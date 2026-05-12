import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import { query } from '../lib/db.js';

const router = Router();

// Auto-create junction tables for many-to-many relationships
(async () => {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS user_department_assignments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id),
        department_id UUID NOT NULL REFERENCES departments(id),
        created_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE(user_id, department_id)
      )
    `);
  } catch (e) {
    if (e.code !== '42P07') console.warn('user_department_assignments table creation skipped:', e.message);
  }
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS user_manager_assignments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id),
        manager_id UUID NOT NULL REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE(user_id, manager_id)
      )
    `);
  } catch (e) {
    if (e.code !== '42P07') console.warn('user_manager_assignments table creation skipped:', e.message);
  }
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS user_team_lead_assignments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id),
        team_lead_id UUID NOT NULL REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT now(),
        UNIQUE(user_id, team_lead_id)
      )
    `);
  } catch (e) {
    if (e.code !== '42P07') console.warn('user_team_lead_assignments table creation skipped:', e.message);
  }

  // Add employee_id (employer-assigned varchar ID) column
  try {
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS employee_id VARCHAR(100)`);
  } catch (e) {
    console.warn('employee_id column migration skipped:', e.message);
  }

  // Add employment_type column (intern, full_time, part_time, contract)
  try {
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS employment_type VARCHAR(50) DEFAULT 'full_time'`);
  } catch (e) {
    console.warn('employment_type column migration skipped:', e.message);
  }

  // Add work_timezone and work_hours columns
  try {
    await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS work_timezone VARCHAR(50) DEFAULT 'Asia/Kolkata', ADD COLUMN IF NOT EXISTS work_hours VARCHAR(50), ADD COLUMN IF NOT EXISTS work_location_default VARCHAR(50) DEFAULT 'wfo'`);
  } catch (e) {
    console.warn('work_timezone column migration skipped:', e.message);
  }
})();

// Helper: sync junction tables for a user given arrays of IDs
async function syncMultiAssignments(userId, { department_ids, client_ids, manager_ids, team_lead_ids }) {
  if (Array.isArray(department_ids)) {
    await query(`DELETE FROM user_department_assignments WHERE user_id = $1`, [userId]);
    for (const deptId of department_ids) {
      await query(
        `INSERT INTO user_department_assignments (user_id, department_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [userId, deptId]
      );
    }
  }
  if (Array.isArray(client_ids)) {
    try {
      await query(`DELETE FROM user_client_assignments WHERE user_id = $1`, [userId]);
      for (const clientId of client_ids) {
        await query(
          `INSERT INTO user_client_assignments (user_id, client_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
          [userId, clientId]
        );
      }
    } catch (e) {
      if (e.code !== '42P01') throw e; // table doesn't exist yet, skip
    }
  }
  if (Array.isArray(manager_ids)) {
    await query(`DELETE FROM user_manager_assignments WHERE user_id = $1`, [userId]);
    for (const mgrId of manager_ids) {
      await query(
        `INSERT INTO user_manager_assignments (user_id, manager_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [userId, mgrId]
      );
    }
  }
  if (Array.isArray(team_lead_ids)) {
    await query(`DELETE FROM user_team_lead_assignments WHERE user_id = $1`, [userId]);
    for (const tlId of team_lead_ids) {
      await query(
        `INSERT INTO user_team_lead_assignments (user_id, team_lead_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [userId, tlId]
      );
    }
  }
}

// Helper: fetch multi-assignment arrays for a list of user IDs
async function fetchMultiAssignmentsForUsers(userIds) {
  if (!userIds || userIds.length === 0) return {};

  const placeholders = userIds.map((_, i) => `$${i + 1}`).join(', ');
  const result = {};

  // Department assignments
  try {
    const depts = await query(
      `SELECT user_id, department_id FROM user_department_assignments WHERE user_id IN (${placeholders})`,
      userIds
    );
    for (const row of depts.rows) {
      if (!result[row.user_id]) result[row.user_id] = { department_ids: [], client_ids: [], manager_ids: [], team_lead_ids: [] };
      result[row.user_id].department_ids.push(row.department_id);
    }
  } catch (e) {
    if (e.code !== '42P01') throw e;
  }

  // Client assignments
  try {
    const clients = await query(
      `SELECT user_id, client_id FROM user_client_assignments WHERE user_id IN (${placeholders})`,
      userIds
    );
    for (const row of clients.rows) {
      if (!result[row.user_id]) result[row.user_id] = { department_ids: [], client_ids: [], manager_ids: [], team_lead_ids: [] };
      result[row.user_id].client_ids.push(row.client_id);
    }
  } catch (e) {
    if (e.code !== '42P01') throw e;
  }

  // Manager assignments
  try {
    const mgrs = await query(
      `SELECT user_id, manager_id FROM user_manager_assignments WHERE user_id IN (${placeholders})`,
      userIds
    );
    for (const row of mgrs.rows) {
      if (!result[row.user_id]) result[row.user_id] = { department_ids: [], client_ids: [], manager_ids: [], team_lead_ids: [] };
      result[row.user_id].manager_ids.push(row.manager_id);
    }
  } catch (e) {
    if (e.code !== '42P01') throw e;
  }

  // Team lead assignments
  try {
    const tls = await query(
      `SELECT user_id, team_lead_id FROM user_team_lead_assignments WHERE user_id IN (${placeholders})`,
      userIds
    );
    for (const row of tls.rows) {
      if (!result[row.user_id]) result[row.user_id] = { department_ids: [], client_ids: [], manager_ids: [], team_lead_ids: [] };
      result[row.user_id].team_lead_ids.push(row.team_lead_id);
    }
  } catch (e) {
    if (e.code !== '42P01') throw e;
  }

  return result;
}

const USER_COLUMNS_BASE = 'id, email, name, role, client_id, manager_id, team_lead_id, created_at';
const EXTRA_COLUMNS = ', employee_no, date_of_birth, phone, designation, employee_id';
const TYPE_COLUMNS = ', employment_type';
const DEPT_COLUMNS = ', department_id, work_timezone, work_hours, work_location_default';
let _userColumnsCache = null;

async function getUserColumns() {
  if (_userColumnsCache) return _userColumnsCache;
  let cols = USER_COLUMNS_BASE;
  try {
    await query(`SELECT id, employee_no, date_of_birth, phone, designation FROM users LIMIT 1`);
    cols = USER_COLUMNS_BASE + EXTRA_COLUMNS;
  } catch (e) {
    if (e.code === '42703') {
      try {
        await query(`SELECT employee_no FROM users LIMIT 1`);
        cols = USER_COLUMNS_BASE + ', employee_no';
      } catch (e2) {
        if (e2.code === '42703') { /* keep base */ } else throw e2;
      }
    } else throw e;
  }
  // Check for employment_type column
  try {
    await query(`SELECT employment_type FROM users LIMIT 1`);
    cols = cols + TYPE_COLUMNS;
  } catch (e) {
    if (e.code !== '42703') throw e;
  }
  // Check for department columns
  try {
    await query(`SELECT department_id, work_timezone, work_hours FROM users LIMIT 1`);
    cols = cols + DEPT_COLUMNS;
  } catch (e) {
    if (e.code !== '42703') throw e;
  }
  _userColumnsCache = cols;
  return cols;
}

router.get('/me', authenticate, async (req, res, next) => {
  try {
    const cols = await getUserColumns();
    const prefixedCols = cols.split(',').map((c) => `u.${c.trim()}`).join(', ');
    const r = await query(
      `SELECT ${prefixedCols}, d.name AS department_name FROM users u LEFT JOIN departments d ON u.department_id = d.id WHERE u.id = $1 AND u.deleted_at IS NULL AND u.is_active = true`,
      [req.user.sub]
    );
    const user = r.rows[0];
    if (!user) return res.status(401).json({ error: 'User not found or inactive' });
    // Attach multi-assignment arrays
    try {
      const multiMap = await fetchMultiAssignmentsForUsers([user.id]);
      const multi = multiMap[user.id] || { department_ids: [], client_ids: [], manager_ids: [], team_lead_ids: [] };
      user.department_ids = multi.department_ids;
      user.client_ids = multi.client_ids;
      user.manager_ids = multi.manager_ids;
      user.team_lead_ids = multi.team_lead_ids;
    } catch (_e) { /* junction tables may not exist yet */ }
    res.json({ user });
  } catch (e) {
    next(e);
  }
});

// GET /my-team - Employees can see teammates in same client
router.get('/my-team', authenticate, async (req, res, next) => {
  try {
    const userId = req.user.sub;
    const meResult = await query(`SELECT client_id, department_id, team_lead_id, manager_id FROM users WHERE id = $1`, [userId]);
    const me = meResult.rows[0];

    // Get all departments this user is assigned to (primary + multi-assignments)
    let myDeptIds = [];
    if (me?.department_id) myDeptIds.push(me.department_id);
    try {
      const deptAssign = await query(`SELECT department_id FROM user_department_assignments WHERE user_id = $1`, [userId]);
      for (const row of deptAssign.rows) {
        if (!myDeptIds.includes(row.department_id)) myDeptIds.push(row.department_id);
      }
    } catch (_e) { /* table may not exist */ }

    if (!me?.client_id && myDeptIds.length === 0) return res.json({ users: [] });

    const cols = await getUserColumns();
    const prefixedCols = cols.split(',').map((c) => `u.${c.trim()}`).join(', ');

    // Match by client_id, all departments (primary + multi), team lead, and manager
    const conditions = [];
    const values = [];
    if (me.client_id) {
      values.push(me.client_id);
      conditions.push(`u.client_id = $${values.length}`);
    }
    for (const deptId of myDeptIds) {
      values.push(deptId);
      const idx = values.length;
      // Users with this as primary department
      conditions.push(`u.department_id = $${idx}`);
      // Users assigned to this department via multi-assignments
      conditions.push(`EXISTS (SELECT 1 FROM user_department_assignments uda WHERE uda.user_id = u.id AND uda.department_id = $${idx})`);
    }
    if (me.team_lead_id) {
      values.push(me.team_lead_id);
      conditions.push(`u.id = $${values.length}`);
      // Include the team lead's direct manager_id
      const tlResult = await query(`SELECT manager_id FROM users WHERE id = $1`, [me.team_lead_id]);
      if (tlResult.rows[0]?.manager_id) {
        values.push(tlResult.rows[0].manager_id);
        conditions.push(`u.id = $${values.length}`);
      }
      // Also find manager via user_team_lead_assignments (manager who has this TL in their team leads list)
      try {
        const mgrViaTL = await query(
          `SELECT user_id FROM user_team_lead_assignments WHERE team_lead_id = $1`,
          [me.team_lead_id]
        );
        for (const row of mgrViaTL.rows) {
          values.push(row.user_id);
          conditions.push(`u.id = $${values.length}`);
        }
      } catch (_e) { /* table may not exist */ }
    }
    if (me.manager_id) {
      values.push(me.manager_id);
      conditions.push(`u.id = $${values.length}`);
    }

    const r = await query(
      `SELECT ${prefixedCols}, d.name AS department_name, c.name AS client_name, mgr.name AS manager_name, tl.name AS team_lead_name
       FROM users u
       LEFT JOIN departments d ON u.department_id = d.id
       LEFT JOIN clients c ON c.id = u.client_id
       LEFT JOIN users mgr ON u.manager_id = mgr.id
       LEFT JOIN users tl ON u.team_lead_id = tl.id
       WHERE u.deleted_at IS NULL AND u.is_active = true
         AND (${conditions.join(' OR ')})
       ORDER BY u.name`,
      values
    );

    // Attach multi-assignment arrays so frontend can check department_ids
    try {
      const userIds = r.rows.map((u) => u.id);
      if (userIds.length > 0) {
        const multiMap = await fetchMultiAssignmentsForUsers(userIds);
        for (const user of r.rows) {
          const multi = multiMap[user.id] || { department_ids: [], client_ids: [], manager_ids: [], team_lead_ids: [] };
          user.department_ids = multi.department_ids;
          user.client_ids = multi.client_ids;
          user.manager_ids = multi.manager_ids;
          user.team_lead_ids = multi.team_lead_ids;
        }
      }
    } catch (_e) { /* junction tables may not exist yet */ }

    res.json({ users: r.rows });
  } catch (e) {
    next(e);
  }
});

router.get('/', authenticate, requireRole('admin', 'manager', 'team_lead'), async (req, res, next) => {
  try {
    const cols = await getUserColumns();
    // Prefix user columns with u. for the JOIN
    const prefixedCols = cols.split(',').map((c) => `u.${c.trim()}`).join(', ');
    // include_inactive=true returns all users (for user management view)
    const includeInactive = req.query.include_inactive === 'true';
    let sql = `SELECT ${prefixedCols}, u.is_active, d.name AS department_name, mgr.name AS manager_name, tl.name AS team_lead_name FROM users u LEFT JOIN departments d ON u.department_id = d.id LEFT JOIN users mgr ON u.manager_id = mgr.id LEFT JOIN users tl ON u.team_lead_id = tl.id`;
    const conditions = [];
    const values = [];
    // Always exclude hard-deleted users; include_inactive just controls is_active filter
    conditions.push('u.deleted_at IS NULL');
    if (!includeInactive) {
      conditions.push('u.is_active = true');
    }
    if (req.query.department_id) {
      values.push(req.query.department_id);
      conditions.push(`u.department_id = $${values.length}`);
    }
    // Team leads only see their own team (direct assignments + junction table)
    // unless they explicitly request all via scope=all (used by admin views)
    if (req.user.role === 'team_lead' && req.query.scope !== 'all') {
      values.push(req.user.sub);
      const idx = values.length;
      let teamCond = `(u.id = $${idx} OR u.team_lead_id = $${idx}`;
      try {
        await query(`SELECT 1 FROM user_team_lead_assignments LIMIT 1`);
        teamCond += ` OR EXISTS (SELECT 1 FROM user_team_lead_assignments uta WHERE uta.user_id = u.id AND uta.team_lead_id = $${idx})`;
      } catch (_e) { /* table may not exist */ }
      teamCond += ')';
      conditions.push(teamCond);
    }
    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY u.name';
    const r = await query(sql, values);
    // Attach multi-assignment arrays to each user
    try {
      const userIds = r.rows.map((u) => u.id);
      if (userIds.length > 0) {
        const multiMap = await fetchMultiAssignmentsForUsers(userIds);
        for (const user of r.rows) {
          const multi = multiMap[user.id] || { department_ids: [], client_ids: [], manager_ids: [], team_lead_ids: [] };
          user.department_ids = multi.department_ids;
          user.client_ids = multi.client_ids;
          user.manager_ids = multi.manager_ids;
          user.team_lead_ids = multi.team_lead_ids;
        }
      }
    } catch (_e) { /* junction tables may not exist yet */ }
    res.json({ users: r.rows });
  } catch (e) {
    next(e);
  }
});

const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(1).max(255),
  role: z.enum(['admin', 'manager', 'team_lead', 'employee']),
  client_id: z.string().uuid().optional().nullable(),
  manager_id: z.string().uuid().optional().nullable(),
  team_lead_id: z.string().uuid().optional().nullable(),
  department_id: z.string().uuid().optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  designation: z.string().max(255).optional().nullable(),
  employee_id: z.string().max(100).optional().nullable(),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  employment_type: z.enum(['full_time', 'part_time', 'intern', 'contract']).optional().nullable(),
  work_timezone: z.string().max(50).optional().nullable(),
});

router.post('/', authenticate, requireRole('admin', 'manager', 'team_lead'), async (req, res, next) => {
  try {
    const body = createUserSchema.parse(req.body);
    const bcrypt = (await import('bcryptjs')).default;
    const hash = await bcrypt.hash(body.password, 10);
    const r = await query(
      `INSERT INTO users (email, password_hash, name, role, client_id, manager_id, team_lead_id, department_id, phone, designation, employee_id, date_of_birth, employment_type, work_timezone)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING id, email, name, role, client_id, manager_id, team_lead_id, department_id, phone, designation, employee_id, date_of_birth, employment_type, work_timezone, created_at`,
      [
        body.email.toLowerCase().trim(),
        hash,
        body.name.trim(),
        body.role,
        body.client_id || null,
        body.manager_id || null,
        body.team_lead_id || null,
        body.department_id || null,
        body.phone || null,
        body.designation || null,
        body.employee_id || null,
        body.date_of_birth || null,
        body.employment_type || 'full_time',
        body.work_timezone || 'Asia/Kolkata',
      ]
    );
    const user = r.rows[0];
    if (user) {
      // Sync junction tables from array fields if provided
      const multiBody = req.body;
      const hasMulti = Array.isArray(multiBody.department_ids) || Array.isArray(multiBody.client_ids) ||
                       Array.isArray(multiBody.manager_ids) || Array.isArray(multiBody.team_lead_ids);
      if (hasMulti) {
        await syncMultiAssignments(user.id, {
          department_ids: multiBody.department_ids,
          client_ids: multiBody.client_ids,
          manager_ids: multiBody.manager_ids,
          team_lead_ids: multiBody.team_lead_ids,
        });
      } else if (body.client_id) {
        // Backward compat: single client_id -> insert into user_client_assignments
        try {
          await query(
            `INSERT INTO user_client_assignments (user_id, client_id) VALUES ($1, $2) ON CONFLICT (user_id, client_id) DO NOTHING`,
            [user.id, body.client_id]
          );
        } catch (e) {
          if (e.code !== '42P01') throw e;
        }
      }
      // Also seed single-value FKs into their junction tables for backward compat
      if (!hasMulti) {
        if (body.department_id) {
          try { await query(`INSERT INTO user_department_assignments (user_id, department_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [user.id, body.department_id]); } catch (_e) {}
        }
        if (body.manager_id) {
          try { await query(`INSERT INTO user_manager_assignments (user_id, manager_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [user.id, body.manager_id]); } catch (_e) {}
        }
        if (body.team_lead_id) {
          try { await query(`INSERT INTO user_team_lead_assignments (user_id, team_lead_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [user.id, body.team_lead_id]); } catch (_e) {}
        }
      }
    }
    res.status(201).json(user);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Email already exists' });
    if (e.name === 'ZodError') return res.status(400).json({ error: e.errors.map(err => err.message).join(', ') });
    next(e);
  }
});

// PATCH /api/users/assign-team-lead — Assign/replace TL for a client
// NOTE: Must be defined BEFORE /:id route so Express doesn't treat "assign-team-lead" as a UUID
router.patch('/assign-team-lead', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const body = z.object({
      client_id: z.string().uuid(),
      team_lead_id: z.string().uuid().nullable(),
    }).parse(req.body);

    // Update the client's team_lead_id
    await query(`UPDATE clients SET team_lead_id = $1, updated_at = now() WHERE id = $2`, [body.team_lead_id, body.client_id]);

    // Update all employees under this client to have the new team_lead_id
    if (body.team_lead_id) {
      await query(
        `UPDATE users SET team_lead_id = $1, updated_at = now()
         WHERE client_id = $2 AND deleted_at IS NULL AND role = 'employee'`,
        [body.team_lead_id, body.client_id]
      );
    }

    res.json({ ok: true });
  } catch (e) {
    if (e.name === 'ZodError') return res.status(400).json({ error: e.errors.map(err => err.message).join(', ') });
    next(e);
  }
});

// PATCH /api/users/assign-manager — Assign/replace manager for a department or client
// NOTE: Must be defined BEFORE /:id route so Express doesn't treat "assign-manager" as a UUID
router.patch('/assign-manager', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const body = z.object({
      department_id: z.string().uuid().optional(),
      client_id: z.string().uuid().optional(),
      manager_id: z.string().uuid().nullable(),
    }).parse(req.body);

    if (!body.department_id && !body.client_id) {
      return res.status(400).json({ error: 'Either department_id or client_id is required' });
    }

    if (body.client_id) {
      // Assign manager to all employees under this client
      await query(
        `UPDATE users SET manager_id = $1, updated_at = now()
         WHERE client_id = $2 AND deleted_at IS NULL AND role IN ('employee', 'team_lead')`,
        [body.manager_id, body.client_id]
      );
      // Also set the manager's department_id to match the client's department
      if (body.manager_id) {
        const clientRow = await query(`SELECT department_id FROM clients WHERE id = $1`, [body.client_id]);
        if (clientRow.rows.length > 0 && clientRow.rows[0].department_id) {
          await query(
            `UPDATE users SET department_id = $1, updated_at = now() WHERE id = $2`,
            [clientRow.rows[0].department_id, body.manager_id]
          );
        }
      }
    } else if (body.department_id) {
      // Assign manager to all employees in this department
      await query(
        `UPDATE users SET manager_id = $1, updated_at = now()
         WHERE department_id = $2 AND deleted_at IS NULL AND role IN ('employee', 'team_lead')`,
        [body.manager_id, body.department_id]
      );
      // Also set the manager's own department_id so they appear in the hierarchy
      if (body.manager_id) {
        await query(
          `UPDATE users SET department_id = $1, updated_at = now() WHERE id = $2`,
          [body.department_id, body.manager_id]
        );
      }
    }

    res.json({ ok: true });
  } catch (e) {
    if (e.name === 'ZodError') return res.status(400).json({ error: e.errors.map(err => err.message).join(', ') });
    next(e);
  }
});

// GET /api/users/multi-assignments — Return all junction table data in one call
router.get('/multi-assignments', authenticate, async (req, res, next) => {
  try {
    const result = { user_departments: [], user_clients: [], user_managers: [], user_team_leads: [] };

    try {
      const depts = await query(`SELECT user_id, department_id FROM user_department_assignments`);
      result.user_departments = depts.rows;
    } catch (e) { if (e.code !== '42P01') throw e; }

    try {
      const clients = await query(`SELECT user_id, client_id FROM user_client_assignments`);
      result.user_clients = clients.rows;
    } catch (e) { if (e.code !== '42P01') throw e; }

    try {
      const mgrs = await query(`SELECT user_id, manager_id FROM user_manager_assignments`);
      result.user_managers = mgrs.rows;
    } catch (e) { if (e.code !== '42P01') throw e; }

    try {
      const tls = await query(`SELECT user_id, team_lead_id FROM user_team_lead_assignments`);
      result.user_team_leads = tls.rows;
    } catch (e) { if (e.code !== '42P01') throw e; }

    res.json(result);
  } catch (e) {
    next(e);
  }
});

// PUT /api/users/:id/multi-assignments — Replace all junction assignments for a user
router.put('/:id/multi-assignments', authenticate, requireRole('admin', 'manager', 'team_lead'), async (req, res, next) => {
  try {
    const userId = req.params.id;
    const { department_ids, client_ids, manager_ids, team_lead_ids } = req.body;

    await syncMultiAssignments(userId, { department_ids, client_ids, manager_ids, team_lead_ids });

    // Update primary FK columns on users table to the first value (or null) for backward compat
    const updates = [];
    const values = [];
    let i = 1;
    if (Array.isArray(department_ids)) {
      updates.push(`department_id = $${i++}`);
      values.push(department_ids.length > 0 ? department_ids[0] : null);
    }
    if (Array.isArray(client_ids)) {
      updates.push(`client_id = $${i++}`);
      values.push(client_ids.length > 0 ? client_ids[0] : null);
    }
    if (Array.isArray(manager_ids)) {
      updates.push(`manager_id = $${i++}`);
      values.push(manager_ids.length > 0 ? manager_ids[0] : null);
    }
    if (Array.isArray(team_lead_ids)) {
      updates.push(`team_lead_id = $${i++}`);
      values.push(team_lead_ids.length > 0 ? team_lead_ids[0] : null);
    }

    if (updates.length > 0) {
      values.push(userId);
      await query(
        `UPDATE users SET ${updates.join(', ')}, updated_at = now() WHERE id = $${i} AND deleted_at IS NULL`,
        values
      );
    }

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

const updateUserSchema = z.object({
  email: z.string().email().optional(),
  name: z.string().min(1).max(255).optional(),
  role: z.enum(['admin', 'manager', 'team_lead', 'employee']).optional(),
  client_id: z.string().uuid().optional().nullable(),
  manager_id: z.string().uuid().optional().nullable(),
  team_lead_id: z.string().uuid().optional().nullable(),
  department_id: z.string().uuid().optional().nullable(),
  password: z.string().min(6).optional(),
  date_of_birth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  designation: z.string().max(255).optional().nullable(),
  employee_id: z.string().max(100).optional().nullable(),
  employment_type: z.enum(['full_time', 'part_time', 'intern', 'contract']).optional().nullable(),
  work_location_default: z.enum(['wfh', 'wfo']).optional().nullable(),
  work_timezone: z.string().max(50).optional().nullable(),
});

router.patch('/:id', authenticate, requireRole('admin', 'manager', 'team_lead'), async (req, res, next) => {
  try {
    const id = req.params.id;
    const body = updateUserSchema.parse(req.body);
    const updates = [];
    const values = [];
    let i = 1;
    if (body.email !== undefined) { updates.push(`email = $${i++}`); values.push(body.email.toLowerCase().trim()); }
    if (body.name !== undefined) { updates.push(`name = $${i++}`); values.push(body.name.trim()); }
    if (body.role !== undefined) { updates.push(`role = $${i++}`); values.push(body.role); }
    if (body.client_id !== undefined) { updates.push(`client_id = $${i++}`); values.push(body.client_id); }
    if (body.manager_id !== undefined) { updates.push(`manager_id = $${i++}`); values.push(body.manager_id); }
    if (body.team_lead_id !== undefined) { updates.push(`team_lead_id = $${i++}`); values.push(body.team_lead_id); }
    if (body.department_id !== undefined) { updates.push(`department_id = $${i++}`); values.push(body.department_id); }
    if (body.date_of_birth !== undefined) { updates.push(`date_of_birth = $${i++}`); values.push(body.date_of_birth || null); }
    if (body.phone !== undefined) { updates.push(`phone = $${i++}`); values.push(body.phone || null); }
    if (body.designation !== undefined) { updates.push(`designation = $${i++}`); values.push(body.designation || null); }
    if (body.employee_id !== undefined) { updates.push(`employee_id = $${i++}`); values.push(body.employee_id || null); }
    if (body.employment_type !== undefined) { updates.push(`employment_type = $${i++}`); values.push(body.employment_type || null); }
    if (body.work_location_default !== undefined) { updates.push(`work_location_default = $${i++}`); values.push(body.work_location_default || 'wfo'); }
    if (body.work_timezone !== undefined) { updates.push(`work_timezone = $${i++}`); values.push(body.work_timezone || 'Asia/Kolkata'); }
    if (body.password !== undefined) {
      const bcrypt = (await import('bcryptjs')).default;
      const hash = await bcrypt.hash(body.password, 10);
      updates.push(`password_hash = $${i++}`);
      values.push(hash);
    }
    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
    values.push(id);
    const r = await query(
      `UPDATE users SET ${updates.join(', ')}, updated_at = now() WHERE id = $${i} AND deleted_at IS NULL RETURNING id, email, name, role, client_id, manager_id, team_lead_id, created_at`,
      values
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    if (r.rows[0] && (body.date_of_birth !== undefined || body.phone !== undefined || body.designation !== undefined)) {
      try {
        const extra = await query(`SELECT date_of_birth, phone, designation FROM users WHERE id = $1`, [id]);
        if (extra.rows[0]) Object.assign(r.rows[0], extra.rows[0]);
      } catch (e) {
        if (e.code !== '42703') throw e;
      }
    }
    // Sync junction tables from array fields if provided
    const multiBody = req.body;
    const hasMulti = Array.isArray(multiBody.department_ids) || Array.isArray(multiBody.client_ids) ||
                     Array.isArray(multiBody.manager_ids) || Array.isArray(multiBody.team_lead_ids);
    if (hasMulti) {
      await syncMultiAssignments(id, {
        department_ids: multiBody.department_ids,
        client_ids: multiBody.client_ids,
        manager_ids: multiBody.manager_ids,
        team_lead_ids: multiBody.team_lead_ids,
      });
    } else {
      // Backward compat: single FK values -> insert into junction tables
      if (body.client_id) {
        try {
          await query(
            `INSERT INTO user_client_assignments (user_id, client_id) VALUES ($1, $2) ON CONFLICT (user_id, client_id) DO NOTHING`,
            [id, body.client_id]
          );
        } catch (e) {
          if (e.code !== '42P01') throw e;
        }
      }
      if (body.department_id) {
        try { await query(`INSERT INTO user_department_assignments (user_id, department_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [id, body.department_id]); } catch (_e) {}
      }
      if (body.manager_id) {
        try { await query(`INSERT INTO user_manager_assignments (user_id, manager_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [id, body.manager_id]); } catch (_e) {}
      }
      if (body.team_lead_id) {
        try { await query(`INSERT INTO user_team_lead_assignments (user_id, team_lead_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [id, body.team_lead_id]); } catch (_e) {}
      }
    }
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Email already exists. Please use a different email.' });
    if (e.name === 'ZodError') return res.status(400).json({ error: e.errors.map(err => err.message).join(', ') });
    next(e);
  }
});

router.delete('/:id', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const id = req.params.id;
    const r = await query(
      `UPDATE users SET deleted_at = now(), updated_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
      [id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// PATCH /api/users/:id/deactivate — Soft-deactivate a user (keeps record, marks inactive)
router.patch('/:id/deactivate', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const id = req.params.id;
    if (id === req.user.sub) return res.status(400).json({ error: 'Cannot deactivate yourself' });
    const r = await query(
      `UPDATE users SET is_active = false, deleted_at = now(), updated_at = now() WHERE id = $1 RETURNING id, name, email, is_active`,
      [id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(r.rows[0]);
  } catch (e) {
    next(e);
  }
});

// PATCH /api/users/:id/activate — Re-activate a deactivated user
router.patch('/:id/activate', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const id = req.params.id;
    const r = await query(
      `UPDATE users SET is_active = true, deleted_at = NULL, updated_at = now() WHERE id = $1 RETURNING id, name, email, is_active`,
      [id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    res.json(r.rows[0]);
  } catch (e) {
    next(e);
  }
});

// POST /api/users/:id/reset-password — Admin resets a user's password to a generated temp password
router.post('/:id/reset-password', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const id = req.params.id;
    const crypto = (await import('crypto')).default;
    const bcrypt = (await import('bcryptjs')).default;
    // Generate a readable temp password: 3 words + 3 digits
    const words = ['Solar', 'Green', 'Power', 'Wind', 'Tech', 'Star', 'Blue', 'Red', 'Sky', 'Sun'];
    const w1 = words[Math.floor(Math.random() * words.length)];
    const w2 = words[Math.floor(Math.random() * words.length)];
    const digits = String(Math.floor(Math.random() * 900) + 100);
    const tempPassword = `${w1}${w2}@${digits}`;
    const hash = await bcrypt.hash(tempPassword, 10);
    // Ensure columns
    try {
      await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS must_reset_password BOOLEAN NOT NULL DEFAULT false`);
      await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_password_plain VARCHAR(255)`);
    } catch (_e) {}
    const r = await query(
      `UPDATE users SET password_hash = $1, must_reset_password = true, last_password_plain = $2, updated_at = now()
       WHERE id = $3 AND role != 'admin' RETURNING id, name, email`,
      [hash, tempPassword, id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'User not found or cannot reset admin password' });
    res.json({ ok: true, temp_password: tempPassword, user: r.rows[0] });
  } catch (e) {
    next(e);
  }
});

// POST /api/users/bulk-set-password — Set temporary password for all employees and flag for reset
router.post('/bulk-set-password', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { password, user_ids } = req.body;
    if (!password || password.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters' });

    const bcrypt = (await import('bcryptjs')).default;
    const hash = await bcrypt.hash(password, 10);

    // Ensure must_reset_password column exists
    try {
      await query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS must_reset_password BOOLEAN NOT NULL DEFAULT false`);
    } catch (_e) { /* already exists */ }

    let sql, values;
    if (Array.isArray(user_ids) && user_ids.length > 0) {
      // Set password for specific users
      const placeholders = user_ids.map((_, i) => `$${i + 3}`).join(', ');
      sql = `UPDATE users SET password_hash = $1, must_reset_password = true, updated_at = now()
             WHERE id IN (${placeholders}) AND deleted_at IS NULL AND role != 'admin'
             RETURNING id, email, name`;
      values = [hash, ...user_ids];
    } else {
      // Set password for ALL non-admin users
      sql = `UPDATE users SET password_hash = $1, must_reset_password = true, updated_at = now()
             WHERE deleted_at IS NULL AND role != 'admin'
             RETURNING id, email, name`;
      values = [hash];
    }

    const r = await query(sql, values);
    res.json({ ok: true, updated_count: r.rowCount, users: r.rows.map((u) => ({ id: u.id, email: u.email, name: u.name })) });
  } catch (e) {
    next(e);
  }
});

// GET /api/users/team-hierarchy — Organizational hierarchy grouped by department > client
router.get('/team-hierarchy', authenticate, requireRole('admin', 'manager', 'team_lead'), async (req, res, next) => {
  try {
    // Get all departments
    const deptResult = await query(`SELECT id, name FROM departments ORDER BY name`);
    const departments = deptResult.rows;

    // Get all clients with department info
    const clientResult = await query(
      `SELECT c.id, c.name, c.department_id, c.team_lead_id,
              tl.name AS team_lead_name, tl.email AS team_lead_email
       FROM clients c
       LEFT JOIN users tl ON tl.id = c.team_lead_id AND tl.deleted_at IS NULL
       ORDER BY c.name`
    );
    const clients = clientResult.rows;

    // Get all active users with their TL/manager names
    const usersResult = await query(
      `SELECT u.id, u.email, u.name, u.role, u.client_id, u.department_id,
              u.manager_id, u.team_lead_id, u.designation, u.phone, u.is_active,
              d.name AS department_name,
              tl.name AS team_lead_name,
              mgr.name AS manager_name
       FROM users u
       LEFT JOIN departments d ON d.id = u.department_id
       LEFT JOIN users tl ON tl.id = u.team_lead_id AND tl.deleted_at IS NULL
       LEFT JOIN users mgr ON mgr.id = u.manager_id AND mgr.deleted_at IS NULL
       WHERE u.deleted_at IS NULL
       ORDER BY u.name`
    );
    const users = usersResult.rows;

    // Attach multi-assignments
    try {
      const userIds = users.map((u) => u.id);
      if (userIds.length > 0) {
        const multiMap = await fetchMultiAssignmentsForUsers(userIds);
        for (const user of users) {
          const multi = multiMap[user.id] || { department_ids: [], client_ids: [], manager_ids: [], team_lead_ids: [] };
          user.department_ids = multi.department_ids;
          user.client_ids = multi.client_ids;
        }
      }
    } catch (_e) { /* junction tables may not exist yet */ }

    // Build hierarchy
    const result = departments.map((dept) => {
      // Find users explicitly assigned to this department (primary or multi)
      const deptUsers = users.filter(
        (u) => u.department_id === dept.id || (u.department_ids && u.department_ids.includes(dept.id))
      );
      
      const deptClients = clients.filter((c) => c.department_id === dept.id);

      // Start with explicitly assigned managers
      const managers = deptUsers.filter((u) => u.role === 'manager');

      // Add dynamic managers: managers who manage employees in this department, but aren't explicitly assigned to this department
      const employeeManagerIds = new Set(deptUsers.map(u => u.manager_id).filter(Boolean));
      for (const mId of employeeManagerIds) {
         if (!managers.find(m => m.id === mId)) {
            const mUser = users.find(u => u.id === mId);
            if (mUser && mUser.role === 'manager') {
               managers.push(mUser);
            }
         }
      }

      const clientGroups = deptClients.map((client) => {
        // Employees assigned to this client
        const clientEmployees = users.filter(
          (u) => (u.client_id === client.id || (u.client_ids && u.client_ids.includes(client.id))) && u.role !== 'manager'
        );
        // Auto-infer team lead if missing
        let teamLead = null;
        if (client.team_lead_id) {
          teamLead = users.find((u) => u.id === client.team_lead_id) || { id: client.team_lead_id, name: client.team_lead_name, email: client.team_lead_email };
        } else {
          // If no explicit team lead is set for the client, try to infer from the employees
          const commonTlId = clientEmployees.find(u => u.team_lead_id)?.team_lead_id;
          if (commonTlId) {
            teamLead = users.find(u => u.id === commonTlId);
          }
        }

        return {
          id: client.id,
          name: client.name,
          team_lead: teamLead ? { id: teamLead.id, name: teamLead.name, email: teamLead.email, role: teamLead.role } : null,
          employees: clientEmployees.map((u) => ({
            id: u.id, name: u.name, email: u.email, role: u.role,
            designation: u.designation, phone: u.phone,
            team_lead_id: u.team_lead_id, manager_id: u.manager_id,
            team_lead_name: u.team_lead_name, manager_name: u.manager_name,
            is_active: u.is_active,
          })),
        };
      });

      // Users in this department not assigned to any client
      const assignedClientIds = new Set(deptClients.map((c) => c.id));
      const unassigned = deptUsers.filter(
        (u) => u.role !== 'manager' && (!u.client_id || !assignedClientIds.has(u.client_id))
      );

      return {
        id: dept.id,
        name: dept.name,
        managers: managers.map((m) => ({ id: m.id, name: m.name, email: m.email, role: m.role, phone: m.phone })),
        clients: clientGroups,
        unassigned_employees: unassigned.map((u) => ({
          id: u.id, name: u.name, email: u.email, role: u.role,
          designation: u.designation, phone: u.phone,
          team_lead_id: u.team_lead_id, manager_id: u.manager_id,
          team_lead_name: u.team_lead_name, manager_name: u.manager_name,
          is_active: u.is_active,
        })),
      };
    });

    // Users with no department
    const noDeptUsers = users.filter((u) => !u.department_id);
    if (noDeptUsers.length > 0) {
      const noDeptClients = clients.filter((c) => !c.department_id);
      result.push({
        id: null,
        name: 'Unassigned Department',
        managers: noDeptUsers.filter((u) => u.role === 'manager').map((m) => ({ id: m.id, name: m.name, email: m.email, role: m.role, phone: m.phone })),
        clients: noDeptClients.map((client) => {
          const emps = noDeptUsers.filter((u) => u.client_id === client.id && u.role !== 'manager');
          // Auto-infer team lead if missing
          let teamLead = null;
          if (client.team_lead_id) {
            teamLead = noDeptUsers.find((u) => u.id === client.team_lead_id) || { id: client.team_lead_id, name: client.team_lead_name, email: client.team_lead_email };
          } else {
            const commonTlId = emps.find(u => u.team_lead_id)?.team_lead_id;
            if (commonTlId) {
              teamLead = users.find(u => u.id === commonTlId);
            }
          }
          return {
            id: client.id,
            name: client.name,
            team_lead: teamLead ? { id: teamLead.id, name: teamLead.name, email: teamLead.email, role: teamLead.role } : null,
            employees: emps.map((u) => ({
              id: u.id, name: u.name, email: u.email, role: u.role,
              designation: u.designation, phone: u.phone,
              team_lead_id: u.team_lead_id, manager_id: u.manager_id,
              team_lead_name: u.team_lead_name, manager_name: u.manager_name,
              is_active: u.is_active,
            })),
          };
        }),
        unassigned_employees: noDeptUsers.filter((u) => u.role !== 'manager' && !u.client_id).map((u) => ({
          id: u.id, name: u.name, email: u.email, role: u.role,
          designation: u.designation, phone: u.phone,
          team_lead_id: u.team_lead_id, manager_id: u.manager_id,
          team_lead_name: u.team_lead_name, manager_name: u.manager_name,
          is_active: u.is_active,
        })),
      });
    }

    res.json({ departments: result });
  } catch (e) {
    next(e);
  }
});

export default router;
