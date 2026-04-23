import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { getPool } from '../db/pool.js';
import { authenticate, requireRole } from '../middleware/auth.js';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';
const JWT_EXPIRES_IN = process.env.JWT_EXPIRES_IN || '7d';

const TOKEN_EXPIRY_HOURS = 1;
const TOKEN_BYTES = 32;

// Ensure must_reset_password column exists
let _mustResetColumnReady = false;
async function ensureMustResetColumn() {
  if (_mustResetColumnReady) return;
  const pool = getPool();
  try {
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS must_reset_password BOOLEAN NOT NULL DEFAULT false`);
  } catch (_e) { /* column may already exist */ }
  _mustResetColumnReady = true;
}

// ---------------------------------------------------------------------------
// Ensure password_reset_tokens table exists (runs once on first use)
// ---------------------------------------------------------------------------
let tableEnsured = false;

async function ensureResetTokensTable() {
  if (tableEnsured) return;
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      token_hash VARCHAR(255) NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_expires
      ON password_reset_tokens (expires_at);
    CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_user_id
      ON password_reset_tokens (user_id);
  `);
  tableEnsured = true;
}

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------
const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

const resetPasswordSchema = z.object({
  token: z.string().min(1, 'Reset token is required'),
  new_password: z.string().min(6, 'Password must be at least 6 characters'),
});

// ---------------------------------------------------------------------------
// POST /login
// ---------------------------------------------------------------------------
router.post('/login', async (req, res, next) => {
  try {
    await ensureMustResetColumn();
    const { email, password } = loginSchema.parse(req.body);
    const pool = getPool();
    const r = await pool.query(
      `SELECT id, email, name, role, client_id, manager_id, team_lead_id,
              designation, department_id, work_timezone, work_hours, employee_no,
              password_hash, must_reset_password
       FROM users WHERE LOWER(email) = $1 AND deleted_at IS NULL AND is_active = true`,
      [email.toLowerCase().trim()]
    );
    const user = r.rows[0];
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      return res.status(401).json({ error: 'Invalid email or password' });
    }
    const { password_hash, must_reset_password, ...safe } = user;
    const token = jwt.sign(
      { sub: safe.id, role: safe.role, email: safe.email, name: safe.name },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );
    res.json({ user: safe, token, must_reset_password: must_reset_password || false });
  } catch (e) {
    if (e.name === 'ZodError') return res.status(400).json({ error: e.errors.map(err => err.message).join(', ') });
    next(e);
  }
});

// ---------------------------------------------------------------------------
// POST /sso-login  — Suite SSO: verify Suite JWT, find local user, issue local JWT
// ---------------------------------------------------------------------------
router.post('/sso-login', async (req, res, next) => {
  try {
    const { suite_token } = req.body;
    if (!suite_token) return res.status(400).json({ error: 'suite_token is required' });

    // Verify token against Suite backend
    const suiteApiUrl = (process.env.SUITE_API_URL || 'http://localhost:3001').replace(/\/$/, '');
    const verifyRes = await fetch(`${suiteApiUrl}/api/auth/sso-verify?suite_token=${encodeURIComponent(suite_token)}`);
    if (!verifyRes.ok) return res.status(401).json({ error: 'Invalid or expired suite token' });

    const verifyData = await verifyRes.json();
    if (!verifyData.valid) return res.status(401).json({ error: 'Suite token verification failed' });

    const suiteUser = verifyData.user;
    const email = suiteUser.email?.toLowerCase().trim();
    if (!email) return res.status(400).json({ error: 'No email in suite token' });

    // Find local user by email
    const pool = getPool();
    const r = await pool.query(
      `SELECT id, email, name, role, client_id, manager_id, team_lead_id,
              designation, department_id, work_timezone, work_hours, employee_no
       FROM users WHERE LOWER(email) = $1 AND deleted_at IS NULL AND is_active = true`,
      [email]
    );
    const user = r.rows[0];
    if (!user) return res.status(404).json({ error: 'User not found in Workforce Portal. Contact an admin.' });

    // Issue local JWT
    const token = jwt.sign(
      { sub: user.id, role: user.role, email: user.email, name: user.name },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES_IN }
    );

    res.json({ user, token });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// POST /logout
// Fires a mobile-logout alert on every mobile logout. Recipients:
//   - all of the user's manager(s) (primary + junction user_manager_assignments)
//   - the CEO (admin role) and Shiva (by name, admin or manager).
// ---------------------------------------------------------------------------
function isMobileUA(ua) {
  if (!ua) return false;
  return /mobile|android|iphone|ipad|ipod|blackberry|opera mini|iemobile/i.test(ua);
}

async function fireMobileLogoutAlert(userId, userAgent) {
  try {
    const pool = getPool();
    // Ensure the recipient column exists (backward-compatible: null = broadcast)
    try { await pool.query(`ALTER TABLE admin_alerts ADD COLUMN IF NOT EXISTS recipient_user_id UUID REFERENCES users(id)`); } catch (_e) {}

    const { rows: [user] } = await pool.query(
      `SELECT name, manager_id FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [userId]
    );
    if (!user) return;

    const recipientSet = new Set();
    if (user.manager_id) recipientSet.add(user.manager_id);

    // Multi-manager junction (if enabled)
    try {
      const mgrJ = await pool.query(
        `SELECT manager_id FROM user_manager_assignments WHERE user_id = $1`,
        [userId]
      );
      for (const row of mgrJ.rows) recipientSet.add(row.manager_id);
    } catch (_e) { /* table may not exist */ }

    // CEO = admin(s)
    try {
      const ceos = await pool.query(
        `SELECT id FROM users WHERE role = 'admin' AND is_active = true AND deleted_at IS NULL`
      );
      for (const row of ceos.rows) recipientSet.add(row.id);
    } catch (_e) {}

    // Shiva — always notified regardless of role
    try {
      const shiva = await pool.query(
        `SELECT id FROM users WHERE name ILIKE '%shiva%' AND is_active = true AND deleted_at IS NULL`
      );
      for (const row of shiva.rows) recipientSet.add(row.id);
    } catch (_e) {}

    // Never notify the user about themselves
    recipientSet.delete(userId);

    const message = `${user.name} logged out from mobile`;
    const details = JSON.stringify({ user_agent: String(userAgent || '').slice(0, 200), at: new Date().toISOString() });

    for (const recipientId of recipientSet) {
      try {
        await pool.query(
          `INSERT INTO admin_alerts (user_id, alert_type, message, details, recipient_user_id)
           VALUES ($1, 'mobile_logout', $2, $3::jsonb, $4)`,
          [userId, message, details, recipientId]
        );
      } catch (e) {
        console.warn('fireMobileLogoutAlert insert failed:', e.message);
      }
    }
  } catch (e) {
    console.warn('fireMobileLogoutAlert error:', e.message);
  }
}

router.post('/logout', async (req, res) => {
  // Try to attribute the logout to a user — attempt JWT verify but don't fail if absent.
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  let userId = null;
  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      userId = decoded.sub;
    } catch (_e) { /* expired or invalid token — just return OK */ }
  }

  const ua = req.headers['user-agent'] || '';
  if (userId && isMobileUA(ua)) {
    // Fire & forget — don't delay the logout response
    fireMobileLogoutAlert(userId, ua).catch(() => {});
  }
  res.json({ message: 'Logged out' });
});

// ---------------------------------------------------------------------------
// POST /forgot-password
// ---------------------------------------------------------------------------
router.post('/forgot-password', async (req, res, next) => {
  try {
    await ensureResetTokensTable();
    const { email } = forgotPasswordSchema.parse(req.body);
    const pool = getPool();

    // Always return the same generic message to prevent email enumeration
    const genericResponse = {
      message: 'If an account with that email exists, a password reset token has been generated.',
    };

    // Look up user (case-insensitive)
    const userResult = await pool.query(
      `SELECT id, email FROM users WHERE LOWER(email) = $1 AND deleted_at IS NULL AND is_active = true`,
      [email.toLowerCase().trim()]
    );

    const user = userResult.rows[0];
    if (!user) {
      // Don't reveal whether the email exists
      return res.json(genericResponse);
    }

    // Delete any existing reset tokens for this user
    await pool.query(`DELETE FROM password_reset_tokens WHERE user_id = $1`, [user.id]);

    // Generate secure random token
    const rawToken = crypto.randomBytes(TOKEN_BYTES).toString('hex');

    // Store bcrypt hash of token (never store plaintext)
    const tokenHash = await bcrypt.hash(rawToken, 10);

    const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

    await pool.query(
      `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, $3)`,
      [user.id, tokenHash, expiresAt.toISOString()]
    );

    // Cleanup expired tokens (fire-and-forget)
    pool.query(`DELETE FROM password_reset_tokens WHERE expires_at < NOW()`).catch(() => {});

    // In production, the token would be sent via email.
    // For development, we return it directly in the response.
    res.json({
      ...genericResponse,
      // DEV ONLY: return token so it can be displayed in the UI
      reset_token: rawToken,
      expires_at: expiresAt.toISOString(),
    });
  } catch (e) {
    if (e.name === 'ZodError') return res.status(400).json({ error: e.errors.map(err => err.message).join(', ') });
    next(e);
  }
});

// ---------------------------------------------------------------------------
// POST /reset-password
// ---------------------------------------------------------------------------
router.post('/reset-password', async (req, res, next) => {
  try {
    await ensureResetTokensTable();
    const { token, new_password } = resetPasswordSchema.parse(req.body);
    const pool = getPool();

    // Get all non-expired tokens (we need to compare hashes)
    const tokensResult = await pool.query(
      `SELECT id, user_id, token_hash FROM password_reset_tokens WHERE expires_at > NOW()`
    );

    // Find the matching token by comparing against bcrypt hashes
    let matchedRow = null;
    for (const row of tokensResult.rows) {
      const match = await bcrypt.compare(token, row.token_hash);
      if (match) {
        matchedRow = row;
        break;
      }
    }

    if (!matchedRow) {
      return res.status(400).json({ error: 'Invalid or expired reset token.' });
    }

    // Hash the new password
    const newHash = await bcrypt.hash(new_password, 10);

    // Update user's password, clear must_reset_password, store plain for admin view
    await ensurePlainPwdColumn();
    await pool.query(`UPDATE users SET password_hash = $1, must_reset_password = false, last_password_plain = $2 WHERE id = $3`, [
      newHash,
      new_password,
      matchedRow.user_id,
    ]);

    // Delete the used token (one-time use)
    await pool.query(`DELETE FROM password_reset_tokens WHERE id = $1`, [matchedRow.id]);

    // Also cleanup any other tokens for this user
    await pool.query(`DELETE FROM password_reset_tokens WHERE user_id = $1`, [matchedRow.user_id]);

    res.json({ message: 'Password has been reset successfully. You can now log in with your new password.' });
  } catch (e) {
    if (e.name === 'ZodError') return res.status(400).json({ error: e.errors.map(err => err.message).join(', ') });
    next(e);
  }
});

// ---------------------------------------------------------------------------
// Ensure last_password_plain column exists (for admin view)
// ---------------------------------------------------------------------------
let _plainPwdColumnReady = false;
async function ensurePlainPwdColumn() {
  if (_plainPwdColumnReady) return;
  const pool = getPool();
  try {
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_password_plain VARCHAR(255)`);
  } catch (_e) { /* already exists */ }
  _plainPwdColumnReady = true;
}

// ---------------------------------------------------------------------------
// POST /change-password (authenticated — for forced password reset after temp login)
// ---------------------------------------------------------------------------
router.post('/change-password', authenticate, async (req, res, next) => {
  try {
    await ensureMustResetColumn();
    await ensurePlainPwdColumn();
    const { new_password } = req.body;
    if (!new_password || new_password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }
    const pool = getPool();
    const newHash = await bcrypt.hash(new_password, 10);
    await pool.query(
      `UPDATE users SET password_hash = $1, must_reset_password = false, last_password_plain = $2, updated_at = now() WHERE id = $3`,
      [newHash, new_password, req.user.sub]
    );
    res.json({ message: 'Password changed successfully.' });
  } catch (e) {
    next(e);
  }
});

// ---------------------------------------------------------------------------
// GET /view-password/:userId (admin only — view employee's current password)
// ---------------------------------------------------------------------------
router.get('/view-password/:userId', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    await ensurePlainPwdColumn();
    const pool = getPool();
    const r = await pool.query(
      `SELECT last_password_plain FROM users WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.userId]
    );
    if (r.rows.length === 0) return res.status(404).json({ error: 'User not found' });
    const pwd = r.rows[0].last_password_plain;
    if (!pwd) return res.json({ password: null, message: 'No password on file. User may not have reset yet.' });
    res.json({ password: pwd });
  } catch (e) {
    next(e);
  }
});

export default router;
