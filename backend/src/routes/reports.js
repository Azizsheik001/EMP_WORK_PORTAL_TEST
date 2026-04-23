import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { query } from '../lib/db.js';

const router = Router();

function toDateStr(d) {
  if (!d) return null;
  if (d instanceof Date) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  return String(d).slice(0, 10);
}

/**
 * GET /api/reports/hr?from=YYYY-MM-DD&to=YYYY-MM-DD&client_id=uuid
 * Returns HR attendance report data for the given date range.
 * Each row: employee_no, employee_name, date, shift_start, shift_end, login_time, logout_time, status
 */
router.get('/hr', authenticate, requireRole('admin', 'manager', 'team_lead'), async (req, res, next) => {
  try {
    const from = req.query.from;
    const to = req.query.to;

    if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
      return res.status(400).json({ error: 'Both "from" and "to" query params are required in YYYY-MM-DD format' });
    }
    if (from > to) {
      return res.status(400).json({ error: '"from" date must be on or before "to" date' });
    }

    const clientId = req.query.client_id || null;

    // 1. Get all shift assignments with clock events for the date range
    const shiftsResult = await query(
      `SELECT
         u.id AS user_id,
         u.employee_no,
         u.name AS employee_name,
         sa.shift_date,
         sa.shift_start_time,
         sa.shift_end_time,
         (SELECT ce_in.created_at FROM clock_events ce_in
          WHERE ce_in.user_id = u.id AND ce_in.shift_date = sa.shift_date
            AND ce_in.event_type IN ('clock_in', 'in')
          ORDER BY ce_in.created_at ASC LIMIT 1) AS clock_in_at,
         (SELECT ce_out.created_at FROM clock_events ce_out
          WHERE ce_out.user_id = u.id AND ce_out.shift_date = sa.shift_date
            AND ce_out.event_type IN ('clock_out', 'out')
          ORDER BY ce_out.created_at DESC LIMIT 1) AS clock_out_at
       FROM shift_assignments sa
       JOIN users u ON u.id = sa.user_id AND u.deleted_at IS NULL
       WHERE sa.shift_date >= $1 AND sa.shift_date <= $2
         AND ($3::uuid IS NULL OR sa.client_id = $3)
       ORDER BY sa.shift_date, u.name`,
      [from, to, clientId]
    );

    // 2. Get approved leaves in the date range
    const leavesResult = await query(
      `SELECT lr.employee_id AS user_id, lr.start_date, lr.end_date
       FROM leave_requests lr
       WHERE lr.status = 'approved'
         AND lr.start_date <= $2 AND lr.end_date >= $1`,
      [from, to]
    );

    // Build a lookup: user_id -> Set of leave dates (YYYY-MM-DD)
    const leaveMap = new Map();
    for (const lr of leavesResult.rows) {
      const start = new Date(lr.start_date);
      const end = new Date(lr.end_date);
      const fromD = new Date(from);
      const toD = new Date(to);
      const effectiveStart = start < fromD ? fromD : start;
      const effectiveEnd = end > toD ? toD : end;
      const d = new Date(effectiveStart);
      while (d <= effectiveEnd) {
        const dateStr = d.toISOString().slice(0, 10);
        if (!leaveMap.has(lr.user_id)) leaveMap.set(lr.user_id, new Set());
        leaveMap.get(lr.user_id).add(dateStr);
        d.setDate(d.getDate() + 1);
      }
    }

    // 3. Format each row and determine status
    const formatTimeIST = (ts) => {
      if (!ts) return '';
      const d = new Date(ts);
      return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
    };

    const rows = shiftsResult.rows.map((row) => {
      const dateStr = toDateStr(row.shift_date);

      const isOff = !row.shift_start_time || row.shift_start_time === 'OFF' || row.shift_end_time === 'OFF';
      const hasClockIn = !!row.clock_in_at;
      const hasLeave = leaveMap.get(row.user_id)?.has(dateStr) || false;

      let status;
      if (isOff) {
        status = 'Off';
      } else if (hasLeave) {
        status = 'Leave';
      } else if (hasClockIn) {
        status = 'Present';
      } else {
        status = 'Absent';
      }

      return {
        employee_no: row.employee_no || '',
        employee_name: row.employee_name,
        date: dateStr,
        shift_start: isOff ? 'OFF' : (row.shift_start_time || '').slice(0, 5),
        shift_end: isOff ? 'OFF' : (row.shift_end_time || '').slice(0, 5),
        login_time: formatTimeIST(row.clock_in_at),
        logout_time: formatTimeIST(row.clock_out_at),
        status,
      };
    });

    res.json({ rows });
  } catch (err) {
    next(err);
  }
});

export default router;
