import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { query } from '../lib/db.js';

const router = Router();

// ── All routes require authentication (any role) ────────────────

router.use(authenticate);

// ── GET /today — users whose birthday is today ──────────────────

router.get('/today', async (req, res, next) => {
  try {
    const r = await query(`
      SELECT u.id, u.name, u.email, u.date_of_birth, d.name AS department_name, u.designation
      FROM users u
      LEFT JOIN departments d ON d.id = u.department_id
      WHERE u.date_of_birth IS NOT NULL
        AND u.is_active = true
        AND u.deleted_at IS NULL
        AND EXTRACT(MONTH FROM u.date_of_birth) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(DAY FROM u.date_of_birth) = EXTRACT(DAY FROM CURRENT_DATE)
      ORDER BY u.name
    `);
    res.json({ birthdays: r.rows });
  } catch (e) {
    next(e);
  }
});

// ── GET /upcoming — birthdays in next 30 days (handles year wrap) ─

router.get('/upcoming', async (req, res, next) => {
  try {
    const r = await query(`
      SELECT u.id, u.name, u.email, u.date_of_birth, d.name AS department_name, u.designation,
        CASE
          WHEN (EXTRACT(MONTH FROM u.date_of_birth) * 100 + EXTRACT(DAY FROM u.date_of_birth))
               >= (EXTRACT(MONTH FROM CURRENT_DATE) * 100 + EXTRACT(DAY FROM CURRENT_DATE))
          THEN (EXTRACT(MONTH FROM u.date_of_birth) * 100 + EXTRACT(DAY FROM u.date_of_birth))
               - (EXTRACT(MONTH FROM CURRENT_DATE) * 100 + EXTRACT(DAY FROM CURRENT_DATE))
          ELSE (EXTRACT(MONTH FROM u.date_of_birth) * 100 + EXTRACT(DAY FROM u.date_of_birth))
               + 1300
               - (EXTRACT(MONTH FROM CURRENT_DATE) * 100 + EXTRACT(DAY FROM CURRENT_DATE))
        END AS sort_key
      FROM users u
      LEFT JOIN departments d ON d.id = u.department_id
      WHERE u.date_of_birth IS NOT NULL
        AND u.is_active = true
        AND u.deleted_at IS NULL
        AND (
          -- Same-year case: birthday MMDD is between tomorrow and today+30
          (
            MAKE_DATE(EXTRACT(YEAR FROM CURRENT_DATE)::int, EXTRACT(MONTH FROM u.date_of_birth)::int, EXTRACT(DAY FROM u.date_of_birth)::int)
            BETWEEN CURRENT_DATE + INTERVAL '1 day' AND CURRENT_DATE + INTERVAL '30 days'
          )
          OR
          -- Year-wrap case: birthday in early January when today is in late December
          (
            MAKE_DATE(EXTRACT(YEAR FROM CURRENT_DATE)::int + 1, EXTRACT(MONTH FROM u.date_of_birth)::int, EXTRACT(DAY FROM u.date_of_birth)::int)
            BETWEEN CURRENT_DATE + INTERVAL '1 day' AND CURRENT_DATE + INTERVAL '30 days'
          )
        )
      ORDER BY sort_key ASC
    `);
    res.json({ birthdays: r.rows });
  } catch (e) {
    next(e);
  }
});

// ── GET /month/:month — all birthdays in a given month (1-12) ───

const monthParamSchema = z.coerce.number().int().min(1).max(12);

router.get('/month/:month', async (req, res, next) => {
  try {
    const month = monthParamSchema.parse(Number(req.params.month));
    const r = await query(`
      SELECT u.id, u.name, u.email, u.date_of_birth, d.name AS department_name, u.designation
      FROM users u
      LEFT JOIN departments d ON d.id = u.department_id
      WHERE u.date_of_birth IS NOT NULL
        AND u.is_active = true
        AND u.deleted_at IS NULL
        AND EXTRACT(MONTH FROM u.date_of_birth) = $1
      ORDER BY EXTRACT(DAY FROM u.date_of_birth), u.name
    `, [month]);
    res.json({ birthdays: r.rows });
  } catch (e) {
    if (e.name === 'ZodError') return res.status(400).json({ error: 'Month must be between 1 and 12' });
    next(e);
  }
});


// ── GET /all — all birthdays for the year ────────────────────────

router.get('/all', async (req, res, next) => {
  try {
    const r = await query(`
      SELECT u.id, u.name, u.email, u.date_of_birth, d.name AS department_name, u.designation
      FROM users u
      LEFT JOIN departments d ON d.id = u.department_id
      WHERE u.date_of_birth IS NOT NULL
        AND u.is_active = true
        AND u.deleted_at IS NULL
      ORDER BY EXTRACT(MONTH FROM u.date_of_birth), EXTRACT(DAY FROM u.date_of_birth), u.name
    `);
    res.json({ birthdays: r.rows });
  } catch (e) {
    next(e);
  }
});

export default router;
