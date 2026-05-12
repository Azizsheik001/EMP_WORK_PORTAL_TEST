import { Router } from 'express';
import { query } from '../lib/db.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = Router();

// Get all shift codes
router.get('/', authenticate, async (req, res, next) => {
  try {
    const result = await query('SELECT * FROM shift_codes ORDER BY start_time');
    res.json(result.rows);
  } catch (err) { next(err); }
});

// Create or update a shift code
router.post('/', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const { start_time, end_time, shift_code } = req.body;
    
    if (!start_time || !end_time || !shift_code) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const result = await query(
      `INSERT INTO shift_codes (start_time, end_time, shift_code) 
       VALUES ($1, $2, $3) 
       ON CONFLICT (start_time, end_time) 
       DO UPDATE SET shift_code = $3 
       RETURNING *`,
      [start_time, end_time, shift_code]
    );
    res.json(result.rows[0]);
  } catch (err) { next(err); }
});

// Delete a shift code
router.delete('/:id', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    const result = await query('DELETE FROM shift_codes WHERE id = $1 RETURNING *', [req.params.id]);
    if (result.rowCount === 0) {
      return res.status(404).json({ error: 'Shift code not found' });
    }
    res.json({ success: true, deleted: result.rows[0] });
  } catch (err) { next(err); }
});

export default router;
