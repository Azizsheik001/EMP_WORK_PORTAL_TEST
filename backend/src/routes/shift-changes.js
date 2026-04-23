import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import { query } from '../lib/db.js';

const router = Router();

// ---------- Helpers ----------
const PENDING_STATUSES = ['pending_team_lead', 'pending_managers', 'pending_ceo'];

const approvalPayload = (req) => ({
  role: req.user.role,
  user_id: req.user.sub,
  user_name: req.user.name,
  at: new Date().toISOString(),
});

// Ensure the table exists (idempotent) + migrate statuses
let migrated = false;
const migrate = async () => {
  if (migrated) return;
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS shift_change_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id),
        request_date DATE NOT NULL,
        original_start_time VARCHAR(10),
        original_end_time VARCHAR(10),
        requested_start_time VARCHAR(10) NOT NULL,
        requested_end_time VARCHAR(10) NOT NULL,
        reason TEXT,
        status VARCHAR(30) NOT NULL DEFAULT 'pending_team_lead',
        approval_chain JSONB DEFAULT '[]',
        rejected_by UUID,
        rejected_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
  } catch (e) {
    if (e.code !== '42P07') console.warn('shift_change_requests table creation skipped:', e.message);
  }
  // Migrate old 'pending' status rows to 'pending_team_lead'
  try {
    await query(`UPDATE shift_change_requests SET status = 'pending_team_lead' WHERE status = 'pending'`);
  } catch (e) { /* ignore */ }
  migrated = true;
};

const createSchema = z.object({
  request_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  requested_start_time: z.string().regex(/^\d{2}:\d{2}$/),
  requested_end_time: z.string().regex(/^\d{2}:\d{2}$/),
  reason: z.string().max(500).optional(),
});

// POST /api/shift-changes - Create a shift change request
router.post('/', authenticate, async (req, res, next) => {
  try {
    await migrate();
    const body = createSchema.parse(req.body);
    const userId = req.user.sub;

    // Look up original shift times from shift_assignments
    let originalStart = null;
    let originalEnd = null;
    try {
      const shiftResult = await query(
        `SELECT shift_start_time, shift_end_time FROM shift_assignments
         WHERE user_id = $1 AND shift_date = $2
         ORDER BY updated_at DESC LIMIT 1`,
        [userId, body.request_date]
      );
      if (shiftResult.rowCount > 0) {
        originalStart = shiftResult.rows[0].shift_start_time;
        originalEnd = shiftResult.rows[0].shift_end_time;
      }
    } catch (e) {
      // shift_assignments may not have data
    }

    // Check requester's role and team lead assignment
    const empResult = await query(`SELECT team_lead_id, role FROM users WHERE id = $1`, [userId]);
    const hasTeamLead = empResult.rows[0]?.team_lead_id != null;
    const requesterRole = empResult.rows[0]?.role;

    // Manager requests go directly to CEO (admin) — skip TL and co-managers
    // Team lead requests go directly to managers (they ARE team leads, skip TL stage)
    let initialStatus;
    if (requesterRole === 'manager') {
      initialStatus = 'pending_ceo';
    } else if (requesterRole === 'team_lead') {
      initialStatus = 'pending_managers';
    } else if (hasTeamLead) {
      initialStatus = 'pending_team_lead';
    } else {
      initialStatus = 'pending_managers';
    }

    const r = await query(
      `INSERT INTO shift_change_requests
         (user_id, request_date, original_start_time, original_end_time, requested_start_time, requested_end_time, reason, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [userId, body.request_date, originalStart, originalEnd, body.requested_start_time, body.requested_end_time, body.reason || null, initialStatus]
    );
    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.name === 'ZodError') return res.status(400).json({ error: e.errors.map(err => err.message).join(', ') });
    next(e);
  }
});

// GET /api/shift-changes - List shift change requests
// Employees: their own; TL: own + pending_team_lead for reports; Manager: own + pending_managers; Admin: all
router.get('/', authenticate, async (req, res, next) => {
  try {
    await migrate();
    const userId = req.user.sub;
    const role = req.user.role;
    let r;

    if (role === 'employee') {
      r = await query(
        `SELECT scr.*, u.name AS user_name
         FROM shift_change_requests scr
         JOIN users u ON u.id = scr.user_id
         WHERE scr.user_id = $1
         ORDER BY scr.created_at DESC`,
        [userId]
      );
    } else if (role === 'team_lead') {
      // Own requests + pending_team_lead where they are the employee's team_lead
      r = await query(
        `SELECT scr.*, u.name AS user_name
         FROM shift_change_requests scr
         JOIN users u ON u.id = scr.user_id
         WHERE scr.user_id = $1
            OR (scr.status = 'pending_team_lead' AND u.team_lead_id = $1)
         ORDER BY scr.created_at DESC`,
        [userId]
      );
    } else if (role === 'manager') {
      // Own requests + pending_managers (where they haven't already approved)
      r = await query(
        `SELECT scr.*, u.name AS user_name
         FROM shift_change_requests scr
         JOIN users u ON u.id = scr.user_id
         WHERE scr.user_id = $1
            OR (scr.status = 'pending_managers'
                AND NOT EXISTS (
                  SELECT 1 FROM jsonb_array_elements(COALESCE(scr.approval_chain, '[]'::jsonb)) AS elem
                  WHERE elem->>'user_id' = $1::text
                ))
         ORDER BY scr.created_at DESC`,
        [userId]
      );
    } else {
      // admin: sees everything (all statuses)
      r = await query(
        `SELECT scr.*, u.name AS user_name
         FROM shift_change_requests scr
         JOIN users u ON u.id = scr.user_id
         ORDER BY scr.created_at DESC`
      );
    }
    // For approvers, also return ALL shift change requests (for context/pretext)
    let allRows = [];
    if (role !== 'employee') {
      try {
        const allResult = await query(
          `SELECT scr.*, u.name AS user_name
           FROM shift_change_requests scr
           JOIN users u ON u.id = scr.user_id
           ORDER BY scr.created_at DESC`
        );
        allRows = allResult.rows;
      } catch (_e) { /* ignore */ }
    }

    res.json({ shift_change_requests: r.rows, all_shift_change_requests: allRows });
  } catch (e) {
    next(e);
  }
});

// PATCH /api/shift-changes/:id/approve
// Same approval chain as leaves: TL -> ONE manager -> approved. Admin can override at any stage.
router.patch('/:id/approve', authenticate, requireRole('team_lead', 'manager', 'admin'), async (req, res, next) => {
  try {
    await migrate();
    const id = req.params.id;
    const role = req.user.role;
    const userId = req.user.sub;

    const scrResult = await query(
      `SELECT scr.*, u.team_lead_id
       FROM shift_change_requests scr
       JOIN users u ON u.id = scr.user_id
       WHERE scr.id = $1`,
      [id]
    );
    if (scrResult.rowCount === 0) return res.status(404).json({ error: 'Shift change request not found' });

    const scr = scrResult.rows[0];
    const existingChain = Array.isArray(scr.approval_chain) ? scr.approval_chain : [];

    // ---- Admin override approval (can approve at any pending stage) ----
    if (role === 'admin') {
      if (!PENDING_STATUSES.includes(scr.status)) {
        return res.status(400).json({ error: 'Request is not in a pending status' });
      }
      const newEntry = approvalPayload(req);
      const updatedChain = [...existingChain, newEntry];
      await query(
        `UPDATE shift_change_requests SET status = 'approved', approval_chain = $1::jsonb, updated_at = now()
         WHERE id = $2`,
        [JSON.stringify(updatedChain), id]
      );
      // Update the actual shift assignment
      await query(
        `UPDATE shift_assignments
         SET shift_start_time = $1, shift_end_time = $2, updated_at = now()
         WHERE user_id = $3 AND shift_date = $4`,
        [scr.requested_start_time, scr.requested_end_time, scr.user_id, scr.request_date]
      );
      return res.json({ ok: true, status: 'approved' });
    }

    // ---- Team lead approval ----
    if (role === 'team_lead') {
      if (scr.status !== 'pending_team_lead') {
        return res.status(400).json({ error: 'Request is not at team lead approval stage' });
      }
      if (scr.team_lead_id !== userId) {
        return res.status(403).json({ error: "You are not this employee's team lead" });
      }
      if (existingChain.some((entry) => entry.user_id === userId)) {
        return res.status(400).json({ error: 'You have already approved this request' });
      }
      const newEntry = approvalPayload(req);
      const updatedChain = [...existingChain, newEntry];
      // After TL approval -> move to pending_managers
      await query(
        `UPDATE shift_change_requests SET status = 'pending_managers', approval_chain = $1::jsonb, updated_at = now()
         WHERE id = $2`,
        [JSON.stringify(updatedChain), id]
      );
      return res.json({ ok: true, status: 'pending_managers' });
    }

    // ---- Manager approval ----
    if (role === 'manager') {
      if (scr.status !== 'pending_managers') {
        return res.status(400).json({ error: 'Request is not at manager approval stage' });
      }
      if (existingChain.some((entry) => entry.user_id === userId)) {
        return res.status(400).json({ error: 'You have already approved this request' });
      }
      const newEntry = approvalPayload(req);
      const updatedChain = [...existingChain, newEntry];
      // Any ONE manager approval is sufficient — auto-approve
      await query(
        `UPDATE shift_change_requests SET status = 'approved', approval_chain = $1::jsonb, updated_at = now()
         WHERE id = $2`,
        [JSON.stringify(updatedChain), id]
      );
      // Update the actual shift assignment
      await query(
        `UPDATE shift_assignments
         SET shift_start_time = $1, shift_end_time = $2, updated_at = now()
         WHERE user_id = $3 AND shift_date = $4`,
        [scr.requested_start_time, scr.requested_end_time, scr.user_id, scr.request_date]
      );
      return res.json({ ok: true, status: 'approved' });
    }

    return res.status(403).json({ error: 'Unauthorized' });
  } catch (e) {
    next(e);
  }
});

// PATCH /api/shift-changes/:id/reject
router.patch('/:id/reject', authenticate, requireRole('team_lead', 'manager', 'admin'), async (req, res, next) => {
  try {
    await migrate();
    const id = req.params.id;
    const role = req.user.role;
    const userId = req.user.sub;

    const scrResult = await query(
      `SELECT scr.*, u.team_lead_id
       FROM shift_change_requests scr
       JOIN users u ON u.id = scr.user_id
       WHERE scr.id = $1`,
      [id]
    );
    if (scrResult.rowCount === 0) return res.status(404).json({ error: 'Shift change request not found' });

    const scr = scrResult.rows[0];

    // Must be in a pending status
    if (!PENDING_STATUSES.includes(scr.status)) {
      return res.status(400).json({ error: 'Request is not in a pending status' });
    }

    // Team lead can only reject at pending_team_lead stage and must be assigned TL
    if (role === 'team_lead') {
      if (scr.status !== 'pending_team_lead') {
        return res.status(400).json({ error: 'Request is not at team lead stage' });
      }
      if (scr.team_lead_id !== userId) {
        return res.status(403).json({ error: "You are not this employee's team lead" });
      }
    }

    // Manager can only reject at pending_managers stage
    if (role === 'manager') {
      if (scr.status !== 'pending_managers') {
        return res.status(400).json({ error: 'Request is not at manager approval stage' });
      }
    }

    // Admin can reject at any pending stage (override)

    await query(
      `UPDATE shift_change_requests SET status = 'rejected', rejected_by = $1, rejected_at = now(), updated_at = now()
       WHERE id = $2`,
      [userId, id]
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
