import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import { query } from '../lib/db.js';

const router = Router();

function toDateStr(d) {
  if (!d) return null;
  if (d instanceof Date) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return String(d).slice(0, 10);
}

// ---------- Auto-migrate: sequential approval + acknowledged columns ----------
let migrated = false;
const migrate = async () => {
  if (migrated) return;
  try {
    // Add acknowledged columns
    await query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS acknowledged_by UUID REFERENCES users(id)`);
    await query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMPTZ`);
    // Add session columns for half-day leave support
    await query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS start_session INTEGER NOT NULL DEFAULT 1`);
    await query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS end_session INTEGER NOT NULL DEFAULT 2`);
    // Add reason column for free-text leave reason
    await query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS reason TEXT`);
    // Add rejection notes columns
    await query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS rejection_notes TEXT`);
    await query(`ALTER TABLE leave_requests ADD COLUMN IF NOT EXISTS rejected_by_name VARCHAR(255)`);
    // Update CHECK constraint to allow new sequential statuses
    await query(`ALTER TABLE leave_requests DROP CONSTRAINT IF EXISTS leave_requests_status_check`);
    await query(`ALTER TABLE leave_requests ADD CONSTRAINT leave_requests_status_check CHECK (status IN ('pending_team_lead','pending_managers','pending_ceo','approved','rejected','pending_tl_and_managers'))`);
    // Migrate any existing parallel-status rows to sequential
    await query(`UPDATE leave_requests SET status = 'pending_team_lead' WHERE status = 'pending_tl_and_managers'`);
    // Backfill rejected_by_name for old rejections that have rejected_by but no name
    await query(`
      UPDATE leave_requests lr SET rejected_by_name = u.name
      FROM users u WHERE lr.rejected_by = u.id AND lr.rejected_by IS NOT NULL AND lr.rejected_by_name IS NULL
    `);
  } catch (e) {
    // Ignore errors if constraint/columns already exist
    if (e.code !== '42710' && e.code !== '42701') console.error('Leave migration warning:', e.message);
  }
  migrated = true;
};

// ---------- Schemas ----------
// Leave type constants
const LEAVE_TYPES = ['casual', 'sick', 'comp', 'loss_of_pay', 'work_from_home', 'national_holiday_comp_off', 'half_day'];
const CASUAL_LEAVE_TOTAL = 12; // 1 per month
const SICK_LEAVE_TOTAL = 4;
const TOTAL_PAID_LEAVES = CASUAL_LEAVE_TOTAL + SICK_LEAVE_TOTAL; // 16

const createSchema = z.object({
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  total_days: z.number().positive().max(365),
  leave_type: z.string().default('casual').transform((val) => {
    const v = (val || '').toLowerCase().trim();
    if (['casual', 'sick', 'comp', 'loss_of_pay', 'work_from_home', 'national_holiday_comp_off', 'half_day'].includes(v)) return v;
    if (v === 'unpaid' || v === 'lop') return 'loss_of_pay';
    if (v === 'wfh') return 'work_from_home';
    return 'casual'; // default to casual for any unrecognized value
  }),
  reason: z.string().max(500).optional(),
  start_session: z.coerce.number().int().min(1).max(2).default(1),
  end_session: z.coerce.number().int().min(1).max(2).default(2),
}).refine((d) => d.end_date >= d.start_date, { message: 'end_date must be >= start_date', path: ['end_date'] });

// ---------- Helpers ----------
const PENDING_STATUSES = ['pending_team_lead', 'pending_managers', 'pending_ceo'];

const approvalPayload = (req) => ({
  role: req.user.role,
  user_id: req.user.sub,
  user_name: req.user.name,
  at: new Date().toISOString(),
});

const BASE_SELECT = `
  SELECT lr.*, u.name AS employee_name, u.client_id, u.team_lead_id, c.name AS client_name,
         u.role AS employee_role, u.designation AS employee_designation,
         d.name AS department_name
  FROM leave_requests lr
  JOIN users u ON u.id = lr.employee_id
  LEFT JOIN clients c ON c.id = u.client_id
  LEFT JOIN departments d ON d.id = u.department_id
`;

// ---------- POST / (create) ----------
router.post('/', authenticate, requireRole('employee', 'team_lead', 'manager', 'admin'), async (req, res, next) => {
  try {
    await migrate();
    const body = createSchema.parse(req.body);
    const employeeId = req.user.sub;

    // Block overlapping leave requests (pending or approved) for the same employee
    const overlap = await query(
      `SELECT id FROM leave_requests
       WHERE employee_id = $1 AND status NOT IN ('rejected')
         AND start_date <= $3 AND end_date >= $2
       LIMIT 1`,
      [employeeId, body.start_date, body.end_date]
    );
    if (overlap.rowCount > 0) {
      return res.status(400).json({ error: 'You already have a leave request (pending or approved) that overlaps with these dates. Please cancel the existing one first or choose different dates.' });
    }

    // If requesting comp leave, validate available comp-offs
    if (body.leave_type === 'comp') {
      try {
        const year = new Date(body.start_date).getFullYear();
        
        // 1. Check for manual override in leave_balances
        const dbBal = await query(`SELECT compensatory_off FROM leave_balances WHERE user_id = $1 AND year = $2`, [employeeId, year]);
        
        let allocatedComp = 0;
        if (dbBal.rowCount > 0 && dbBal.rows[0].compensatory_off != null) {
          allocatedComp = parseFloat(dbBal.rows[0].compensatory_off);
        } else {
          // 2. Default to comp_offs table
          const todayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
          const compCheck = await query(
            `SELECT COUNT(*) AS available FROM comp_offs
             WHERE user_id = $1 AND status = 'earned' AND (expiry_date IS NULL OR expiry_date >= $2)`,
            [employeeId, todayIST]
          );
          allocatedComp = parseInt(compCheck.rows[0]?.available || '0', 10);
        }

        // 3. Subtract already used comp offs in that year
        const usedQuery = await query(`SELECT SUM(total_days) as used FROM leave_requests WHERE employee_id = $1 AND leave_type = 'comp' AND status = 'approved' AND EXTRACT(YEAR FROM start_date) = $2`, [employeeId, year]);
        const usedComp = parseFloat(usedQuery.rows[0]?.used || '0');
        
        const available = Math.round(Math.max(0, allocatedComp - usedComp) * 100) / 100;

        if (available < body.total_days) {
          return res.status(400).json({ error: `You only have ${available} comp leave${available !== 1 ? 's' : ''} available. Cannot request ${body.total_days} day${body.total_days > 1 ? 's' : ''}.` });
        }
      } catch (e) {
        console.error('Comp validation error:', e.message);
      }
    }

    // Check requester's role and team lead assignment
    const empResult = await query(`SELECT team_lead_id, role FROM users WHERE id = $1`, [employeeId]);
    const hasTeamLead = empResult.rows[0]?.team_lead_id != null;
    const requesterRole = empResult.rows[0]?.role;

    // Manager requests go directly to CEO (admin) — skip TL and co-managers
    // Team lead requests go directly to managers (they ARE team leads, skip TL stage)
    // Employees: TL first (if assigned), then managers
    let initialStatus;
    if (requesterRole === 'admin') {
      initialStatus = 'approved';
    } else if (requesterRole === 'manager') {
      initialStatus = 'pending_ceo';
    } else if (requesterRole === 'team_lead') {
      initialStatus = 'pending_managers';
    } else if (hasTeamLead) {
      initialStatus = 'pending_team_lead';
    } else {
      initialStatus = 'pending_managers';
    }

    const r = await query(
      `INSERT INTO leave_requests (employee_id, start_date, end_date, total_days, leave_type, status, start_session, end_session, reason)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, employee_id, start_date, end_date, total_days, leave_type, status, approval_chain, requested_at, start_session, end_session, reason`,
      [employeeId, body.start_date, body.end_date, body.total_days, body.leave_type, initialStatus, body.start_session, body.end_session, body.reason || null]
    );

    // Insert notification
    try {
      let typeStr = body.leave_type;
      if (body.total_days === 0.5) typeStr = 'half_day';
      else if (body.leave_type === 'comp') typeStr = 'comp_off';
      await query(
        `INSERT INTO notifications (user_id, type, title, message) VALUES ($1, $2, $3, $4)`,
        [employeeId, typeStr, 'Leave Request Submitted', `Your request for ${body.total_days} day(s) of ${typeStr.replace('_', ' ')} leave starting ${body.start_date} has been submitted.`]
      );
    } catch (err) {
      console.warn('Failed to insert notification:', err.message);
    }

    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.name === 'ZodError') return res.status(400).json({ error: e.errors.map(err => err.message).join(', ') });
    next(e);
  }
});

// ---------- GET / (list) ----------
router.get('/', authenticate, async (req, res, next) => {
  try {
    await migrate();
    const userId = req.user.sub;
    const role = req.user.role;

    let actionableQuery;
    let actionableParams;

    if (role === 'employee') {
      // Employee only sees own requests
      actionableQuery = `${BASE_SELECT} WHERE lr.employee_id = $1 ORDER BY lr.requested_at DESC`;
      actionableParams = [userId];
    } else if (role === 'team_lead') {
      // Own requests + pending_team_lead where they are the employee's team_lead
      actionableQuery = `${BASE_SELECT}
        WHERE lr.employee_id = $1
           OR (lr.status = 'pending_team_lead' AND u.team_lead_id = $1)
        ORDER BY lr.requested_at DESC`;
      actionableParams = [userId];
    } else if (role === 'manager') {
      // Own requests + pending_managers where they haven't already approved
      actionableQuery = `${BASE_SELECT}
        WHERE lr.employee_id = $1
           OR (lr.status = 'pending_managers'
               AND NOT EXISTS (
                 SELECT 1 FROM jsonb_array_elements(COALESCE(lr.approval_chain, '[]'::jsonb)) AS elem
                 WHERE elem->>'user_id' = $1::text
               ))
        ORDER BY lr.requested_at DESC`;
      actionableParams = [userId];
    } else {
      // admin (CEO): own requests + ALL leave requests (admin sees everything)
      actionableQuery = `${BASE_SELECT}
        ORDER BY lr.requested_at DESC`;
      actionableParams = [];
    }

    const actionableResult = await query(actionableQuery, actionableParams);

    // For roles above employee, also fetch ALL leave requests for dashboard display
    let allLeaveRequests = [];
    if (role === 'admin') {
      // Admin already gets everything in actionable query, just separate own vs others
      allLeaveRequests = actionableResult.rows.filter((r) => r.employee_id !== userId);
    } else if (role !== 'employee') {
      const allResult = await query(
        `${BASE_SELECT}
         ORDER BY lr.requested_at DESC`
      );
      allLeaveRequests = allResult.rows.filter((r) => r.employee_id !== userId);
    }

    res.json({
      leave_requests: actionableResult.rows,
      all_leave_requests: allLeaveRequests,
    });
  } catch (e) {
    next(e);
  }
});

// ---------- GET /balance-all — Leave balance for all employees (admin/manager/team_lead) ----------
// NOTE: Must be defined BEFORE /balance/:userId to avoid route conflict
router.get('/balance-all', authenticate, requireRole('admin', 'manager', 'team_lead'), async (req, res, next) => {
  try {
    const year = req.query.year ? parseInt(req.query.year, 10) : new Date().getFullYear();
    const month = req.query.month ? parseInt(req.query.month, 10) : null; // 1-12, null = full year
    const todayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

    // Ensure is_active column exists (auto-migration)
    try { await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT true`); } catch { /* ignore */ }

    const { rows: employees } = await query(
      `SELECT u.id, u.name, u.email, u.role, u.designation, u.department_id, d.name AS department_name
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
       WHERE u.deleted_at IS NULL AND (u.is_active = true OR u.is_active IS NULL)
       ORDER BY u.name`
    );

    // Build date filter: if month is specified, only count leaves in that month
    let dateFilterSQL = `WHERE lr.status = 'approved' AND EXTRACT(YEAR FROM lr.start_date) = $1`;
    const queryParams = [year];
    if (month) {
      // Include leaves that overlap with the target month
      const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
      const nextMonth = month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`;
      dateFilterSQL += ` AND lr.start_date < $2 AND lr.end_date >= $3`;
      queryParams.push(nextMonth, monthStart);
    }

    const { rows: allLeaves } = await query(
      `SELECT lr.employee_id, lr.start_date, lr.end_date, lr.total_days, lr.leave_type
       FROM leave_requests lr
       ${dateFilterSQL}
       ORDER BY lr.start_date`,
      queryParams
    );

    // When month filter is active, only count days within that month
    const monthStart = month ? `${year}-${String(month).padStart(2, '0')}-01` : null;
    const monthEnd = month ? (month === 12 ? `${year + 1}-01-01` : `${year}-${String(month + 1).padStart(2, '0')}-01`) : null;

    const leavesByEmployee = {};
    for (const lr of allLeaves) {
      if (!leavesByEmployee[lr.employee_id]) leavesByEmployee[lr.employee_id] = [];
      const sd = new Date(lr.start_date);
      const ed = new Date(lr.end_date || lr.start_date);

      // Compute total date span (all calendar days in leave range)
      let totalSpan = 0;
      const iterCur = new Date(sd);
      while (iterCur <= ed) {
        totalSpan++;
        iterCur.setDate(iterCur.getDate() + 1);
      }

      // Weight per day: total_days / span preserves fractional values (e.g. 0.5 half-days)
      const totalDays = lr.total_days != null ? parseFloat(lr.total_days) : totalSpan;
      const dayWeight = totalSpan > 0 ? totalDays / totalSpan : totalDays;

      // Expand dates, only pushing those within the month filter (if any)
      const cur = new Date(sd);
      while (cur <= ed) {
        const dateStr = toDateStr(cur);
        if (!month || (dateStr >= monthStart && dateStr < monthEnd)) {
          leavesByEmployee[lr.employee_id].push({
            date: dateStr,
            leave_type: lr.leave_type,
            isPast: dateStr <= todayIST,
            weight: dayWeight,
          });
        }
        cur.setDate(cur.getDate() + 1);
      }
    }

    let compByEmployee = {};
    try {
      const compResult = await query(
        `SELECT user_id, COUNT(*) AS count FROM comp_offs
         WHERE status = 'earned' AND expiry_date >= $1
           AND EXTRACT(YEAR FROM holiday_date) = $2
         GROUP BY user_id`,
        [todayIST, year]
      );
      for (const r of compResult.rows) {
        compByEmployee[r.user_id] = parseInt(r.count, 10);
      }
    } catch { /* comp_offs table may not exist */ }

    let currentMonthForAlloc = new Date().getMonth() + 1;
    if (year < new Date().getFullYear()) currentMonthForAlloc = 12;
    else if (year > new Date().getFullYear()) currentMonthForAlloc = 0;
    
    const clAllocated = month ? month : currentMonthForAlloc;
    const slAllocated = Math.min(4, Math.ceil(clAllocated / 3));

    // Fetch manual leave balances from leave_balances table
    const { rows: dbBalances } = await query(
      `SELECT user_id, casual_leave, sick_leave, compensatory_off, national_holiday_comp_off, loss_of_pay, casual_leave_used, sick_leave_used FROM leave_balances WHERE year = $1`,
      [year]
    );
    const dbBalMap = {};
    for (const b of dbBalances) {
      dbBalMap[b.user_id] = { 
        casual: b.casual_leave !== null ? parseFloat(b.casual_leave) : undefined,
        casual_used: b.casual_leave_used !== null ? parseFloat(b.casual_leave_used) : undefined,
        sick: b.sick_leave !== null ? parseFloat(b.sick_leave) : undefined,
        sick_used: b.sick_leave_used !== null ? parseFloat(b.sick_leave_used) : undefined,
        comp: b.compensatory_off !== null ? parseFloat(b.compensatory_off) : undefined,
        nhco: b.national_holiday_comp_off !== null ? parseFloat(b.national_holiday_comp_off) : 0,
        lop: b.loss_of_pay !== null ? parseFloat(b.loss_of_pay) : undefined
      };
    }

    const balances = employees.map(emp => {
      const dates = leavesByEmployee[emp.id] || [];
      
      // leave_balances stores REMAINING balance. allocated = remaining + used (derived).
      const empDbBal = dbBalMap[emp.id]; // undefined if no row
      const hasDatabaseBalance = !!empDbBal;

      const byType = { casual: { used: 0, planned: 0 }, sick: { used: 0, planned: 0 }, comp: { used: 0, planned: 0 }, nhco: { used: 0, planned: 0 }, loss_of_pay: { used: 0, planned: 0 } };

      for (const d of dates) {
        let lt = (d.leave_type || 'casual').toLowerCase();
        if (!LEAVE_TYPES.includes(lt)) {
          if (lt === 'sick') lt = 'sick';
          else if (lt === 'unpaid') lt = 'loss_of_pay';
          else if (lt === 'national_holiday_comp_off' || lt === 'nhco') lt = 'nhco';
          else if (lt === 'comp_off' || lt === 'comp') lt = 'comp';
          else lt = 'casual';
        }
        // Use fractional weight so 0.5-day leaves count correctly
        const w = d.weight != null ? d.weight : 1;
        if (d.isPast) {
          if (byType[lt]) byType[lt].used = Math.round((byType[lt].used + w) * 100) / 100;
        } else {
          if (byType[lt]) byType[lt].planned = Math.round((byType[lt].planned + w) * 100) / 100;
        }
      }

      const clUsed   = byType.casual.used + byType.casual.planned;
      const slUsed   = byType.sick.used + byType.sick.planned;
      const compUsed = byType.comp.used + byType.comp.planned;
      const nhcoUsed = byType.nhco.used + byType.nhco.planned;
      const lopUsed  = byType.loss_of_pay.used + byType.loss_of_pay.planned;

      // LOP manual override
      const lopFinal = hasDatabaseBalance && empDbBal.lop != null ? Math.max(parseFloat(empDbBal.lop), lopUsed) : lopUsed;

      // CL: Reconstruct Total Allocated from manual overrides (Left + Used), then subtract LIVE used leaves
      let clAllocatedFinal = clAllocated;
      let clUsedFinal = clUsed;
      if (hasDatabaseBalance && empDbBal.casual != null && empDbBal.casual_used != null) {
        clAllocatedFinal = Math.round((parseFloat(empDbBal.casual) + parseFloat(empDbBal.casual_used)) * 100) / 100;
        clUsedFinal = Math.max(clUsed, parseFloat(empDbBal.casual_used));
      } else if (hasDatabaseBalance && empDbBal.casual != null) {
        clAllocatedFinal = Math.round((parseFloat(empDbBal.casual) + clUsed) * 100) / 100;
      }
      const clRem = Math.round(Math.max(0, clAllocatedFinal - clUsedFinal) * 100) / 100;

      // SL: same logic
      let slAllocatedFinal = slAllocated;
      let slUsedFinal = slUsed;
      if (hasDatabaseBalance && empDbBal.sick != null && empDbBal.sick_used != null) {
        slAllocatedFinal = Math.round((parseFloat(empDbBal.sick) + parseFloat(empDbBal.sick_used)) * 100) / 100;
        slUsedFinal = Math.max(slUsed, parseFloat(empDbBal.sick_used));
      } else if (hasDatabaseBalance && empDbBal.sick != null) {
        slAllocatedFinal = Math.round((parseFloat(empDbBal.sick) + slUsed) * 100) / 100;
      }
      const slRem = Math.round(Math.max(0, slAllocatedFinal - slUsedFinal) * 100) / 100;

      const empCompAllocated = hasDatabaseBalance && empDbBal.comp != null
        ? parseFloat(empDbBal.comp)
        : (compByEmployee[emp.id] || 0);
      const compRem = Math.round(Math.max(0, empCompAllocated - compUsed) * 100) / 100;

      const empNhco = hasDatabaseBalance && empDbBal.nhco != null ? parseFloat(empDbBal.nhco) : 0;
      const nhcoRem = Math.round(Math.max(0, empNhco - nhcoUsed) * 100) / 100;

      return {
        employee_id: emp.id,
        employee_name: emp.name,
        email: emp.email,
        role: emp.role,
        designation: emp.designation,
        department_name: emp.department_name,
        casual: { total: CASUAL_LEAVE_TOTAL, allocated: clAllocatedFinal, used: clUsedFinal, planned: byType.casual.planned, remaining: clRem },
        sick: { total: SICK_LEAVE_TOTAL, allocated: slAllocatedFinal, used: slUsedFinal, planned: byType.sick.planned, remaining: slRem },
        comp: { available: empCompAllocated, used: compUsed, planned: byType.comp.planned, remaining: compRem },
        nhco: { available: empNhco, used: nhcoUsed, planned: byType.nhco.planned, remaining: nhcoRem },
        loss_of_pay: { used: lopFinal, planned: byType.loss_of_pay.planned },
        total_used: Math.round((clUsedFinal + slUsedFinal + compUsed + lopFinal + nhcoUsed) * 100) / 100,
        total_remaining: Math.round((clRem + slRem + compRem + nhcoRem) * 100) / 100,
      };
    });

    res.json({ year, month: month || null, balances });
  } catch (e) {
    next(e);
  }
});

// ---------- PUT /balance/:userId — Manually set leave balances ----------
router.put('/balance/:userId', authenticate, async (req, res, next) => {
  try {
    await migrate();
    const targetUserId = req.params.userId;
    const year = req.body.year || new Date().getFullYear();

    const actorResult = await query(`SELECT d.name AS department_name FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = $1`, [req.user.sub]);
    const isHRorFinance = ['HR', 'Human Resources', 'Finance'].includes(actorResult.rows[0]?.department_name);

    if (req.user.role !== 'admin' && req.user.role !== 'manager' && !isHRorFinance) {
      return res.status(403).json({ error: 'Only HR, Finance or Admins can adjust leave balances' });
    }

    const { casual, casual_used, sick, sick_used, comp, nhco, lop } = req.body;

    const existing = await query(`SELECT id FROM leave_balances WHERE user_id = $1 AND year = $2`, [targetUserId, year]);
    if (existing.rowCount > 0) {
      await query(
        `UPDATE leave_balances SET casual_leave = $1, sick_leave = $2, compensatory_off = $3, national_holiday_comp_off = $4, loss_of_pay = $5, casual_leave_used = $6, sick_leave_used = $7 WHERE user_id = $8 AND year = $9`,
        [casual, sick, comp, nhco, lop, casual_used, sick_used, targetUserId, year]
      );
    } else {
      await query(
        `INSERT INTO leave_balances (user_id, year, casual_leave, sick_leave, compensatory_off, national_holiday_comp_off, loss_of_pay, casual_leave_used, sick_leave_used) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [targetUserId, year, casual, sick, comp, nhco, lop, casual_used, sick_used]
      );
    }

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ---------- GET /balance/:userId — Leave balance breakdown by type ----------
router.get('/balance/:userId', authenticate, async (req, res, next) => {
  try {
    const targetUserId = req.params.userId;
    const year = req.query.year ? parseInt(req.query.year, 10) : new Date().getFullYear();
    const todayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

    // Get all approved leave requests for this employee in the given year
    const { rows: leaves } = await query(
      `SELECT id, start_date, end_date, total_days, leave_type
       FROM leave_requests
       WHERE employee_id = $1 AND status = 'approved'
         AND EXTRACT(YEAR FROM start_date) = $2
       ORDER BY start_date`,
      [targetUserId, year]
    );

    // Expand each leave into individual dates, tracking leave_type
    const allLeaveDates = [];
    for (const lr of leaves) {
      // Normalize old leave types to new system
      let leaveType = (lr.leave_type || 'casual').toLowerCase();
      if (!LEAVE_TYPES.includes(leaveType)) {
        // Map old types: annual/personal/emergency/other → casual, sick stays sick, unpaid → loss_of_pay
        if (leaveType === 'sick') leaveType = 'sick';
        else if (leaveType === 'unpaid') leaveType = 'loss_of_pay';
        else leaveType = 'casual';
      }

      const sd = new Date(lr.start_date);
      const ed = new Date(lr.end_date || lr.start_date);
      const current = new Date(sd);
      while (current <= ed) {
        const dateStr = toDateStr(current);
        allLeaveDates.push({ date: dateStr, leave_id: lr.id, leave_type: leaveType, isPast: dateStr <= todayIST });
        current.setDate(current.getDate() + 1);
      }
    }

    // For past leave dates, check if the employee actually clocked in (override = they worked)
    const pastDates = allLeaveDates.filter(d => d.isPast).map(d => d.date);
    let clockedInDates = new Set();
    if (pastDates.length > 0) {
      const { rows } = await query(
        `SELECT DISTINCT shift_date::text FROM clock_events
         WHERE user_id = $1 AND event_type IN ('clock_in', 'in') AND shift_date = ANY($2::date[])`,
        [targetUserId, pastDates]
      );
      clockedInDates = new Set(rows.map(r => r.shift_date.slice(0, 10)));
    }

    // Calculate per-type breakdown
    const byType = { casual: { used: 0, planned: 0 }, sick: { used: 0, planned: 0 }, comp: { used: 0, planned: 0 }, nhco: { used: 0, planned: 0 }, loss_of_pay: { used: 0, planned: 0 } };
    let daysActuallyUsed = 0;
    let daysPlanned = 0;
    let daysOverridden = 0;
    for (const d of allLeaveDates) {
      const type = byType[d.leave_type] ? d.leave_type : 'casual';
      if (d.isPast) {
        if (clockedInDates.has(d.date)) {
          daysOverridden++;
        } else {
          daysActuallyUsed++;
          byType[type].used++;
        }
      } else {
        daysPlanned++;
        byType[type].planned++;
      }
    }

    // Get available comp-off leaves from comp_offs table as fallback
    let compFallback = 0;
    try {
      const compResult = await query(
        `SELECT COUNT(*) AS count FROM comp_offs
         WHERE user_id = $1 AND status = 'earned' AND (expiry_date IS NULL OR expiry_date >= $2)
           AND EXTRACT(YEAR FROM holiday_date) = $3`,
        [targetUserId, todayIST, year]
      );
      compFallback = parseInt(compResult.rows[0]?.count || '0', 10);
    } catch { /* comp_offs table may not exist */ }

    // Fetch manual leave balances from leave_balances table
    let empClAllocated = CASUAL_LEAVE_TOTAL; // default if no dynamic and no db
    let empSlAllocated = SICK_LEAVE_TOTAL;
    let empCompAllocated = compFallback;
    let empNhcoAllocated = 0;
    
    // Attempt dynamic month calculation first as baseline
    let currentMonthForAlloc = new Date().getMonth() + 1;
    if (year < new Date().getFullYear()) currentMonthForAlloc = 12;
    else if (year > new Date().getFullYear()) currentMonthForAlloc = 0;
    empClAllocated = currentMonthForAlloc;
    empSlAllocated = Math.min(4, Math.ceil(empClAllocated / 3));

    try {
      const { rows } = await query(
        `SELECT casual_leave, sick_leave, compensatory_off, national_holiday_comp_off FROM leave_balances WHERE user_id = $1 AND year = $2`,
        [targetUserId, year]
      );
      if (rows.length > 0) {
        if (rows[0].casual_leave !== null) empClAllocated = parseFloat(rows[0].casual_leave);
        if (rows[0].sick_leave !== null) empSlAllocated = parseFloat(rows[0].sick_leave);
        if (rows[0].compensatory_off !== null) empCompAllocated = parseFloat(rows[0].compensatory_off);
        if (rows[0].national_holiday_comp_off !== null) empNhcoAllocated = parseFloat(rows[0].national_holiday_comp_off);
      }
    } catch { /* ignore if table doesn't exist */ }

    res.json({
      employee_id: targetUserId,
      year,
      // Per-type totals and usage
      casual: { total: CASUAL_LEAVE_TOTAL, used: byType.casual.used, planned: byType.casual.planned, remaining: Math.max(0, empClAllocated - byType.casual.used) },
      sick: { total: SICK_LEAVE_TOTAL, used: byType.sick.used, planned: byType.sick.planned, remaining: Math.max(0, empSlAllocated - byType.sick.used) },
      comp: { available: empCompAllocated, used: byType.comp.used, planned: byType.comp.planned },
      nhco: { available: empNhcoAllocated, used: byType.nhco.used, planned: byType.nhco.planned },
      loss_of_pay: { used: byType.loss_of_pay.used, planned: byType.loss_of_pay.planned },
      // Aggregate totals (backwards compatible)
      annual_total: TOTAL_PAID_LEAVES,
      days_actually_used: daysActuallyUsed,
      days_planned: daysPlanned,
      days_overridden: daysOverridden,
      remaining: Math.max(0, TOTAL_PAID_LEAVES - (byType.casual.used + byType.sick.used)),
      clocked_in_on_leave_dates: Array.from(clockedInDates),
    });
  } catch (e) {
    next(e);
  }
});

// ---------- Helper: mark comp_offs as used when comp leave is approved ----------
async function markCompOffsUsed(employeeId, totalDays, usedDate) {
  try {
    const todayIST = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    // Find available (earned, not expired) comp_offs for this employee, oldest first
    const { rows } = await query(
      `SELECT id FROM comp_offs
       WHERE user_id = $1 AND status = 'earned' AND (expiry_date IS NULL OR expiry_date >= $2)
       ORDER BY holiday_date ASC
       LIMIT $3`,
      [employeeId, todayIST, Math.ceil(totalDays)]
    );
    for (const row of rows) {
      await query(
        `UPDATE comp_offs SET status = 'used', used_date = $1 WHERE id = $2`,
        [usedDate || todayIST, row.id]
      );
    }
  } catch (e) {
    console.warn('markCompOffsUsed warning:', e.message);
  }
}

// ---------- PATCH /:id/approve ----------
router.patch('/:id/approve', authenticate, requireRole('team_lead', 'manager', 'admin'), async (req, res, next) => {
  try {
    await migrate();
    const id = req.params.id;
    const role = req.user.role;
    const userId = req.user.sub;

    // Fetch the leave request with employee info
    const lrResult = await query(
      `SELECT lr.*, u.team_lead_id
       FROM leave_requests lr
       JOIN users u ON u.id = lr.employee_id
       WHERE lr.id = $1`,
      [id]
    );
    if (lrResult.rowCount === 0) return res.status(404).json({ error: 'Leave request not found' });

    const lr = lrResult.rows[0];
    const existingChain = Array.isArray(lr.approval_chain) ? lr.approval_chain : [];

    // ---- Admin override approval (can approve at any pending stage) ----
    if (role === 'admin') {
      if (!PENDING_STATUSES.includes(lr.status)) {
        return res.status(400).json({ error: 'Request is not in a pending status' });
      }
      const newEntry = approvalPayload(req);
      const updatedChain = [...existingChain, newEntry];
      await query(
        `UPDATE leave_requests SET status = 'approved', approval_chain = $1::jsonb, updated_at = now()
         WHERE id = $2`,
        [JSON.stringify(updatedChain), id]
      );
      // If comp leave, mark comp_offs as used
      if ((lr.leave_type || '').toLowerCase() === 'comp') {
        await markCompOffsUsed(lr.employee_id, lr.total_days || 1, toDateStr(lr.start_date));
      }
      return res.json({ ok: true, status: 'approved' });
    }

    // ---- Team lead approval ----
    if (role === 'team_lead') {
      if (lr.status !== 'pending_team_lead') {
        return res.status(400).json({ error: 'Request is not at team lead approval stage' });
      }
      if (lr.team_lead_id !== userId) {
        return res.status(403).json({ error: "You are not this employee's team lead" });
      }
      // Check if already approved
      if (existingChain.some((entry) => entry.user_id === userId)) {
        return res.status(400).json({ error: 'You have already approved this request' });
      }

      const newEntry = approvalPayload(req);
      const updatedChain = [...existingChain, newEntry];

      // After TL approval -> move to pending_managers
      await query(
        `UPDATE leave_requests SET status = 'pending_managers', approval_chain = $1::jsonb, updated_at = now()
         WHERE id = $2`,
        [JSON.stringify(updatedChain), id]
      );
      return res.json({ ok: true, status: 'pending_managers' });
    }

    // ---- Manager approval ----
    if (role === 'manager') {
      if (lr.status !== 'pending_managers') {
        return res.status(400).json({ error: 'Request is not at manager approval stage' });
      }
      // Check if already approved
      if (existingChain.some((entry) => entry.user_id === userId)) {
        return res.status(400).json({ error: 'You have already approved this request' });
      }

      const newEntry = approvalPayload(req);
      const updatedChain = [...existingChain, newEntry];

      // Any ONE manager approval is sufficient — auto-approve
      await query(
        `UPDATE leave_requests SET status = 'approved', approval_chain = $1::jsonb, updated_at = now()
         WHERE id = $2`,
        [JSON.stringify(updatedChain), id]
      );
      // If comp leave, mark comp_offs as used
      if ((lr.leave_type || '').toLowerCase() === 'comp') {
        await markCompOffsUsed(lr.employee_id, lr.total_days || 1, toDateStr(lr.start_date));
      }
      return res.json({ ok: true, status: 'approved' });
    }

    return res.status(403).json({ error: 'Unauthorized' });
  } catch (e) {
    next(e);
  }
});

// ---------- PATCH /:id/reject ----------
router.patch('/:id/reject', authenticate, requireRole('team_lead', 'manager', 'admin'), async (req, res, next) => {
  try {
    await migrate();
    const id = req.params.id;
    const role = req.user.role;
    const userId = req.user.sub;

    // Fetch the leave request with employee info
    const lrResult = await query(
      `SELECT lr.*, u.team_lead_id
       FROM leave_requests lr
       JOIN users u ON u.id = lr.employee_id
       WHERE lr.id = $1`,
      [id]
    );
    if (lrResult.rowCount === 0) return res.status(404).json({ error: 'Leave request not found' });

    const lr = lrResult.rows[0];

    // Must be in a pending status
    if (!PENDING_STATUSES.includes(lr.status)) {
      return res.status(400).json({ error: 'Leave request is not in a pending status' });
    }

    // Team lead can only reject at pending_team_lead stage and must be assigned TL
    if (role === 'team_lead') {
      if (lr.status !== 'pending_team_lead') {
        return res.status(400).json({ error: 'Request is not at team lead stage' });
      }
      if (lr.team_lead_id !== userId) {
        return res.status(403).json({ error: "You are not this employee's team lead" });
      }
    }

    // Manager can only reject at pending_managers stage
    if (role === 'manager') {
      if (lr.status !== 'pending_managers') {
        return res.status(400).json({ error: 'Request is not at manager approval stage' });
      }
    }

    // Admin can reject at any pending stage (override)
    // (no additional check needed — the PENDING_STATUSES check above is sufficient)

    const notes = req.body?.notes || null;
    const rejectedByName = req.user.name || null;

    const r = await query(
      `UPDATE leave_requests SET status = 'rejected', rejected_by = $1, rejected_at = now(), updated_at = now(),
       rejection_notes = $3, rejected_by_name = $4
       WHERE id = $2 RETURNING id`,
      [userId, id, notes, rejectedByName]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Leave request not found' });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ---------- PATCH /:id/acknowledge (admin only) ----------
router.patch('/:id/acknowledge', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    await migrate();
    const id = req.params.id;
    const userId = req.user.sub;

    // Fetch the leave request
    const lrResult = await query(`SELECT * FROM leave_requests WHERE id = $1`, [id]);
    if (lrResult.rowCount === 0) return res.status(404).json({ error: 'Leave request not found' });

    const lr = lrResult.rows[0];
    if (lr.status !== 'approved') {
      return res.status(400).json({ error: 'Only approved leave requests can be acknowledged' });
    }

    await query(
      `UPDATE leave_requests SET acknowledged_by = $1, acknowledged_at = now(), updated_at = now()
       WHERE id = $2`,
      [userId, id]
    );

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ---------- DELETE /:id (cancel/withdraw — employee cancels own pending request) ----------
router.delete('/:id', authenticate, async (req, res, next) => {
  try {
    await migrate();
    const id = req.params.id;
    const userId = req.user.sub;

    const lrResult = await query(`SELECT * FROM leave_requests WHERE id = $1`, [id]);
    if (lrResult.rowCount === 0) return res.status(404).json({ error: 'Leave request not found' });

    const lr = lrResult.rows[0];

    const actorResult = await query(`SELECT d.name AS department_name FROM users u LEFT JOIN departments d ON d.id = u.department_id WHERE u.id = $1`, [userId]);
    const isHRorFinance = ['HR', 'Human Resources', 'Finance'].includes(actorResult.rows[0]?.department_name);
    const canWithdrawApproved = req.user.role === 'admin' || req.user.role === 'manager' || isHRorFinance;

    // Only the employee who created it can cancel, or an admin/HR/Finance
    if (lr.employee_id !== userId && !canWithdrawApproved) {
      return res.status(403).json({ error: 'You can only cancel your own leave requests' });
    }

    // Can only cancel pending requests (not already approved/rejected) unless Admin/HR/Finance/Manager
    if (!PENDING_STATUSES.includes(lr.status)) {
      if (lr.status === 'approved' && canWithdrawApproved) {
        // Allow withdrawal of approved leave
        // If it was a comp off, we must revert it!
        if ((lr.leave_type || '').toLowerCase() === 'comp') {
          try {
            await query(
              `UPDATE comp_offs SET status = 'earned', used_date = NULL
               WHERE user_id = $1 AND status = 'used' AND used_date = $2
               AND id IN (
                 SELECT id FROM comp_offs
                 WHERE user_id = $1 AND status = 'used' AND used_date = $2
                 LIMIT $3
               )`,
              [lr.employee_id, lr.start_date ? String(lr.start_date).slice(0, 10) : null, Math.ceil(lr.total_days || 1)]
            );
          } catch (e) {
            console.warn('Revert comp_offs warning:', e.message);
          }
        }
      } else {
        return res.status(400).json({ error: 'Only pending leave requests can be cancelled' });
      }
    }

    await query(`DELETE FROM leave_requests WHERE id = $1`, [id]);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ---------- PATCH /:id/edit (edit dates — employee edits own pending request) ----------
router.patch('/:id/edit', authenticate, async (req, res, next) => {
  try {
    await migrate();
    const id = req.params.id;
    const userId = req.user.sub;

    const lrResult = await query(`SELECT * FROM leave_requests WHERE id = $1`, [id]);
    if (lrResult.rowCount === 0) return res.status(404).json({ error: 'Leave request not found' });

    const lr = lrResult.rows[0];

    if (lr.employee_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'You can only edit your own leave requests' });
    }

    if (!PENDING_STATUSES.includes(lr.status)) {
      return res.status(400).json({ error: 'Only pending leave requests can be edited' });
    }

    const { start_date, end_date, total_days, leave_type, reason, start_session, end_session } = req.body;

    // Update only provided fields
    const updates = [];
    const params = [];
    let paramIdx = 1;

    if (start_date) { updates.push(`start_date = $${paramIdx++}`); params.push(start_date); }
    if (end_date) { updates.push(`end_date = $${paramIdx++}`); params.push(end_date); }
    if (total_days != null) { updates.push(`total_days = $${paramIdx++}`); params.push(total_days); }
    if (leave_type) {
      const lt = (leave_type || '').toLowerCase().trim();
      const validType = ['casual', 'sick', 'comp', 'loss_of_pay'].includes(lt) ? lt : (lt === 'unpaid' || lt === 'lop' ? 'loss_of_pay' : 'casual');
      updates.push(`leave_type = $${paramIdx++}`); params.push(validType);
    }
    if (reason !== undefined) { updates.push(`reason = $${paramIdx++}`); params.push(reason || null); }
    if (start_session != null) { updates.push(`start_session = $${paramIdx++}`); params.push(start_session); }
    if (end_session != null) { updates.push(`end_session = $${paramIdx++}`); params.push(end_session); }

    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });

    // Reset approval chain when editing (request goes back to beginning of pipeline)
    updates.push(`approval_chain = '[]'::jsonb`);
    updates.push(`updated_at = now()`);

    // Re-determine initial status based on employee's team lead assignment
    const empResult = await query(`SELECT team_lead_id, role FROM users WHERE id = $1`, [lr.employee_id]);
    const hasTeamLead = empResult.rows[0]?.team_lead_id != null;
    const requesterRole = empResult.rows[0]?.role;
    let newStatus;
    if (requesterRole === 'manager') newStatus = 'pending_ceo';
    else if (requesterRole === 'team_lead') newStatus = 'pending_managers';
    else if (hasTeamLead) newStatus = 'pending_team_lead';
    else newStatus = 'pending_managers';
    updates.push(`status = $${paramIdx++}`);
    params.push(newStatus);

    params.push(id);
    const r = await query(
      `UPDATE leave_requests SET ${updates.join(', ')} WHERE id = $${paramIdx} RETURNING *`,
      params
    );

    res.json(r.rows[0]);
  } catch (e) {
    next(e);
  }
});

// ---------- POST /:id/split (split request — exclude dates, creating multiple requests) ----------
router.post('/:id/split', authenticate, async (req, res, next) => {
  try {
    await migrate();
    const id = req.params.id;
    const userId = req.user.sub;

    const lrResult = await query(`SELECT * FROM leave_requests WHERE id = $1`, [id]);
    if (lrResult.rowCount === 0) return res.status(404).json({ error: 'Leave request not found' });

    const lr = lrResult.rows[0];

    if (lr.employee_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'You can only edit your own leave requests' });
    }

    if (!PENDING_STATUSES.includes(lr.status)) {
      return res.status(400).json({ error: 'Only pending leave requests can be split' });
    }

    // exclude_dates: array of YYYY-MM-DD strings to remove from the range
    const { exclude_dates } = req.body;
    if (!Array.isArray(exclude_dates) || exclude_dates.length === 0) {
      return res.status(400).json({ error: 'exclude_dates must be a non-empty array of dates' });
    }

    const excludeSet = new Set(exclude_dates);

    // Expand original range into individual dates
    const sd = new Date(toDateStr(lr.start_date) + 'T00:00:00');
    const ed = new Date(toDateStr(lr.end_date) + 'T00:00:00');
    const allDates = [];
    for (let d = new Date(sd); d <= ed; d.setDate(d.getDate() + 1)) {
      const ds = toDateStr(d);
      if (!excludeSet.has(ds)) allDates.push(ds);
    }

    if (allDates.length === 0) {
      // All dates excluded — just delete the request
      await query(`DELETE FROM leave_requests WHERE id = $1`, [id]);
      return res.json({ ok: true, requests: [], message: 'All dates excluded — request cancelled' });
    }

    // Group consecutive dates into ranges
    const ranges = [];
    let rangeStart = allDates[0];
    let prev = allDates[0];
    for (let i = 1; i < allDates.length; i++) {
      const prevD = new Date(prev + 'T00:00:00');
      const currD = new Date(allDates[i] + 'T00:00:00');
      const diff = (currD - prevD) / 86400000;
      if (diff > 1) {
        ranges.push({ start: rangeStart, end: prev });
        rangeStart = allDates[i];
      }
      prev = allDates[i];
    }
    ranges.push({ start: rangeStart, end: prev });

    // Determine initial status
    const empResult = await query(`SELECT team_lead_id, role FROM users WHERE id = $1`, [lr.employee_id]);
    const hasTeamLead = empResult.rows[0]?.team_lead_id != null;
    const requesterRole = empResult.rows[0]?.role;
    let initialStatus;
    if (requesterRole === 'manager') initialStatus = 'pending_ceo';
    else if (requesterRole === 'team_lead') initialStatus = 'pending_managers';
    else if (hasTeamLead) initialStatus = 'pending_team_lead';
    else initialStatus = 'pending_managers';

    // Update the first range in-place (keep original ID)
    const firstRange = ranges[0];
    const firstDays = Math.round((new Date(firstRange.end + 'T00:00:00') - new Date(firstRange.start + 'T00:00:00')) / 86400000) + 1;
    // Adjust sessions: first range keeps original start_session; if it's the only range, keeps end_session too
    const firstStartSession = lr.start_session || 1;
    const firstEndSession = ranges.length === 1 ? (lr.end_session || 2) : 2;
    let firstTotalDays = firstDays;
    if (firstDays === 1) {
      firstTotalDays = firstStartSession === firstEndSession ? 0.5 : 1;
    } else {
      firstTotalDays = firstDays - (firstStartSession === 2 ? 0.5 : 0) - (firstEndSession === 1 ? 0.5 : 0);
    }

    await query(
      `UPDATE leave_requests SET start_date = $1, end_date = $2, total_days = $3, start_session = $4, end_session = $5,
       status = $6, approval_chain = '[]'::jsonb, updated_at = now()
       WHERE id = $7`,
      [firstRange.start, firstRange.end, firstTotalDays, firstStartSession, firstEndSession, initialStatus, id]
    );

    const createdIds = [id];

    // Create new requests for remaining ranges
    for (let i = 1; i < ranges.length; i++) {
      const range = ranges[i];
      const days = Math.round((new Date(range.end + 'T00:00:00') - new Date(range.start + 'T00:00:00')) / 86400000) + 1;
      const startSess = 1;
      const endSess = i === ranges.length - 1 ? (lr.end_session || 2) : 2;
      let totalDays = days;
      if (days === 1) {
        totalDays = startSess === endSess ? 0.5 : 1;
      } else {
        totalDays = days - (startSess === 2 ? 0.5 : 0) - (endSess === 1 ? 0.5 : 0);
      }

      const r = await query(
        `INSERT INTO leave_requests (employee_id, start_date, end_date, total_days, leave_type, reason, status, start_session, end_session)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [lr.employee_id, range.start, range.end, totalDays, lr.leave_type, lr.reason, initialStatus, startSess, endSess]
      );
      createdIds.push(r.rows[0].id);
    }

    res.json({ ok: true, request_ids: createdIds, ranges });
  } catch (e) {
    next(e);
  }
});

export default router;
