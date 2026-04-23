import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import { query } from '../lib/db.js';

const router = Router();

router.get('/', authenticate, async (req, res, next) => {
  try {
    const r = await query(
      `SELECT c.id, c.name, c.team_lead_id, c.department_id, d.name AS department_name
       FROM clients c
       LEFT JOIN departments d ON d.id = c.department_id
       ORDER BY d.name NULLS LAST, c.name`
    );
    res.json({ clients: r.rows });
  } catch (e) {
    if (e.code === '42P01' || e.code === '42703') {
      const r = await query(`SELECT id, name, team_lead_id, created_at FROM clients ORDER BY name`);
      return res.json({ clients: r.rows });
    }
    next(e);
  }
});

const createSchema = z.object({
  name: z.string().min(1).max(255),
  department_id: z.string().uuid().optional().nullable(),
  team_lead_id: z.string().uuid().optional().nullable(),
});

router.post('/', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const body = createSchema.parse(req.body);
    let r;
    try {
      r = await query(
        `INSERT INTO clients (name, department_id, team_lead_id)
         VALUES ($1, $2, $3)
         RETURNING id, name, team_lead_id, department_id, created_at`,
        [body.name.trim(), body.department_id || null, body.team_lead_id || null]
      );
    } catch (e) {
      if (e.code === '42703') {
        r = await query(
          `INSERT INTO clients (name, team_lead_id) VALUES ($1, $2) RETURNING id, name, team_lead_id, created_at`,
          [body.name.trim(), body.team_lead_id || null]
        );
      } else throw e;
    }
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.name === 'ZodError') return res.status(400).json({ error: e.errors.map(err => err.message).join(', ') });
    next(e);
  }
});

router.patch('/:id', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const body = createSchema.partial().parse(req.body);
    const updates = [];
    const values = [];
    let i = 1;
    if (body.name !== undefined) { updates.push(`name = $${i++}`); values.push(body.name.trim()); }
    if (body.department_id !== undefined) { updates.push(`department_id = $${i++}`); values.push(body.department_id); }
    if (body.team_lead_id !== undefined) { updates.push(`team_lead_id = $${i++}`); values.push(body.team_lead_id); }
    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
    values.push(req.params.id);
    const r = await query(
      `UPDATE clients SET ${updates.join(', ')}, updated_at = now() WHERE id = $${i} RETURNING id, name, team_lead_id, department_id`,
      values
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Client not found' });
    res.json(r.rows[0]);
  } catch (e) {
    if (e.name === 'ZodError') return res.status(400).json({ error: e.errors.map(err => err.message).join(', ') });
    next(e);
  }
});

router.delete('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    // Check if employees are assigned to this client
    const check = await query(`SELECT COUNT(*) AS cnt FROM users WHERE client_id = $1 AND deleted_at IS NULL`, [req.params.id]);
    if (parseInt(check.rows[0].cnt) > 0) {
      return res.status(400).json({ error: 'Cannot delete client with assigned employees. Reassign them first.' });
    }
    const r = await query(`DELETE FROM clients WHERE id = $1 RETURNING id`, [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Client not found' });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
