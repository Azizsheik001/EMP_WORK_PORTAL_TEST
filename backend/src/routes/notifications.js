import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { query } from '../lib/db.js';

const router = Router();

// GET /api/notifications
// Fetch notifications for the logged-in user
router.get('/', authenticate, async (req, res, next) => {
  try {
    const r = await query(
      `SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC`,
      [req.user.sub]
    );
    res.json({ notifications: r.rows });
  } catch (e) {
    next(e);
  }
});

// PATCH /api/notifications/:id/read
// Mark a notification as read
router.patch('/:id/read', authenticate, async (req, res, next) => {
  try {
    await query(
      `UPDATE notifications SET is_read = true WHERE id = $1 AND user_id = $2`,
      [req.params.id, req.user.sub]
    );
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

export default router;
