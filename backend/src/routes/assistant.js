import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { getPool } from '../db/pool.js';
import {
  LlmAgent,
  InMemoryRunner,
  FunctionTool,
  Gemini,
  setLogLevel,
} from '@google/adk';

const router = Router();
setLogLevel('error'); // suppress verbose ADK logs in production

function dbQuery(sql, params) {
  return getPool().query(sql, params);
}

const today = () => new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
const toDateStr = (d) => {
  if (!d) return null;
  if (d instanceof Date) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return String(d).slice(0, 10);
};
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || '';

// ══════════════════════════════════════════════════════════════════
// TOOLS — FunctionTools that agents can call
// ══════════════════════════════════════════════════════════════════

const getWorkforceStats = new FunctionTool({
  name: 'get_workforce_stats',
  description: 'Get total employee count broken down by role (employees, team leads, managers, admins) and by client/department.',
  parameters: {},
  execute: async () => {
    const { rows: [stats] } = await dbQuery(`
      SELECT COUNT(*) FILTER (WHERE is_active = true AND deleted_at IS NULL) as total,
        COUNT(*) FILTER (WHERE role = 'employee' AND is_active = true AND deleted_at IS NULL) as employees,
        COUNT(*) FILTER (WHERE role = 'team_lead' AND is_active = true AND deleted_at IS NULL) as team_leads,
        COUNT(*) FILTER (WHERE role = 'manager' AND is_active = true AND deleted_at IS NULL) as managers,
        COUNT(*) FILTER (WHERE role = 'admin' AND is_active = true AND deleted_at IS NULL) as admins
      FROM users
    `);
    const { rows: byClient } = await dbQuery(`
      SELECT COALESCE(c.name, 'Unassigned') as client, COUNT(*) as count
      FROM users u LEFT JOIN clients c ON u.client_id = c.id
      WHERE u.is_active = true AND u.deleted_at IS NULL AND u.role NOT IN ('admin')
      GROUP BY c.name ORDER BY count DESC
    `);
    const { rows: byDept } = await dbQuery(`
      SELECT COALESCE(d.name, 'Unassigned') as department, COUNT(*) as count
      FROM users u LEFT JOIN departments d ON u.department_id = d.id
      WHERE u.is_active = true AND u.deleted_at IS NULL
      GROUP BY d.name ORDER BY count DESC
    `);
    return JSON.stringify({ stats, by_client: byClient, by_department: byDept });
  },
});

const getLeavesToday = new FunctionTool({
  name: 'get_leaves_today',
  description: 'Get employees who are on approved leave today.',
  parameters: {},
  execute: async () => {
    const { rows } = await dbQuery(`
      SELECT u.name, c.name as client, lr.leave_type, lr.start_date, lr.end_date
      FROM leave_requests lr JOIN users u ON lr.employee_id = u.id LEFT JOIN clients c ON u.client_id = c.id
      WHERE lr.status = 'approved' AND $1 BETWEEN lr.start_date AND lr.end_date ORDER BY u.name
    `, [today()]);
    return JSON.stringify({ count: rows.length, employees: rows });
  },
});

const getPendingLeaves = new FunctionTool({
  name: 'get_pending_leaves',
  description: 'Get pending leave requests awaiting approval.',
  parameters: {},
  execute: async () => {
    const { rows } = await dbQuery(`
      SELECT u.name, c.name as client, lr.leave_type, lr.start_date, lr.end_date, lr.status
      FROM leave_requests lr JOIN users u ON lr.employee_id = u.id LEFT JOIN clients c ON u.client_id = c.id
      WHERE lr.status IN ('pending_team_lead', 'pending_managers', 'pending_ceo')
      ORDER BY lr.requested_at DESC NULLS LAST
    `);
    return JSON.stringify({ count: rows.length, requests: rows });
  },
});

const getClockedInEmployees = new FunctionTool({
  name: 'get_clocked_in_employees',
  description: 'Get employees who clocked in on a given date (default today). Supports filtering by a team/department OR by a client. Can show currently clocked in only, or all who worked that day. Use for: "who is logged in", "who is clocked in right now", "who is logged in tech team", "who is logged in Libsys department", "who is in solar department today", "who is clocked in for Ameresco", "who worked on March 19", "how many people logged in on a date". IMPORTANT: the filter is forgiving — whether you pass the filter term as client_name or department_name, the tool will match against BOTH the client table AND the department table, so you don\'t need to know in advance whether a term like "Libsys" is a client or a department.',
  parameters: {
    type: 'object',
    properties: {
      client_name: { type: 'string', description: 'Optional client name to filter by. Known clients: Ameresco, Cleanleaf, MaxSolar, Metlen, Puresky, Standard Solar, Triforce, TSR. Matches case-insensitively against both clients AND departments (forgiving fallback).' },
      department_name: { type: 'string', description: 'Optional department/team name to filter by. Known departments: Tech, Solar, HR, Finance, Libsys, Business Development. Matches case-insensitively with partial matching — "tech" will match "Tech Team", "libsys" will match "Libsys". Also falls back to matching clients if no department matches (forgiving fallback).' },
      date: { type: 'string', description: 'Date in YYYY-MM-DD format (default today). Use this for past dates.' },
      include_clocked_out: { type: 'boolean', description: 'If true, include employees who already clocked out (shows all who worked). Default false for today, true for past dates.' },
    },
  },
  execute: async ({ client_name, department_name, date, include_clocked_out }) => {
    const targetDate = date || today();
    const isPastDate = targetDate < today();
    const showAll = include_clocked_out !== undefined ? include_clocked_out : isPastDate;

    const params = [targetDate];
    const filters = [];
    // Forgiving filters: each term matches against BOTH the client name AND the department name (case-insensitive, LIKE-based).
    // This way the tool works regardless of whether the agent passes a term under client_name or department_name.
    if (client_name) {
      params.push(`%${client_name.toLowerCase()}%`);
      const idx = params.length;
      filters.push(`AND (LOWER(c.name) LIKE $${idx} OR LOWER(d.name) LIKE $${idx})`);
    }
    if (department_name) {
      params.push(`%${department_name.toLowerCase()}%`);
      const idx = params.length;
      filters.push(`AND (LOWER(d.name) LIKE $${idx} OR LOWER(c.name) LIKE $${idx})`);
    }
    const clientFilter = filters[0] || '';
    const deptFilter = filters[1] || '';

    let sql;
    if (showAll) {
      // Show ALL employees who clocked in on the date (including those who clocked out)
      sql = `
        SELECT DISTINCT u.name, c.name as client, d.name as department, u.employee_no,
          (SELECT MIN(ce2.created_at) FROM clock_events ce2 WHERE ce2.user_id = u.id AND ce2.shift_date = $1 AND ce2.event_type IN ('clock_in','in')) as clock_in_at,
          (SELECT MAX(ce3.created_at) FROM clock_events ce3 WHERE ce3.user_id = u.id AND ce3.shift_date = $1 AND ce3.event_type IN ('clock_out','out')) as clock_out_at
        FROM clock_events ce
        JOIN users u ON ce.user_id = u.id
        LEFT JOIN clients c ON u.client_id = c.id
        LEFT JOIN departments d ON u.department_id = d.id
        WHERE ce.shift_date = $1 AND ce.event_type IN ('clock_in','in') ${clientFilter} ${deptFilter}
        ORDER BY u.name
      `;
    } else {
      // Show only CURRENTLY clocked in (no clock-out after their last clock-in).
      // IMPORTANT: look back 2 days of shift_dates to handle overnight shifts that cross IST midnight,
      // and check clock_out across ALL days, not just the same shift_date.
      sql = `
        SELECT DISTINCT u.name, c.name as client, d.name as department, u.employee_no
        FROM clock_events ce
        JOIN users u ON ce.user_id = u.id
        LEFT JOIN clients c ON u.client_id = c.id
        LEFT JOIN departments d ON u.department_id = d.id
        WHERE ce.shift_date >= ($1::date - INTERVAL '2 days')
          AND ce.shift_date <= $1::date
          AND ce.event_type IN ('clock_in','in')
          AND NOT EXISTS (
            SELECT 1 FROM clock_events co
            WHERE co.user_id = u.id
              AND co.event_type IN ('clock_out','out')
              AND co.created_at > ce.created_at
          )
          ${clientFilter} ${deptFilter}
        ORDER BY u.name
      `;
    }

    const { rows } = await dbQuery(sql, params);

    const result = {
      date: targetDate,
      count: rows.length,
      mode: showAll ? 'all_who_worked' : 'currently_clocked_in',
      filters: {
        ...(client_name ? { client: client_name } : {}),
        ...(department_name ? { department: department_name } : {}),
      },
    };
    if (showAll) {
      result.employees = rows.map(r => ({
        name: r.name,
        client: r.client,
        department: r.department,
        clock_in: r.clock_in_at ? new Date(r.clock_in_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }) + ' IST' : null,
        clock_out: r.clock_out_at ? new Date(r.clock_out_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }) + ' IST' : 'still working',
      }));
    } else {
      result.employees = rows.map(r => ({
        name: r.name, client: r.client, department: r.department, employee_no: r.employee_no,
      }));
    }
    return JSON.stringify(result);
  },
});

const getEmployeesByClient = new FunctionTool({
  name: 'get_employees_by_client',
  description: 'Get all active employees assigned to a specific client.',
  parameters: {
    type: 'object',
    properties: { client_name: { type: 'string', description: 'Client name (e.g. Ameresco, Cleanleaf, Puresky, Standard Solar, Triforce, MaxSolar, Metlen, TSR)' } },
    required: ['client_name'],
  },
  execute: async ({ client_name }) => {
    const { rows } = await dbQuery(`
      SELECT u.name, u.email, u.role, u.employee_no, u.designation, c.name as client
      FROM users u JOIN clients c ON u.client_id = c.id
      WHERE LOWER(c.name) = LOWER($1) AND u.is_active = true AND u.deleted_at IS NULL
      ORDER BY u.role, u.name
    `, [client_name]);
    return JSON.stringify({ count: rows.length, client: client_name, employees: rows });
  },
});

const getTeamLeads = new FunctionTool({
  name: 'get_team_leads',
  description: 'Get all team leads in the organization.',
  parameters: {},
  execute: async () => {
    const { rows } = await dbQuery(`
      SELECT u.name, u.email, u.employee_no, c.name as client, u.designation
      FROM users u LEFT JOIN clients c ON u.client_id = c.id
      WHERE u.role = 'team_lead' AND u.is_active = true AND u.deleted_at IS NULL ORDER BY u.name
    `);
    return JSON.stringify({ count: rows.length, team_leads: rows });
  },
});

const getManagers = new FunctionTool({
  name: 'get_managers',
  description: 'Get all managers in the organization.',
  parameters: {},
  execute: async () => {
    const { rows } = await dbQuery(`
      SELECT u.name, u.email, u.employee_no, u.designation
      FROM users u WHERE u.role = 'manager' AND u.is_active = true AND u.deleted_at IS NULL ORDER BY u.name
    `);
    return JSON.stringify({ count: rows.length, managers: rows });
  },
});

const getAssetSummary = new FunctionTool({
  name: 'get_asset_summary',
  description: 'Get asset inventory summary — total, assigned, available, by category.',
  parameters: {},
  execute: async () => {
    const { rows: [stats] } = await dbQuery(`
      SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'assigned') as assigned,
        COUNT(*) FILTER (WHERE status = 'available') as available,
        COUNT(*) FILTER (WHERE status = 'under_repair') as under_repair,
        COUNT(*) FILTER (WHERE status = 'retired') as retired FROM assets
    `);
    const { rows: byCat } = await dbQuery(`
      SELECT ac.name as category, COUNT(*) as count, COUNT(*) FILTER (WHERE a.status = 'assigned') as assigned
      FROM assets a JOIN asset_categories ac ON a.category_id = ac.id GROUP BY ac.name ORDER BY count DESC
    `);
    return JSON.stringify({ stats, by_category: byCat });
  },
});

const getUpcomingBirthdays = new FunctionTool({
  name: 'get_upcoming_birthdays',
  description: 'Get employees with birthdays in the next 14 days (starting from today in IST).',
  parameters: {},
  execute: async () => {
    // Use IST, not UTC — the company is India-based. Otherwise on Vercel (UTC), past IST midnight
    // this would use yesterday's day number and miss/overshoot.
    const istDateStr = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const start = new Date(istDateStr + 'T00:00:00Z');
    const end = new Date(start); end.setUTCDate(end.getUTCDate() + 14);
    const startMonth = start.getUTCMonth() + 1;
    const startDay = start.getUTCDate();
    const endMonth = end.getUTCMonth() + 1;
    const endDay = end.getUTCDate();

    // Fix month-boundary logic: previously `(M=4 AND D>=9) OR (M=4 AND D<=23)` resolved to all of April.
    let whereClause;
    let params;
    if (startMonth === endMonth) {
      // Window stays in one month (common case)
      whereClause = `EXTRACT(MONTH FROM u.date_of_birth) = $1 AND EXTRACT(DAY FROM u.date_of_birth) BETWEEN $2 AND $3`;
      params = [startMonth, startDay, endDay];
    } else if (endMonth === startMonth + 1 || (startMonth === 12 && endMonth === 1)) {
      // Window crosses one month boundary
      whereClause = `(EXTRACT(MONTH FROM u.date_of_birth) = $1 AND EXTRACT(DAY FROM u.date_of_birth) >= $2)
        OR (EXTRACT(MONTH FROM u.date_of_birth) = $3 AND EXTRACT(DAY FROM u.date_of_birth) <= $4)`;
      params = [startMonth, startDay, endMonth, endDay];
    } else {
      // Defensive fallback (shouldn't hit for a 14-day window but just in case)
      whereClause = `TRUE`;
      params = [];
    }

    const { rows } = await dbQuery(`
      SELECT u.name, u.date_of_birth, c.name as client
      FROM users u LEFT JOIN clients c ON u.client_id = c.id
      WHERE u.date_of_birth IS NOT NULL AND u.is_active = true AND u.deleted_at IS NULL
        AND (${whereClause})
      ORDER BY EXTRACT(MONTH FROM u.date_of_birth), EXTRACT(DAY FROM u.date_of_birth)
      LIMIT 20
    `, params);
    return JSON.stringify({
      count: rows.length,
      window: { from: `${startMonth}/${startDay}`, to: `${endMonth}/${endDay}` },
      birthdays: rows,
    });
  },
});

const searchEmployee = new FunctionTool({
  name: 'search_employee',
  description: 'Search for an employee by name. Returns details like email, role, client, department, designation, DOB, work hours.',
  parameters: {
    type: 'object',
    properties: { name: { type: 'string', description: 'Employee name or partial name to search for' } },
    required: ['name'],
  },
  execute: async ({ name }) => {
    const { rows } = await dbQuery(`
      SELECT u.name, u.email, u.role, u.employee_no, u.designation, u.date_of_birth, u.phone,
             c.name as client, d.name as department, u.work_timezone, u.work_hours
      FROM users u LEFT JOIN clients c ON u.client_id = c.id LEFT JOIN departments d ON u.department_id = d.id
      WHERE LOWER(u.name) LIKE $1 AND u.deleted_at IS NULL LIMIT 5
    `, [`%${name.toLowerCase()}%`]);
    return JSON.stringify({ count: rows.length, employees: rows });
  },
});

const getDepartments = new FunctionTool({
  name: 'get_departments',
  description: 'Get all departments and their employee counts.',
  parameters: {},
  execute: async () => {
    const { rows } = await dbQuery(`
      SELECT d.name as department, COUNT(u.id) as employee_count
      FROM departments d LEFT JOIN users u ON u.department_id = d.id AND u.is_active = true AND u.deleted_at IS NULL
      GROUP BY d.id, d.name ORDER BY d.name
    `);
    return JSON.stringify({ departments: rows });
  },
});

const getEmployeeAttendance = new FunctionTool({
  name: 'get_employee_attendance',
  description: 'Get attendance history for an employee over a date range. Shows clock-in/out times, shift times, whether they were late (with 30-min grace), and total hours worked. Use this for questions like "how many times was X late", "attendance report for X", "did X come on time".',
  parameters: {
    type: 'object',
    properties: {
      employee_name: { type: 'string', description: 'Employee name or partial name' },
      days_back: { type: 'number', description: 'Number of days to look back (default 28 for 4 weeks)' },
    },
    required: ['employee_name'],
  },
  execute: async ({ employee_name, days_back = 28 }) => {
    // Find the employee
    const { rows: empRows } = await dbQuery(
      `SELECT id, name FROM users WHERE LOWER(name) LIKE $1 AND is_active = true AND deleted_at IS NULL LIMIT 1`,
      [`%${employee_name.toLowerCase()}%`]
    );
    if (empRows.length === 0) return JSON.stringify({ error: 'Employee not found' });
    const emp = empRows[0];

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days_back);
    const startISO = startDate.toISOString().slice(0, 10);

    // Get shift assignments and clock events
    const { rows } = await dbQuery(`
      SELECT
        sa.shift_date,
        sa.shift_start_time,
        sa.shift_end_time,
        (SELECT ce.created_at FROM clock_events ce
         WHERE ce.user_id = $1 AND ce.shift_date = sa.shift_date AND ce.event_type IN ('clock_in','in')
         ORDER BY ce.created_at ASC LIMIT 1) AS first_clock_in,
        (SELECT ce.created_at FROM clock_events ce
         WHERE ce.user_id = $1 AND ce.shift_date = sa.shift_date AND ce.event_type IN ('clock_out','out')
         ORDER BY ce.created_at DESC LIMIT 1) AS last_clock_out
      FROM shift_assignments sa
      WHERE sa.user_id = $1 AND sa.shift_date >= $2 AND sa.shift_date <= $3
      ORDER BY sa.shift_date DESC
    `, [emp.id, startISO, today()]);

    let lateCount = 0;
    let onTimeCount = 0;
    let absentCount = 0;
    let totalMinutesWorked = 0;
    const GRACE_MINUTES = 30;
    const details = [];

    for (const r of rows) {
      const shiftStart = r.shift_start_time; // e.g. "09:00"
      const clockIn = r.first_clock_in;
      const clockOut = r.last_clock_out;

      if (!clockIn) {
        absentCount++;
        details.push({ date: r.shift_date, shift: `${shiftStart}-${r.shift_end_time}`, clock_in: null, status: 'absent' });
        continue;
      }

      // Convert clock-in to IST time string
      const clockInDate = new Date(clockIn);
      const clockInIST = clockInDate.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });

      // Parse shift start and clock-in into minutes for comparison
      const [sh, sm] = (shiftStart || '09:00').split(':').map(Number);
      const [ch, cm] = clockInIST.split(':').map(Number);
      const shiftMinutes = sh * 60 + sm;
      const clockMinutes = ch * 60 + cm;
      const lateBy = clockMinutes - shiftMinutes;

      let status;
      if (lateBy <= GRACE_MINUTES) {
        status = 'on_time';
        onTimeCount++;
      } else {
        status = `late_by_${lateBy - GRACE_MINUTES}_mins`;
        lateCount++;
      }

      // Calculate hours worked
      if (clockOut) {
        const clockOutDate = new Date(clockOut);
        const workedMs = clockOutDate - clockInDate;
        totalMinutesWorked += Math.round(workedMs / 60000);
      }

      details.push({
        date: r.shift_date,
        shift: `${shiftStart}-${r.shift_end_time}`,
        clock_in: clockInIST + ' IST',
        clock_out: clockOut ? new Date(clockOut).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }) + ' IST' : null,
        late_by_minutes: lateBy > GRACE_MINUTES ? lateBy - GRACE_MINUTES : 0,
        status,
      });
    }

    return JSON.stringify({
      employee: emp.name,
      period: `${startISO} to ${today()}`,
      total_shifts: rows.length,
      on_time: onTimeCount,
      late: lateCount,
      absent: absentCount,
      grace_period: `${GRACE_MINUTES} minutes`,
      avg_hours_per_day: rows.length > 0 ? (totalMinutesWorked / 60 / Math.max(1, rows.length - absentCount)).toFixed(1) : 0,
      details: details.slice(0, 15), // Limit to 15 most recent
    });
  },
});

const getAttendanceSummary = new FunctionTool({
  name: 'get_attendance_summary',
  description: 'Get attendance summary for a specific date or date range. Shows who was present, absent, late. Good for "who was absent yesterday", "attendance on March 10".',
  parameters: {
    type: 'object',
    properties: {
      date: { type: 'string', description: 'Date in YYYY-MM-DD format (default today)' },
      client_name: { type: 'string', description: 'Optional client name to filter' },
    },
  },
  execute: async ({ date, client_name }) => {
    const targetDate = date || today();
    const params = [targetDate];
    let clientFilter = '';
    if (client_name) { clientFilter = 'AND LOWER(c.name) = LOWER($2)'; params.push(client_name); }

    const { rows } = await dbQuery(`
      SELECT u.name, u.role, c.name as client,
        sa.shift_start_time, sa.shift_end_time,
        (SELECT ce.created_at FROM clock_events ce
         WHERE ce.user_id = u.id AND ce.shift_date = $1 AND ce.event_type IN ('clock_in','in')
         ORDER BY ce.created_at ASC LIMIT 1) AS first_clock_in,
        (SELECT ce.created_at FROM clock_events ce
         WHERE ce.user_id = u.id AND ce.shift_date = $1 AND ce.event_type IN ('clock_out','out')
         ORDER BY ce.created_at DESC LIMIT 1) AS last_clock_out
      FROM shift_assignments sa
      JOIN users u ON u.id = sa.user_id
      LEFT JOIN clients c ON c.id = u.client_id
      WHERE sa.shift_date = $1 AND u.is_active = true AND u.deleted_at IS NULL ${clientFilter}
      ORDER BY u.name
    `, params);

    const GRACE = 30;
    let present = 0, absent = 0, late = 0;
    const summary = rows.map(r => {
      if (!r.first_clock_in) { absent++; return { name: r.name, client: r.client, status: 'absent' }; }
      const cin = new Date(r.first_clock_in);
      const cinIST = cin.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' });
      const [sh, sm] = (r.shift_start_time || '09:00').split(':').map(Number);
      const [ch, cm] = cinIST.split(':').map(Number);
      const lateBy = (ch * 60 + cm) - (sh * 60 + sm);
      if (lateBy > GRACE) { late++; present++; return { name: r.name, client: r.client, status: 'late', clock_in: cinIST, late_by: `${lateBy - GRACE} mins` }; }
      present++; return { name: r.name, client: r.client, status: 'on_time', clock_in: cinIST };
    });

    return JSON.stringify({ date: targetDate, total: rows.length, present, absent, late, employees: summary });
  },
});

const getLeaveHistory = new FunctionTool({
  name: 'get_leave_history',
  description: 'Get leave history for a specific employee. Shows all leave requests with dates, type, status, and approval chain.',
  parameters: {
    type: 'object',
    properties: {
      employee_name: { type: 'string', description: 'Employee name or partial name' },
      days_back: { type: 'number', description: 'Number of days to look back (default 90)' },
    },
    required: ['employee_name'],
  },
  execute: async ({ employee_name, days_back = 90 }) => {
    const { rows: empRows } = await dbQuery(
      `SELECT id, name FROM users WHERE LOWER(name) LIKE $1 AND is_active = true AND deleted_at IS NULL LIMIT 1`,
      [`%${employee_name.toLowerCase()}%`]
    );
    if (empRows.length === 0) return JSON.stringify({ error: 'Employee not found' });
    const emp = empRows[0];

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days_back);

    const { rows } = await dbQuery(`
      SELECT lr.start_date, lr.end_date, lr.total_days, lr.leave_type, lr.status, lr.approval_chain, lr.requested_at
      FROM leave_requests lr
      WHERE lr.employee_id = $1 AND lr.requested_at >= $2
      ORDER BY lr.requested_at DESC
    `, [emp.id, startDate.toISOString()]);

    return JSON.stringify({
      employee: emp.name,
      total_requests: rows.length,
      approved: rows.filter(r => r.status === 'approved').length,
      rejected: rows.filter(r => r.status === 'rejected').length,
      pending: rows.filter(r => r.status.startsWith('pending')).length,
      total_days_taken: rows.filter(r => r.status === 'approved').reduce((s, r) => s + (r.total_days || 0), 0),
      leaves: rows.map(r => ({
        dates: `${r.start_date} to ${r.end_date}`,
        days: r.total_days,
        type: r.leave_type,
        status: r.status,
        approvers: (r.approval_chain || []).map(a => `${a.user_name} (${a.role})`).join(', '),
      })),
    });
  },
});

const getShiftChangeHistory = new FunctionTool({
  name: 'get_shift_change_history',
  description: 'Get shift change request history for a specific employee or all employees.',
  parameters: {
    type: 'object',
    properties: {
      employee_name: { type: 'string', description: 'Optional employee name to filter' },
    },
  },
  execute: async ({ employee_name }) => {
    let empFilter = '';
    const params = [];
    if (employee_name) {
      const { rows: empRows } = await dbQuery(
        `SELECT id, name FROM users WHERE LOWER(name) LIKE $1 AND is_active = true AND deleted_at IS NULL LIMIT 1`,
        [`%${employee_name.toLowerCase()}%`]
      );
      if (empRows.length === 0) return JSON.stringify({ error: 'Employee not found' });
      params.push(empRows[0].id);
      empFilter = `AND scr.user_id = $${params.length}`;
    }
    const { rows } = await dbQuery(`
      SELECT u.name, scr.request_date, scr.original_start_time, scr.original_end_time,
             scr.requested_start_time, scr.requested_end_time, scr.reason, scr.status, scr.approval_chain
      FROM shift_change_requests scr JOIN users u ON u.id = scr.user_id
      WHERE 1=1 ${empFilter}
      ORDER BY scr.created_at DESC LIMIT 20
    `, params);
    return JSON.stringify({ count: rows.length, requests: rows.map(r => ({
      employee: r.name, date: r.request_date,
      original: `${r.original_start_time || '?'}-${r.original_end_time || '?'}`,
      requested: `${r.requested_start_time}-${r.requested_end_time}`,
      reason: r.reason, status: r.status,
      approvers: (r.approval_chain || []).map(a => `${a.user_name} (${a.role})`).join(', '),
    }))});
  },
});

const getHolidayCalendar = new FunctionTool({
  name: 'get_holiday_calendar',
  description: 'Get the holiday calendar for a given year. Shows all company holidays with their dates, names, type (mandatory/optional), and which calendar they belong to (IND, US, All). Use this for questions like "what holidays do we have", "upcoming holidays", "is March 30 a holiday", "Indian holidays", "US holidays".',
  parameters: {
    type: 'object',
    properties: {
      year: { type: 'number', description: 'Year to fetch holidays for (default current year)' },
    },
  },
  execute: async ({ year }) => {
    const yr = year || new Date().getFullYear();
    try {
      const { rows } = await dbQuery(
        `SELECT id, holiday_date, name, is_optional, calendar, COALESCE(holiday_type, 'regional') as holiday_type FROM holidays WHERE EXTRACT(YEAR FROM holiday_date) = $1 ORDER BY holiday_date`,
        [yr]
      );
      const todayStr = today();
      const upcoming = rows.filter(r => toDateStr(r.holiday_date) >= todayStr);
      return JSON.stringify({
        year: yr,
        total_holidays: rows.length,
        upcoming_count: upcoming.length,
        holidays: rows.map(r => ({
          date: toDateStr(r.holiday_date),
          name: r.name,
          type: r.is_optional ? 'Optional' : 'Mandatory',
          holiday_type: r.holiday_type,
          comp_off_expiry: r.holiday_type === 'national' ? '1 year' : '1 month',
          calendar: r.calendar,
          upcoming: toDateStr(r.holiday_date) >= todayStr,
        })),
      });
    } catch (e) {
      return JSON.stringify({ error: 'Could not fetch holidays', detail: e.message });
    }
  },
});

const getCompOffInfo = new FunctionTool({
  name: 'get_comp_off_info',
  description: 'Get comp-off (compensatory off) information for an employee or all employees. Shows earned comp leaves and bonuses for working on holidays. Use this for questions like "my comp offs", "who earned comp leave", "holiday work bonus", "comp off balance", "how many comp leaves do I have".',
  parameters: {
    type: 'object',
    properties: {
      employee_name: { type: 'string', description: 'Optional employee name to filter (omit for all)' },
    },
  },
  execute: async ({ employee_name }) => {
    try {
      let empFilter = '';
      const params = [];
      if (employee_name) {
        const { rows: empRows } = await dbQuery(
          `SELECT id, name FROM users WHERE LOWER(name) LIKE $1 AND is_active = true AND deleted_at IS NULL LIMIT 1`,
          [`%${employee_name.toLowerCase()}%`]
        );
        if (empRows.length === 0) return JSON.stringify({ error: 'Employee not found' });
        params.push(empRows[0].id);
        empFilter = `WHERE co.user_id = $${params.length}`;
      }
      const { rows } = await dbQuery(`
        SELECT co.*, u.name as employee_name, h.name as holiday_name, h.holiday_date, h.calendar
        FROM comp_offs co
        JOIN users u ON u.id = co.user_id
        JOIN holidays h ON h.id = co.holiday_id
        ${empFilter}
        ORDER BY co.created_at DESC
      `, params);

      const byUser = {};
      rows.forEach(r => {
        if (!byUser[r.employee_name]) byUser[r.employee_name] = { earned: 0, used: 0, available: 0, total_bonus: 0, records: [] };
        const u = byUser[r.employee_name];
        u.earned++;
        if (r.status === 'used') u.used++; else u.available++;
        u.total_bonus += Number(r.bonus_amount || 0);
        u.records.push({
          holiday: r.holiday_name,
          date: toDateStr(r.holiday_date),
          calendar: r.calendar,
          bonus: `₹${r.bonus_amount || 500}`,
          comp_leave: `${r.comp_days || 1} day`,
          status: r.status,
        });
      });

      return JSON.stringify({
        total_comp_offs: rows.length,
        summary: Object.entries(byUser).map(([name, data]) => ({
          employee: name,
          comp_leaves_earned: data.earned,
          comp_leaves_used: data.used,
          comp_leaves_available: data.available,
          total_bonus_earned: `₹${data.total_bonus}`,
          details: data.records,
        })),
      });
    } catch (e) {
      return JSON.stringify({ error: 'Could not fetch comp-off data', detail: e.message });
    }
  },
});

const getWhoWorkedOnHoliday = new FunctionTool({
  name: 'get_who_worked_on_holiday',
  description: 'Find out which employees worked on a specific holiday (by name or date). Checks actual clock-in events AND comp-off records. Use for: "who worked on Independence Day", "who came on Diwali", "who worked on 2026-01-26", "who all worked on holidays", "how many people worked on Ugadi".',
  parameters: {
    type: 'object',
    properties: {
      holiday_name: { type: 'string', description: 'Holiday name to search for (e.g. "Independence Day", "Diwali", "Republic Day", "Ugadi"). Partial match supported.' },
      holiday_date: { type: 'string', description: 'Specific date in YYYY-MM-DD format. Use this if user gives a date instead of a name.' },
      year: { type: 'number', description: 'Year to filter (default current year)' },
    },
  },
  execute: async ({ holiday_name, holiday_date, year }) => {
    try {
      const yr = year || new Date().getFullYear();
      let holidayRows;

      if (holiday_date) {
        const { rows } = await dbQuery(
          `SELECT id, holiday_date, name, calendar, COALESCE(holiday_type, 'regional') as holiday_type FROM holidays WHERE holiday_date = $1`,
          [holiday_date]
        );
        holidayRows = rows;
      } else if (holiday_name) {
        const { rows } = await dbQuery(
          `SELECT id, holiday_date, name, calendar, COALESCE(holiday_type, 'regional') as holiday_type FROM holidays
           WHERE LOWER(name) LIKE $1 AND EXTRACT(YEAR FROM holiday_date) = $2
           ORDER BY holiday_date`,
          [`%${holiday_name.toLowerCase()}%`, yr]
        );
        holidayRows = rows;
      } else {
        // Get all holidays that have passed this year
        const { rows } = await dbQuery(
          `SELECT id, holiday_date, name, calendar, COALESCE(holiday_type, 'regional') as holiday_type
           FROM holidays
           WHERE EXTRACT(YEAR FROM holiday_date) = $1 AND holiday_date <= $2
           ORDER BY holiday_date`,
          [yr, today()]
        );
        holidayRows = rows;
      }

      if (holidayRows.length === 0) {
        return JSON.stringify({ error: `No holiday found matching "${holiday_name || holiday_date || 'any'}" in ${yr}` });
      }

      const results = [];
      for (const h of holidayRows) {
        const hDate = toDateStr(h.holiday_date);

        // Check actual clock_events for who clocked in on the holiday date
        const { rows: clockedIn } = await dbQuery(
          `SELECT DISTINCT u.id, u.name, u.role, c.name as client,
             (SELECT MIN(ce2.created_at) FROM clock_events ce2 WHERE ce2.user_id = u.id AND ce2.shift_date = $1 AND ce2.event_type IN ('clock_in','in')) as clock_in_at,
             (SELECT MAX(ce3.created_at) FROM clock_events ce3 WHERE ce3.user_id = u.id AND ce3.shift_date = $1 AND ce3.event_type IN ('clock_out','out')) as clock_out_at
           FROM clock_events ce
           JOIN users u ON u.id = ce.user_id
           LEFT JOIN clients c ON c.id = u.client_id
           WHERE ce.shift_date = $1 AND ce.event_type IN ('clock_in','in')
           ORDER BY u.name`,
          [hDate]
        );

        // Also check comp_offs for bonus/comp leave info
        const { rows: compOffRows } = await dbQuery(
          `SELECT user_id, bonus_amount, comp_leave_days, status FROM comp_offs WHERE holiday_id = $1`,
          [h.id]
        );
        const compMap = {};
        compOffRows.forEach(co => { compMap[co.user_id] = co; });

        results.push({
          holiday: h.name,
          date: hDate,
          calendar: h.calendar,
          employees_worked: clockedIn.length,
          employees: clockedIn.map(w => {
            const co = compMap[w.id];
            return {
              name: w.name,
              role: w.role,
              client: w.client,
              clock_in: w.clock_in_at ? new Date(w.clock_in_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }) + ' IST' : null,
              clock_out: w.clock_out_at ? new Date(w.clock_out_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Kolkata' }) + ' IST' : null,
              comp_off_status: co ? co.status : 'not recorded',
              bonus: co ? `₹${co.bonus_amount || 500}` : 'not recorded',
            };
          }),
        });
      }

      return JSON.stringify({ year: yr, holidays_matched: results.length, results });
    } catch (e) {
      return JSON.stringify({ error: 'Could not fetch holiday attendance', detail: e.message });
    }
  },
});

const getCompLeaveRanking = new FunctionTool({
  name: 'get_comp_leave_ranking',
  description: 'Get a ranking of employees by comp leave count. Shows who has the most comp leaves, who earned the most, who used the most. Use for: "who has more comp leaves", "comp leave ranking", "most comp offs", "comp leave leaderboard".',
  parameters: {
    type: 'object',
    properties: {
      year: { type: 'number', description: 'Year to filter (default current year)' },
      sort_by: { type: 'string', description: 'Sort by: "available" (default), "earned", "used", "bonus"' },
    },
  },
  execute: async ({ year, sort_by = 'available' }) => {
    try {
      const yr = year || new Date().getFullYear();
      const { rows } = await dbQuery(`
        SELECT u.name, u.role, c.name as client,
          COUNT(*) as total_earned,
          COUNT(*) FILTER (WHERE co.status = 'earned') as available,
          COUNT(*) FILTER (WHERE co.status = 'used') as used,
          SUM(co.bonus_amount) as total_bonus,
          MIN(co.expiry_date) FILTER (WHERE co.status = 'earned') as nearest_expiry
        FROM comp_offs co
        JOIN users u ON u.id = co.user_id
        LEFT JOIN clients c ON c.id = u.client_id
        WHERE EXTRACT(YEAR FROM co.holiday_date) = $1
        GROUP BY u.id, u.name, u.role, c.name
        ORDER BY ${sort_by === 'earned' ? 'total_earned' : sort_by === 'used' ? 'used' : sort_by === 'bonus' ? 'total_bonus' : 'available'} DESC
      `, [yr]);

      return JSON.stringify({
        year: yr,
        total_employees_with_comp_offs: rows.length,
        ranking: rows.map((r, i) => ({
          rank: i + 1,
          employee: r.name,
          role: r.role,
          client: r.client,
          comp_leaves_earned: Number(r.total_earned),
          comp_leaves_available: Number(r.available),
          comp_leaves_used: Number(r.used),
          total_bonus: `₹${r.total_bonus || 0}`,
          nearest_expiry: r.nearest_expiry ? toDateStr(r.nearest_expiry) : null,
        })),
      });
    } catch (e) {
      return JSON.stringify({ error: 'Could not fetch comp leave ranking', detail: e.message });
    }
  },
});

const getEmployeeCompOffDetail = new FunctionTool({
  name: 'get_employee_comp_off_detail',
  description: 'Get detailed comp-off information for a specific employee — every comp leave earned, when it was used, expiry dates, and full history. Use for: "how many comp leaves does X have", "when did X use comp leave", "X comp off details", "did X use any comp leaves".',
  parameters: {
    type: 'object',
    properties: {
      employee_name: { type: 'string', description: 'Employee name or partial name' },
      year: { type: 'number', description: 'Year to filter (default current year)' },
    },
    required: ['employee_name'],
  },
  execute: async ({ employee_name, year }) => {
    try {
      const yr = year || new Date().getFullYear();
      const { rows: empRows } = await dbQuery(
        `SELECT id, name FROM users WHERE LOWER(name) LIKE $1 AND is_active = true AND deleted_at IS NULL LIMIT 1`,
        [`%${employee_name.toLowerCase()}%`]
      );
      if (empRows.length === 0) return JSON.stringify({ error: `Employee "${employee_name}" not found` });
      const emp = empRows[0];

      const { rows } = await dbQuery(`
        SELECT co.*, h.name as holiday_name, h.calendar, COALESCE(h.holiday_type, 'regional') as holiday_type
        FROM comp_offs co
        JOIN holidays h ON h.id = co.holiday_id
        WHERE co.user_id = $1 AND EXTRACT(YEAR FROM co.holiday_date) = $2
        ORDER BY co.holiday_date
      `, [emp.id, yr]);

      const todayStr = today();
      const earned = rows.length;
      const used = rows.filter(r => r.status === 'used').length;
      const available = rows.filter(r => r.status === 'earned').length;
      const expired = rows.filter(r => r.status === 'earned' && r.expiry_date && toDateStr(r.expiry_date) < todayStr).length;
      const totalBonus = rows.reduce((s, r) => s + Number(r.bonus_amount || 0), 0);

      return JSON.stringify({
        employee: emp.name,
        year: yr,
        summary: {
          total_earned: earned,
          currently_available: available,
          used: used,
          expiring_soon: rows.filter(r => r.status === 'earned' && r.expiry_date && toDateStr(r.expiry_date) >= todayStr && toDateStr(r.expiry_date) <= new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10)).length,
          already_expired: expired,
          total_bonus_earned: `₹${totalBonus}`,
        },
        comp_offs: rows.map(r => ({
          holiday: r.holiday_name,
          holiday_date: toDateStr(r.holiday_date),
          holiday_type: r.holiday_type,
          calendar: r.calendar,
          bonus: `₹${r.bonus_amount || 500}`,
          comp_days: r.comp_leave_days || 1,
          status: r.status,
          expiry_rule: r.holiday_type === 'national' ? '1 year (national)' : '1 month (regional)',
          earned_date: r.created_at ? new Date(r.created_at).toISOString().slice(0, 10) : null,
          used_date: r.used_date ? toDateStr(r.used_date) : null,
          expiry_date: r.expiry_date ? toDateStr(r.expiry_date) : null,
          is_expired: r.status === 'earned' && r.expiry_date && toDateStr(r.expiry_date) < todayStr,
        })),
      });
    } catch (e) {
      return JSON.stringify({ error: 'Could not fetch employee comp-off details', detail: e.message });
    }
  },
});

const getHolidayAttendanceSummary = new FunctionTool({
  name: 'get_holiday_attendance_summary',
  description: 'Get a summary of all holidays and how many employees actually worked (clocked in) on each one. Use for: "holiday attendance overview", "which holidays had the most workers", "summary of holiday work".',
  parameters: {
    type: 'object',
    properties: {
      year: { type: 'number', description: 'Year to filter (default current year)' },
    },
  },
  execute: async ({ year }) => {
    try {
      const yr = year || new Date().getFullYear();
      // Get all holidays for the year
      const { rows: holidays } = await dbQuery(
        `SELECT id, name, holiday_date, calendar, is_optional FROM holidays WHERE EXTRACT(YEAR FROM holiday_date) = $1 ORDER BY holiday_date`,
        [yr]
      );

      const todayStr = today();
      const results = [];
      for (const h of holidays) {
        const hDate = toDateStr(h.holiday_date);
        const isPast = hDate < todayStr;

        // Count actual clock-in events on the holiday date
        const { rows: workers } = await dbQuery(
          `SELECT DISTINCT u.name
           FROM clock_events ce JOIN users u ON u.id = ce.user_id
           WHERE ce.shift_date = $1 AND ce.event_type IN ('clock_in','in')
           ORDER BY u.name`,
          [hDate]
        );

        results.push({
          name: h.name,
          date: hDate,
          calendar: h.calendar,
          type: h.is_optional ? 'Optional' : 'Mandatory',
          is_past: isPast,
          employees_worked: workers.length,
          who_worked: workers.length > 0 ? workers.map(w => w.name).join(', ') : 'No one',
        });
      }

      return JSON.stringify({
        year: yr,
        total_holidays: results.length,
        holidays_with_workers: results.filter(r => r.employees_worked > 0).length,
        holidays: results,
      });
    } catch (e) {
      return JSON.stringify({ error: 'Could not fetch holiday attendance summary', detail: e.message });
    }
  },
});

const getHolidayWorkPolicy = new FunctionTool({
  name: 'get_holiday_work_policy',
  description: 'Get the company holiday work policy and comp-off benefits. Use for questions like "what do I get for working on a holiday", "holiday benefits", "comp off policy", "holiday bonus", "perks of working on holidays".',
  parameters: {},
  execute: async () => {
    return JSON.stringify({
      policy: {
        title: 'AGS Holiday Work Compensation Policy',
        applicable_to: 'Indian team employees (excludes US-based team: Jaswanthi, Rohan, Girish)',
        benefits: [
          '₹500 bonus per holiday worked (added to payroll)',
          '1 compensatory leave (comp off) per holiday worked',
        ],
        how_it_works: [
          'When an Indian team employee clocks in on a day that is an Indian (IND) or All-calendar holiday, the system automatically credits them with ₹500 bonus and 1 comp leave.',
          'Comp leaves can be used later by requesting through the comp-off section.',
          'Comp leave expiry depends on holiday type: NATIONAL holidays (Republic Day, Independence Day, Gandhi Jayanti, etc.) → 1 year. REGIONAL holidays (Ugadi, Sankranthi, Diwali, etc.) → 1 month.',
          'The Holiday Calendar tab shows all upcoming and past holidays for the year.',
          'My Comp Offs tab shows your earned comp leaves and bonuses.',
        ],
        holiday_attendance_rules: {
          summary: 'Working on a holiday is entirely voluntary. There are NO strict login/logout timing requirements on holidays.',
          details: [
            'Holidays are official days off — working on them is optional and voluntary.',
            'The standard 30-minute grace period and lateness tracking do NOT apply on holidays.',
            'Employees who choose to work on holidays can log in and log out at any time — there is no fixed shift schedule enforced.',
            'The only requirement to earn the comp-off and bonus is to clock in on the holiday. The system detects the clock-in and auto-credits the benefits.',
            'There is no minimum hours requirement on holidays — any clock-in counts.',
          ],
        },
        holiday_calendars: {
          IND: 'Indian holidays — apply to all Indian team members',
          US: 'US holidays — apply only to US-based team (Jaswanthi, Rohan, Girish)',
          All: 'Company-wide holidays — apply to everyone',
        },
        us_team_note: 'US team members (Jaswanthi, Rohan, Girish) observe US + All holidays. They do not receive comp-off benefits or bonuses for working on holidays.',
        where_to_check: 'Go to the "Comp Off" tab in the portal to see the holiday calendar, your earned comp leaves, and bonus details.',
      },
    });
  },
});

// All DB tools
const dbTools = [
  getWorkforceStats, getLeavesToday, getPendingLeaves, getClockedInEmployees,
  getEmployeesByClient, getTeamLeads, getManagers, getAssetSummary,
  getUpcomingBirthdays, searchEmployee, getDepartments,
  getEmployeeAttendance, getAttendanceSummary, getLeaveHistory, getShiftChangeHistory,
  getHolidayCalendar, getCompOffInfo, getHolidayWorkPolicy,
  getWhoWorkedOnHoliday, getCompLeaveRanking, getEmployeeCompOffDetail, getHolidayAttendanceSummary,
];

// ══════════════════════════════════════════════════════════════════
// AGENTS — using Google ADK LlmAgent
// ══════════════════════════════════════════════════════════════════

function createGemini() {
  return new Gemini({ model: 'gemini-2.5-flash', apiKey: GEMINI_API_KEY });
}

// Nick — DB/Workforce Agent (instruction is set dynamically per request with user context)
let nickAgent = null;
function getNickAgent(userContext) {
  // Recreate with user context injected into instruction
  return new LlmAgent({
    name: 'nick',
    model: createGemini(),
    instruction: `You are Nick, the AGS workforce database agent. Today is ${today()}.
You help with employee data, leaves, schedules, assets, clients, departments, birthdays, team structure, attendance, lateness reports, holidays, and comp-off benefits.
Use your tools to query the database — NEVER make up data. Be concise and professional.
Format lists with bullet points. Format dates nicely.

HOLIDAY & COMP-OFF KNOWLEDGE:
- AGS has a holiday calendar with Indian (IND), US, and All (company-wide) holidays.
- Holidays are classified as either "national" or "regional":
  - NATIONAL holidays: Republic Day, Independence Day, Gandhi Jayanti, New Year, Christmas, May Day, US Memorial Day, US Independence Day, US Labour Day, Thanksgiving
  - REGIONAL holidays: Ugadi, Sankranthi/Pongal, Dussehra, Diwali, Ganesh Chaturthi, Ramzan, Bakrid, and other festival holidays
- Indian team employees who clock in on an IND or All-calendar holiday automatically earn ₹500 bonus + 1 compensatory leave (comp off).
- COMP-OFF EXPIRY RULES (IMPORTANT):
  - National holidays → comp leave is valid for 1 YEAR from the holiday date
  - Regional holidays → comp leave is valid for 1 MONTH from the holiday date
  - After expiry, unused comp leaves cannot be redeemed
- US team (Jaswanthi, Rohan, Girish) observes US + All holidays — they do NOT get comp-off benefits or bonuses.

TOOL SELECTION GUIDE (ALWAYS use a tool — never answer from memory, never say "I'm here to help"):
- "upcoming birthdays" / "who has a birthday" / "birthdays this week" → use get_upcoming_birthdays
- "search employee" / "find [name]" / "who is [name]" → use search_employee
- "who is logged in" / "who clocked in today" / "who worked on [date]" → use get_clocked_in_employees
- "who is logged in [X]" where X is a department/team/client — use get_clocked_in_employees. Pass the term as department_name (the tool is forgiving and matches both departments and clients). Known departments: Tech, Solar, HR, Finance, Libsys, Business Development. Known clients: Ameresco, Cleanleaf, MaxSolar, Metlen, Puresky, Standard Solar, Triforce, TSR. Examples: "who is logged in Libsys" → department_name="libsys"; "who is logged in tech team" → department_name="tech"; "who is logged in Ameresco" → department_name="ameresco" (forgiving match). NEVER say "no one is logged in for X" unless you have actually called the tool with department_name set — if a client-only filter returned zero rows, retry with department_name before answering.
- "attendance on [date]" / "who was absent" → use get_attendance_summary
- "how many times was X late" / "attendance report for X" → use get_employee_attendance
- "total employees" / "how many employees" / "workforce stats" → use get_workforce_stats
- "employees in [client]" → use get_employees_by_client
- "who is on leave" / "leaves today" → use get_leaves_today
- "pending leaves" → use get_pending_leaves
- "team leads" / "who are the TLs" → use get_team_leads
- "managers" → use get_managers
- "departments" → use get_departments
- "assets" / "inventory" → use get_asset_summary
- "what holidays are coming up" / "is X a holiday" → use get_holiday_calendar
- "who worked on Independence Day" / "who came on Diwali" / "who worked on holidays" → use get_who_worked_on_holiday
- "who has the most comp leaves" / "comp leave ranking" / "who has more comp offs" → use get_comp_leave_ranking
- "how many comp leaves does X have" / "X comp off details" → use get_employee_comp_off_detail
- "holiday attendance overview" / "which holidays had most workers" → use get_holiday_attendance_summary
- "my comp offs" / "comp off balance for all" / general comp-off info → use get_comp_off_info
- "what do I get for working on a holiday" / "comp off policy" → use get_holiday_work_policy
- "leave history for X" → use get_leave_history
- "shift change requests" → use get_shift_change_history

CRITICAL: You MUST call a tool for EVERY question. NEVER respond with generic text like "I'm here to help". If unsure which tool to use, try the most relevant one.

CURRENT USER CONTEXT:
- Name: ${userContext.name}
- Role: ${userContext.role}
- User ID: ${userContext.id}

ACCESS CONTROL RULES (STRICTLY ENFORCE):
- If role is "admin", "manager", or "team_lead": They can ask about ANY employee's data — attendance, lateness, leaves, who is on leave, leave plans, schedules, etc.
- If role is "employee": They can ONLY ask about their OWN data (their own attendance, their own leaves, their own schedule).
  - If they ask about another employee (e.g. "how many times was John late"), politely refuse: "I can't share that information with you. Please contact your manager for reports on other employees."
  - If they ask general workforce questions like "who is on leave today", "whose leave is approved", "total employees", "who is absent", "pending leave requests", "upcoming leaves" — REFUSE and say: "This information is only available to team leads, managers, and the CEO. I can only help you with your own attendance, leaves, and schedule."
  - Employees should NOT be able to see other people's leave status, leave plans, or any team-wide data.
  - The ONLY things an employee can ask about: their own attendance, their own leave history, their own shift schedule, their own shift change requests, general company info (HR policies, solar news).

LATENESS RULES:
- There is a 30-minute grace period. If someone clocks in within 30 minutes of their shift start time, they are ON TIME.
- Only count as late if they clocked in MORE than 30 minutes after shift start.
- When reporting lateness, show the actual late minutes (after subtracting the 30-min grace).
- IMPORTANT: Lateness rules and the 30-minute grace period do NOT apply on holidays. Working on holidays is completely voluntary — employees can log in and out at any time. There are no fixed shift timings enforced on holidays. Do NOT report anyone as "late" for holiday work.

HOLIDAY ATTENDANCE RULES (answer directly without needing a tool call):
- Working on a holiday is entirely voluntary — it is an official day off.
- There are NO strict login/logout timing requirements on holidays.
- The standard 30-minute grace period and lateness tracking do NOT apply on holidays.
- Employees who choose to work can clock in and out at any time — no fixed shift schedule is enforced.
- The only requirement to earn the comp-off + bonus is to clock in on the holiday.
- There is no minimum hours requirement — any clock-in counts.
- If someone asks "does the buffer/grace period apply on holidays" or "can they login anytime on holidays", answer YES they can, and explain the above rules directly.

When asked about attendance or lateness, use the get_employee_attendance tool. Present the results clearly with counts and a table of recent dates.`,
    tools: dbTools,
  });
}

// Root Agent — created per request with user context (all sub-agents created fresh to avoid re-parenting error)
function createRootAgent(userContext) {
  const nick = getNickAgent(userContext);

  const solarAgent = new LlmAgent({
    name: 'solar_agent',
    model: createGemini(),
    instruction: `You are a solar energy industry expert. Provide information about solar energy news, ITC/PTC tax credits, renewable energy policies, solar panel technology, installation trends, and industry developments. Be knowledgeable about the US solar market.`,
  });

  const hrAgent = new LlmAgent({
    name: 'hr_agent',
    model: createGemini(),
    instruction: `You are an HR assistant for American Green Solutions. Help with leave policies (20 days annual, 10 sick days), onboarding processes, employee benefits, workplace safety guidelines for solar field workers, and general HR questions. Be helpful and professional.

HOLIDAY & COMP-OFF POLICY:
- Indian team employees who work on national/regional holidays (IND or All calendar) earn ₹500 bonus + 1 compensatory leave per holiday worked.
- US team (Jaswanthi, Rohan, Girish) observes US + All holidays — no comp-off benefits.
- Comp leaves are auto-credited when the employee clocks in on a holiday.
- For specific holiday dates or comp-off balances, direct users to the "Comp Off" tab in the portal or suggest they ask @nick for data lookups.`,
  });

  return new LlmAgent({
    name: 'root_agent',
    model: createGemini(),
    instruction: `You are the root orchestrator for the AGS multi-agent assistant. Today is ${today()}.

CURRENT USER: ${userContext.name} (${userContext.role})

Route user queries to the most appropriate sub-agent:
- Questions about employees, attendance, leaves, assets, schedules, lateness, database queries, birthdays → route to nick
- Questions about holidays, comp-off, compensatory leave, holiday bonuses, holiday calendar, perks of working on holidays, who worked on holidays, comp leave ranking, comp leave details for any employee → route to nick
- @solar or solar energy questions → route to solar_agent
- @hr or HR policy questions → route to hr_agent
- @nick or any message starting with @nick → ALWAYS route to nick, no exceptions

For general chat, greetings, or simple questions, respond directly yourself.
Keep your own responses concise and friendly.

CRITICAL ROUTING RULES:
1. If the message contains "@nick", you MUST route to nick — never respond yourself.
2. For ANY question about employee data, attendance, lateness, schedules, leaves, holidays, comp-offs, birthdays, or company data — ALWAYS route to nick.
3. When in doubt, route to nick rather than responding yourself.`,
    subAgents: [nick, solarAgent, hrAgent],
  });
}

// ══════════════════════════════════════════════════════════════════
// RUNNER — created per request (to inject user context)
// ══════════════════════════════════════════════════════════════════

function createRunner(userContext, directAgent) {
  if (!GEMINI_API_KEY) return null;
  if (directAgent === 'nick') {
    // Skip root agent — go directly to nick for reliability
    const nick = getNickAgent(userContext);
    return new InMemoryRunner({ agent: nick, appName: 'ags_assistant' });
  }
  const rootAgent = createRootAgent(userContext);
  return new InMemoryRunner({ agent: rootAgent, appName: 'ags_assistant' });
}

// ══════════════════════════════════════════════════════════════════
// ROUTE
// ══════════════════════════════════════════════════════════════════

router.post('/query', authenticate, async (req, res, next) => {
  try {
    const { query: userQuery } = req.body;
    if (!userQuery || typeof userQuery !== 'string') {
      return res.status(400).json({ error: 'query is required' });
    }

    const userContext = { id: req.user.sub, name: req.user.name || 'User', role: req.user.role || 'employee' };

    // Detect @agent mentions to route directly (bypass root agent for reliability)
    let directAgent = null;
    const lowerQ = userQuery.toLowerCase().trim();
    if (lowerQ.startsWith('@nick') || lowerQ.includes('@nick')) directAgent = 'nick';

    const r = createRunner(userContext, directAgent);
    if (!r) {
      return res.status(500).json({ error: 'AI assistant not configured. Set GEMINI_API_KEY.' });
    }

    const userId = req.user.sub;
    const session = await r.sessionService.createSession({ appName: 'ags_assistant', userId });

    let responseText = '';
    let respondingAgent = directAgent || 'root_agent';

    // Strip @agent prefix so the agent sees a clean question
    const cleanQuery = directAgent ? userQuery.replace(/@\w+\s*/i, '').trim() || userQuery : userQuery;

    const events = r.runAsync({
      userId,
      sessionId: session.id,
      newMessage: { role: 'user', parts: [{ text: cleanQuery }] },
    });

    for await (const event of events) {
      if (event.content?.parts) {
        const text = event.content.parts.map(p => p.text || '').join('');
        if (text && event.author !== 'user') {
          responseText = text; // take the last non-user response
          respondingAgent = event.author || respondingAgent;
        }
      }
    }

    // Map agent names to display info
    const agentMap = {
      nick: { id: 'db', name: 'Nick (DB Agent)' },
      solar_agent: { id: 'solar', name: 'Solar Agent' },
      hr_agent: { id: 'hr', name: 'HR Agent' },
      root_agent: { id: 'general', name: 'General Agent' },
    };

    const agentInfo = agentMap[respondingAgent] || { id: 'general', name: respondingAgent };

    // Extract display data for DB queries (cards in the UI)
    const displayData = respondingAgent === 'nick' ? extractDisplayData(userQuery) : null;

    res.json({
      text: responseText || "I'm here to help! Try asking about employees, news, stocks, or just say hi.",
      data: displayData,
      agent: agentInfo.id,
      agentName: agentInfo.name,
    });
  } catch (e) {
    console.error('Assistant error:', e);
    next(e);
  }
});

// Simple display data extractor for DB agent responses (for UI cards)
async function extractDisplayData(userQuery) {
  const q = userQuery.toLowerCase();
  try {
    if (/leave.*today|on leave|absent/i.test(q)) {
      const { rows } = await dbQuery(`SELECT u.name, c.name as client, lr.leave_type FROM leave_requests lr JOIN users u ON lr.employee_id = u.id LEFT JOIN clients c ON u.client_id = c.id WHERE lr.status = 'approved' AND $1 BETWEEN lr.start_date AND lr.end_date ORDER BY u.name`, [today()]);
      return rows.map(r => ({ name: r.name, detail: r.client || 'No client', extra: r.leave_type }));
    }
    const clientMatch = q.match(/(?:with|for|at|in)\s+(ameresco|cleanleaf|standard solar|puresky|triforce|maxsolar|metlen|tsr)/i);
    if (clientMatch && !/clock|log/i.test(q)) {
      const { rows } = await dbQuery(`SELECT u.name, u.designation, u.role, u.employee_no FROM users u JOIN clients c ON u.client_id = c.id WHERE LOWER(c.name) = LOWER($1) AND u.is_active = true AND u.deleted_at IS NULL ORDER BY u.name`, [clientMatch[1]]);
      return rows.map(r => ({ name: r.name, detail: r.designation || r.role, extra: r.employee_no ? `ID: ${r.employee_no}` : '' }));
    }
    if (/team lead/i.test(q)) {
      const { rows } = await dbQuery(`SELECT u.name, c.name as client, u.employee_no FROM users u LEFT JOIN clients c ON u.client_id = c.id WHERE u.role = 'team_lead' AND u.is_active = true AND u.deleted_at IS NULL ORDER BY u.name`);
      return rows.map(r => ({ name: r.name, detail: r.client || 'No client', extra: r.employee_no || '' }));
    }
    if (/manager/i.test(q)) {
      const { rows } = await dbQuery(`SELECT u.name, u.designation, u.employee_no FROM users u WHERE u.role = 'manager' AND u.is_active = true AND u.deleted_at IS NULL ORDER BY u.name`);
      return rows.map(r => ({ name: r.name, detail: r.designation || 'Manager', extra: r.employee_no || '' }));
    }
  } catch {}
  return null;
}

// List available agents
router.get('/agents', authenticate, (req, res) => {
  res.json({
    agents: [
      { id: 'db', name: 'Nick (DB Agent)', trigger: '@nick', description: 'Workforce & app database queries — employees, leaves, assets, schedules' },
      { id: 'solar', name: 'Solar Agent', trigger: '@solar', description: 'Solar industry news & updates' },
      { id: 'hr', name: 'HR Agent', trigger: '@hr', description: 'HR policies & procedures' },
      { id: 'general', name: 'General Agent', trigger: '', description: 'General conversation' },
    ],
  });
});

export default router;
