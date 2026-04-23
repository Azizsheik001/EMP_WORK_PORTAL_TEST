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
      CREATE TABLE IF NOT EXISTS asset_categories (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name VARCHAR(255) NOT NULL UNIQUE,
        description TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS assets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        asset_tag VARCHAR(100) NOT NULL UNIQUE,
        category_id UUID REFERENCES asset_categories(id) ON DELETE SET NULL,
        brand VARCHAR(255) NOT NULL,
        model VARCHAR(255) NOT NULL,
        serial_number VARCHAR(255),
        purchase_date DATE,
        purchase_cost NUMERIC(12,2),
        warranty_expiry_date DATE,
        status VARCHAR(50) NOT NULL DEFAULT 'available'
          CHECK (status IN ('available', 'assigned', 'under_repair', 'retired')),
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE TABLE IF NOT EXISTS asset_assignments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        asset_id UUID NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        assigned_date DATE NOT NULL DEFAULT CURRENT_DATE,
        returned_date DATE,
        assigned_by UUID REFERENCES users(id) ON DELETE SET NULL,
        notes TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );

      CREATE INDEX IF NOT EXISTS idx_assets_category ON assets(category_id);
      CREATE INDEX IF NOT EXISTS idx_assets_status ON assets(status);
      CREATE INDEX IF NOT EXISTS idx_asset_assignments_asset ON asset_assignments(asset_id);
      CREATE INDEX IF NOT EXISTS idx_asset_assignments_user ON asset_assignments(user_id);

      -- Add support_phone column if it doesn't exist
      ALTER TABLE assets ADD COLUMN IF NOT EXISTS support_phone VARCHAR(50);

      -- Add unique constraint on serial_number if not already present
      CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_serial_number_unique
        ON assets (serial_number) WHERE serial_number IS NOT NULL AND serial_number != '';
    `);
    _tablesReady = true;
  } catch (e) {
    console.error('Failed to create asset tables:', e.message);
  }
}

// Middleware to ensure tables exist before any route
router.use(async (_req, _res, next) => {
  await ensureTables();
  next();
});

// ── Validation schemas ──────────────────────────────────────────

const createCategorySchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().max(1000).optional().nullable(),
});

const createAssetSchema = z.object({
  asset_tag: z.string().min(1).max(100),
  category_id: z.string().uuid(),
  brand: z.string().min(1).max(255),
  model: z.string().min(1).max(255),
  serial_number: z.string().max(255).optional().nullable(),
  purchase_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  purchase_cost: z.number().min(0).optional().nullable(),
  warranty_expiry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  status: z.enum(['available', 'assigned', 'under_repair', 'retired']).optional(),
  notes: z.string().max(2000).optional().nullable(),
  support_phone: z.string().max(50).optional().nullable(),
});

const updateAssetSchema = z.object({
  asset_tag: z.string().min(1).max(100).optional(),
  category_id: z.string().uuid().optional(),
  brand: z.string().min(1).max(255).optional(),
  model: z.string().min(1).max(255).optional(),
  serial_number: z.string().max(255).optional().nullable(),
  purchase_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  purchase_cost: z.number().min(0).optional().nullable(),
  warranty_expiry_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  status: z.enum(['available', 'assigned', 'under_repair', 'retired']).optional(),
  notes: z.string().max(2000).optional().nullable(),
  support_phone: z.string().max(50).optional().nullable(),
});

const assignAssetSchema = z.object({
  user_id: z.string().uuid(),
  assigned_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  notes: z.string().max(2000).optional().nullable(),
});

// ── Category routes ─────────────────────────────────────────────

router.get('/categories', authenticate, async (req, res, next) => {
  try {
    const r = await query('SELECT * FROM asset_categories ORDER BY name');
    res.json({ categories: r.rows });
  } catch (e) {
    next(e);
  }
});

router.post('/categories', authenticate, requireRole('admin', 'manager', 'team_lead'), async (req, res, next) => {
  try {
    const body = createCategorySchema.parse(req.body);
    const name = body.name.trim();
    // Case-insensitive duplicate check
    const existing = await query('SELECT * FROM asset_categories WHERE LOWER(name) = LOWER($1)', [name]);
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: `Category "${existing.rows[0].name}" already exists` });
    }
    const r = await query(
      'INSERT INTO asset_categories (name, description) VALUES ($1, $2) RETURNING *',
      [name, body.description || null]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Category already exists' });
    if (e.name === 'ZodError') return res.status(400).json({ error: e.errors.map(err => err.message).join(', ') });
    next(e);
  }
});

router.patch('/categories/:id', authenticate, requireRole('admin', 'manager', 'team_lead'), async (req, res, next) => {
  try {
    const body = createCategorySchema.parse(req.body);
    const r = await query(
      'UPDATE asset_categories SET name = $1, description = $2 WHERE id = $3 RETURNING *',
      [body.name.trim(), body.description || null, req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Category not found' });
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') return res.status(409).json({ error: 'Category name already exists' });
    if (e.name === 'ZodError') return res.status(400).json({ error: e.errors.map(err => err.message).join(', ') });
    next(e);
  }
});

router.delete('/categories/:id', authenticate, requireRole('admin', 'manager', 'team_lead'), async (req, res, next) => {
  try {
    const r = await query('DELETE FROM asset_categories WHERE id = $1 RETURNING id', [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Category not found' });
    res.json({ ok: true });
  } catch (e) {
    if (e.code === '23503') return res.status(409).json({ error: 'Category is in use by assets' });
    next(e);
  }
});

// ── Dashboard ───────────────────────────────────────────────────

router.get('/dashboard', authenticate, requireRole('admin', 'manager', 'team_lead'), async (req, res, next) => {
  try {
    const [totals, expiring] = await Promise.all([
      query(`
        SELECT
          COUNT(*)::int AS total,
          COUNT(*) FILTER (WHERE status = 'assigned')::int AS assigned,
          COUNT(*) FILTER (WHERE status = 'available')::int AS available,
          COUNT(*) FILTER (WHERE status = 'under_repair')::int AS under_repair,
          COUNT(*) FILTER (WHERE status = 'retired')::int AS retired
        FROM assets
      `),
      query(`
        SELECT COUNT(*)::int AS count
        FROM assets
        WHERE warranty_expiry_date IS NOT NULL
          AND warranty_expiry_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'
          AND status != 'retired'
      `),
    ]);
    res.json({
      ...totals.rows[0],
      warranties_expiring_soon: expiring.rows[0].count,
    });
  } catch (e) {
    next(e);
  }
});

// ── Asset CRUD ──────────────────────────────────────────────────

router.get('/', authenticate, async (req, res, next) => {
  try {
    const { category_id, status, assigned_to, search } = req.query;
    let sql = `
      SELECT a.*,
        c.name AS category_name,
        aa.user_id AS assigned_to_id,
        u.name AS assigned_to_name
      FROM assets a
      LEFT JOIN asset_categories c ON c.id = a.category_id
      LEFT JOIN LATERAL (
        SELECT user_id FROM asset_assignments
        WHERE asset_id = a.id AND returned_date IS NULL
        ORDER BY assigned_date DESC LIMIT 1
      ) aa ON true
      LEFT JOIN users u ON u.id = aa.user_id
    `;
    const conditions = [];
    const values = [];
    let i = 1;

    if (category_id) { conditions.push(`a.category_id = $${i++}`); values.push(category_id); }
    if (status) { conditions.push(`a.status = $${i++}`); values.push(status); }
    if (assigned_to) { conditions.push(`aa.user_id = $${i++}`); values.push(assigned_to); }
    if (search) {
      conditions.push(`(a.asset_tag ILIKE $${i} OR a.brand ILIKE $${i} OR a.model ILIKE $${i} OR a.serial_number ILIKE $${i} OR c.name ILIKE $${i} OR u.name ILIKE $${i})`);
      values.push(`%${search}%`);
      i++;
    }

    if (conditions.length > 0) sql += ' WHERE ' + conditions.join(' AND ');
    sql += ' ORDER BY a.created_at DESC';

    const r = await query(sql, values);
    res.json({ assets: r.rows });
  } catch (e) {
    next(e);
  }
});

router.get('/detail/:id', authenticate, async (req, res, next) => {
  try {
    const r = await query(`
      SELECT a.*, c.name AS category_name
      FROM assets a
      LEFT JOIN asset_categories c ON c.id = a.category_id
      WHERE a.id = $1
    `, [req.params.id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Asset not found' });
    res.json({ asset: r.rows[0] });
  } catch (e) {
    next(e);
  }
});

router.post('/', authenticate, requireRole('admin', 'manager', 'team_lead'), async (req, res, next) => {
  try {
    const body = createAssetSchema.parse(req.body);
    const r = await query(
      `INSERT INTO assets (asset_tag, category_id, brand, model, serial_number, purchase_date, purchase_cost, warranty_expiry_date, status, notes, support_phone)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING *`,
      [
        body.asset_tag.trim(),
        body.category_id,
        body.brand.trim(),
        body.model.trim(),
        body.serial_number || null,
        body.purchase_date || null,
        body.purchase_cost ?? null,
        body.warranty_expiry_date || null,
        body.status || 'available',
        body.notes || null,
        body.support_phone || null,
      ]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') {
      const msg = e.constraint?.includes('serial_number') || e.detail?.includes('serial_number')
        ? 'Serial number already exists. Each asset must have a unique serial number.'
        : 'Asset tag already exists';
      return res.status(409).json({ error: msg });
    }
    if (e.name === 'ZodError') return res.status(400).json({ error: e.errors.map(err => err.message).join(', ') });
    next(e);
  }
});

router.patch('/:id', authenticate, requireRole('admin', 'manager', 'team_lead'), async (req, res, next) => {
  try {
    const body = updateAssetSchema.parse(req.body);
    const updates = [];
    const values = [];
    let i = 1;
    const fields = ['asset_tag', 'category_id', 'brand', 'model', 'serial_number', 'purchase_date', 'purchase_cost', 'warranty_expiry_date', 'status', 'notes', 'support_phone'];
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
      `UPDATE assets SET ${updates.join(', ')} WHERE id = $${i} RETURNING *`,
      values
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Asset not found' });
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '23505') {
      const msg = e.constraint?.includes('serial_number') || e.detail?.includes('serial_number')
        ? 'Serial number already exists. Each asset must have a unique serial number.'
        : 'Asset tag already exists';
      return res.status(409).json({ error: msg });
    }
    if (e.name === 'ZodError') return res.status(400).json({ error: e.errors.map(err => err.message).join(', ') });
    next(e);
  }
});

router.delete('/:id', authenticate, requireRole('admin', 'manager', 'team_lead'), async (req, res, next) => {
  try {
    // Soft-delete by setting status to retired
    const r = await query(
      `UPDATE assets SET status = 'retired', updated_at = now() WHERE id = $1 RETURNING id`,
      [req.params.id]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'Asset not found' });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ── Assign / Unassign ───────────────────────────────────────────

router.post('/:id/assign', authenticate, requireRole('admin', 'manager', 'team_lead'), async (req, res, next) => {
  try {
    const body = assignAssetSchema.parse(req.body);
    const assetId = req.params.id;

    // Check asset exists and is available
    const asset = await query('SELECT id, status FROM assets WHERE id = $1', [assetId]);
    if (asset.rows.length === 0) return res.status(404).json({ error: 'Asset not found' });
    if (asset.rows[0].status === 'assigned') {
      return res.status(400).json({ error: 'Asset is already assigned. Unassign it first.' });
    }
    if (asset.rows[0].status === 'retired') {
      return res.status(400).json({ error: 'Cannot assign a retired asset.' });
    }

    // Create assignment
    const r = await query(
      `INSERT INTO asset_assignments (asset_id, user_id, assigned_date, assigned_by, notes)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [assetId, body.user_id, body.assigned_date || new Date().toISOString().slice(0, 10), req.user.sub, body.notes || null]
    );

    // Update asset status
    await query(`UPDATE assets SET status = 'assigned', updated_at = now() WHERE id = $1`, [assetId]);

    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.name === 'ZodError') return res.status(400).json({ error: e.errors.map(err => err.message).join(', ') });
    next(e);
  }
});

router.post('/:id/unassign', authenticate, requireRole('admin', 'manager', 'team_lead'), async (req, res, next) => {
  try {
    const assetId = req.params.id;

    // Close the current assignment
    const r = await query(
      `UPDATE asset_assignments SET returned_date = CURRENT_DATE
       WHERE asset_id = $1 AND returned_date IS NULL
       RETURNING *`,
      [assetId]
    );
    if (r.rows.length === 0) return res.status(400).json({ error: 'Asset is not currently assigned' });

    // Update asset status
    await query(`UPDATE assets SET status = 'available', updated_at = now() WHERE id = $1`, [assetId]);

    res.json({ ok: true, assignment: r.rows[0] });
  } catch (e) {
    next(e);
  }
});

// ── Assignments history ─────────────────────────────────────────

router.get('/assignments', authenticate, async (req, res, next) => {
  try {
    const { asset_id } = req.query;
    let sql = `
      SELECT aa.*,
        a.asset_tag, a.brand, a.model,
        u.name AS user_name, u.email AS user_email,
        ab.name AS assigned_by_name
      FROM asset_assignments aa
      JOIN assets a ON a.id = aa.asset_id
      JOIN users u ON u.id = aa.user_id
      LEFT JOIN users ab ON ab.id = aa.assigned_by
    `;
    const values = [];
    if (asset_id) {
      sql += ' WHERE aa.asset_id = $1';
      values.push(asset_id);
    }
    sql += ' ORDER BY aa.assigned_date DESC, aa.created_at DESC';
    const r = await query(sql, values);
    res.json({ assignments: r.rows });
  } catch (e) {
    next(e);
  }
});

// ── Employee-centric asset view ──────────────────────────────────

router.get('/by-employee', authenticate, async (req, res, next) => {
  try {
    const r = await query(`
      SELECT
        u.id AS user_id, u.name AS employee_name,
        a.id AS asset_id, a.brand, a.model, a.serial_number, a.purchase_date, a.purchase_cost,
        a.warranty_expiry_date, a.status AS asset_status,
        c.name AS category_name,
        aa.assigned_date
      FROM asset_assignments aa
      JOIN assets a ON a.id = aa.asset_id
      JOIN users u ON u.id = aa.user_id
      LEFT JOIN asset_categories c ON c.id = a.category_id
      WHERE aa.returned_date IS NULL AND a.status != 'retired'
      ORDER BY u.name, c.name, a.brand
    `);

    // Group by employee
    const byEmployee = {};
    for (const row of r.rows) {
      if (!byEmployee[row.user_id]) {
        byEmployee[row.user_id] = {
          user_id: row.user_id,
          employee_name: row.employee_name,
          assets: [],
          total_cost: 0,
        };
      }
      const cost = parseFloat(row.purchase_cost) || 0;
      // Depreciation: 25% per year from purchase_date
      let depreciationPct = 0;
      let currentValue = cost;
      if (row.purchase_date && cost > 0) {
        const purchaseDate = new Date(row.purchase_date);
        const now = new Date();
        const yearsOwned = (now - purchaseDate) / (365.25 * 24 * 60 * 60 * 1000);
        depreciationPct = Math.min(100, Math.round(yearsOwned * 25));
        currentValue = Math.max(0, cost * (1 - depreciationPct / 100));
      }

      byEmployee[row.user_id].assets.push({
        asset_id: row.asset_id,
        category: row.category_name,
        brand: row.brand,
        model: row.model,
        serial_number: row.serial_number,
        purchase_date: row.purchase_date,
        purchase_cost: cost,
        current_value: Math.round(currentValue * 100) / 100,
        depreciation_pct: depreciationPct,
        warranty_expiry_date: row.warranty_expiry_date,
        assigned_date: row.assigned_date,
        needs_replacement: depreciationPct >= 100,
      });
      byEmployee[row.user_id].total_cost += cost;
    }

    res.json({ employees: Object.values(byEmployee) });
  } catch (e) {
    next(e);
  }
});

// ── Auto-generate asset tag ─────────────────────────────────────

router.get('/next-tag/:prefix', authenticate, async (req, res, next) => {
  try {
    const prefix = req.params.prefix.toUpperCase();
    const r = await query(
      `SELECT asset_tag FROM assets WHERE asset_tag LIKE $1 ORDER BY asset_tag DESC LIMIT 1`,
      [`${prefix}-%`]
    );
    let nextNum = 1;
    if (r.rows.length > 0) {
      const last = r.rows[0].asset_tag;
      const parts = last.split('-');
      const num = parseInt(parts[parts.length - 1], 10);
      if (!isNaN(num)) nextNum = num + 1;
    }
    res.json({ tag: `${prefix}-${String(nextNum).padStart(3, '0')}` });
  } catch (e) {
    next(e);
  }
});

// ── Bulk CSV upload ─────────────────────────────────────────────

router.post('/bulk-csv', authenticate, requireRole('admin', 'manager', 'team_lead'), async (req, res, next) => {
  try {
    const { rows: csvRows } = req.body;
    if (!Array.isArray(csvRows) || csvRows.length === 0) {
      return res.status(400).json({ error: 'No rows provided' });
    }
    const results = { created: 0, errors: [] };

    for (let i = 0; i < csvRows.length; i++) {
      const row = csvRows[i];
      try {
        // Ensure category exists (create if not)
        let categoryId = null;
        if (row.category) {
          const catName = row.category.trim();
          const existing = await query('SELECT id FROM asset_categories WHERE LOWER(name) = LOWER($1)', [catName]);
          if (existing.rows.length > 0) {
            categoryId = existing.rows[0].id;
          } else {
            const newCat = await query('INSERT INTO asset_categories (name) VALUES ($1) RETURNING id', [catName]);
            categoryId = newCat.rows[0].id;
          }
        }

        if (!row.asset_tag || !row.brand || !row.model || !categoryId) {
          results.errors.push({ row: i + 1, error: 'Missing required fields: asset_tag, category, brand, model' });
          continue;
        }

        await query(
          `INSERT INTO assets (asset_tag, category_id, brand, model, serial_number, purchase_date, purchase_cost, warranty_expiry_date, status, notes, support_phone)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            row.asset_tag.trim(),
            categoryId,
            row.brand.trim(),
            row.model.trim(),
            row.serial_number || null,
            row.purchase_date && /^\d{4}-\d{2}-\d{2}$/.test(row.purchase_date) ? row.purchase_date : null,
            row.purchase_cost ? parseFloat(row.purchase_cost) || null : null,
            row.warranty_expiry_date && /^\d{4}-\d{2}-\d{2}$/.test(row.warranty_expiry_date) ? row.warranty_expiry_date : null,
            row.status && ['available', 'assigned', 'under_repair', 'retired'].includes(row.status.toLowerCase()) ? row.status.toLowerCase() : 'available',
            row.notes || null,
            row.support_phone || null,
          ]
        );
        results.created++;
      } catch (e) {
        const msg = e.code === '23505' ? 'Duplicate asset tag' : e.message;
        results.errors.push({ row: i + 1, error: msg });
      }
    }
    res.json(results);
  } catch (e) {
    next(e);
  }
});

export default router;
