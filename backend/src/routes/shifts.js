import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import { query, getWeekDateRange } from '../lib/db.js';
import { checkAndCreditCompOff } from './holidays.js';

const router = Router();

// Helper: safely extract YYYY-MM-DD from a pg DATE value.
// postgres-date parses DATE columns as `new Date(year, month, day)` in the server's
// LOCAL timezone.  Using toISOString() converts to UTC first, which shifts the date
// backward by one day when the server is east of UTC (e.g. IST = UTC+5:30).
// Instead, use the local getters that match how postgres-date created the Date.
function toDateStr(d) {
  if (!d) return null;
  if (d instanceof Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return String(d).slice(0, 10);
}

// Ensure shift_change_requests table exists
(async () => {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS shift_change_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id),
        request_date DATE NOT NULL,
        original_start_time VARCHAR(10),
        original_end_time VARCHAR(10),
        requested_start_time VARCHAR(10) NOT NULL,
        requested_end_time VARCHAR(10) NOT NULL,
        reason TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        approval_chain JSONB DEFAULT '[]',
        rejected_by UUID,
        rejected_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
  } catch (e) {
    console.warn('shift_change_requests table creation skipped:', e.message);
  }

  // Add performed_by column to clock_events if it doesn't exist
  try {
    await query(`ALTER TABLE clock_events ADD COLUMN IF NOT EXISTS performed_by UUID REFERENCES users(id) ON DELETE SET NULL`);
  } catch (e2) {
    console.warn('performed_by column migration skipped:', e2.message);
  }

  // Add device tracking columns to clock_events
  try {
    await query(`ALTER TABLE clock_events ADD COLUMN IF NOT EXISTS device_type VARCHAR(20)`);
  } catch (e3) {
    console.warn('device_type column migration skipped:', e3.message);
  }
  try {
    await query(`ALTER TABLE clock_events ADD COLUMN IF NOT EXISTS user_agent TEXT`);
  } catch (e4) {
    console.warn('user_agent column migration skipped:', e4.message);
  }

  // Add WFH tracking column to clock_events
  try {
    await query(`ALTER TABLE clock_events ADD COLUMN IF NOT EXISTS is_wfh BOOLEAN`);
  } catch (e5) {
    console.warn('is_wfh column migration skipped:', e5.message);
  }

  // Add work_location_default to users
  try {
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS work_location_default VARCHAR(10) DEFAULT 'wfo'`);
  } catch (e6) {
    console.warn('work_location_default column migration skipped:', e6.message);
  }

  // Admin alerts table for flagging suspicious patterns
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS admin_alerts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id),
        alert_type VARCHAR(50) NOT NULL,
        message TEXT NOT NULL,
        details JSONB DEFAULT '{}',
        is_read BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_admin_alerts_unread ON admin_alerts (is_read, created_at DESC);
    `);
  } catch (e5) {
    if (e5.code !== '42P07') console.warn('admin_alerts table creation skipped:', e5.message);
  }
})();

// Simple device detection from User-Agent
function detectDevice(userAgent) {
  if (!userAgent) return 'unknown';
  const ua = userAgent.toLowerCase();
  if (/mobile|android|iphone|ipad|ipod|blackberry|opera mini|iemobile/.test(ua)) return 'mobile';
  return 'desktop';
}

// Check for repeated mobile clock events and create admin alert
// Triggers when an employee has 3+ mobile clock-outs in the last 7 days
const MOBILE_ALERT_THRESHOLD = 3;
const MOBILE_ALERT_WINDOW_DAYS = 7;

async function checkMobileAlert(userId, eventType, deviceType) {
  if (deviceType !== 'mobile') return;
  try {
    const windowStart = new Date();
    windowStart.setDate(windowStart.getDate() - MOBILE_ALERT_WINDOW_DAYS);
    const windowISO = windowStart.toISOString().slice(0, 10);

    // Count mobile clock-outs in the window
    const { rows: [{ count }] } = await query(
      `SELECT COUNT(*)::int AS count FROM clock_events
       WHERE user_id = $1 AND device_type = 'mobile' AND event_type IN ('clock_out', 'out')
         AND shift_date >= $2`,
      [userId, windowISO]
    );

    if (count < MOBILE_ALERT_THRESHOLD) return;

    // Check if we already created an alert for this user this week
    const existing = await query(
      `SELECT id FROM admin_alerts
       WHERE user_id = $1 AND alert_type = 'repeated_mobile_clockout'
         AND created_at >= NOW() - INTERVAL '7 days'
       LIMIT 1`,
      [userId]
    );
    if (existing.rowCount > 0) return; // already alerted this week

    // Get employee name
    const userResult = await query(`SELECT name FROM users WHERE id = $1`, [userId]);
    const empName = userResult.rows[0]?.name || 'Unknown';

    // Also check how many were clock-out on mobile but clock-in on desktop (device mismatch)
    const { rows: [{ mismatch }] } = await query(
      `SELECT COUNT(*)::int AS mismatch FROM clock_events co
       WHERE co.user_id = $1 AND co.device_type = 'mobile' AND co.event_type IN ('clock_out', 'out')
         AND co.shift_date >= $2
         AND EXISTS (
           SELECT 1 FROM clock_events ci
           WHERE ci.user_id = co.user_id AND ci.shift_date = co.shift_date
             AND ci.event_type IN ('clock_in', 'in') AND ci.device_type = 'desktop'
         )`,
      [userId, windowISO]
    );

    const message = mismatch > 0
      ? `${empName} has clocked out from mobile ${count} times in the last 7 days. ${mismatch} of these were after clocking in from desktop — possible early departure.`
      : `${empName} has clocked out from mobile ${count} times in the last 7 days.`;

    await query(
      `INSERT INTO admin_alerts (user_id, alert_type, message, details)
       VALUES ($1, 'repeated_mobile_clockout', $2, $3::jsonb)`,
      [userId, message, JSON.stringify({ mobile_clockouts: count, device_mismatches: mismatch, window_days: MOBILE_ALERT_WINDOW_DAYS })]
    );
    console.log(`Admin alert created: ${message}`);
  } catch (e) {
    console.warn('checkMobileAlert error:', e.message);
  }
}

// ── Auto-clock-out: find employees still clocked in past their buffer deadline ──
// Buffer = 3 hours after shift end. Inserts a system clock_out event.
async function autoClockOutExpired() {
  try {
    const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
    const nowH = nowIST.getHours();
    const nowM = nowIST.getMinutes();
    const nowMinutes = nowH * 60 + nowM;
    const todayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

    // Find users whose last clock event (within 7 days) is a clock_in (i.e. still clocked in)
    const activeResult = await query(
      `SELECT DISTINCT ON (ce.user_id)
         ce.user_id, ce.shift_date, ce.event_type, ce.created_at,
         sa.shift_start_time, sa.shift_end_time
       FROM clock_events ce
       LEFT JOIN shift_assignments sa ON sa.user_id = ce.user_id AND sa.shift_date = ce.shift_date
       WHERE ce.shift_date >= (CURRENT_DATE - INTERVAL '7 days')::date
       ORDER BY ce.user_id, ce.created_at DESC`
    );

    let autoLoggedOut = 0;
    for (const row of activeResult.rows) {
      if (row.event_type !== 'clock_in' && row.event_type !== 'in') continue;
      if (!row.shift_start_time || !row.shift_end_time) continue;

      const shiftDateStr = toDateStr(row.shift_date);

      const [sh, sm] = row.shift_start_time.split(':').map(Number);
      const startMin = sh * 60 + (sm || 0);
      const [eh, em] = row.shift_end_time.split(':').map(Number);
      let endMin = eh * 60 + (em || 0);
      if (endMin <= startMin) endMin += 24 * 60; // overnight

      const bufferDeadline = endMin + 180; // 3 hours after shift end

      // Determine if the buffer has passed
      let currMin = nowMinutes;
      const isShiftToday = shiftDateStr === todayIST;
      const isShiftPast = shiftDateStr < todayIST;

      if (isShiftPast) {
        // Shift date is in the past — check if buffer has passed
        const td = new Date(todayIST + 'T12:00:00'); // noon avoids DST/tz edge cases
        td.setDate(td.getDate() - 1);
        const yesterdayStr = `${td.getFullYear()}-${String(td.getMonth() + 1).padStart(2, '0')}-${String(td.getDate()).padStart(2, '0')}`;

        if (shiftDateStr === yesterdayStr) {
          // Shift was yesterday — buffer may extend past midnight into today
          // (applies to overnight shifts AND late-evening shifts whose buffer extends past midnight)
          currMin += 24 * 60;
          if (currMin <= bufferDeadline) continue; // buffer hasn't passed yet
        }
        // else: older than yesterday, definitely expired
      } else if (isShiftToday) {
        // Today's shift — adjust for overnight
        // Only add 24h if we're in the early morning hours (past midnight, before shift start)
        // e.g. shift 18:30-02:30: if it's 01:00 (60min), we're past midnight in the overnight window
        // But if it's 17:00 (1020min), the shift hasn't started yet — don't adjust
        if (endMin >= 24 * 60 && currMin < startMin && currMin < (endMin - 24 * 60 + 180)) {
          currMin += 24 * 60;
        }
        if (currMin <= bufferDeadline) continue; // buffer hasn't passed yet
      } else {
        continue; // future shift, skip
      }

      // Buffer has passed — auto clock out (only if no clock_out already exists for this shift_date)
      const existing = await query(
        `SELECT 1 FROM clock_events WHERE user_id = $1 AND shift_date = $2 AND (event_type = 'clock_out' OR event_type = 'out') LIMIT 1`,
        [row.user_id, shiftDateStr]
      );
      if (existing.rowCount === 0) {
        await query(
          `INSERT INTO clock_events (user_id, shift_date, event_type, device_type, user_agent) VALUES ($1, $2, 'clock_out', 'system', 'auto-clock-out')`,
          [row.user_id, shiftDateStr]
        );
        autoLoggedOut++;
      }
    }

    if (autoLoggedOut > 0) {
      console.log(`Auto-clocked-out ${autoLoggedOut} employee(s) past buffer deadline`);
    }
  } catch (e) {
    console.warn('autoClockOutExpired error:', e.message);
  }
}

// GET /api/shifts?week=5&year=2025&client_id=uuid  OR  ?from=YYYY-MM-DD&to=YYYY-MM-DD&client_id=uuid
// Returns shift_assignments for that week or date range with clock_events aggregated per user/date
router.get('/', authenticate, async (req, res, next) => {
  try {
    // Auto-clock-out anyone past their buffer before returning data
    await autoClockOutExpired();

    const clientId = req.query.client_id || null;
    let startDate, endDate;
    const from = req.query.from && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : null;
    const to = req.query.to && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to) ? req.query.to : null;
    if (from && to && from <= to) {
      startDate = from;
      endDate = to;
    } else {
      const year = parseInt(req.query.year, 10) || new Date().getFullYear();
      const week = parseInt(req.query.week, 10) || 1;
      const range = getWeekDateRange(year, week);
      startDate = range.startDate;
      endDate = range.endDate;
    }

    const r = await query(
      `SELECT
         u.id AS user_id,
         u.name AS employee_name,
         u.role,
         u.department_id,
         d.name AS department_name,
         COALESCE(u.client_id, sa.client_id) AS client_id,
         sa.shift_date,
         sa.shift_start_time,
         sa.shift_end_time,
         (SELECT ce_in.created_at FROM clock_events ce_in
          WHERE ce_in.user_id = u.id AND ce_in.shift_date = sa.shift_date AND ce_in.event_type IN ('clock_in','in')
          ORDER BY ce_in.created_at DESC LIMIT 1) AS clock_in_at,
         (SELECT ce_out.created_at FROM clock_events ce_out
          WHERE ce_out.user_id = u.id AND ce_out.shift_date = sa.shift_date AND ce_out.event_type IN ('clock_out','out')
          ORDER BY ce_out.created_at DESC LIMIT 1) AS clock_out_at,
         (SELECT pb_in.name FROM clock_events ce_in2
          JOIN users pb_in ON pb_in.id = ce_in2.performed_by
          WHERE ce_in2.user_id = u.id AND ce_in2.shift_date = sa.shift_date AND ce_in2.event_type IN ('clock_in','in') AND ce_in2.performed_by IS NOT NULL AND ce_in2.performed_by != u.id
          ORDER BY ce_in2.created_at DESC LIMIT 1) AS clock_in_by,
         (SELECT pb_out.name FROM clock_events ce_out2
          JOIN users pb_out ON pb_out.id = ce_out2.performed_by
          WHERE ce_out2.user_id = u.id AND ce_out2.shift_date = sa.shift_date AND ce_out2.event_type IN ('clock_out','out') AND ce_out2.performed_by IS NOT NULL AND ce_out2.performed_by != u.id
          ORDER BY ce_out2.created_at DESC LIMIT 1) AS clock_out_by,
         (SELECT ce_ind.device_type FROM clock_events ce_ind
          WHERE ce_ind.user_id = u.id AND ce_ind.shift_date = sa.shift_date AND ce_ind.event_type IN ('clock_in','in')
          ORDER BY ce_ind.created_at DESC LIMIT 1) AS clock_in_device,
         (SELECT ce_outd.device_type FROM clock_events ce_outd
          WHERE ce_outd.user_id = u.id AND ce_outd.shift_date = sa.shift_date AND ce_outd.event_type IN ('clock_out','out')
          ORDER BY ce_outd.created_at DESC LIMIT 1) AS clock_out_device
       FROM shift_assignments sa
       JOIN users u ON u.id = sa.user_id AND u.deleted_at IS NULL
       LEFT JOIN departments d ON d.id = u.department_id
       WHERE sa.shift_date >= $1 AND sa.shift_date <= $2
         AND ($3::uuid IS NULL OR u.client_id = $3 OR u.id IN (SELECT uca.user_id FROM user_client_assignments uca WHERE uca.client_id = $3))
       ORDER BY sa.shift_date, u.name`,
      [startDate, endDate, clientId]
    );

    // Normalize for frontend: one row per user per shift_date; format times
    const rows = r.rows.map((row) => ({
      user_id: row.user_id,
      employee_name: row.employee_name,
      role: row.role,
      department_id: row.department_id,
      department_name: row.department_name,
      client_id: row.client_id,
      shift_date: toDateStr(row.shift_date),
      shift_start_time: row.shift_start_time,
      shift_end_time: row.shift_end_time,
      shift_time: `${row.shift_start_time} - ${row.shift_end_time}`,
      clock_in_at: row.clock_in_at,
      clock_out_at: row.clock_out_at,
      clock_in_by: row.clock_in_by || null,
      clock_out_by: row.clock_out_by || null,
      clock_in_device: row.clock_in_device || null,
      clock_out_device: row.clock_out_device || null,
    }));
    res.json({ shifts: rows });
  } catch (e) {
    next(e);
  }
});

// GET /api/shifts/my-status?date=YYYY-MM-DD — current user's clock-in/out for a day (from clock_events only, no shift_assignment needed)
// Also checks recent dates for an active overnight clock-in that hasn't been clocked out yet
router.get('/my-status', authenticate, async (req, res, next) => {
  try {
    // Auto-clock-out expired shifts before checking status
    await autoClockOutExpired();

    const tz = req.query.timezone || 'Asia/Kolkata';
    const today = new Date().toLocaleDateString('en-CA', { timeZone: tz });
    const date = (req.query.date && /^\d{4}-\d{2}-\d{2}$/.test(req.query.date))
      ? req.query.date
      : today;
    const r = await query(
      `SELECT event_type, created_at FROM clock_events
       WHERE user_id = $1 AND shift_date = $2
       ORDER BY created_at DESC`,
      [req.user.sub, date]
    );
    const rows = r.rows || [];
    const lastIn = rows.find((x) => x.event_type === 'clock_in' || x.event_type === 'in');
    const lastOut = rows.find((x) => x.event_type === 'clock_out' || x.event_type === 'out');
    let clockedIn = !!lastIn && (!lastOut || new Date(lastOut.created_at) < new Date(lastIn.created_at));
    let clockedInAt = lastIn ? new Date(lastIn.created_at).toISOString() : null;
    let activeShiftDate = null;

    // If no active clock-in on requested date, check recent dates for overnight/previous-day clock-in
    if (!clockedIn) {
      const recentResult = await query(
        `SELECT shift_date, event_type, created_at FROM clock_events
         WHERE user_id = $1 AND shift_date >= (CURRENT_DATE - INTERVAL '7 days')::date
         ORDER BY created_at DESC LIMIT 1`,
        [req.user.sub]
      );
      if (recentResult.rows.length > 0) {
        const latest = recentResult.rows[0];
        if (latest.event_type === 'clock_in' || latest.event_type === 'in') {
          // Still clocked in from a previous date (e.g. overnight shift)
          clockedIn = true;
          clockedInAt = new Date(latest.created_at).toISOString();
          activeShiftDate = toDateStr(latest.shift_date);
        }
      }
    }

    res.json({
      shift_date: date,
      clocked_in: clockedIn,
      clocked_in_at: clockedInAt,
      active_shift_date: activeShiftDate,
    });
  } catch (e) {
    next(e);
  }
});

// POST /api/shifts/clock-in  body: { shift_date?, timezone? } (default today in user's timezone)
const clockInSchema = z.object({ shift_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), timezone: z.string().optional(), is_wfh: z.boolean().optional() });
router.post('/clock-in', authenticate, async (req, res, next) => {
  try {
    const tz = req.body?.timezone || 'Asia/Kolkata';
    const now = new Date();
    const localDate = now.toLocaleDateString('en-CA', { timeZone: tz });
    const parsed = clockInSchema.parse(req.body || {});
    const shiftDate = parsed.shift_date || localDate;
    const isWfh = parsed.is_wfh;

    // Check if employee has an assigned shift for today
    const shiftResult = await query(
      `SELECT shift_start_time, shift_end_time, is_off FROM shift_assignments
       WHERE user_id = $1 AND shift_date = $2
       ORDER BY updated_at DESC LIMIT 1`,
      [req.user.sub, shiftDate]
    );

    // Only C-suite / top leadership bypass the clock-in time window. All other
    // roles — including regular admins, managers, team leads, and employees —
    // are held to the buffer and must request a shift swap when they miss it.
    // Titles recognized as leadership: CEO, President, Founder, Chairman, COO, CTO, CFO.
    let skipTimeWindow = false;
    try {
      const roleResult = await query(`SELECT role, designation FROM users WHERE id = $1`, [req.user.sub]);
      const u = roleResult.rows[0] || {};
      const d = (u.designation || '').toLowerCase();
      const isLeadership = !!d && /\b(ceo|president|founder|chairman|coo|cto|cfo|chief executive)\b/.test(d);
      if (u.role === 'admin' && isLeadership) skipTimeWindow = true;
    } catch (e) {
      // ignore — fall back to default enforcement
    }

    if (shiftResult.rowCount > 0) {
      const shift = shiftResult.rows[0];
      // If shift exists and is not OFF with valid times, enforce time window (unless admin)
      if (shift.shift_start_time && shift.shift_end_time && !shift.is_off && !skipTimeWindow) {
        let allowedStart = shift.shift_start_time;
        let allowedEnd = shift.shift_end_time;

        // Check for approved shift change request for this date
        try {
          const scrResult = await query(
            `SELECT requested_start_time, requested_end_time FROM shift_change_requests
             WHERE user_id = $1 AND request_date = $2 AND status = 'approved'
             ORDER BY updated_at DESC LIMIT 1`,
            [req.user.sub, shiftDate]
          );
          if (scrResult.rowCount > 0) {
            allowedStart = scrResult.rows[0].requested_start_time;
            allowedEnd = scrResult.rows[0].requested_end_time;
          }
        } catch (e) {
          // shift_change_requests may not exist yet
        }

        // Get current IST time
        const istTimeStr = now.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false }); // HH:MM:SS
        const [nowH, nowM] = istTimeStr.split(':').map(Number);
        const nowMinutes = nowH * 60 + nowM;

        const [startH, startM] = allowedStart.split(':').map(Number);
        const startMinutes = startH * 60 + startM;

        const [endH, endM] = allowedEnd.split(':').map(Number);
        let endMinutes = endH * 60 + endM;

        // Handle overnight shifts (e.g. 22:00 - 06:00)
        if (endMinutes <= startMinutes) {
          endMinutes += 24 * 60;
        }

        // Allow 1 hour buffer before shift start, and 1 hour after shift start for clock-in
        let diff = nowMinutes - startMinutes;
        // Normalize difference to handle midnight wrapping (e.g. 23:30 vs 00:00)
        if (diff > 12 * 60) diff -= 24 * 60;
        else if (diff < -12 * 60) diff += 24 * 60;

        if (diff < -60 || diff > 60) {
          const fmtTime = (h, m) => {
            const ampm = h >= 12 ? 'PM' : 'AM';
            const hr = h % 12 || 12;
            return `${hr}:${String(m).padStart(2, '0')} ${ampm}`;
          };
          const [aH, aM] = allowedStart.split(':').map(Number);
          const [aEH, aEM] = allowedEnd.split(':').map(Number);
          const bufferStartH = Math.floor((startMinutes - 60) / 60 + 24) % 24;
          const bufferStartM = ((startMinutes - 60) % 60 + 60) % 60;
          const bufferEndH = Math.floor((startMinutes + 60) / 60) % 24;
          const bufferEndM = (startMinutes + 60) % 60;
          // Past buffer: offer shift swap instead of silently rejecting
          const pastBuffer = diff > 60;
          return res.status(403).json({
            error: `You can only clock in between ${fmtTime(bufferStartH, bufferStartM)} and ${fmtTime(bufferEndH, bufferEndM)} IST (1 hour before/after your shift start at ${fmtTime(aH, aM)} IST).`,
            shift_start: allowedStart,
            shift_end: allowedEnd,
            past_buffer: pastBuffer,
            offer_shift_swap: pastBuffer,
            shift_date: shiftDate,
          });
        }
      }
    }
    // If no shift assignment exists, allow clock-in (don't block people without schedules)

    const userAgent = req.headers['user-agent'] || '';
    const deviceType = detectDevice(userAgent);
    await query(
      `INSERT INTO clock_events (user_id, shift_date, event_type, device_type, user_agent, is_wfh) VALUES ($1, $2, 'clock_in', $3, $4, $5)`,
      [req.user.sub, shiftDate, deviceType, userAgent, isWfh != null ? isWfh : null]
    );
    // Check for repeated mobile usage alerts
    checkMobileAlert(req.user.sub, 'clock_in', deviceType);
    res.status(201).json({ ok: true, shift_date: shiftDate });
  } catch (e) {
    if (e.name === 'ZodError') return res.status(400).json({ error: e.errors.map(err => err.message).join(', ') });
    next(e);
  }
});

router.post('/clock-out', authenticate, async (req, res, next) => {
  try {
    const tz = req.body?.timezone || 'Asia/Kolkata'; // default IST
    const now = new Date();
    const localDate = now.toLocaleDateString('en-CA', { timeZone: tz }); // YYYY-MM-DD format
    const requestedShiftDate = (req.body && req.body.shift_date) || localDate;

    // --- Step 1: Find the active clock-in across recent dates (handles overnight shifts) ---
    const activeResult = await query(
      `SELECT shift_date, event_type, created_at FROM clock_events
       WHERE user_id = $1 AND shift_date >= (CURRENT_DATE - INTERVAL '7 days')::date
       ORDER BY created_at DESC LIMIT 1`,
      [req.user.sub]
    );

    if (activeResult.rows.length === 0 || (activeResult.rows[0].event_type !== 'clock_in' && activeResult.rows[0].event_type !== 'in')) {
      return res.status(400).json({ error: 'You are not currently clocked in' });
    }

    const activeRow = activeResult.rows[0];
    const activeShiftDate = toDateStr(activeRow.shift_date);

    // Determine which shift_date to use for the clock-out event
    // Always clock out on the same shift_date as the active clock-in
    const shiftDate = activeShiftDate;
    const isCrossDate = shiftDate !== localDate;

    // No time restriction on clock-out — always allow it.
    // If the buffer has passed, the auto-clock-out system handles it,
    // but manual clock-out should never be blocked.

    const userAgent = req.headers['user-agent'] || '';
    const deviceType = detectDevice(userAgent);
    await query(
      `INSERT INTO clock_events (user_id, shift_date, event_type, device_type, user_agent) VALUES ($1, $2, 'clock_out', $3, $4)`,
      [req.user.sub, shiftDate, deviceType, userAgent]
    );
    // Check for repeated mobile usage alerts
    checkMobileAlert(req.user.sub, 'clock_out', deviceType);

    // Calculate hours worked to see if they qualify for comp-off (min 8 hours)
    let compOff = null;
    try {
      const inEvent = await query(
        `SELECT created_at FROM clock_events 
         WHERE user_id = $1 AND shift_date = $2 AND event_type IN ('clock_in', 'in') 
         ORDER BY created_at DESC LIMIT 1`,
        [req.user.sub, shiftDate]
      );
      if (inEvent.rows.length > 0) {
        const inTime = new Date(inEvent.rows[0].created_at);
        const outTime = new Date(); // now
        const hoursWorked = (outTime - inTime) / (1000 * 60 * 60);
        if (hoursWorked >= 8) {
          compOff = await checkAndCreditCompOff(req.user.sub, shiftDate);
        }
      }
    } catch (err) {
      console.warn('Comp-off calculation error:', err.message);
    }

    res.json({ ok: true, shift_date: shiftDate, comp_off: compOff || undefined });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// POST /api/shifts/admin-clock-in — Superior (admin/manager/team_lead) clocks in an employee (no time restrictions)
// ---------------------------------------------------------------------------
router.post('/admin-clock-in', authenticate, requireRole('admin', 'manager', 'team_lead'), async (req, res, next) => {
  try {
    const { user_id, shift_date } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });

    // ── Role hierarchy check ──
    // admin → can clock in anyone | manager → employees + team_leads | team_lead → employees only
    const targetUser = await query(`SELECT role FROM users WHERE id = $1 AND deleted_at IS NULL`, [user_id]);
    if (targetUser.rows.length === 0) return res.status(404).json({ error: 'Employee not found' });
    const targetRole = targetUser.rows[0].role;
    const actorRole = req.user.role;
    const ROLE_LEVEL = { employee: 0, team_lead: 1, manager: 2, admin: 3 };
    if ((ROLE_LEVEL[actorRole] || 0) <= (ROLE_LEVEL[targetRole] || 0)) {
      return res.status(403).json({ error: `A ${actorRole.replace('_', ' ')} cannot clock in a ${targetRole.replace('_', ' ')}` });
    }

    const tz = 'Asia/Kolkata';
    const today = new Date().toLocaleDateString('en-CA', { timeZone: tz });
    const date = (shift_date && /^\d{4}-\d{2}-\d{2}$/.test(shift_date)) ? shift_date : today;

    // Check if the employee is already actively clocked in for this date.
    // For past dates: only block if the LAST event is a clock_in (i.e. they haven't clocked out yet).
    // If they have a complete clock_in + clock_out pair, allow adding another clock_in.
    const existing = await query(
      `SELECT event_type FROM clock_events WHERE user_id = $1 AND shift_date = $2 ORDER BY created_at DESC LIMIT 1`,
      [user_id, date]
    );
    if (existing.rows.length > 0 && (existing.rows[0].event_type === 'clock_in' || existing.rows[0].event_type === 'in')) {
      return res.status(400).json({ error: 'Employee is already clocked in for this date. Clock them out first.' });
    }

    const adminUA = req.headers['user-agent'] || '';
    await query(
      `INSERT INTO clock_events (user_id, shift_date, event_type, performed_by, device_type, user_agent) VALUES ($1, $2, 'clock_in', $3, 'admin', $4)`,
      [user_id, date, req.user.sub, adminUA]
    );

    // Get employee name for response
    const userResult = await query(`SELECT name FROM users WHERE id = $1`, [user_id]);
    const empName = userResult.rows[0]?.name || 'Employee';

    res.status(201).json({ ok: true, shift_date: date, message: `${empName} clocked in by ${req.user.name || 'supervisor'}` });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// POST /api/shifts/admin-clock-out — Superior (admin/manager/team_lead) clocks out an employee (no time restrictions)
// Searches across all recent shift dates to find the active clock-in (handles overnight/forgot-logout)
// ---------------------------------------------------------------------------
router.post('/admin-clock-out', authenticate, requireRole('admin', 'manager', 'team_lead'), async (req, res, next) => {
  try {
    const { user_id, shift_date } = req.body;
    if (!user_id) return res.status(400).json({ error: 'user_id is required' });

    // ── Role hierarchy check ──
    const targetUser = await query(`SELECT role FROM users WHERE id = $1 AND deleted_at IS NULL`, [user_id]);
    if (targetUser.rows.length === 0) return res.status(404).json({ error: 'Employee not found' });
    const targetRole = targetUser.rows[0].role;
    const actorRole = req.user.role;
    const ROLE_LEVEL = { employee: 0, team_lead: 1, manager: 2, admin: 3 };
    if ((ROLE_LEVEL[actorRole] || 0) <= (ROLE_LEVEL[targetRole] || 0)) {
      return res.status(403).json({ error: `A ${actorRole.replace('_', ' ')} cannot clock out a ${targetRole.replace('_', ' ')}` });
    }
    const tz = 'Asia/Kolkata';
    const today = new Date().toLocaleDateString('en-CA', { timeZone: tz });

    let targetShiftDate;

    // Helper: check if a clock-out was a glitch (< 2 min after the preceding clock-in)
    const isGlitchClockOut = async (userId, shiftDate) => {
      const pair = await query(
        `SELECT event_type, created_at FROM clock_events WHERE user_id = $1 AND shift_date = $2 ORDER BY created_at DESC LIMIT 2`,
        [userId, shiftDate]
      );
      if (pair.rows.length >= 2) {
        const [latest, prev] = pair.rows;
        const isOut = latest.event_type === 'clock_out' || latest.event_type === 'out';
        const isIn = prev.event_type === 'clock_in' || prev.event_type === 'in';
        if (isOut && isIn) {
          const gap = new Date(latest.created_at).getTime() - new Date(prev.created_at).getTime();
          if (gap < 2 * 60 * 1000) return true; // < 2 min = glitch
        }
      }
      return false;
    };

    if (shift_date && /^\d{4}-\d{2}-\d{2}$/.test(shift_date)) {
      // Admin specified a specific date — check that there's an active clock_in on that date
      const dateResult = await query(
        `SELECT event_type FROM clock_events WHERE user_id = $1 AND shift_date = $2 ORDER BY created_at DESC LIMIT 1`,
        [user_id, shift_date]
      );
      if (dateResult.rows.length === 0) {
        return res.status(400).json({ error: `Employee is not clocked in for ${shift_date}` });
      }
      const lastEvent = dateResult.rows[0]?.event_type;
      const isIn = lastEvent === 'clock_in' || lastEvent === 'in';
      if (!isIn) {
        // Check if there's any clock-in at all on this date — admin can force clock-out
        const hasClockIn = await query(
          `SELECT 1 FROM clock_events WHERE user_id = $1 AND shift_date = $2 AND event_type IN ('clock_in', 'in') LIMIT 1`,
          [user_id, shift_date]
        );
        if (hasClockIn.rows.length === 0) {
          return res.status(400).json({ error: `Employee is not clocked in for ${shift_date}` });
        }
      }
      targetShiftDate = shift_date;
    } else {
      // No date specified — find the most recent active clock-in (original behavior)
      const activeResult = await query(
        `SELECT shift_date, event_type, created_at FROM clock_events
         WHERE user_id = $1 AND shift_date >= (CURRENT_DATE - INTERVAL '7 days')::date
         ORDER BY created_at DESC LIMIT 1`,
        [user_id]
      );

      if (activeResult.rows.length === 0) {
        return res.status(400).json({ error: 'Employee is not currently clocked in' });
      }

      const lastEvent = activeResult.rows[0].event_type;
      const isIn = lastEvent === 'clock_in' || lastEvent === 'in';
      const sd = toDateStr(activeResult.rows[0].shift_date);

      // Check if there's a clock-in on this date at all (even if last event is clock-out from glitch)
      if (!isIn) {
        const hasClockIn = await query(
          `SELECT 1 FROM clock_events WHERE user_id = $1 AND shift_date = $2 AND event_type IN ('clock_in', 'in') LIMIT 1`,
          [user_id, sd]
        );
        if (hasClockIn.rows.length === 0) {
          return res.status(400).json({ error: 'Employee is not currently clocked in' });
        }
        // Has a clock-in on this date — admin override: allow clock-out
      }

      targetShiftDate = sd;
    }

    const adminUA = req.headers['user-agent'] || '';
    await query(
      `INSERT INTO clock_events (user_id, shift_date, event_type, performed_by, device_type, user_agent) VALUES ($1, $2, 'clock_out', $3, 'admin', $4)`,
      [user_id, targetShiftDate, req.user.sub, adminUA]
    );

    const userResult = await query(`SELECT name FROM users WHERE id = $1`, [user_id]);
    const empName = userResult.rows[0]?.name || 'Employee';

    // Calculate hours worked for comp off
    let compOffMsg = '';
    try {
      const inEvent = await query(
        `SELECT created_at FROM clock_events 
         WHERE user_id = $1 AND shift_date = $2 AND event_type IN ('clock_in', 'in') 
         ORDER BY created_at DESC LIMIT 1`,
        [user_id, targetShiftDate]
      );
      if (inEvent.rows.length > 0) {
        const inTime = new Date(inEvent.rows[0].created_at);
        const outTime = new Date(); // now
        const hoursWorked = (outTime - inTime) / (1000 * 60 * 60);
        if (hoursWorked >= 8) {
          const compResult = await checkAndCreditCompOff(user_id, targetShiftDate);
          if (compResult) compOffMsg = ' (Eligible for Comp Off)';
        }
      }
    } catch (err) {
      console.warn('Admin Comp-off calculation error:', err.message);
    }

    res.json({ ok: true, shift_date: targetShiftDate, message: `${empName} clocked out by ${req.user.name || 'supervisor'}${compOffMsg}` });
  } catch (e) {
    next(e);
  }
});

// GET /api/shifts/grid?from=YYYY-MM-DD&to=YYYY-MM-DD&client_id= — schedule grid for date range (for display / in-app builder)
router.get('/grid', authenticate, async (req, res, next) => {
  try {
    const from = req.query.from && /^\d{4}-\d{2}-\d{2}$/.test(req.query.from) ? req.query.from : null;
    const to = req.query.to && /^\d{4}-\d{2}-\d{2}$/.test(req.query.to) ? req.query.to : null;
    const clientId = req.query.client_id || null;
    const departmentId = req.query.department_id || null;
    if (!from || !to || from > to) return res.status(400).json({ error: 'Query from and to (YYYY-MM-DD) required, from <= to' });
    let r;
    try {
      r = await query(
        `SELECT sa.user_id, u.name AS employee_name, u.role, sa.shift_date,
                sa.shift_start_time, sa.shift_end_time, sa.is_off
         FROM shift_assignments sa
         JOIN users u ON u.id = sa.user_id AND u.deleted_at IS NULL
         WHERE sa.shift_date >= $1 AND sa.shift_date <= $2
           AND CASE
             WHEN $3::uuid IS NOT NULL THEN
               -- Specific client selected: shift must be for that client (or null fallback) AND user must currently belong to it
               (sa.client_id = $3 OR sa.client_id IS NULL)
               AND (u.client_id = $3 OR u.id IN (SELECT uca.user_id FROM user_client_assignments uca WHERE uca.client_id = $3))
             ELSE
               -- No client filter: only return shifts from the user's own primary client to avoid cross-client noise
               (sa.client_id = u.client_id OR sa.client_id IS NULL)
           END
           AND ($4::uuid IS NULL OR u.department_id = $4 OR u.id IN (SELECT uda.user_id FROM user_department_assignments uda WHERE uda.department_id = $4))
         ORDER BY u.name, sa.shift_date`,
        [from, to, clientId, departmentId]
      );
    } catch (e) {
      if (e.code === '42703' || e.code === '42P01') {
        try {
          r = await query(
            `SELECT sa.user_id, u.name AS employee_name, u.role, sa.shift_date,
                    sa.shift_start_time, sa.shift_end_time
             FROM shift_assignments sa
             JOIN users u ON u.id = sa.user_id AND u.deleted_at IS NULL
             WHERE sa.shift_date >= $1 AND sa.shift_date <= $2
               AND CASE
                 WHEN $3::uuid IS NOT NULL THEN
                   (sa.client_id = $3 OR sa.client_id IS NULL) AND u.client_id = $3
                 ELSE
                   (sa.client_id = u.client_id OR sa.client_id IS NULL)
               END
               AND ($4::uuid IS NULL OR u.department_id = $4)
             ORDER BY u.name, sa.shift_date`,
            [from, to, clientId, departmentId]
          );
        } catch (e2) {
          throw e2;
        }
      } else throw e;
    }
    const dates = [];
    for (let d = new Date(from + 'T12:00:00'); d <= new Date(to + 'T12:00:00'); d.setDate(d.getDate() + 1)) {
      dates.push(toDateStr(d));
    }
    // Fetch approved leaves for the date range
    let leaveMap = {}; // { `${user_id}-${date}` : true }
    try {
      const leaveResult = await query(
        `SELECT lr.employee_id, generate_series(lr.start_date, lr.end_date, '1 day'::interval)::date AS leave_date
         FROM leave_requests lr
         WHERE lr.status = 'approved'
           AND lr.start_date <= $2::date
           AND lr.end_date >= $1::date`,
        [from, to]
      );
      (leaveResult.rows || []).forEach((row) => {
        const d = toDateStr(row.leave_date);
        leaveMap[`${row.employee_id}-${d}`] = true;
      });
    } catch (e) {
      // leave_requests table may not exist; silently continue
      console.warn('Could not fetch leave data for grid:', e.message);
    }

    const byUser = {};
    (r.rows || []).forEach((row) => {
      if (!byUser[row.user_id]) byUser[row.user_id] = { user_id: row.user_id, employee_name: row.employee_name, role: row.role, shifts: {}, leaves: {} };
      const key = toDateStr(row.shift_date);
      const isOff = row.is_off === true || (row.shift_start_time == null && row.shift_end_time == null);
      byUser[row.user_id].shifts[key] = isOff ? 'OFF' : `${row.shift_start_time}-${row.shift_end_time}`;
      if (leaveMap[`${row.user_id}-${key}`]) {
        byUser[row.user_id].leaves[key] = true;
      }
    });

    // Also add leave-only entries for users who have approved leaves but may not have shifts
    Object.keys(leaveMap).forEach((mapKey) => {
      const [userId, dateStr] = [mapKey.substring(0, 36), mapKey.substring(37)];
      if (!dates.includes(dateStr)) return;
      if (byUser[userId]) {
        byUser[userId].leaves[dateStr] = true;
      }
    });

    // Include users assigned to the filtered client/department who have no shifts yet
    // so newly added employees show up in the schedule grid
    if (clientId || departmentId) {
      try {
        const conditions = ['u.deleted_at IS NULL', 'u.is_active = true'];
        const vals = [];
        if (clientId) {
          vals.push(clientId);
          conditions.push(`(u.client_id = $${vals.length} OR u.id IN (SELECT uca.user_id FROM user_client_assignments uca WHERE uca.client_id = $${vals.length}))`);
        }
        if (departmentId) {
          vals.push(departmentId);
          conditions.push(`(u.department_id = $${vals.length} OR u.id IN (SELECT uda.user_id FROM user_department_assignments uda WHERE uda.department_id = $${vals.length}))`);
        }
        const missingUsers = await query(
          `SELECT u.id, u.name, u.role FROM users u WHERE ${conditions.join(' AND ')} ORDER BY u.name`,
          vals
        );
        (missingUsers.rows || []).forEach((u) => {
          if (!byUser[u.id]) {
            byUser[u.id] = { user_id: u.id, employee_name: u.name, role: u.role, shifts: {}, leaves: {} };
          }
        });
      } catch (_e) {
        // user_client_assignments table may not exist; silently continue
      }
    }

    const sortedRows = Object.values(byUser).sort((a, b) => (a.employee_name || '').localeCompare(b.employee_name || ''));
    res.json({ dates, rows: sortedRows });
  } catch (e) {
    next(e);
  }
});

// GET /api/shifts/schedule-info?client_id= — get the last scheduled date for a client (or all)
router.get('/schedule-info', authenticate, async (req, res, next) => {
  try {
    const clientId = req.query.client_id || null;
    const r = await query(
      `SELECT MAX(sa.shift_date) AS last_date, MIN(sa.shift_date) AS first_date, COUNT(DISTINCT sa.user_id)::int AS employee_count
       FROM shift_assignments sa
       JOIN users u ON u.id = sa.user_id AND u.deleted_at IS NULL
       WHERE ($1::uuid IS NULL OR 
              ( (sa.client_id = $1 OR sa.client_id IS NULL) AND (u.client_id = $1 OR u.id IN (SELECT uca.user_id FROM user_client_assignments uca WHERE uca.client_id = $1)) )
             )
         AND sa.is_off = false`,
      [clientId]
    );
    const info = r.rows[0] || {};
    const lastDate = toDateStr(info.last_date);
    const firstDate = toDateStr(info.first_date);
    res.json({ last_date: lastDate, first_date: firstDate, employee_count: info.employee_count || 0 });
  } catch (e) {
    next(e);
  }
});

// POST /api/shifts/bulk — create/update schedule in-app (TL/manager): array of { user_id, client_id, shift_date, shift_start_time?, shift_end_time?, is_off? }
const bulkSchema = z.object({
  client_id: z.string().uuid().optional().nullable(),
  department_id: z.string().uuid().optional().nullable(),
  assignments: z.array(z.object({
    user_id: z.string().uuid(),
    shift_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    shift_start_time: z.string().optional().nullable(),
    shift_end_time: z.string().optional().nullable(),
    is_off: z.boolean().optional(),
  })),
  leave_entries: z.array(z.object({
    user_id: z.string().uuid(),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  })).optional(),
});
router.post('/bulk', authenticate, requireRole('admin', 'manager', 'team_lead'), async (req, res, next) => {
  try {
    const parsed = bulkSchema.parse(req.body);
    let { client_id } = parsed;
    const { department_id, assignments } = parsed;
    if (assignments.length === 0) {
      return res.status(201).json({ ok: true, count: 0 });
    }

    // When saving without a specific client_id, look up each user's client_id from the users table
    let userClientMap = {};
    if (!client_id) {
      const userIds = [...new Set(assignments.map((a) => a.user_id))];
      const ph = userIds.map((_, i) => `$${i + 1}`).join(', ');
      const ucResult = await query(`SELECT id, client_id FROM users WHERE id IN (${ph})`, userIds);
      ucResult.rows.forEach((r) => { userClientMap[r.id] = r.client_id; });
    }
    // Separate assignments into those with and without client_id
    const withClient = [];
    const withoutClient = [];
    assignments.forEach((a) => {
      const isOff = a.is_off || (!a.shift_start_time && !a.shift_end_time);
      const resolvedClientId = client_id || userClientMap[a.user_id] || null;
      const entry = { user_id: a.user_id, client_id: resolvedClientId, shift_date: a.shift_date, start: a.shift_start_time || null, end: a.shift_end_time || null, isOff };
      if (resolvedClientId) withClient.push(entry);
      else withoutClient.push(entry);
    });

    let totalInserted = 0;

    // Insert assignments WITH client_id (uses user_id, client_id, shift_date unique index)
    if (withClient.length > 0) {
      const params = [];
      const placeholders = [];
      withClient.forEach((e) => {
        const base = params.length + 1;
        placeholders.push(`($${base}, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`);
        params.push(e.user_id, e.client_id, e.shift_date, e.start, e.end, e.isOff);
      });
      await query(
        `INSERT INTO shift_assignments (user_id, client_id, shift_date, shift_start_time, shift_end_time, is_off)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (user_id, client_id, shift_date) WHERE client_id IS NOT NULL
         DO UPDATE SET shift_start_time = EXCLUDED.shift_start_time, shift_end_time = EXCLUDED.shift_end_time, is_off = EXCLUDED.is_off, updated_at = now()`,
        params
      );
      totalInserted += withClient.length;
    }

    // Insert assignments WITHOUT client_id (internal departments — uses user_id, shift_date unique index)
    if (withoutClient.length > 0) {
      const params = [];
      const placeholders = [];
      withoutClient.forEach((e) => {
        const base = params.length + 1;
        placeholders.push(`($${base}, NULL, $${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`);
        params.push(e.user_id, e.shift_date, e.start, e.end, e.isOff);
      });
      await query(
        `INSERT INTO shift_assignments (user_id, client_id, shift_date, shift_start_time, shift_end_time, is_off)
         VALUES ${placeholders.join(', ')}
         ON CONFLICT (user_id, shift_date) WHERE client_id IS NULL
         DO UPDATE SET shift_start_time = EXCLUDED.shift_start_time, shift_end_time = EXCLUDED.shift_end_time, is_off = EXCLUDED.is_off, updated_at = now()`,
        params
      );
      totalInserted += withoutClient.length;
    }

    if (totalInserted === 0) {
      return res.status(400).json({ error: 'No valid assignments to save.' });
    }
    // Handle leave entries — create leave_requests for each LEAVE-marked cell
    const leaveEntries = parsed.leave_entries || [];
    if (leaveEntries.length > 0) {
      for (const le of leaveEntries) {
        try {
          await query(
            `INSERT INTO leave_requests (employee_id, start_date, end_date, total_days, leave_type, status, reason)
             VALUES ($1, $2, $2, 1, 'casual', 'approved', 'Marked as leave in schedule builder')
             ON CONFLICT DO NOTHING`,
            [le.user_id, le.date]
          );
        } catch (_e) {
          // skip if leave_requests table doesn't have these columns or conflicts
        }
      }
    }
    res.status(201).json({ ok: true, count: assignments.length, leaves: leaveEntries.length });
  } catch (e) {
    if (e.code === '42703') return res.status(501).json({ error: 'Run migration 002 to add is_off column. If you use 001 schema, run docs/migrations/004_shift_assignments_date_based.sql first.' });
    if (e.code === '42P10' || (e.message && /ON CONFLICT|conflict target|unique constraint/.test(e.message))) return res.status(501).json({ error: 'Run migration 006: docs/migrations/006_nullable_client_in_shifts.sql to update unique constraints for nullable client_id.' });
    if (e.name === 'ZodError') return res.status(400).json({ error: e.errors.map(err => err.message).join(', ') });
    next(e);
  }
});

// ── Admin Alerts ─────────────────────────────────────────────────
// GET /api/shifts/admin-alerts — list unread admin alerts (admin/manager/team_lead only)
router.get('/admin-alerts', authenticate, requireRole('admin', 'manager', 'team_lead'), async (req, res, next) => {
  try {
    const showAll = req.query.all === 'true';
    let filter = showAll ? '' : 'WHERE a.is_read = false';
    
    try {
      const recFilter = showAll 
        ? 'WHERE (a.recipient_user_id IS NULL OR a.recipient_user_id = $1)'
        : 'WHERE a.is_read = false AND (a.recipient_user_id IS NULL OR a.recipient_user_id = $1)';
      
      const { rows } = await query(
        `SELECT a.*, u.name AS employee_name
         FROM admin_alerts a
         JOIN users u ON u.id = a.user_id
         ${recFilter}
         ORDER BY a.created_at DESC
         LIMIT 50`,
        [req.user.sub]
      );
      return res.json({ alerts: rows });
    } catch (e) {
      if (e.code === '42703') { // column "recipient_user_id" does not exist
        const { rows } = await query(
          `SELECT a.*, u.name AS employee_name
           FROM admin_alerts a
           JOIN users u ON u.id = a.user_id
           ${filter}
           ORDER BY a.created_at DESC
           LIMIT 50`
        );
        return res.json({ alerts: rows });
      } else throw e;
    }
  } catch (e) {
    next(e);
  }
});

// PATCH /api/shifts/admin-alerts/:id/read — mark alert as read
router.patch('/admin-alerts/:id/read', authenticate, requireRole('admin', 'manager', 'team_lead'), async (req, res, next) => {
  try {
    await query(`UPDATE admin_alerts SET is_read = true WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// PATCH /api/shifts/admin-alerts/read-all — mark all alerts as read
router.patch('/admin-alerts/read-all', authenticate, requireRole('admin', 'manager', 'team_lead'), async (req, res, next) => {
  try {
    await query(`UPDATE admin_alerts SET is_read = true WHERE is_read = false`);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ── Auto-logout notice dismissals table ──
(async () => {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS auto_logout_dismissals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id),
        shift_date DATE NOT NULL,
        dismissed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(user_id, shift_date)
      )
    `);
  } catch (e) { /* table may already exist */ }
})();

// GET /api/shifts/auto-logout-notices — returns recent auto-clock-out events for the current user
// that have NOT been dismissed yet
router.get('/auto-logout-notices', authenticate, async (req, res, next) => {
  try {
    const r = await query(
      `SELECT DISTINCT ON (ce.shift_date) ce.shift_date, ce.created_at AS auto_logout_at,
              sa.shift_end_time
       FROM clock_events ce
       LEFT JOIN shift_assignments sa ON sa.user_id = ce.user_id AND sa.shift_date = ce.shift_date
       WHERE ce.user_id = $1
         AND ce.event_type IN ('clock_out', 'out')
         AND ce.device_type = 'system'
         AND ce.user_agent = 'auto-clock-out'
         AND ce.shift_date >= (CURRENT_DATE - INTERVAL '7 days')::date
         AND NOT EXISTS (
           SELECT 1 FROM auto_logout_dismissals ald
           WHERE ald.user_id = ce.user_id AND ald.shift_date = ce.shift_date
         )
       ORDER BY ce.shift_date DESC, ce.created_at DESC`,
      [req.user.sub]
    );

    const notices = r.rows.map((row) => ({
      shift_date: toDateStr(row.shift_date),
      auto_logout_at: row.auto_logout_at,
      shift_end_time: row.shift_end_time || null,
    }));

    res.json({ notices });
  } catch (e) {
    next(e);
  }
});

// POST /api/shifts/auto-logout-notices/dismiss — dismiss a specific auto-logout notice
router.post('/auto-logout-notices/dismiss', authenticate, async (req, res, next) => {
  try {
    const { shift_date } = req.body;
    if (!shift_date) return res.status(400).json({ error: 'shift_date is required' });
    await query(
      `INSERT INTO auto_logout_dismissals (user_id, shift_date)
       VALUES ($1, $2)
       ON CONFLICT (user_id, shift_date) DO NOTHING`,
      [req.user.sub, shift_date]
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
