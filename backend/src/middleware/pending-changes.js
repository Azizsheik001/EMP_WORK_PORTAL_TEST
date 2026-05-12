import { getPool } from '../db/pool.js';

export async function interceptPendingChanges(req, res, next) {
  // If this is an approval replay, let it pass through
  if (req.user?.is_approval_replay || req.headers['x-approval-replay']) {
    return next();
  }

  // Only intercept mutating requests (POST, PATCH, PUT, DELETE)
  if (['GET', 'OPTIONS', 'HEAD'].includes(req.method)) {
    return next();
  }

  // If user is not an employee, let it pass (admin/manager/team_lead do directly)
  if (req.user.role !== 'employee') {
    return next();
  }

  try {
    const pool = getPool();
    // Fetch user details to check department and manager
    const r = await pool.query(
      `SELECT u.manager_id, d.name as department_name 
       FROM users u 
       LEFT JOIN departments d ON u.department_id = d.id 
       WHERE u.id = $1`,
      [req.user.sub]
    );

    if (r.rows.length === 0) return next();
    
    const { manager_id, department_name } = r.rows[0];
    const dept = (department_name || '').toLowerCase();
    
    // Only HR and Finance employees are intercepted for approval
    if (dept === 'hr' || dept === 'finance' || dept === 'human resources') {
      
      // Determine module based on base URL
      let module = 'other';
      if (req.originalUrl.includes('/api/assets')) module = 'assets';
      else if (req.originalUrl.includes('/api/budgeting')) module = 'budgeting';
      else if (req.originalUrl.includes('/api/dinners')) module = 'dinners';
      else if (req.originalUrl.includes('/api/allowances')) module = 'allowances';
      else module = req.originalUrl.split('/')[2] || 'unknown';

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

    // If not HR/Finance, maybe they shouldn't even have access, but auth middleware handles that.
    next();
  } catch (e) {
    next(e);
  }
}
