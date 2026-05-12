import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import { query } from '../lib/db.js';

const router = Router();

// ── Ensure tables exist on first import ──────────────────────────
let _tablesReady = false;

async function ensureTables() {
  if (_tablesReady) return;
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS budgets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL,
        department_id UUID REFERENCES departments(id),
        client_id UUID REFERENCES clients(id),
        period_start DATE,
        period_end DATE,
        allocated_amount NUMERIC(14,2) NOT NULL,
        notes TEXT,
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS budget_expenses (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        budget_id UUID NOT NULL REFERENCES budgets(id) ON DELETE CASCADE,
        description VARCHAR(500) NOT NULL,
        amount NUMERIC(14,2) NOT NULL,
        expense_date DATE NOT NULL,
        category VARCHAR(100),
        created_by UUID REFERENCES users(id),
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_budget_expenses_budget ON budget_expenses(budget_id);
      CREATE INDEX IF NOT EXISTS idx_budgets_department ON budgets(department_id);
      CREATE INDEX IF NOT EXISTS idx_budgets_client ON budgets(client_id);
    `);
    _tablesReady = true;
  } catch (e) {
    console.error('Failed to create budgeting tables:', e.message);
  }
}

// Middleware to ensure tables exist before any route
router.use(async (_req, _res, next) => {
  await ensureTables();
  next();
});

// ── Validation schemas ──────────────────────────────────────────

const createBudgetSchema = z.object({
  name: z.string().min(1).max(255),
  department_id: z.string().uuid().optional().nullable(),
  client_id: z.string().uuid().optional().nullable(),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  allocated_amount: z.number().min(0),
  notes: z.string().max(2000).optional().nullable(),
});

const updateBudgetSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  department_id: z.string().uuid().optional().nullable(),
  client_id: z.string().uuid().optional().nullable(),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  allocated_amount: z.number().min(0).optional(),
  notes: z.string().max(2000).optional().nullable(),
});

const createExpenseSchema = z.object({
  description: z.string().min(1).max(500),
  amount: z.number().min(0.01),
  expense_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  category: z.string().max(100).optional().nullable(),
});

// ── Budget CRUD ─────────────────────────────────────────────────

router.get('/', authenticate, requireRole('admin', 'manager', 'team_lead'), async (req, res, next) => {
  try {
    const r = await query(`
      SELECT b.*,
        d.name AS department_name,
        c.name AS client_name,
        u.name AS created_by_name,
        COALESCE(e.spent, 0)::numeric AS spent
      FROM budgets b
      LEFT JOIN departments d ON d.id = b.department_id
      LEFT JOIN clients c ON c.id = b.client_id
      LEFT JOIN users u ON u.id = b.created_by
      LEFT JOIN LATERAL (
        SELECT SUM(amount) AS spent FROM budget_expenses WHERE budget_id = b.id
      ) e ON true
      ORDER BY b.created_at DESC
    `);
    res.json({ budgets: r.rows });
  } catch (e) {
    next(e);
  }
});

router.post('/', authenticate, requireRole('admin', 'manager', 'team_lead'), async (req, res, next) => {
  try {
    const body = createBudgetSchema.parse(req.body);
    const r = await query(
      `INSERT INTO budgets (name, department_id, client_id, period_start, period_end, allocated_amount, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [
        body.name.trim(),
        body.department_id || null,
        body.client_id || null,
        body.period_start || null,
        body.period_end || null,
        body.allocated_amount,
        body.notes || null,
        req.user.sub,
      ]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.name === 'ZodError') return res.status(400).json({ error: e.errors.map(err => err.message).join(', ') });
    next(e);
  }
});

router.patch('/:id', authenticate, requireRole('admin', 'manager', 'team_lead'), async (req, res, next) => {
  try {
    const body = updateBudgetSchema.parse(req.body);
    const updates = [];
    const values = [];
    let i = 1;
    const fields = ['name', 'department_id', 'client_id', 'period_start', 'period_end', 'allocated_amount', 'notes'];
    for (const f of fields) {
      if (body[f] !== undefined) {
        updates.push(`${f} = $${i++}`);
        values.push(body[f] ?? null);
      }
    }
    if (updates.length === 0) return res.status(400).json({ error: 'No fields to update' });
    updates.push('updated_at = now()');
    values.push(req.params.id);
    const r = await query(
      `UPDATE budgets SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Budget not found' });
    res.json(r.rows[0]);
  } catch (e) {
    if (e.name === 'ZodError') return res.status(400).json({ error: e.errors.map(err => err.message).join(', ') });
    next(e);
  }
});

router.delete('/:id', authenticate, requireRole('admin', 'manager', 'team_lead'), async (req, res, next) => {
  try {
    const r = await query('DELETE FROM budgets WHERE id = $1 RETURNING id', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Budget not found' });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ── Expense routes ──────────────────────────────────────────────

router.get('/:id/expenses', authenticate, requireRole('admin', 'manager', 'team_lead'), async (req, res, next) => {
  try {
    const r = await query(
      `SELECT be.*, u.name AS created_by_name
       FROM budget_expenses be
       LEFT JOIN users u ON u.id = be.created_by
       WHERE be.budget_id = $1
       ORDER BY be.expense_date DESC, be.created_at DESC`,
      [req.params.id]
    );
    res.json({ expenses: r.rows });
  } catch (e) {
    next(e);
  }
});

router.post('/:id/expenses', authenticate, requireRole('admin', 'manager', 'team_lead'), async (req, res, next) => {
  try {
    const body = createExpenseSchema.parse(req.body);

    // Verify budget exists
    const budget = await query('SELECT id FROM budgets WHERE id = $1', [req.params.id]);
    if (budget.rows.length === 0) return res.status(404).json({ error: 'Budget not found' });

    const r = await query(
      `INSERT INTO budget_expenses (budget_id, description, amount, expense_date, category, created_by)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        req.params.id,
        body.description.trim(),
        body.amount,
        body.expense_date,
        body.category || null,
        req.user.sub,
      ]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.name === 'ZodError') return res.status(400).json({ error: e.errors.map(err => err.message).join(', ') });
    next(e);
  }
});

router.delete('/expenses/:expenseId', authenticate, requireRole('admin', 'manager', 'team_lead'), async (req, res, next) => {
  try {
    const r = await query(
      'DELETE FROM budget_expenses WHERE id = $1 RETURNING id',
      [req.params.expenseId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Expense not found' });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ── Summary route ───────────────────────────────────────────────

router.get('/summary', authenticate, requireRole('admin', 'manager', 'team_lead'), async (req, res, next) => {
  try {
    const r = await query(`
      SELECT
        COALESCE(SUM(b.allocated_amount), 0)::numeric AS total_allocated,
        COALESCE(SUM(e.spent), 0)::numeric AS total_spent,
        json_agg(
          json_build_object(
            'department_id', b.department_id,
            'department_name', d.name,
            'allocated', b.allocated_amount,
            'spent', COALESCE(e.spent, 0)
          )
        ) FILTER (WHERE b.id IS NOT NULL) AS by_department
      FROM budgets b
      LEFT JOIN departments d ON d.id = b.department_id
      LEFT JOIN LATERAL (
        SELECT SUM(amount) AS spent FROM budget_expenses WHERE budget_id = b.id
      ) e ON true
    `);
    const row = r.rows[0];
    res.json({
      total_allocated: row.total_allocated,
      total_spent: row.total_spent,
      by_department: row.by_department || [],
    });
  } catch (e) {
    next(e);
  }
});

export default router;
