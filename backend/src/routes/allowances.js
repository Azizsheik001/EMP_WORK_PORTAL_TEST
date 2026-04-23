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
      CREATE TABLE IF NOT EXISTS allowance_policies (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        type VARCHAR(20) NOT NULL CHECK (type IN ('food', 'cab')),
        amount_per_day NUMERIC(10,2) NOT NULL,
        max_per_month NUMERIC(10,2) NOT NULL,
        eligible_roles TEXT[],
        is_active BOOLEAN NOT NULL DEFAULT true,
        effective_from DATE,
        effective_to DATE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS allowance_claims (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id),
        type VARCHAR(20) NOT NULL CHECK (type IN ('food', 'cab')),
        claim_date DATE NOT NULL,
        amount NUMERIC(10,2) NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
        notes TEXT,
        approved_by UUID REFERENCES users(id),
        receipt_url TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE(user_id, type, claim_date)
      );

      CREATE INDEX IF NOT EXISTS idx_allowance_claims_user ON allowance_claims(user_id);
      CREATE INDEX IF NOT EXISTS idx_allowance_claims_status ON allowance_claims(status);
      CREATE INDEX IF NOT EXISTS idx_allowance_claims_date ON allowance_claims(claim_date);
    `);

    // Seed default policies if table is empty
    const existing = await query('SELECT COUNT(*)::int AS count FROM allowance_policies');
    if (existing.rows[0].count === 0) {
      await query(`
        INSERT INTO allowance_policies (type, amount_per_day, max_per_month, eligible_roles, is_active, effective_from)
        VALUES
          ('food', 15.00, 300.00, ARRAY['admin','manager','team_lead','employee'], true, '2025-01-01'),
          ('cab', 20.00, 400.00, ARRAY['admin','manager','team_lead','employee'], true, '2025-01-01')
      `);
    }

    _tablesReady = true;
  } catch (e) {
    console.error('Failed to create allowance tables:', e.message);
  }
}

// Middleware to ensure tables exist before any route
router.use(async (_req, _res, next) => {
  await ensureTables();
  next();
});

// ── Validation schemas ──────────────────────────────────────────

const createPolicySchema = z.object({
  type: z.enum(['food', 'cab']),
  amount_per_day: z.number().min(0),
  max_per_month: z.number().min(0),
  eligible_roles: z.array(z.string()).optional().nullable(),
  is_active: z.boolean().optional(),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  effective_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

const updatePolicySchema = z.object({
  type: z.enum(['food', 'cab']).optional(),
  amount_per_day: z.number().min(0).optional(),
  max_per_month: z.number().min(0).optional(),
  eligible_roles: z.array(z.string()).optional().nullable(),
  is_active: z.boolean().optional(),
  effective_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  effective_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});

const submitClaimSchema = z.object({
  type: z.enum(['food', 'cab']),
  claim_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  amount: z.number().min(0.01),
  notes: z.string().max(2000).optional().nullable(),
  receipt_url: z.string().max(1000).optional().nullable(),
});

// ── Policy routes ───────────────────────────────────────────────

router.get('/policies', authenticate, async (req, res, next) => {
  try {
    const r = await query(
      'SELECT * FROM allowance_policies WHERE is_active = true ORDER BY type'
    );
    res.json({ policies: r.rows });
  } catch (e) {
    next(e);
  }
});

router.post('/policies', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const body = createPolicySchema.parse(req.body);
    const r = await query(
      `INSERT INTO allowance_policies (type, amount_per_day, max_per_month, eligible_roles, is_active, effective_from, effective_to)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        body.type,
        body.amount_per_day,
        body.max_per_month,
        body.eligible_roles || null,
        body.is_active ?? true,
        body.effective_from || null,
        body.effective_to || null,
      ]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.name === 'ZodError') return res.status(400).json({ error: e.errors.map(err => err.message).join(', ') });
    next(e);
  }
});

router.patch('/policies/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    const body = updatePolicySchema.parse(req.body);
    const updates = [];
    const values = [];
    let i = 1;
    const fields = ['type', 'amount_per_day', 'max_per_month', 'eligible_roles', 'is_active', 'effective_from', 'effective_to'];
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
      `UPDATE allowance_policies SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Policy not found' });
    res.json(r.rows[0]);
  } catch (e) {
    if (e.name === 'ZodError') return res.status(400).json({ error: e.errors.map(err => err.message).join(', ') });
    next(e);
  }
});

// ── Claim routes ────────────────────────────────────────────────

router.get('/claims', authenticate, async (req, res, next) => {
  try {
    const { user_id, type, status, month } = req.query;
    const isAdmin = ['admin', 'manager'].includes(req.user.role);

    let sql = `
      SELECT ac.*, u.name AS user_name, u.email AS user_email,
        ab.name AS approved_by_name
      FROM allowance_claims ac
      JOIN users u ON u.id = ac.user_id
      LEFT JOIN users ab ON ab.id = ac.approved_by
    `;
    const conditions = [];
    const values = [];
    let i = 1;

    // Employees can only see their own claims
    if (!isAdmin) {
      conditions.push(`ac.user_id = $${i++}`);
      values.push(req.user.sub);
    } else if (user_id) {
      conditions.push(`ac.user_id = $${i++}`);
      values.push(user_id);
    }

    if (type) { conditions.push(`ac.type = $${i++}`); values.push(type); }
    if (status) { conditions.push(`ac.status = $${i++}`); values.push(status); }
    if (month) {
      // month format: YYYY-MM
      conditions.push(`TO_CHAR(ac.claim_date, 'YYYY-MM') = $${i++}`);
      values.push(month);
    }

    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY ac.claim_date DESC, ac.created_at DESC';

    const r = await query(sql, values);
    res.json({ claims: r.rows });
  } catch (e) {
    next(e);
  }
});

router.post('/claims', authenticate, async (req, res, next) => {
  try {
    const body = submitClaimSchema.parse(req.body);
    const userId = req.user.sub;

    // Get the active policy for this type
    const policyResult = await query(
      `SELECT * FROM allowance_policies
       WHERE type = $1 AND is_active = true
       ORDER BY effective_from DESC LIMIT 1`,
      [body.type]
    );
    if (policyResult.rows.length === 0) {
      return res.status(400).json({ error: `No active policy found for type '${body.type}'` });
    }
    const policy = policyResult.rows[0];

    // Validate amount against policy daily limit
    if (body.amount > parseFloat(policy.amount_per_day)) {
      return res.status(400).json({
        error: `Amount exceeds daily limit of Rs.${policy.amount_per_day} for ${body.type}`,
      });
    }

    // Check monthly cap
    const claimMonth = body.claim_date.slice(0, 7); // YYYY-MM
    const monthTotal = await query(
      `SELECT COALESCE(SUM(amount), 0)::numeric AS total
       FROM allowance_claims
       WHERE user_id = $1 AND type = $2
         AND TO_CHAR(claim_date, 'YYYY-MM') = $3
         AND status != 'rejected'`,
      [userId, body.type, claimMonth]
    );
    const currentTotal = parseFloat(monthTotal.rows[0].total);
    if (currentTotal + body.amount > parseFloat(policy.max_per_month)) {
      return res.status(400).json({
        error: `Adding Rs.${body.amount} would exceed monthly cap of Rs.${policy.max_per_month} for ${body.type} (current: Rs.${currentTotal.toFixed(2)})`,
      });
    }

    const r = await query(
      `INSERT INTO allowance_claims (user_id, type, claim_date, amount, notes, receipt_url)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [userId, body.type, body.claim_date, body.amount, body.notes || null, body.receipt_url || null]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'A claim for this type and date already exists' });
    if (e.name === 'ZodError') return res.status(400).json({ error: e.errors.map(err => err.message).join(', ') });
    next(e);
  }
});

router.patch('/claims/:id/approve', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const r = await query(
      `UPDATE allowance_claims SET status = 'approved', approved_by = $1, updated_at = now()
       WHERE id = $2 AND status = 'pending' RETURNING *`,
      [req.user.sub, req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Claim not found or not pending' });
    res.json(r.rows[0]);
  } catch (e) {
    next(e);
  }
});

router.patch('/claims/:id/reject', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const r = await query(
      `UPDATE allowance_claims SET status = 'rejected', approved_by = $1, updated_at = now()
       WHERE id = $2 AND status = 'pending' RETURNING *`,
      [req.user.sub, req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Claim not found or not pending' });
    res.json(r.rows[0]);
  } catch (e) {
    next(e);
  }
});

// ── Summary route ───────────────────────────────────────────────

router.get('/summary', authenticate, async (req, res, next) => {
  try {
    const { month } = req.query;
    const isAdmin = ['admin', 'manager'].includes(req.user.role);
    const targetMonth = month || new Date().toISOString().slice(0, 7);

    let sql = `
      SELECT
        ac.user_id,
        u.name AS user_name,
        COALESCE(SUM(ac.amount) FILTER (WHERE ac.type = 'food' AND ac.status != 'rejected'), 0)::numeric AS food_total,
        COALESCE(SUM(ac.amount) FILTER (WHERE ac.type = 'cab' AND ac.status != 'rejected'), 0)::numeric AS cab_total,
        COUNT(*) FILTER (WHERE ac.type = 'food' AND ac.status != 'rejected')::int AS food_days,
        COUNT(*) FILTER (WHERE ac.type = 'cab' AND ac.status != 'rejected')::int AS cab_days,
        $1 AS month
      FROM allowance_claims ac
      JOIN users u ON u.id = ac.user_id
      WHERE TO_CHAR(ac.claim_date, 'YYYY-MM') = $1
    `;
    const values = [targetMonth];
    let i = 2;

    if (!isAdmin) {
      sql += ` AND ac.user_id = $${i++}`;
      values.push(req.user.sub);
    }

    sql += ' GROUP BY ac.user_id, u.name ORDER BY u.name';

    const r = await query(sql, values);
    res.json({ summary: r.rows });
  } catch (e) {
    next(e);
  }
});

export default router;
