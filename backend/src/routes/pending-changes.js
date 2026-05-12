import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { getPool } from '../db/pool.js';
import jwt from 'jsonwebtoken';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

// Helper to determine the local port
const getLocalBaseUrl = (req) => {
  const port = process.env.PORT || 3000;
  return `http://127.0.0.1:${port}`;
};

// GET /api/pending-changes
router.get('/', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const pool = getPool();
    let sql = `
      SELECT p.*, u.name as requested_by_name, u.email as requested_by_email 
      FROM pending_change_requests p
      JOIN users u ON p.requested_by = u.id
      WHERE p.status = 'pending'
    `;
    const params = [];

    // Managers only see requests assigned to them
    if (req.user.role === 'manager') {
      sql += ` AND p.manager_id = $1 `;
      params.push(req.user.sub);
    }

    sql += ` ORDER BY p.created_at DESC `;

    const r = await pool.query(sql, params);
    res.json({ pending_changes: r.rows });
  } catch (e) {
    next(e);
  }
});

// POST /api/pending-changes/:id/approve
router.post('/:id/approve', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const pool = getPool();
    const { id } = req.params;

    // Fetch the pending request
    const r = await pool.query(
      `SELECT * FROM pending_change_requests WHERE id = $1 AND status = 'pending'`,
      [id]
    );

    if (r.rows.length === 0) {
      return res.status(404).json({ error: 'Pending change request not found or already processed' });
    }

    const pending = r.rows[0];

    if (req.user.role === 'manager' && pending.manager_id !== req.user.sub) {
      return res.status(403).json({ error: 'Forbidden: not the manager for this request' });
    }

    const payload = pending.payload;
    const originalUrl = payload.originalUrl;
    const method = payload.method;
    const body = payload.body;

    // Generate an admin token for the replay
    const adminToken = jwt.sign(
      { sub: req.user.sub, email: req.user.email, role: 'admin', is_approval_replay: true },
      JWT_SECRET,
      { expiresIn: '5m' }
    );

    // Make the internal HTTP request
    const fullUrl = `${getLocalBaseUrl(req)}${originalUrl}`;
    const fetchOptions = {
      method: method,
      headers: {
        'Authorization': `Bearer ${adminToken}`,
        'Content-Type': 'application/json'
      }
    };
    if (body && Object.keys(body).length > 0) {
      fetchOptions.body = JSON.stringify(body);
    }

    const replayRes = await fetch(fullUrl, fetchOptions);
    const replayData = await replayRes.text();

    if (!replayRes.ok) {
      // Return the error from the underlying endpoint
      let errorMsg = 'Failed to apply change';
      try {
        const parsed = JSON.parse(replayData);
        errorMsg = parsed.error || errorMsg;
      } catch (e) {}
      return res.status(replayRes.status).json({ error: `Action failed: ${errorMsg}` });
    }

    // Update status to approved
    await pool.query(
      `UPDATE pending_change_requests SET status = 'approved', updated_at = now() WHERE id = $1`,
      [id]
    );

    // Create notification for admins
    const adminsRes = await pool.query(`SELECT id FROM users WHERE role = 'admin'`);
    const requesterRes = await pool.query(`SELECT name, department_id FROM users WHERE id = $1`, [pending.requested_by]);
    const requesterName = requesterRes.rows[0]?.name || 'An employee';
    
    // Find department name
    let deptName = 'HR/Finance';
    if (requesterRes.rows[0]?.department_id) {
       const dRes = await pool.query(`SELECT name FROM departments WHERE id = $1`, [requesterRes.rows[0].department_id]);
       if (dRes.rows.length) deptName = dRes.rows[0].name;
    }

    const notifMessage = `${requesterName} (${deptName}) made a change in ${pending.module} which was approved by their manager.`;
    
    for (const admin of adminsRes.rows) {
      try {
         await pool.query(
           `INSERT INTO notifications (user_id, title, message, type) VALUES ($1, $2, $3, $4)`,
           [admin.id, 'Data Update Approved', notifMessage, 'system']
         );
      } catch (e) {
         // notifications table might have different columns, but usually user_id, title, message, type works
      }
    }

    res.json({ message: 'Change approved and applied successfully', data: replayData });
  } catch (e) {
    next(e);
  }
});

// POST /api/pending-changes/:id/reject
router.post('/:id/reject', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const pool = getPool();
    const { id } = req.params;

    const r = await pool.query(
      `SELECT * FROM pending_change_requests WHERE id = $1 AND status = 'pending'`,
      [id]
    );

    if (r.rows.length === 0) {
      return res.status(404).json({ error: 'Pending change request not found or already processed' });
    }

    const pending = r.rows[0];

    if (req.user.role === 'manager' && pending.manager_id !== req.user.sub) {
      return res.status(403).json({ error: 'Forbidden: not the manager for this request' });
    }

    // Update status to rejected
    await pool.query(
      `UPDATE pending_change_requests SET status = 'rejected', updated_at = now() WHERE id = $1`,
      [id]
    );

    res.json({ message: 'Change rejected successfully' });
  } catch (e) {
    next(e);
  }
});

export default router;
