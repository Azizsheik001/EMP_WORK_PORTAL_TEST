import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret';

export function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid authorization header' });
  }
  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    req.user = payload;
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
}

import { getPool } from '../db/pool.js';

export function requireRole(...roles) {
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
    
    // If user has the required role (or is an approval replay), let them pass
    if (roles.includes(req.user.role) || req.user.is_approval_replay) {
      return next();
    }

    // Check if user is an employee who might have HR/Finance privileges
    if (req.user.role === 'employee') {
      try {
        const pool = getPool();
        const r = await pool.query(
          `SELECT u.manager_id, d.name as department_name 
           FROM users u 
           LEFT JOIN departments d ON u.department_id = d.id 
           WHERE u.id = $1`,
          [req.user.sub]
        );

        if (r.rows.length > 0) {
          const { manager_id, department_name } = r.rows[0];
          const dept = (department_name || '').toLowerCase();
          const isHrOrFinance = dept === 'hr' || dept === 'finance' || dept === 'human resources';

          if (isHrOrFinance) {
            // Determine module
            let module = 'other';
            if (req.originalUrl.includes('/api/assets')) module = 'assets';
            else if (req.originalUrl.includes('/api/budgeting')) module = 'budgeting';
            else if (req.originalUrl.includes('/api/dinners')) module = 'dinners';
            else if (req.originalUrl.includes('/api/allowances')) module = 'allowances';
            else if (req.originalUrl.includes('/api/reports')) module = 'reports';
            else if (req.originalUrl.includes('/api/leave-requests')) module = 'leave_requests';

            const allowedModules = ['assets', 'budgeting', 'dinners', 'allowances', 'reports', 'leave_requests'];
            
            if (allowedModules.includes(module)) {
              // If it's a GET request, just allow them to view it
              if (['GET', 'OPTIONS', 'HEAD'].includes(req.method)) {
                return next();
              }

              // It's a mutating request, intercept as pending change
              const payload = {
                method: req.method,
                originalUrl: req.originalUrl,
                body: req.body,
              };

              await pool.query(
                `INSERT INTO pending_change_requests 
                 (module, action, payload, requested_by, manager_id, status)
                 VALUES ($1, $2, $3, $4, $5, 'pending')`,
                [module, req.method, JSON.stringify(payload), req.user.sub, manager_id]
              );

              return res.status(202).json({
                message: 'Your update has been submitted to your manager for approval.',
                pending_approval: true
              });
            }
          }
        }
      } catch (e) {
        return next(e);
      }
    }

    return res.status(403).json({ error: 'Forbidden: insufficient role' });
  };
}
