import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import { query } from '../lib/db.js';

const router = Router();

// List employees assigned to a client (for schedule builder / client view).
// Returns everyone who is in user_client_assignments OR has users.client_id = this client (merged, no duplicates).
router.get('/by-client/:clientId', authenticate, async (req, res, next) => {
  try {
    const { clientId } = req.params;
    const byAssignments = [];
    try {
      const r = await query(
        `SELECT u.id, u.name, u.role, u.email, u.department_id, d.name AS department_name, mgr.name AS manager_name, tl.name AS team_lead_name
         FROM user_client_assignments uca
         JOIN users u ON u.id = uca.user_id AND u.deleted_at IS NULL
         LEFT JOIN departments d ON d.id = u.department_id
         LEFT JOIN users mgr ON u.manager_id = mgr.id
         LEFT JOIN users tl ON u.team_lead_id = tl.id
         WHERE uca.client_id = $1`,
        [clientId]
      );
      byAssignments.push(...r.rows);
    } catch (e) {
      if (e.code !== '42P01') throw e;
    }
    const byPrimaryClient = await query(
      `SELECT u.id, u.name, u.role, u.email, u.department_id, d.name AS department_name, mgr.name AS manager_name, tl.name AS team_lead_name
       FROM users u LEFT JOIN departments d ON d.id = u.department_id
       LEFT JOIN users mgr ON u.manager_id = mgr.id
       LEFT JOIN users tl ON u.team_lead_id = tl.id
       WHERE u.client_id = $1 AND u.deleted_at IS NULL`,
      [clientId]
    );
    const seen = new Set(byAssignments.map((u) => u.id));
    for (const u of byPrimaryClient.rows) {
      if (!seen.has(u.id)) {
        byAssignments.push(u);
        seen.add(u.id);
      }
    }
    byAssignments.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    res.json({ users: byAssignments });
  } catch (e) {
    next(e);
  }
});

// Get client assignments for all users (returns user_id → client_name mapping)
router.get('/user-clients', authenticate, async (req, res, next) => {
  try {
    const rows = [];
    try {
      const r = await query(
        `SELECT uca.user_id, c.id AS client_id, c.name AS client_name
         FROM user_client_assignments uca
         JOIN clients c ON c.id = uca.client_id
         JOIN users u ON u.id = uca.user_id AND u.deleted_at IS NULL
         ORDER BY u.name`
      );
      rows.push(...r.rows);
    } catch (e) {
      if (e.code !== '42P01') throw e;
    }
    // Also include users.client_id primary assignment
    try {
      const r2 = await query(
        `SELECT u.id AS user_id, c.id AS client_id, c.name AS client_name
         FROM users u
         JOIN clients c ON c.id = u.client_id
         WHERE u.deleted_at IS NULL AND u.client_id IS NOT NULL`
      );
      const seen = new Set(rows.map((r) => `${r.user_id}-${r.client_id}`));
      for (const row of r2.rows) {
        const key = `${row.user_id}-${row.client_id}`;
        if (!seen.has(key)) {
          rows.push(row);
          seen.add(key);
        }
      }
    } catch (_e) { /* clients table may not exist */ }
    res.json({ user_clients: rows });
  } catch (e) {
    next(e);
  }
});

// Assign user to client (add to pool for that client)
router.post('/', authenticate, requireRole('admin', 'manager', 'team_lead'), async (req, res, next) => {
  try {
    const { user_id, client_id } = z.object({
      user_id: z.string().uuid(),
      client_id: z.string().uuid(),
    }).parse(req.body);
    await query(
      `INSERT INTO user_client_assignments (user_id, client_id) VALUES ($1, $2) ON CONFLICT (user_id, client_id) DO NOTHING`,
      [user_id, client_id]
    );
    res.status(201).json({ ok: true });
  } catch (e) {
    if (e.code === '42P01') return res.status(501).json({ error: 'Run migration 002_departments_and_assignments.sql' });
    if (e.name === 'ZodError') return res.status(400).json({ error: e.errors.map(err => err.message).join(', ') });
    next(e);
  }
});

router.delete('/:userId/:clientId', authenticate, requireRole('admin', 'manager', 'team_lead'), async (req, res, next) => {
  try {
    const r = await query(
      `DELETE FROM user_client_assignments WHERE user_id = $1 AND client_id = $2`,
      [req.params.userId, req.params.clientId]
    );
    res.json({ ok: true, removed: r.rowCount > 0 });
  } catch (e) {
    next(e);
  }
});

export default router;
