import { Router } from 'express';
import { z } from 'zod';
import multer from 'multer';
import { authenticate } from '../middleware/auth.js';
import { query } from '../lib/db.js';
import { uploadAttachment, getSignedUrl, removeAttachment, storageConfigured } from '../lib/storage.js';

const router = Router();

// Multer: keep files in memory, 20 MB cap each.
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

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

      CREATE TABLE IF NOT EXISTS idea_attachments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        idea_id UUID NOT NULL REFERENCES ideas(id) ON DELETE CASCADE,
        user_id UUID NOT NULL REFERENCES users(id),
        file_name VARCHAR(512) NOT NULL,
        file_size BIGINT NOT NULL,
        mime_type VARCHAR(255),
        bucket VARCHAR(255) NOT NULL,
        storage_path TEXT NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_idea_attachments_idea ON idea_attachments(idea_id);
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

    // Best-effort: remove any attached files from the bucket before deleting the idea.
    try {
      const atts = await query('SELECT storage_path FROM idea_attachments WHERE idea_id = $1', [id]);
      if (atts.rows.length > 0 && storageConfigured()) {
        for (const row of atts.rows) {
          try { await removeAttachment(row.storage_path); } catch (_e) { /* ignore */ }
        }
      }
    } catch (_e) { /* table may not exist yet */ }

    await query('DELETE FROM ideas WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (e) {
    console.error('DELETE /api/ideas error:', e.message);
    res.status(500).json({ error: 'Failed to delete idea' });
  }
});

// ── Attachment endpoints ─────────────────────────────────────────

// GET /api/ideas/:id/attachments — list attachments for an idea
router.get('/:id/attachments', authenticate, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await query(
      `SELECT a.id, a.idea_id, a.user_id, a.file_name, a.file_size, a.mime_type, a.created_at,
              u.name AS uploader_name
       FROM idea_attachments a
       LEFT JOIN users u ON u.id = a.user_id
       WHERE a.idea_id = $1
       ORDER BY a.created_at ASC`,
      [id]
    );
    res.json({ attachments: result.rows });
  } catch (e) {
    console.error('GET attachments error:', e.message);
    res.status(500).json({ error: 'Failed to fetch attachments' });
  }
});

// POST /api/ideas/:id/attachments — upload a file (multipart/form-data, field: "file")
// Owner-only: only the author of the idea may attach files.
router.post('/:id/attachments', authenticate, upload.single('file'), async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.sub;
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

    const idea = await query('SELECT id, user_id FROM ideas WHERE id = $1', [id]);
    if (!idea.rows.length) return res.status(404).json({ error: 'Idea not found' });
    if (idea.rows[0].user_id !== userId) {
      return res.status(403).json({ error: 'Only the author of this idea can attach files.' });
    }

    if (!storageConfigured()) {
      return res.status(503).json({
        error: 'Attachments unavailable: set SUPABASE_SERVICE_ROLE_KEY in backend/.env to enable uploads.',
      });
    }

    const safeName = req.file.originalname.replace(/[^\w.\-]+/g, '_').slice(0, 200);
    const pathKey = `${id}/${Date.now()}_${safeName}`;
    const { bucket, path } = await uploadAttachment({
      pathKey,
      buffer: req.file.buffer,
      contentType: req.file.mimetype,
    });

    const insert = await query(
      `INSERT INTO idea_attachments (idea_id, user_id, file_name, file_size, mime_type, bucket, storage_path)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, idea_id, user_id, file_name, file_size, mime_type, created_at`,
      [id, userId, req.file.originalname, req.file.size, req.file.mimetype || null, bucket, path]
    );

    res.status(201).json(insert.rows[0]);
  } catch (e) {
    console.error('POST attachment error:', e.message);
    res.status(500).json({ error: e.message || 'Failed to upload attachment' });
  }
});

// GET /api/ideas/attachments/:attachmentId/url — get a signed download URL
router.get('/attachments/:attachmentId/url', authenticate, async (req, res) => {
  try {
    const { attachmentId } = req.params;
    const result = await query('SELECT storage_path FROM idea_attachments WHERE id = $1', [attachmentId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Attachment not found' });

    if (!storageConfigured()) {
      return res.status(503).json({ error: 'Storage not configured' });
    }
    const url = await getSignedUrl(result.rows[0].storage_path);
    res.json({ url });
  } catch (e) {
    console.error('GET attachment URL error:', e.message);
    res.status(500).json({ error: 'Failed to generate URL' });
  }
});

// DELETE /api/ideas/attachments/:attachmentId — delete (owner of attachment OR owner of idea)
router.delete('/attachments/:attachmentId', authenticate, async (req, res) => {
  try {
    const { attachmentId } = req.params;
    const userId = req.user.sub;

    const result = await query(
      `SELECT a.*, i.user_id AS idea_owner
       FROM idea_attachments a
       JOIN ideas i ON i.id = a.idea_id
       WHERE a.id = $1`,
      [attachmentId]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Attachment not found' });

    const row = result.rows[0];
    if (row.user_id !== userId && row.idea_owner !== userId) {
      return res.status(403).json({ error: 'Not authorized' });
    }

    if (storageConfigured()) {
      try { await removeAttachment(row.storage_path); } catch (_e) { /* ignore bucket-level errors */ }
    }
    await query('DELETE FROM idea_attachments WHERE id = $1', [attachmentId]);
    res.json({ success: true });
  } catch (e) {
    console.error('DELETE attachment error:', e.message);
    res.status(500).json({ error: 'Failed to delete attachment' });
  }
});

export default router;
