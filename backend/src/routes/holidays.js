import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { query } from '../lib/db.js';

const router = Router();

function toDateStr(d) {
  if (!d) return null;
  if (d instanceof Date) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return String(d).slice(0, 10);
}

// ── Bootstrap tables ────────────────────────────────────────────
(async () => {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS holidays (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        holiday_date DATE NOT NULL,
        name VARCHAR(200) NOT NULL,
        is_optional BOOLEAN DEFAULT false,
        calendar VARCHAR(10) NOT NULL DEFAULT 'All',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE UNIQUE INDEX IF NOT EXISTS holidays_date_name_idx ON holidays (holiday_date, name);
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS comp_offs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id),
        holiday_id UUID REFERENCES holidays(id),
        holiday_date DATE NOT NULL,
        holiday_name VARCHAR(200),
        bonus_amount NUMERIC(10,2) DEFAULT 500,
        comp_leave_days NUMERIC(3,1) DEFAULT 1,
        status VARCHAR(20) DEFAULT 'earned',
        used_date DATE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, holiday_date)
      );
    `);
    await query(`
      CREATE TABLE IF NOT EXISTS comp_off_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id),
        shift_date DATE NOT NULL,
        request_type VARCHAR(50) NOT NULL, -- 'week_off' or 'holiday'
        hours_worked NUMERIC(5,2) NOT NULL,
        earned_days NUMERIC(3,1) NOT NULL,
        holiday_id UUID REFERENCES holidays(id),
        holiday_name VARCHAR(200),
        status VARCHAR(20) DEFAULT 'pending', -- pending, approved, rejected
        approved_by UUID REFERENCES users(id),
        rejected_by UUID REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(user_id, shift_date)
      );
    `);
  } catch (e) {
    console.warn('holidays/comp_offs/requests table creation skipped:', e.message);
  }

  // Add expiry_date column to comp_offs if it doesn't exist
  try {
    await query(`ALTER TABLE comp_offs ADD COLUMN IF NOT EXISTS expiry_date DATE`);
  } catch (e) { /* ignore */ }

  // Add holiday_type column to holidays (national vs regional)
  try {
    await query(`ALTER TABLE holidays ADD COLUMN IF NOT EXISTS holiday_type VARCHAR(20) NOT NULL DEFAULT 'regional'`);
    // Classify national holidays: Republic Day, Independence Day, Gandhi Jayanti, New Year, Christmas, May Day, US national holidays
    await query(`
      UPDATE holidays SET holiday_type = 'national' WHERE holiday_type = 'regional' AND (
        LOWER(name) LIKE '%republic day%' OR
        LOWER(name) LIKE '%independence day%' OR
        LOWER(name) LIKE '%gandhi%' OR
        LOWER(name) LIKE '%new year%' OR
        LOWER(name) LIKE '%christmas%' OR
        LOWER(name) LIKE '%may day%' OR
        LOWER(name) LIKE '%us memorial%' OR
        LOWER(name) LIKE '%us independence%' OR
        LOWER(name) LIKE '%us labour%' OR
        LOWER(name) LIKE '%thanksgiving%'
      )
    `);
    // Fix existing comp_offs expiry dates: national → 1 year, regional → 1 month
    await query(`
      UPDATE comp_offs co SET expiry_date = co.holiday_date + INTERVAL '1 year'
      FROM holidays h WHERE h.id = co.holiday_id AND COALESCE(h.holiday_type, 'regional') = 'national'
        AND co.expiry_date IS DISTINCT FROM (co.holiday_date + INTERVAL '1 year')
    `);
    await query(`
      UPDATE comp_offs co SET expiry_date = co.holiday_date + INTERVAL '1 month'
      FROM holidays h WHERE h.id = co.holiday_id AND COALESCE(h.holiday_type, 'regional') = 'regional'
        AND co.expiry_date IS DISTINCT FROM (co.holiday_date + INTERVAL '1 month')
    `);
  } catch (e) { /* ignore */ }

  // Seed 2026 holidays if empty
  try {
    const existing = await query(`SELECT COUNT(*)::int AS cnt FROM holidays`);
    if (existing.rows[0].cnt === 0) {
      await query(`
        INSERT INTO holidays (holiday_date, name, is_optional, calendar) VALUES
          ('2026-01-01', 'New Year''s Day',           false, 'All'),
          ('2026-01-14', 'Pongal',                    false, 'All'),
          ('2026-01-26', 'Republic Day',              false, 'IND'),
          ('2026-03-19', 'Ugadi',                     false, 'IND'),
          ('2026-03-20', 'Ramzan / Idul Fitr',        true,  'All'),
          ('2026-05-01', 'May Day',                   false, 'IND'),
          ('2026-06-26', 'Bakrid / Eid ul-Adha',      true,  'All'),
          ('2026-08-15', 'Independence Day',          false, 'IND'),
          ('2026-09-14', 'Ganesh Chaturthi',          false, 'All'),
          ('2026-10-02', 'Mahatma Gandhi Jayanthi',   false, 'IND'),
          ('2026-10-20', 'Dussehra (Maha Navami)',    false, 'All'),
          ('2026-11-09', 'Diwali / Deepavali',        false, 'All'),
          ('2026-12-25', 'Christmas Day',             false, 'All'),
          ('2026-05-25', 'US Memorial Day',           false, 'US'),
          ('2026-07-04', 'US Independence Day',       false, 'US'),
          ('2026-09-07', 'US Labour Day',             false, 'US'),
          ('2026-11-26', 'Thanksgiving Day (US)',     false, 'US'),
          ('2026-11-27', 'Day After Thanksgiving (US)', false, 'US'),
          ('2026-12-31', 'New Year EVE',              false, 'US')
        ON CONFLICT DO NOTHING;
      `);
      console.log('Seeded 2026 holidays');
    }
  } catch (e) {
    console.warn('Holiday seeding skipped:', e.message);
  }
})();

// ── Determine which calendars apply to a user ───────────────────
// Prefer work_timezone (stored on user row). Fallback to legacy name match for
// users created before work_timezone existed.
const US_TEAM_NAMES = ['jaswanthi', 'rohan', 'girish'];

function isUSTeam(user) {
  const tz = (user.work_timezone || '').toLowerCase();
  if (tz.startsWith('america/') || tz === 'us' || tz === 'cst' || tz === 'est' || tz === 'pst' || tz === 'mst') return true;
  const nameLower = (user.name || '').toLowerCase();
  return US_TEAM_NAMES.some((n) => nameLower.includes(n));
}

function getUserCalendars(user) {
  // US employees see US + All holidays (display only, no comp off)
  // India employees get IND + All holidays (with comp off benefits)
  return isUSTeam(user) ? ['US', 'All'] : ['IND', 'All'];
}

// ── GET /api/holidays — list all holidays ───────────────────────
router.get('/', authenticate, async (req, res, next) => {
  try {
    const year = req.query.year || new Date().getFullYear();
    const r = await query(
      `SELECT id, holiday_date, name, is_optional, calendar, COALESCE(holiday_type, 'regional') as holiday_type
       FROM holidays
       WHERE EXTRACT(YEAR FROM holiday_date) = $1
       ORDER BY holiday_date`,
      [year]
    );
    // Get user info to mark which holidays apply to them
    let userRow = {};
    try {
      const userResult = await query(`SELECT name, work_timezone FROM users WHERE id = $1`, [req.user.sub]);
      userRow = userResult.rows[0] || {};
    } catch (_e) {
      const userResult = await query(`SELECT name FROM users WHERE id = $1`, [req.user.sub]);
      userRow = userResult.rows[0] || {};
    }
    const calendars = getUserCalendars(userRow);

    const holidays = r.rows.map((h) => ({
      ...h,
      holiday_date: toDateStr(h.holiday_date),
      // Region-specific holidays are mandatory (not optional) for users of that region.
      is_optional: (h.calendar === 'US' || h.calendar === 'IND') && calendars.includes(h.calendar)
        ? false
        : h.is_optional,
    }));

    res.json({ holidays, user_calendars: calendars });
  } catch (e) {
    next(e);
  }
});

// ── POST /api/holidays — admin can add/update holidays ──────────
router.post('/', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { holiday_date, name, is_optional, calendar } = req.body;
    if (!holiday_date || !name) return res.status(400).json({ error: 'holiday_date and name required' });
    const r = await query(
      `INSERT INTO holidays (holiday_date, name, is_optional, calendar)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (holiday_date, name) DO UPDATE SET is_optional = $3, calendar = $4
       RETURNING *`,
      [holiday_date, name, is_optional || false, calendar || 'All']
    );
    res.status(201).json({ holiday: r.rows[0] });
  } catch (e) {
    next(e);
  }
});

// ── DELETE /api/holidays/:id — admin can remove holidays ────────
router.delete('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    await query(`DELETE FROM holidays WHERE id = $1`, [req.params.id]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ── GET /api/holidays/comp-offs — user's comp off records ───────
router.get('/comp-offs', authenticate, async (req, res, next) => {
  try {
    const userId = req.query.user_id || req.user.sub;
    const year = req.query.year ? parseInt(req.query.year, 10) : null;
    // Non-admin can only see their own
    if (userId !== req.user.sub) {
      const meResult = await query(`SELECT role FROM users WHERE id = $1`, [req.user.sub]);
      const role = meResult.rows[0]?.role;
      if (!['admin', 'manager', 'team_lead'].includes(role)) {
        return res.status(403).json({ error: 'Not authorized' });
      }
    }

    const r = await query(
      `SELECT c.*, u.name AS user_name
       FROM comp_offs c
       JOIN users u ON u.id = c.user_id
       WHERE ($1::uuid IS NULL OR c.user_id = $1)
         AND ($2::int IS NULL OR EXTRACT(YEAR FROM c.holiday_date) = $2)
       ORDER BY c.holiday_date DESC`,
      [userId === 'all' ? null : userId, year]
    );
    const rows = r.rows.map((c) => ({
      ...c,
      holiday_date: toDateStr(c.holiday_date),
      used_date: toDateStr(c.used_date),
      expiry_date: toDateStr(c.expiry_date),
    }));

    // Summary
    const earned = rows.filter((c) => c.status === 'earned').length;
    const used = rows.filter((c) => c.status === 'used').length;
    const totalBonus = rows.reduce((sum, c) => sum + parseFloat(c.bonus_amount || 0), 0);

    res.json({ comp_offs: rows, summary: { earned, used, available: earned - used, total_bonus: totalBonus } });
  } catch (e) {
    next(e);
  }
});

// ── GET /api/holidays/comp-off-requests — get pending comp off requests ──
router.get('/comp-off-requests', authenticate, async (req, res, next) => {
  try {
    const r = await query(
      `SELECT cr.*, u.name AS user_name, u.role
       FROM comp_off_requests cr
       JOIN users u ON u.id = cr.user_id
       ORDER BY cr.created_at DESC`
    );
    const rows = r.rows.map(r => ({
      ...r,
      shift_date: toDateStr(r.shift_date)
    }));
    res.json({ requests: rows });
  } catch (e) {
    next(e);
  }
});

// ── PATCH /api/holidays/comp-off-requests/:id/:action — approve/reject ──
router.patch('/comp-off-requests/:id/:action', authenticate, requireRole('admin', 'manager', 'team_lead'), async (req, res, next) => {
  try {
    const { id, action } = req.params;
    if (action !== 'approve' && action !== 'reject') return res.status(400).json({ error: 'Invalid action' });

    const status = action === 'approve' ? 'approved' : 'rejected';
    const field = action === 'approve' ? 'approved_by' : 'rejected_by';

    // Update request
    const r = await query(
      `UPDATE comp_off_requests SET status = $1, ${field} = $2, updated_at = NOW() WHERE id = $3 AND status = 'pending' RETURNING *`,
      [status, req.user.sub, id]
    );

    if (r.rowCount === 0) return res.status(404).json({ error: 'Request not found or already processed' });

    const reqData = r.rows[0];

    // If approved, create the actual comp_off record
    if (status === 'approved') {
      const bonus = reqData.request_type === 'holiday' ? 500 : 0;
      
      let expiryInterval = '1 month'; // default regional or week_off
      if (reqData.holiday_id) {
        const hRes = await query(`SELECT COALESCE(holiday_type, 'regional') as holiday_type FROM holidays WHERE id = $1`, [reqData.holiday_id]);
        if (hRes.rows[0]?.holiday_type === 'national') expiryInterval = '1 year';
      }

      await query(
        `INSERT INTO comp_offs (user_id, holiday_id, holiday_date, holiday_name, bonus_amount, comp_leave_days, expiry_date)
         VALUES ($1, $2, $3, $4, $5, $6, $3::date + INTERVAL '${expiryInterval}')
         ON CONFLICT (user_id, holiday_date) DO NOTHING`,
        [reqData.user_id, reqData.holiday_id, reqData.shift_date, reqData.holiday_name || (reqData.request_type === 'week_off' ? 'Week Off' : null), bonus, reqData.earned_days]
      );
    }

    res.json({ request: reqData });
  } catch (e) {
    next(e);
  }
});

// ── GET /api/holidays/comp-offs/all — admin view of all comp offs
router.get('/comp-offs/all', authenticate, requireRole('admin', 'manager', 'team_lead'), async (req, res, next) => {
  try {
    const r = await query(
      `SELECT c.*, u.name AS user_name
       FROM comp_offs c
       JOIN users u ON u.id = c.user_id
       ORDER BY c.holiday_date DESC, u.name`
    );
    const rows = r.rows.map((c) => ({
      ...c,
      holiday_date: toDateStr(c.holiday_date),
      used_date: toDateStr(c.used_date),
      expiry_date: toDateStr(c.expiry_date),
    }));

    // Per-user summary
    const byUser = {};
    rows.forEach((c) => {
      if (!byUser[c.user_id]) byUser[c.user_id] = { user_id: c.user_id, user_name: c.user_name, earned: 0, used: 0, total_bonus: 0 };
      byUser[c.user_id].earned += c.status === 'earned' ? 1 : 0;
      byUser[c.user_id].used += c.status === 'used' ? 1 : 0;
      byUser[c.user_id].total_bonus += parseFloat(c.bonus_amount || 0);
    });

    res.json({ comp_offs: rows, by_user: Object.values(byUser) });
  } catch (e) {
    next(e);
  }
});

// ── GET /api/holidays/comp-offs/by-employee — per-employee comp off summary (admin/manager/TL) ──
router.get('/comp-offs/by-employee', authenticate, requireRole('admin', 'manager', 'team_lead'), async (req, res, next) => {
  try {
    const yr = req.query.year || new Date().getFullYear();
    const { rows } = await query(`
      SELECT co.user_id,
             COUNT(*) FILTER (WHERE co.status = 'earned') as available,
             COUNT(*) FILTER (WHERE co.status = 'used') as used,
             COUNT(*) as total,
             SUM(co.bonus_amount) as total_bonus,
             MIN(co.expiry_date) FILTER (WHERE co.status = 'earned') as nearest_expiry
      FROM comp_offs co
      WHERE EXTRACT(YEAR FROM co.holiday_date) = $1
      GROUP BY co.user_id
    `, [yr]);
    const map = {};
    rows.forEach(r => {
      map[r.user_id] = {
        ...r,
        nearest_expiry: toDateStr(r.nearest_expiry),
      };
    });
    res.json({ comp_off_summary: map });
  } catch (e) {
    next(e);
  }
});

// ── PATCH /api/holidays/comp-offs/:id/use — mark a comp off as used ──
router.patch('/comp-offs/:id/use', authenticate, async (req, res, next) => {
  try {
    const { used_date } = req.body;
    const r = await query(
      `UPDATE comp_offs SET status = 'used', used_date = $1 WHERE id = $2 AND user_id = $3 AND status = 'earned' RETURNING *`,
      [used_date || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' }), req.params.id, req.user.sub]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Comp off not found or already used' });
    res.json({ comp_off: r.rows[0] });
  } catch (e) {
    next(e);
  }
});

// ── Create comp off request on clock-out (called from shifts.js) ─
// This is exported so shifts.js can call it after a successful clock-out
export async function createCompOffRequest(userId, shiftDate, hoursWorked) {
  try {
    if (hoursWorked < 4) return null;

    // Get user info
    const userResult = await query(`SELECT id, name FROM users WHERE id = $1`, [userId]);
    if (userResult.rowCount === 0) return null;
    const user = userResult.rows[0];

    // US team does not earn comp off or bonus
    if (isUSTeam(user)) return null;

    const calendars = getUserCalendars(user);

    // 1. Check if shiftDate is a holiday
    const holidayResult = await query(
      `SELECT id, name, calendar, COALESCE(holiday_type, 'regional') as holiday_type FROM holidays
       WHERE holiday_date = $1 AND calendar = ANY($2)`,
      [shiftDate, calendars]
    );

    let isHoliday = false;
    let isWeekOff = false;
    let holidayData = null;

    if (holidayResult.rowCount > 0) {
      isHoliday = true;
      holidayData = holidayResult.rows[0];
    } else {
      // 2. Check if shiftDate is a Week Off
      const saResult = await query(
        `SELECT is_off FROM shift_assignments WHERE user_id = $1 AND shift_date = $2`,
        [userId, shiftDate]
      );
      if (saResult.rowCount > 0 && saResult.rows[0].is_off) {
        isWeekOff = true;
      }
    }

    if (!isHoliday && !isWeekOff) return null;

    const requestType = isHoliday ? 'holiday' : 'week_off';
    const earnedDays = hoursWorked >= 8 ? 1.0 : 0.5;

    // Check if a request already exists
    const existing = await query(`SELECT id FROM comp_off_requests WHERE user_id = $1 AND shift_date = $2`, [userId, shiftDate]);
    if (existing.rowCount > 0) return null; // already requested

    const r = await query(
      `INSERT INTO comp_off_requests (user_id, shift_date, request_type, hours_worked, earned_days, holiday_id, holiday_name)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [userId, shiftDate, requestType, hoursWorked, earnedDays, holidayData?.id || null, holidayData?.name || null]
    );

    if (r.rowCount > 0) {
      console.log(`Comp off request created: ${user.name} worked ${hoursWorked.toFixed(1)}h on ${requestType} (${shiftDate})`);
      return r.rows[0];
    }
    return null;
  } catch (e) {
    console.warn('createCompOffRequest error:', e.message);
    return null;
  }
}

export default router;
