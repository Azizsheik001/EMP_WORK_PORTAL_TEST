import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import { query } from '../lib/db.js';

const router = Router();

router.get('/', authenticate, async (req, res, next) => {
  try {
    const r = await query(
      `SELECT id, name, created_at FROM departments ORDER BY name`
    );
    res.json({ departments: r.rows });
  } catch (e) {
    next(e);
  }
});

router.post('/', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { name } = z.object({ name: z.string().min(1).max(255) }).parse(req.body);
    const r = await query(
      `INSERT INTO departments (name) VALUES ($1) RETURNING id, name, created_at`,
      [name.trim()]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Department name already exists' });
    if (e.name === 'ZodError') return res.status(400).json({ error: e.errors.map(err => err.message).join(', ') });
    next(e);
  }
});

router.patch('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const { name } = z.object({ name: z.string().min(1).max(255) }).parse(req.body);
    const r = await query(
      `UPDATE departments SET name = $1 WHERE id = $2 RETURNING id, name, created_at`,
      [name.trim(), req.params.id]
    );
    if (r.rowCount === 0) return res.status(404).json({ error: 'Department not found' });
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Department name already exists' });
    if (e.name === 'ZodError') return res.status(400).json({ error: e.errors.map(err => err.message).join(', ') });
    next(e);
  }
});

router.delete('/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    // Check if employees are assigned to this department
    const check = await query(`SELECT COUNT(*) AS cnt FROM users WHERE department_id = $1 AND deleted_at IS NULL`, [req.params.id]);
    if (parseInt(check.rows[0].cnt) > 0) {
      return res.status(400).json({ error: 'Cannot delete department with assigned employees. Reassign them first.' });
    }
    const r = await query(`DELETE FROM departments WHERE id = $1 RETURNING id`, [req.params.id]);
    if (r.rowCount === 0) return res.status(404).json({ error: 'Department not found' });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
