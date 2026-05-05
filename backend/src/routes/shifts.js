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

  // Dedup table — one row per (scope, entity, end_date, notified_on day) so
  // the alert fires AT MOST once per calendar day per subject. The same
  // schedule can re-alert daily until it is extended past the horizon (which
  // changes end_date and resets the dedup naturally).
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS schedule_expiry_alerts (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        scope VARCHAR(20) NOT NULL,           -- 'client' | 'user' | 'department'
        entity_id UUID NOT NULL,
        end_date DATE NOT NULL,
        notified_on DATE NOT NULL DEFAULT CURRENT_DATE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE (scope, entity_id, end_date, notified_on)
      )
    `);
  } catch (e6) {
    if (e6.code !== '42P07') console.warn('schedule_expiry_alerts table creation skipped:', e6.message);
  }
  // Backward-compatible migration for existing installs that still have the
  // old (scope, entity_id, end_date) UNIQUE constraint without notified_on.
  try { await query(`ALTER TABLE schedule_expiry_alerts ADD COLUMN IF NOT EXISTS notified_on DATE NOT NULL DEFAULT CURRENT_DATE`); } catch (_e) {}
  try {
    // Drop the old 3-column UNIQUE if present and re-create with notified_on.
    await query(`ALTER TABLE schedule_expiry_alerts DROP CONSTRAINT IF EXISTS schedule_expiry_alerts_scope_entity_id_end_date_key`);
  } catch (_e) {}
  try {
    await query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'schedule_expiry_alerts_daily_uniq'
        ) THEN
          ALTER TABLE schedule_expiry_alerts
            ADD CONSTRAINT schedule_expiry_alerts_daily_uniq
            UNIQUE (scope, entity_id, end_date, notified_on);
        END IF;
      END $$
    `);
  } catch (_e) {}

  // Kick off the first expiry scan shortly after boot, then every 6h.
  setTimeout(() => { checkScheduleExpiry().catch((e) => console.warn('scheduleExpiry error:', e.message)); }, 15_000);
  setInterval(() => { checkScheduleExpiry().catch((e) => console.warn('scheduleExpiry error:', e.message)); }, 6 * 60 * 60 * 1000);
})();

// ── Schedule expiry notifier ─────────────────────────────────────
// Alerts the affected employee, their direct team lead and manager, plus the
// CEO (admin) when a client's, department's, or a single user's uploaded
// schedule runs out in the next SCHEDULE_EXPIRY_HORIZON_DAYS. Re-fires daily
// until the schedule is extended past the horizon.
const SCHEDULE_EXPIRY_HORIZON_DAYS = 7;

// Narrow recipient list per product owner: subject + their direct supervisors
// (primary + junction) + admins (CEO). For a team-level alert (client or
// department scope) we union the supervisors of every member of the cohort
// instead of every leadership-role user tagged to the client/department.
async function collectScheduleRecipients({ clientId, userId, departmentId, memberIds = [] }) {
  const ids = new Set();

  // Subject(s) themselves — so the affected person sees it too.
  if (userId) ids.add(userId);
  for (const m of memberIds) ids.add(m);

  // Direct supervisors of each subject — primary + junction tables.
  const subjectIds = userId ? [userId, ...memberIds] : [...memberIds];
  for (const sid of subjectIds) {
    try {
      const r = await query(`SELECT team_lead_id, manager_id FROM users WHERE id = $1`, [sid]);
      if (r.rows[0]?.team_lead_id) ids.add(r.rows[0].team_lead_id);
      if (r.rows[0]?.manager_id) ids.add(r.rows[0].manager_id);
    } catch (_e) {}
    try {
      const j = await query(
        `SELECT team_lead_id FROM user_team_lead_assignments WHERE user_id = $1`,
        [sid]
      );
      for (const row of j.rows) ids.add(row.team_lead_id);
    } catch (_e) {}
    try {
      const j = await query(
        `SELECT manager_id FROM user_manager_assignments WHERE user_id = $1`,
        [sid]
      );
      for (const row of j.rows) ids.add(row.manager_id);
    } catch (_e) {}
  }

  // Primary team lead on the client (the contact recorded on the clients
  // row) — keep this one client-scoped link so a client lead is still
  // looped in for client-scope alerts even if individual members have
  // different reporting lines.
  if (clientId) {
    try {
      const r = await query(`SELECT team_lead_id FROM clients WHERE id = $1`, [clientId]);
      if (r.rows[0]?.team_lead_id) ids.add(r.rows[0].team_lead_id);
    } catch (_e) {}
  }

  // CEO (admins).
  try {
    const admins = await query(
      `SELECT id FROM users WHERE role = 'admin' AND is_active = true AND deleted_at IS NULL`
    );
    for (const row of admins.rows) ids.add(row.id);
  } catch (_e) {}

  return ids;
}

async function fireScheduleExpiryAlert({ scope, entityId, subjectName, endDate, clientId, departmentId, userId, membersText, memberIds = [] }) {
  // Dedup on (scope, entityId, endDate, today) — alerts re-fire daily until
  // the schedule is extended past the horizon. The reconcile pass in
  // checkScheduleExpiry marks already-fired alerts as read for the previous
  // days, so the bell only counts today's reminder.
  try {
    const inserted = await query(
      `INSERT INTO schedule_expiry_alerts (scope, entity_id, end_date, notified_on)
       VALUES ($1, $2, $3, CURRENT_DATE)
       ON CONFLICT (scope, entity_id, end_date, notified_on) DO NOTHING RETURNING id`,
      [scope, entityId, endDate]
    );
    if (inserted.rowCount === 0) return; // already alerted today for this end_date
  } catch (e) {
    console.warn('schedule_expiry dedup insert failed:', e.message);
    return;
  }

  const recipients = await collectScheduleRecipients({ clientId, userId, departmentId, memberIds });
  if (recipients.size === 0) return;

  // Ensure recipient column exists on admin_alerts (backward-compatible).
  try { await query(`ALTER TABLE admin_alerts ADD COLUMN IF NOT EXISTS recipient_user_id UUID REFERENCES users(id)`); } catch (_e) {}

  const humanDate = toDateStr(endDate);
  const today = new Date().toISOString().slice(0, 10);
  const daysLeft = Math.max(0, Math.round((new Date(humanDate) - new Date(today)) / (24 * 3600 * 1000)));
  const daysPhrase = daysLeft === 0 ? 'expires today' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`;
  let msg;
  if (scope === 'client') {
    // Solar & any other client-based team — per-client alert.
    const header = subjectName.replace(/\s+team$/i, '');
    msg = `${header} client schedule ends on ${humanDate} (${daysPhrase}). ${membersText || ''} Draft the next one.`.trim();
  } else if (scope === 'department') {
    // Department-wide team (Tech, HR, BD, Finance, Libsys) — one alert for the whole team.
    const header = subjectName.replace(/\s+team$/i, '');
    msg = `${header} team schedule ends on ${humanDate} (${daysPhrase}). ${membersText || ''} Draft the next one.`.trim();
  } else {
    msg = `${subjectName}'s schedule ends on ${humanDate} (${daysPhrase}) — different from the rest of their team.`;
  }
  const details = JSON.stringify({ scope, entityId, endDate: humanDate, daysLeft });

  // Pick an anchor user_id for the admin_alerts row (the subject entity).
  const anchorUserId = userId || (await (async () => {
    try {
      const r = await query(`SELECT id FROM users WHERE role = 'admin' AND is_active = true LIMIT 1`);
      return r.rows[0]?.id || null;
    } catch { return null; }
  })());
  if (!anchorUserId) return;

  // Before inserting today's reminder, mark any previous unread alerts for
  // the SAME subject (same scope + entityId) as read. This way the bell only
  // shows today's pending reminder rather than stacking yesterday's + today's.
  try {
    await query(
      `UPDATE admin_alerts SET is_read = true
       WHERE alert_type = 'schedule_expiring'
         AND is_read = false
         AND details->>'scope' = $1
         AND details->>'entityId' = $2`,
      [scope, String(entityId)]
    );
  } catch (_e) { /* best-effort */ }

  for (const recipientId of recipients) {
    try {
      await query(
        `INSERT INTO admin_alerts (user_id, alert_type, message, details, recipient_user_id)
         VALUES ($1, 'schedule_expiring', $2, $3::jsonb, $4)`,
        [anchorUserId, msg, details, recipientId]
      );
    } catch (e) {
      console.warn('schedule expiry alert insert failed:', e.message);
    }
  }
  console.log(`schedule-expiry: ${scope} ${subjectName} → ${humanDate} (${daysLeft}d)`);
}

async function checkScheduleExpiry() {
  const horizon = SCHEDULE_EXPIRY_HORIZON_DAYS;

  // ── Reconciliation: clear out stale alerts whose subject is no longer
  // within the horizon (i.e. someone extended the schedule past it). Runs
  // BEFORE the new fire pass so the bell reflects reality immediately.
  try {
    // Pull every currently-unread schedule_expiring row + its anchor entity.
    const stale = await query(
      `SELECT a.id, a.user_id, a.details
       FROM admin_alerts a
       WHERE a.alert_type = 'schedule_expiring' AND a.is_read = false`
    );
    if (stale.rowCount > 0) {
      // Cache: does a given (scope, id) currently have an end_date inside the horizon?
      const userCache = new Map();
      const clientCache = new Map();
      const deptCache = new Map();

      const userExpiring = async (id) => {
        if (userCache.has(id)) return userCache.get(id);
        const r = await query(
          `SELECT MAX(sa.shift_date) AS end_date
           FROM shift_assignments sa
           WHERE sa.user_id = $1 AND sa.is_off IS NOT TRUE`,
          [id]
        );
        const end = r.rows[0]?.end_date;
        const inHorizon = end && end <= new Date(Date.now() + horizon * 24 * 3600 * 1000).toISOString().slice(0, 10) && end >= new Date().toISOString().slice(0, 10);
        userCache.set(id, !!inHorizon);
        return !!inHorizon;
      };
      const clientExpiring = async (id) => {
        if (clientCache.has(id)) return clientCache.get(id);
        const r = await query(
          `SELECT MAX(sa.shift_date) AS end_date
           FROM shift_assignments sa
           JOIN users u ON u.id = sa.user_id AND u.is_active = true AND u.deleted_at IS NULL
           WHERE sa.client_id = $1 AND sa.is_off IS NOT TRUE`,
          [id]
        );
        const end = r.rows[0]?.end_date;
        const inHorizon = end && end <= new Date(Date.now() + horizon * 24 * 3600 * 1000).toISOString().slice(0, 10) && end >= new Date().toISOString().slice(0, 10);
        clientCache.set(id, !!inHorizon);
        return !!inHorizon;
      };
      const deptExpiring = async (id) => {
        if (deptCache.has(id)) return deptCache.get(id);
        const r = await query(
          `SELECT MAX(sa.shift_date) AS end_date
           FROM shift_assignments sa
           JOIN users u ON u.id = sa.user_id AND u.is_active = true AND u.deleted_at IS NULL
           WHERE u.department_id = $1 AND sa.is_off IS NOT TRUE`,
          [id]
        );
        const end = r.rows[0]?.end_date;
        const inHorizon = end && end <= new Date(Date.now() + horizon * 24 * 3600 * 1000).toISOString().slice(0, 10) && end >= new Date().toISOString().slice(0, 10);
        deptCache.set(id, !!inHorizon);
        return !!inHorizon;
      };

      const readIds = [];
      for (const row of stale.rows) {
        let details = {};
        try { details = typeof row.details === 'string' ? JSON.parse(row.details) : (row.details || {}); } catch {}
        const scope = details.scope;
        const entityId = details.entityId || row.user_id;
        if (!scope || !entityId) continue;
        let stillExpiring = true;
        try {
          if (scope === 'user') stillExpiring = await userExpiring(entityId);
          else if (scope === 'client') stillExpiring = await clientExpiring(entityId);
          else if (scope === 'department') stillExpiring = await deptExpiring(entityId);
        } catch { stillExpiring = true; }
        if (!stillExpiring) readIds.push(row.id);
      }

      if (readIds.length > 0) {
        const ph = readIds.map((_, i) => `$${i + 1}`).join(', ');
        await query(`UPDATE admin_alerts SET is_read = true WHERE id IN (${ph})`, readIds);
        // Drop dedup rows ONLY for entities that are no longer expiring. With
        // daily dedup we can't blow away the whole table — that would let
        // entities still inside the horizon re-fire a duplicate alert today.
        const reconciledKeys = new Set();
        for (const row of stale.rows) {
          if (!readIds.includes(row.id)) continue;
          let details = {};
          try { details = typeof row.details === 'string' ? JSON.parse(row.details) : (row.details || {}); } catch {}
          if (details.scope && (details.entityId || row.user_id)) {
            reconciledKeys.add(`${details.scope}:${details.entityId || row.user_id}`);
          }
        }
        for (const key of reconciledKeys) {
          const [scope, entityId] = key.split(':');
          try {
            await query(
              `DELETE FROM schedule_expiry_alerts WHERE scope = $1 AND entity_id = $2`,
              [scope, entityId]
            );
          } catch (_e) {}
        }
        console.log(`schedule-expiry: reconciled ${readIds.length} stale alert(s) — schedule now extends beyond the horizon`);
      }
    }
  } catch (e) {
    console.warn('schedule-expiry reconcile failed:', e.message);
  }

  // Per-user latest shift_date. We group these into team cohorts and fire one
  // alert per cohort (the shared end_date) + a per-user alert only for people
  // whose schedule diverges from the team's majority end_date.
  let userEnds;
  try {
    const r = await query(
      `SELECT u.id, u.name, u.department_id, u.client_id,
              c.name AS client_name, d.name AS department_name,
              MAX(sa.shift_date) AS end_date
       FROM users u
       JOIN shift_assignments sa ON sa.user_id = u.id
       LEFT JOIN clients c ON c.id = u.client_id
       LEFT JOIN departments d ON d.id = u.department_id
       WHERE u.is_active = true AND u.deleted_at IS NULL
         AND sa.is_off IS NOT TRUE
       GROUP BY u.id, u.name, u.department_id, u.client_id, c.name, d.name
       HAVING MAX(sa.shift_date) >= CURRENT_DATE
          AND MAX(sa.shift_date) <= CURRENT_DATE + ($1 || ' days')::interval`,
      [String(horizon)]
    );
    userEnds = r.rows;
  } catch (e) {
    console.warn('schedule-expiry scan failed:', e.message);
    return;
  }

  if (!userEnds || userEnds.length === 0) return;

  // Group by team. Prefer client_id if set, fall back to department_id; users
  // with neither land in a "solo" bucket keyed by their own id.
  const teams = new Map(); // key → { scope, id, name, deptId, clientId, members: [{ id, name, end }] }
  for (const row of userEnds) {
    const end = toDateStr(row.end_date);
    let key, team;
    if (row.client_id) {
      key = `client:${row.client_id}`;
      team = teams.get(key) || { scope: 'client', id: row.client_id, name: row.client_name || 'client', deptId: row.department_id, clientId: row.client_id, members: [] };
    } else if (row.department_id) {
      key = `dept:${row.department_id}`;
      team = teams.get(key) || { scope: 'department', id: row.department_id, name: row.department_name || 'department', deptId: row.department_id, clientId: null, members: [] };
    } else {
      key = `solo:${row.id}`;
      team = teams.get(key) || { scope: 'solo', id: row.id, name: row.name, deptId: null, clientId: null, members: [] };
    }
    team.members.push({ id: row.id, name: row.name, end });
    teams.set(key, team);
  }

  for (const team of teams.values()) {
    // Mode end_date — the date most members share. If the team has only one
    // person, or all members happen to share a single end_date, skip the
    // per-user spam entirely and fire just the team alert.
    const counts = new Map();
    for (const m of team.members) counts.set(m.end, (counts.get(m.end) || 0) + 1);
    let modeEnd = null, modeCount = 0;
    for (const [date, count] of counts) {
      if (count > modeCount) { modeEnd = date; modeCount = count; }
    }

    const majority = team.members.filter((m) => m.end === modeEnd);
    const outliers = team.members.filter((m) => m.end !== modeEnd);

    // Team-level alert: names of the members on the majority end date.
    if (team.scope !== 'solo') {
      const sampleNames = majority.slice(0, 8).map((m) => m.name).join(', ');
      const extra = majority.length > 8 ? ` and ${majority.length - 8} more` : '';
      await fireScheduleExpiryAlert({
        scope: team.scope,
        entityId: team.id,
        subjectName: `${team.name} team`,
        endDate: modeEnd,
        clientId: team.clientId,
        departmentId: team.deptId,
        membersText: `${majority.length} member${majority.length === 1 ? '' : 's'}: ${sampleNames}${extra}`,
        // Pass the cohort so each member + their direct TL/manager are
        // notified (instead of broadcasting to every leadership user
        // tagged to the client/department).
        memberIds: majority.map((m) => m.id),
      });
    } else {
      // Solo: single person, just fire one alert for them.
      await fireScheduleExpiryAlert({
        scope: 'user',
        entityId: team.id,
        subjectName: team.name,
        endDate: modeEnd,
        userId: team.id,
      });
      continue;
    }

    // Per-user alerts only for people whose schedule ends on a different date
    // from the team majority — "pop up that person's name" in the user's words.
    for (const m of outliers) {
      await fireScheduleExpiryAlert({
        scope: 'user',
        entityId: m.id,
        subjectName: m.name,
        endDate: m.end,
        clientId: team.clientId,
        departmentId: team.deptId,
        userId: m.id,
      });
    }
  }
}

// Clear pending expiry alerts for the affected scope when a schedule is
// updated. After a new upload, the dedup row is removed so the NEXT scan can
// legitimately fire for the new end_date, and any unread admin_alerts for
// this scope get marked read so the notification dot disappears.
async function clearScheduleExpiryForEntities({ clientIds = [], userIds = [] }) {
  try {
    if (clientIds.length > 0) {
      const ph = clientIds.map((_, i) => `$${i + 1}`).join(', ');
      await query(`DELETE FROM schedule_expiry_alerts WHERE scope = 'client' AND entity_id IN (${ph})`, clientIds);
    }
    if (userIds.length > 0) {
      const ph = userIds.map((_, i) => `$${i + 1}`).join(', ');
      await query(`DELETE FROM schedule_expiry_alerts WHERE scope = 'user' AND entity_id IN (${ph})`, userIds);
      // Also wipe any department-scoped dedup rows for their departments
      // so those can re-fire too.
      await query(
        `DELETE FROM schedule_expiry_alerts
         WHERE scope = 'department'
           AND entity_id IN (SELECT DISTINCT department_id FROM users WHERE id IN (${ph}) AND department_id IS NOT NULL)`,
        userIds
      );
    }
    // Mark any unread schedule_expiring admin_alerts for the subject users as read.
    if (userIds.length > 0) {
      const ph = userIds.map((_, i) => `$${i + 1}`).join(', ');
      await query(
        `UPDATE admin_alerts SET is_read = true
         WHERE alert_type = 'schedule_expiring' AND is_read = false AND user_id IN (${ph})`,
        userIds
      );
    }
  } catch (e) {
    console.warn('clearScheduleExpiryForEntities failed:', e.message);
  }
}

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
         AND ($3::uuid IS NULL OR u.client_id = $3)
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
        const windowStart = startMinutes - 60;
        const windowEnd = startMinutes + 60;
        let currentMinutes = nowMinutes;
        // If overnight and current time is after midnight, add 24h
        if (endMinutes > 24 * 60 && nowMinutes < startMinutes - 60) {
          currentMinutes += 24 * 60;
        }

        if (currentMinutes < windowStart || currentMinutes > windowEnd) {
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
          const pastBuffer = currentMinutes > windowEnd;
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
    // Auto-credit comp off if clocking in on a holiday
    const compOff = await checkAndCreditCompOff(req.user.sub, shiftDate);
    // Check for repeated mobile usage alerts
    checkMobileAlert(req.user.sub, 'clock_in', deviceType);
    res.status(201).json({ ok: true, shift_date: shiftDate, comp_off: compOff || undefined });
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
    res.json({ ok: true, shift_date: shiftDate });
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

    // Auto-credit comp off if clocking in on a holiday
    await checkAndCreditCompOff(user_id, date);

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

    res.json({ ok: true, shift_date: targetShiftDate, message: `${empName} clocked out by ${req.user.name || 'supervisor'}` });
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
    // ALWAYS filter shift rows to exclude those tagged to a client the user
    // is no longer assigned to. Without this:
    //   * client filter alone catches the explicit case (Keerthi → Cleanleaf)
    //   * BUT department / "All clients" filters still pull stale client-tagged
    //     shifts. The result is two parallel rows per (user, date) — one for
    //     the legacy client and one for the current internal/department shift
    //     — and JS overwrites whichever is iterated second, producing a
    //     frankenstein pattern in the grid.
    //
    // Rule: a shift_assignments row is visible when EITHER
    //   (a) sa.client_id IS NULL (internal / department-level), OR
    //   (b) the user is currently assigned to sa.client_id via
    //       user_client_assignments (junction-priority — only fall back to
    //       users.client_id when the junction is empty for that user).
    const stillAssignedToShiftClient = `
      AND (
        sa.client_id IS NULL
        OR (
          CASE
            WHEN EXISTS (SELECT 1 FROM user_client_assignments uca0 WHERE uca0.user_id = u.id)
            THEN EXISTS (
              SELECT 1 FROM user_client_assignments uca
              WHERE uca.user_id = u.id AND uca.client_id = sa.client_id
            )
            ELSE u.client_id = sa.client_id
          END
        )
      )
    `;
    // The explicit-client filter is still useful (it lets the same user query
    // be scoped to one client even if they're on multiple), so we keep that
    // narrowing on top of the always-on staleness filter.
    const currentAssignmentClause = clientId
      ? `AND (
           CASE
             WHEN EXISTS (SELECT 1 FROM user_client_assignments uca0 WHERE uca0.user_id = u.id)
             THEN EXISTS (
               SELECT 1 FROM user_client_assignments uca
               WHERE uca.user_id = u.id AND uca.client_id = $3
             )
             ELSE u.client_id = $3
           END
         )`
      : '';
    let r;
    try {
      r = await query(
        `SELECT sa.user_id, u.name AS employee_name, u.role, sa.shift_date,
                sa.shift_start_time, sa.shift_end_time, sa.is_off
         FROM shift_assignments sa
         JOIN users u ON u.id = sa.user_id AND u.deleted_at IS NULL
         WHERE sa.shift_date >= $1 AND sa.shift_date <= $2
           AND ($3::uuid IS NULL OR sa.client_id = $3)
           ${stillAssignedToShiftClient}
           ${currentAssignmentClause}
           AND ($4::uuid IS NULL OR u.department_id = $4 OR u.id IN (SELECT uda.user_id FROM user_department_assignments uda WHERE uda.department_id = $4))
         ORDER BY u.name, sa.shift_date`,
        [from, to, clientId, departmentId]
      );
    } catch (e) {
      if (e.code === '42703') {
        r = await query(
          `SELECT sa.user_id, u.name AS employee_name, u.role, sa.shift_date,
                  sa.shift_start_time, sa.shift_end_time
           FROM shift_assignments sa
           JOIN users u ON u.id = sa.user_id AND u.deleted_at IS NULL
           WHERE sa.shift_date >= $1 AND sa.shift_date <= $2
             AND ($3::uuid IS NULL OR sa.client_id = $3)
             ${currentAssignmentClause}
             AND ($4::uuid IS NULL OR u.department_id = $4 OR u.id IN (SELECT uda.user_id FROM user_department_assignments uda WHERE uda.department_id = $4))
           ORDER BY u.name, sa.shift_date`,
          [from, to, clientId, departmentId]
        );
      } else if (e.code === '42P01' && clientId) {
        // user_client_assignments table doesn't exist — fall back to the simpler check
        r = await query(
          `SELECT sa.user_id, u.name AS employee_name, u.role, sa.shift_date,
                  sa.shift_start_time, sa.shift_end_time, sa.is_off
           FROM shift_assignments sa
           JOIN users u ON u.id = sa.user_id AND u.deleted_at IS NULL
           WHERE sa.shift_date >= $1 AND sa.shift_date <= $2
             AND ($3::uuid IS NULL OR sa.client_id = $3)
             AND ($3::uuid IS NULL OR u.client_id = $3)
             AND ($4::uuid IS NULL OR u.department_id = $4 OR u.id IN (SELECT uda.user_id FROM user_department_assignments uda WHERE uda.department_id = $4))
           ORDER BY u.name, sa.shift_date`,
          [from, to, clientId, departmentId]
        );
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
        // Junction-priority membership check: if a user has any junction
        // rows for that relation, only the junction matters; otherwise fall
        // back to the legacy primary column.
        const conditions = ['u.deleted_at IS NULL', 'u.is_active = true'];
        const vals = [];
        if (clientId) {
          vals.push(clientId);
          const i = vals.length;
          conditions.push(`(
            CASE
              WHEN EXISTS (SELECT 1 FROM user_client_assignments uca0 WHERE uca0.user_id = u.id)
              THEN u.id IN (SELECT uca.user_id FROM user_client_assignments uca WHERE uca.client_id = $${i})
              ELSE u.client_id = $${i}
            END
          )`);
        }
        if (departmentId) {
          vals.push(departmentId);
          const i = vals.length;
          conditions.push(`(
            CASE
              WHEN EXISTS (SELECT 1 FROM user_department_assignments uda0 WHERE uda0.user_id = u.id)
              THEN u.id IN (SELECT uda.user_id FROM user_department_assignments uda WHERE uda.department_id = $${i})
              ELSE u.department_id = $${i}
            END
          )`);
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
      `SELECT MAX(shift_date) AS last_date, MIN(shift_date) AS first_date, COUNT(DISTINCT user_id)::int AS employee_count
       FROM shift_assignments
       WHERE ($1::uuid IS NULL OR client_id = $1)
         AND is_off = false`,
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

    // When saving without a specific client_id, look up the user's current
    // client. Prefer user_client_assignments (the multi-client junction) so a
    // user assigned to e.g. Ameresco + Standard Solar gets their shifts saved
    // under one of the actual current clients — not against a stale primary
    // users.client_id from a previous assignment. Fall back to users.client_id
    // only if there is no junction row.
    let userClientMap = {};
    if (!client_id) {
      const userIds = [...new Set(assignments.map((a) => a.user_id))];
      const ph = userIds.map((_, i) => `$${i + 1}`).join(', ');
      try {
        const jResult = await query(
          `SELECT user_id, client_id FROM user_client_assignments WHERE user_id IN (${ph})`,
          userIds
        );
        jResult.rows.forEach((r) => {
          // First-write-wins: any current assignment beats users.client_id below
          if (!userClientMap[r.user_id]) userClientMap[r.user_id] = r.client_id;
        });
      } catch (e) {
        if (e.code !== '42P01') throw e; // junction table may not exist
      }
      const missing = userIds.filter((id) => !userClientMap[id]);
      if (missing.length > 0) {
        const ph2 = missing.map((_, i) => `$${i + 1}`).join(', ');
        const ucResult = await query(`SELECT id, client_id FROM users WHERE id IN (${ph2})`, missing);
        ucResult.rows.forEach((r) => { userClientMap[r.id] = r.client_id; });
      }
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
    // Clear stale schedule-expiry alerts for affected users + clients so the
    // notification dot goes away immediately after a fresh save, and so the
    // next scan can legitimately re-fire when the NEW end_date approaches.
    const touchedUserIds = [...new Set(assignments.map((a) => a.user_id))];
    const touchedClientIds = [...new Set([...withClient, ...withoutClient].map((e) => e.client_id).filter(Boolean))];
    clearScheduleExpiryForEntities({ userIds: touchedUserIds, clientIds: touchedClientIds })
      // Immediately re-scan so the bell reflects the new state (the reconcile
      // pass inside will also sweep away any stale alerts for extended schedules).
      .then(() => checkScheduleExpiry())
      .catch(() => {});

    res.status(201).json({ ok: true, count: assignments.length, leaves: leaveEntries.length });
  } catch (e) {
    if (e.code === '42703') return res.status(501).json({ error: 'Run migration 002 to add is_off column. If you use 001 schema, run docs/migrations/004_shift_assignments_date_based.sql first.' });
    if (e.code === '42P10' || (e.message && /ON CONFLICT|conflict target|unique constraint/.test(e.message))) return res.status(501).json({ error: 'Run migration 006: docs/migrations/006_nullable_client_in_shifts.sql to update unique constraints for nullable client_id.' });
    if (e.name === 'ZodError') return res.status(400).json({ error: e.errors.map(err => err.message).join(', ') });
    next(e);
  }
});

// ── Admin Alerts ─────────────────────────────────────────────────
// GET /api/shifts/admin-alerts — list unread admin alerts (admin/manager/team_lead only).
// Honors the recipient_user_id column when set: alerts with a recipient
// are only visible to that recipient. Broadcast alerts (recipient NULL)
// remain visible to every admin/manager/team_lead (backward compatible).
router.get('/admin-alerts', authenticate, requireRole('admin', 'manager', 'team_lead'), async (req, res, next) => {
  try {
    const showAll = req.query.all === 'true';
    const clauses = [];
    if (!showAll) clauses.push('a.is_read = false');
    // Recipient filter — column may not exist on older DBs, so we try the
    // filtered query first and fall back to the unfiltered one on 42703.
    const recipientClause = '(a.recipient_user_id IS NULL OR a.recipient_user_id = $1)';
    const values = [req.user.sub];
    const whereWith = [...clauses, recipientClause].join(' AND ');
    const whereWithout = clauses.join(' AND ');

    let rows;
    try {
      const sql = `SELECT a.*, u.name AS employee_name
                   FROM admin_alerts a
                   JOIN users u ON u.id = a.user_id
                   ${whereWith ? 'WHERE ' + whereWith : ''}
                   ORDER BY a.created_at DESC
                   LIMIT 50`;
      ({ rows } = await query(sql, values));
    } catch (e) {
      if (e.code !== '42703') throw e;
      const sql = `SELECT a.*, u.name AS employee_name
                   FROM admin_alerts a
                   JOIN users u ON u.id = a.user_id
                   ${whereWithout ? 'WHERE ' + whereWithout : ''}
                   ORDER BY a.created_at DESC
                   LIMIT 50`;
      ({ rows } = await query(sql));
    }
    res.json({ alerts: rows });
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
