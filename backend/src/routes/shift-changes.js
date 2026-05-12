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

const seenPayload = (req) => ({
  role: req.user.role,
  user_id: req.user.sub,
  user_name: req.user.name,
  at: new Date().toISOString(),
});

const normalizeApprovalChain = (value) => {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

const normalizeSeenBy = (value) => {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

// Ensure the table exists (idempotent) + migrate statuses
let migrated = false;
const migrate = async () => {
  if (migrated) return;

  try {
    await query(`
      CREATE TABLE IF NOT EXISTS shift_change_requests (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL REFERENCES users(id),
        request_kind VARCHAR(40) NOT NULL DEFAULT 'future_change',
        from_date DATE,
        to_date DATE,
        request_date DATE,
        session VARCHAR(20),
        original_start_time VARCHAR(10),
        original_end_time VARCHAR(10),
        requested_start_time VARCHAR(10) NOT NULL,
        requested_end_time VARCHAR(10) NOT NULL,
        reason TEXT,
        status VARCHAR(30) NOT NULL DEFAULT 'pending_team_lead',
        approval_chain JSONB DEFAULT '[]',
        seen_by JSONB DEFAULT '[]',
        rejected_by UUID,
        rejected_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
  } catch (e) {
    if (e.code !== '42P07') console.warn('shift_change_requests table creation skipped:', e.message);
  }

  try {
    await query(`
      ALTER TABLE shift_change_requests
      ADD COLUMN IF NOT EXISTS request_kind VARCHAR(40) NOT NULL DEFAULT 'future_change'
    `);
  } catch (e) { /* ignore */ }

  try {
    await query(`
      ALTER TABLE shift_change_requests
      ADD COLUMN IF NOT EXISTS from_date DATE
    `);
  } catch (e) { /* ignore */ }

  try {
    await query(`
      ALTER TABLE shift_change_requests
      ADD COLUMN IF NOT EXISTS to_date DATE
    `);
  } catch (e) { /* ignore */ }

  try {
    await query(`
      ALTER TABLE shift_change_requests
      ADD COLUMN IF NOT EXISTS session VARCHAR(20)
    `);
  } catch (e) { /* ignore */ }

  try {
    await query(`
      ALTER TABLE shift_change_requests
      ADD COLUMN IF NOT EXISTS seen_by JSONB DEFAULT '[]'
    `);
  } catch (e) { /* ignore */ }

  // Migrate old 'pending' status rows to 'pending_team_lead'
  try {
    await query(`UPDATE shift_change_requests SET status = 'pending_team_lead' WHERE status = 'pending'`);
  } catch (e) { /* ignore */ }

  try {
    await query(`
      UPDATE shift_change_requests
      SET request_kind = 'future_change'
      WHERE request_kind IS NULL
         OR request_kind NOT IN ('future_change', 'permanent_change', 'past_acknowledgement', 'late_in', 'early_out')
    `);
  } catch (e) { /* ignore */ }

  try {
    await query(`
      UPDATE shift_change_requests
      SET from_date = COALESCE(from_date, request_date),
          to_date = CASE
            WHEN request_kind = 'permanent_change' THEN NULL
            ELSE COALESCE(to_date, request_date)
          END
      WHERE from_date IS NULL
         OR (request_kind <> 'permanent_change' AND to_date IS NULL)
    `);
  } catch (e) { /* ignore */ }

  try {
    await query(`
      UPDATE shift_change_requests
      SET seen_by = '[]'::jsonb
      WHERE seen_by IS NULL
    `);
  } catch (e) { /* ignore */ }

  migrated = true;
};

const createSchema = z.object({
  request_kind: z.enum(['future_change', 'permanent_change', 'past_acknowledgement', 'late_in', 'early_out']).default('future_change'),
  request_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  from_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  to_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  requested_start_time: z.string().regex(/^\d{2}:\d{2}$/),
  requested_end_time: z.string().regex(/^\d{2}:\d{2}$/),
  session: z.enum(['full', 'session_1', 'session_2']).optional(),
  reason: z.string().max(500).optional(),
});

const getOriginalShiftForDate = async (userId, date) => {
  try {
    const shiftResult = await query(
      `SELECT shift_start_time, shift_end_time
       FROM shift_assignments
       WHERE user_id = $1 AND shift_date = $2
       ORDER BY updated_at DESC
       LIMIT 1`,
      [userId, date]
    );

    if (shiftResult.rowCount > 0) {
      return {
        originalStart: shiftResult.rows[0].shift_start_time,
        originalEnd: shiftResult.rows[0].shift_end_time,
      };
    }
  } catch (e) {
    // shift_assignments may not have data
  }

  return { originalStart: null, originalEnd: null };
};

const applyApprovedShiftChange = async (scr) => {
  if (scr.request_kind === 'past_acknowledgement') return;

  if (['future_change', 'late_in', 'early_out'].includes(scr.request_kind)) {
    await query(
      `UPDATE shift_assignments
       SET shift_start_time = $1,
           shift_end_time = $2,
           updated_at = now()
       WHERE user_id = $3
         AND shift_date >= $4
         AND shift_date <= $5`,
      [
        scr.requested_start_time,
        scr.requested_end_time,
        scr.user_id,
        scr.from_date || scr.request_date,
        scr.to_date || scr.from_date || scr.request_date,
      ]
    );
    return;
  }

  if (scr.request_kind === 'permanent_change') {
    await query(
      `UPDATE shift_assignments
       SET shift_start_time = $1,
           shift_end_time = $2,
           updated_at = now()
       WHERE user_id = $3
         AND shift_date >= $4`,
      [
        scr.requested_start_time,
        scr.requested_end_time,
        scr.user_id,
        scr.from_date || scr.request_date,
      ]
    );
    return;
  }

  // Backward compatibility for old rows without request_kind
  await query(
    `UPDATE shift_assignments
     SET shift_start_time = $1,
         shift_end_time = $2,
         updated_at = now()
     WHERE user_id = $3
       AND shift_date = $4`,
    [scr.requested_start_time, scr.requested_end_time, scr.user_id, scr.request_date]
  );
};

// POST /api/shift-changes - Create a shift change request
router.post('/', authenticate, async (req, res, next) => {
  try {
    await migrate();

    const body = createSchema.parse(req.body);
    const userId = req.user.sub;
    const today = new Date().toISOString().slice(0, 10);

    const requestKind = body.request_kind || 'future_change';
    const fromDate = body.from_date || body.request_date;
    const toDate = body.to_date;

    if (!fromDate) {
      return res.status(400).json({ error: 'From date or request date is required.' });
    }

    if (body.requested_start_time === body.requested_end_time) {
      return res.status(400).json({
        error: 'Requested start time and end time cannot be the same.',
      });
    }

    if (['future_change', 'late_in', 'early_out'].includes(requestKind)) {
      if (!toDate) {
        return res.status(400).json({ error: 'To date is required for this shift request.' });
      }
      if (fromDate < today) {
        return res.status(400).json({ error: 'This shift request cannot start in the past.' });
      }
      if (toDate < fromDate) {
        return res.status(400).json({ error: 'To date must be on or after From date.' });
      }
    }

    if (requestKind === 'permanent_change') {
      if (fromDate < today) {
        return res.status(400).json({ error: 'Permanent shift change must start today or later.' });
      }
    }

    if (requestKind === 'past_acknowledgement') {
      if (!toDate) {
        return res.status(400).json({ error: 'To date is required for past acknowledgement.' });
      }
      if (fromDate > today || toDate > today) {
        return res.status(400).json({ error: 'Past acknowledgement cannot include future dates.' });
      }
      if (toDate < fromDate) {
        return res.status(400).json({ error: 'To date must be on or after From date.' });
      }
    }

    const { originalStart, originalEnd } = await getOriginalShiftForDate(userId, fromDate);

    // Check requester's role and team lead assignment
    const empResult = await query(`SELECT team_lead_id, role FROM users WHERE id = $1`, [userId]);
    const hasTeamLead = empResult.rows[0]?.team_lead_id != null;
    const requesterRole = empResult.rows[0]?.role;

    // Manager requests go directly to CEO (admin) — skip TL and co-managers
    // Team lead requests go directly to managers (they ARE team leads, skip TL stage)
    let initialStatus;
    if (requestKind === 'past_acknowledgement') {
      initialStatus = 'acknowledged';
    } else if (requesterRole === 'manager') {
      initialStatus = 'pending_ceo';
    } else if (requesterRole === 'team_lead') {
      initialStatus = 'pending_managers';
    } else if (hasTeamLead) {
      initialStatus = 'pending_team_lead';
    } else {
      initialStatus = 'pending_managers';
    }

    const finalToDate = requestKind === 'permanent_change' ? null : (toDate || fromDate);

    const r = await query(
      `INSERT INTO shift_change_requests
         (
          user_id,
          request_kind,
          from_date,
          to_date,
          request_date,
          session,
          original_start_time,
          original_end_time,
          requested_start_time,
          requested_end_time,
          reason,
          status,
          seen_by
         )
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, '[]'::jsonb)
       RETURNING *`,
      [
        userId,
        requestKind,
        fromDate,
        finalToDate,
        fromDate,
        body.session || null,
        originalStart,
        originalEnd,
        body.requested_start_time,
        body.requested_end_time,
        body.reason || null,
        initialStatus,
      ]
    );

    // Insert notification
    try {
      await query(
        `INSERT INTO notifications (user_id, type, title, message) VALUES ($1, $2, $3, $4)`,
        [
          userId,
          'shift_change',
          requestKind === 'past_acknowledgement'
            ? 'Past Shift Timing Acknowledgement Submitted'
            : requestKind === 'late_in' ? 'Late In Request Submitted'
            : requestKind === 'early_out' ? 'Early Out Request Submitted'
            : 'Shift Change Request Submitted',
          requestKind === 'past_acknowledgement'
            ? `Your past shift timing acknowledgement from ${fromDate} to ${finalToDate} has been submitted.`
            : requestKind === 'late_in' ? `Your late in request from ${fromDate}${finalToDate ? ` to ${finalToDate}` : ''} has been submitted.`
            : requestKind === 'early_out' ? `Your early out request from ${fromDate}${finalToDate ? ` to ${finalToDate}` : ''} has been submitted.`
            : `Your shift change request from ${fromDate}${finalToDate ? ` to ${finalToDate}` : ''} has been submitted.`,
        ]
      );
    } catch (err) {
      console.warn('Failed to insert notification:', err.message);
    }

    res.status(201).json(r.rows[0]);
  } catch (e) {
    if (e.name === 'ZodError') {
      return res.status(400).json({ error: e.errors.map(err => err.message).join(', ') });
    }
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
      // Also show unseen past acknowledgements for their employees
      r = await query(
        `SELECT scr.*, u.name AS user_name
         FROM shift_change_requests scr
         JOIN users u ON u.id = scr.user_id
         WHERE scr.user_id = $1
            OR (scr.status = 'pending_team_lead' AND u.team_lead_id = $1)
            OR (
              scr.request_kind = 'past_acknowledgement'
              AND u.team_lead_id = $1
              AND NOT EXISTS (
                SELECT 1
                FROM jsonb_array_elements(COALESCE(scr.seen_by, '[]'::jsonb)) AS elem
                WHERE elem->>'user_id' = $1::text
              )
            )
         ORDER BY scr.created_at DESC`,
        [userId]
      );
    } else if (role === 'manager') {
      // Own requests + pending_managers where they haven't approved
      // Also show unseen past acknowledgements
      r = await query(
        `SELECT scr.*, u.name AS user_name
         FROM shift_change_requests scr
         JOIN users u ON u.id = scr.user_id
         WHERE scr.user_id = $1
            OR (
              scr.status = 'pending_managers'
              AND NOT EXISTS (
                SELECT 1
                FROM jsonb_array_elements(COALESCE(scr.approval_chain, '[]'::jsonb)) AS elem
                WHERE elem->>'user_id' = $1::text
              )
            )
            OR (
              scr.request_kind = 'past_acknowledgement'
              AND NOT EXISTS (
                SELECT 1
                FROM jsonb_array_elements(COALESCE(scr.seen_by, '[]'::jsonb)) AS elem
                WHERE elem->>'user_id' = $1::text
              )
            )
         ORDER BY scr.created_at DESC`,
        [userId]
      );
    } else {
      // admin: sees everything except already-seen past acknowledgements
      r = await query(
        `SELECT scr.*, u.name AS user_name
         FROM shift_change_requests scr
         JOIN users u ON u.id = scr.user_id
         WHERE scr.request_kind <> 'past_acknowledgement'
            OR NOT EXISTS (
              SELECT 1
              FROM jsonb_array_elements(COALESCE(scr.seen_by, '[]'::jsonb)) AS elem
              WHERE elem->>'user_id' = $1::text
            )
         ORDER BY scr.created_at DESC`,
        [userId]
      );
    }

    // For approvers, also return ALL shift change requests for context/pretext
    // Already-seen past acknowledgements are hidden from each approver.
    let allRows = [];
    if (role !== 'employee') {
      try {
        const allResult = await query(
          `SELECT scr.*, u.name AS user_name
           FROM shift_change_requests scr
           JOIN users u ON u.id = scr.user_id
           WHERE scr.request_kind <> 'past_acknowledgement'
              OR NOT EXISTS (
                SELECT 1
                FROM jsonb_array_elements(COALESCE(scr.seen_by, '[]'::jsonb)) AS elem
                WHERE elem->>'user_id' = $1::text
              )
           ORDER BY scr.created_at DESC`,
          [userId]
        );
        allRows = allResult.rows;
      } catch (_e) { /* ignore */ }
    }

    res.json({ shift_change_requests: r.rows, all_shift_change_requests: allRows });
  } catch (e) {
    next(e);
  }
});

// PATCH /api/shift-changes/:id/acknowledge-notice
// Used mainly for past shift timing acknowledgement dismissal by TL / manager / admin
router.patch('/:id/acknowledge-notice', authenticate, requireRole('team_lead', 'manager', 'admin'), async (req, res, next) => {
  try {
    await migrate();

    const id = req.params.id;
    const userId = req.user.sub;

    const r = await query(
      `SELECT scr.*, u.team_lead_id
       FROM shift_change_requests scr
       JOIN users u ON u.id = scr.user_id
       WHERE scr.id = $1`,
      [id]
    );

    if (r.rowCount === 0) {
      return res.status(404).json({ error: 'Shift change request not found' });
    }

    const scr = r.rows[0];

    if (scr.request_kind !== 'past_acknowledgement') {
      return res.status(400).json({
        error: 'Only past acknowledgement notices can be dismissed this way.',
      });
    }

    const seenBy = normalizeSeenBy(scr.seen_by);

    if (seenBy.some((entry) => entry.user_id === userId)) {
      return res.json({ ok: true, already_seen: true });
    }

    const updatedSeenBy = [...seenBy, seenPayload(req)];

    await query(
      `UPDATE shift_change_requests
       SET seen_by = $1::jsonb,
           updated_at = now()
       WHERE id = $2`,
      [JSON.stringify(updatedSeenBy), id]
    );

    return res.json({ ok: true });
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

    if (scrResult.rowCount === 0) {
      return res.status(404).json({ error: 'Shift change request not found' });
    }

    const scr = scrResult.rows[0];
    const existingChain = normalizeApprovalChain(scr.approval_chain);

    if (scr.request_kind === 'past_acknowledgement') {
      return res.status(400).json({
        error: 'Past acknowledgements are informational only and do not require approval.',
      });
    }

    // ---- Admin override approval (can approve at any pending stage) ----
    if (role === 'admin') {
      if (!PENDING_STATUSES.includes(scr.status)) {
        return res.status(400).json({ error: 'Request is not in a pending status' });
      }

      const newEntry = approvalPayload(req);
      const updatedChain = [...existingChain, newEntry];

      await query(
        `UPDATE shift_change_requests
         SET status = 'approved',
             approval_chain = $1::jsonb,
             updated_at = now()
         WHERE id = $2`,
        [JSON.stringify(updatedChain), id]
      );

      await applyApprovedShiftChange(scr);

      return res.json({
        ok: true,
        status: 'approved',
        request_kind: scr.request_kind,
      });
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
        `UPDATE shift_change_requests
         SET status = 'pending_managers',
             approval_chain = $1::jsonb,
             updated_at = now()
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
        `UPDATE shift_change_requests
         SET status = 'approved',
             approval_chain = $1::jsonb,
             updated_at = now()
         WHERE id = $2`,
        [JSON.stringify(updatedChain), id]
      );

      await applyApprovedShiftChange(scr);

      return res.json({
        ok: true,
        status: 'approved',
        request_kind: scr.request_kind,
      });
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

    if (scrResult.rowCount === 0) {
      return res.status(404).json({ error: 'Shift change request not found' });
    }

    const scr = scrResult.rows[0];

    if (scr.request_kind === 'past_acknowledgement') {
      return res.status(400).json({
        error: 'Past acknowledgements are informational only and cannot be rejected.',
      });
    }

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
      `UPDATE shift_change_requests
       SET status = 'rejected',
           rejected_by = $1,
           rejected_at = now(),
           updated_at = now()
       WHERE id = $2`,
      [userId, id]
    );

    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// PATCH /api/shift-changes/:id/acknowledge
// This marks a shift-change notification/request as seen for TL / manager / admin.
// It prevents old acknowledgements from showing again and again.
router.patch('/:id/acknowledge', authenticate, requireRole('team_lead', 'manager', 'admin'), async (req, res, next) => {
  try {
    await migrate();

    const id = req.params.id;
    const userId = req.user.sub;

    const r = await query(
      `SELECT seen_by
       FROM shift_change_requests
       WHERE id = $1`,
      [id]
    );

    if (r.rowCount === 0) {
      return res.status(404).json({ error: 'Shift change request not found' });
    }

    const seenBy = normalizeSeenBy(r.rows[0].seen_by);

    if (seenBy.some((entry) => entry.user_id === userId)) {
      return res.json({ ok: true, already_seen: true });
    }

    const updatedSeenBy = [...seenBy, seenPayload(req)];

    await query(
      `UPDATE shift_change_requests
       SET seen_by = $1::jsonb,
           updated_at = now()
       WHERE id = $2`,
      [JSON.stringify(updatedSeenBy), id]
    );

    return res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;