import { Router } from 'express';
import { z } from 'zod';
import { authenticate } from '../middleware/auth.js';
import { query } from '../lib/db.js';

const router = Router();

// ── Ensure table exists on first import ──────────────────────────
let _tableReady = false;

async function ensureTable() {
  if (_tableReady) return;
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS ideas (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id),
        title VARCHAR(255) NOT NULL,
        content TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'idea',
        priority VARCHAR(10) DEFAULT 'normal',
        tags TEXT[],
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_ideas_user ON ideas(user_id);
      CREATE INDEX IF NOT EXISTS idx_ideas_status ON ideas(status);
    `);
    // Seed Shree's inverter analysis idea if ideas table is empty
    try {
      const count = await query('SELECT COUNT(*) AS c FROM ideas');
      if (parseInt(count.rows[0].c, 10) === 0) {
        const shree = await query(`SELECT id FROM users WHERE name ILIKE '%shree%' AND role = 'admin' LIMIT 1`);
        if (shree.rows.length > 0) {
          await query(
            `INSERT INTO ideas (user_id, title, content, status, priority, tags)
             VALUES ($1, $2, $3, 'idea', 'high', $4)`,
            [
              shree.rows[0].id,
              'Inverter Performance Analysis Across Sites',
              `Using the equipment data from the solar sites we monitor, we can analyze which inverters (same make/model) perform better in different regions based on weather conditions, irradiance levels, and local climate patterns.\n\nThe idea is to build a comparative analysis dashboard that shows:\n- Side-by-side performance of identical inverters across different sites\n- Weather correlation data (temperature, humidity, cloud cover) vs output\n- Degradation patterns by region\n- Seasonal performance trends\n\nThis analysis becomes a powerful sales tool. When we pitch to new clients in initial calls, we can show them real data: "These inverters perform X% better in your region because of Y weather pattern." This adds huge value to our monitoring service and differentiates us from competitors who just do basic monitoring.\n\nWe already have the data from our monitoring equipment — we just need to aggregate and present it smartly.`,
              ['solar', 'analytics', 'sales', 'inverters'],
            ]
          );
          console.log('Seeded Shree\'s inverter analysis idea');
        }
      }
    } catch { /* seed is optional */ }

    _tableReady = true;
  } catch (e) {
    console.error('Failed to create ideas table:', e.message);
  }
}

router.use(async (_req, _res, next) => {
  await ensureTable();
  next();
});

// ── Validation schemas ──────────────────────────────────────────

const STATUS_VALUES = ['idea', 'in_progress', 'implemented', 'archived'];
const PRIORITY_VALUES = ['low', 'normal', 'high'];

const createSchema = z.object({
  title: z.string().min(1).max(255),
  content: z.string().max(10000).optional().nullable(),
  priority: z.enum(PRIORITY_VALUES).optional(),
  tags: z.array(z.string().max(50)).max(20).optional().nullable(),
});

const updateSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  content: z.string().max(10000).optional().nullable(),
  status: z.enum(STATUS_VALUES).optional(),
  priority: z.enum(PRIORITY_VALUES).optional(),
  tags: z.array(z.string().max(50)).max(20).optional().nullable(),
});

// ── GET /api/ideas — list all ideas (visible to everyone) ───────

router.get('/', authenticate, async (req, res) => {
  try {
    const { status, mine } = req.query;
    const params = [];
    let where = 'WHERE 1=1';

    if (mine === 'true') {
      params.push(req.user.sub);
      where += ` AND i.user_id = $${params.length}`;
    }

    if (status && STATUS_VALUES.includes(status)) {
      params.push(status);
      where += ` AND i.status = $${params.length}`;
    }

    const sql = `SELECT i.*, u.name AS author_name, u.role AS author_role
                 FROM ideas i
                 JOIN users u ON u.id = i.user_id
                 ${where}
                 ORDER BY i.updated_at DESC`;

    const result = await query(sql, params);
    res.json({ ideas: result.rows });
  } catch (e) {
    console.error('GET /api/ideas error:', e.message);
    res.status(500).json({ error: 'Failed to fetch ideas' });
  }
});

// ── POST /api/ideas — create a new idea ─────────────────────────

router.post('/', authenticate, async (req, res) => {
  try {
    const data = createSchema.parse(req.body);
    const userId = req.user.sub;

    const result = await query(
      `INSERT INTO ideas (user_id, title, content, priority, tags)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [userId, data.title, data.content || null, data.priority || 'normal', data.tags || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return res.status(400).json({ error: e.errors[0].message });
    }
    console.error('POST /api/ideas error:', e.message);
    res.status(500).json({ error: 'Failed to create idea' });
  }
});

// ── PATCH /api/ideas/:id — update an idea (owner only) ──────────

router.patch('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.sub;

    // Check ownership
    const existing = await query('SELECT * FROM ideas WHERE id = $1', [id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Idea not found' });
    if (existing.rows[0].user_id !== userId) return res.status(403).json({ error: 'Not authorized' });

    const data = updateSchema.parse(req.body);
    const fields = [];
    const params = [];
    let idx = 1;

    for (const [key, val] of Object.entries(data)) {
      if (val !== undefined) {
        fields.push(`${key} = $${idx}`);
        params.push(val);
        idx++;
      }
    }

    if (!fields.length) return res.json(existing.rows[0]);

    fields.push(`updated_at = NOW()`);
    params.push(id);

    const sql = `UPDATE ideas SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`;
    const result = await query(sql, params);
    res.json(result.rows[0]);
  } catch (e) {
    if (e instanceof z.ZodError) {
      return res.status(400).json({ error: e.errors[0].message });
    }
    console.error('PATCH /api/ideas error:', e.message);
    res.status(500).json({ error: 'Failed to update idea' });
  }
});

// ── DELETE /api/ideas/:id — delete an idea (owner only) ─────────

router.delete('/:id', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.sub;

    const existing = await query('SELECT * FROM ideas WHERE id = $1', [id]);
    if (!existing.rows.length) return res.status(404).json({ error: 'Idea not found' });
    if (existing.rows[0].user_id !== userId) return res.status(403).json({ error: 'Not authorized' });

    await query('DELETE FROM ideas WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (e) {
    console.error('DELETE /api/ideas error:', e.message);
    res.status(500).json({ error: 'Failed to delete idea' });
  }
});

export default router;
