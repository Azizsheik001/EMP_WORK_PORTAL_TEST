import { Router } from 'express';
import { authenticate, requireRole } from '../middleware/auth.js';
import { query } from '../lib/db.js';

const router = Router();

function toDateStr(d) {
  if (!d) return null;
  if (d instanceof Date) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return String(d).slice(0, 10);
}

// ── Auto-create tables ──────────────────────────────────────────
async function ensureTables() {
  await query(`
    CREATE TABLE IF NOT EXISTS food_coupon_extras (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id),
      guest_name VARCHAR(255),
      coupon_date DATE NOT NULL,
      added_by UUID REFERENCES users(id),
      reason TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, coupon_date)
    )
  `);
  // Add guest_name column and drop NOT NULL on user_id if table already existed
  try {
    await query(`ALTER TABLE food_coupon_extras ADD COLUMN IF NOT EXISTS guest_name VARCHAR(255)`);
  } catch { /* column may already exist */ }
  try {
    await query(`ALTER TABLE food_coupon_extras ALTER COLUMN user_id DROP NOT NULL`);
  } catch { /* already nullable */ }

  // Exclusions table: track employees who opted out of food coupons for a date
  await query(`
    CREATE TABLE IF NOT EXISTS food_coupon_exclusions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id),
      coupon_date DATE NOT NULL,
      excluded_by UUID REFERENCES users(id),
      reason TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(user_id, coupon_date)
    )
  `);
}

// ── Settings table for configurable token prices ───────────────
async function ensureSettingsTable() {
  await query(`
    CREATE TABLE IF NOT EXISTS food_coupon_settings (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      regular_price NUMERIC(10,2) NOT NULL DEFAULT 120,
      wednesday_price NUMERIC(10,2) NOT NULL DEFAULT 160,
      updated_by UUID REFERENCES users(id),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `);
  // Seed default row if empty
  const existing = await query(`SELECT id FROM food_coupon_settings LIMIT 1`);
  if (existing.rowCount === 0) {
    await query(`INSERT INTO food_coupon_settings (regular_price, wednesday_price) VALUES (120, 160)`);
  }
}

async function getPricing() {
  try {
    const r = await query(`SELECT regular_price, wednesday_price FROM food_coupon_settings LIMIT 1`);
    if (r.rowCount > 0) return { regular: parseFloat(r.rows[0].regular_price), wednesday: parseFloat(r.rows[0].wednesday_price) };
  } catch { /* table may not exist yet */ }
  return { regular: 120, wednesday: 160 };
}

let tablesReady = false;
async function init() {
  if (!tablesReady) {
    await ensureTables();
    try { await ensureSettingsTable(); } catch { /* ignore */ }
    tablesReady = true;
  }
}

// ── GET /api/dinners/summary ────────────────────────────────────
// Must be defined BEFORE /:id to avoid route conflicts
router.get('/summary', authenticate, async (req, res, next) => {
  try {
    await init();
    const now = new Date();
    const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
    const nextMonth = now.getMonth() === 11
      ? `${now.getFullYear() + 1}-01-01`
      : `${now.getFullYear()}-${String(now.getMonth() + 2).padStart(2, '0')}-01`;

    // Daily breakdown - only include office employees who clocked in between 13:00–20:00 IST
    const dailyBreakdown = await query(
      `SELECT coupon_date, COUNT(*) AS count FROM (
         SELECT DISTINCT ce.user_id, ce.shift_date AS coupon_date
         FROM clock_events ce
         WHERE ce.event_type IN ('clock_in', 'in')
           AND ce.shift_date >= $1 AND ce.shift_date < $2
           AND (ce.is_wfh IS NULL OR ce.is_wfh = false)
           AND (ce.created_at AT TIME ZONE 'Asia/Kolkata')::time BETWEEN '13:00:00' AND '20:00:00'
           AND NOT EXISTS (
             SELECT 1 FROM food_coupon_exclusions excl
             WHERE excl.user_id = ce.user_id AND excl.coupon_date = ce.shift_date
           )
         UNION ALL
         SELECT fce.user_id, fce.coupon_date
         FROM food_coupon_extras fce
         WHERE fce.coupon_date >= $1 AND fce.coupon_date < $2
           AND NOT EXISTS (
             SELECT 1 FROM food_coupon_exclusions excl
             WHERE excl.user_id = fce.user_id AND excl.coupon_date = fce.coupon_date
             AND fce.user_id IS NOT NULL
           )
       ) combined
       GROUP BY coupon_date
       ORDER BY coupon_date DESC`,
      [monthStart, nextMonth]
    );

    // Per-person breakdown (employees + guests) - office workers 13:00-20:00 only
    const employeeBreakdown = await query(
      `SELECT combined.person_name AS user_name, COUNT(*) AS coupon_count
       FROM (
         SELECT DISTINCT ce.user_id, u.name AS person_name, ce.shift_date AS coupon_date
         FROM clock_events ce
         JOIN users u ON u.id = ce.user_id
         WHERE ce.event_type IN ('clock_in', 'in')
           AND ce.shift_date >= $1 AND ce.shift_date < $2
           AND (ce.is_wfh IS NULL OR ce.is_wfh = false)
           AND (ce.created_at AT TIME ZONE 'Asia/Kolkata')::time BETWEEN '13:00:00' AND '20:00:00'
           AND NOT EXISTS (
             SELECT 1 FROM food_coupon_exclusions excl
             WHERE excl.user_id = ce.user_id AND excl.coupon_date = ce.shift_date
           )
         UNION ALL
         SELECT fce.user_id, COALESCE(u.name, fce.guest_name) AS person_name, fce.coupon_date
         FROM food_coupon_extras fce
         LEFT JOIN users u ON u.id = fce.user_id
         WHERE fce.coupon_date >= $1 AND fce.coupon_date < $2
           AND NOT EXISTS (
             SELECT 1 FROM food_coupon_exclusions excl
             WHERE excl.user_id = fce.user_id AND excl.coupon_date = fce.coupon_date
             AND fce.user_id IS NOT NULL
           )
       ) combined
       GROUP BY combined.person_name
       ORDER BY coupon_count DESC`,
      [monthStart, nextMonth]
    );

    // Get configurable pricing
    const pricing = await getPricing();
    const WEDNESDAY_PRICE = pricing.wednesday;
    const REGULAR_PRICE = pricing.regular;

    const totalCoupons = dailyBreakdown.rows.reduce((s, r) => s + parseInt(r.count, 10), 0);
    let totalAmount = 0;
    const dailyWithPricing = dailyBreakdown.rows.map(r => {
      const d = new Date(String(r.coupon_date).slice(0, 10) + 'T00:00:00');
      const isWednesday = d.getDay() === 3;
      const price = isWednesday ? WEDNESDAY_PRICE : REGULAR_PRICE;
      const count = parseInt(r.count, 10);
      const dayTotal = count * price;
      totalAmount += dayTotal;
      return { ...r, price_per_token: price, day_total: dayTotal, is_wednesday: isWednesday };
    });

    // Per-employee cost breakdown
    const employeeWithPricing = employeeBreakdown.rows.map(r => ({
      ...r,
      coupon_count: parseInt(r.coupon_count, 10),
    }));

    // Coupons issued today - office + 13:00-20:00 IST only
    const today = toDateStr(now);
    const couponsToday = await query(
      `SELECT COUNT(*) AS count FROM (
         SELECT DISTINCT ce.user_id
         FROM clock_events ce
         WHERE ce.event_type IN ('clock_in', 'in')
           AND ce.shift_date = $1
           AND (ce.is_wfh IS NULL OR ce.is_wfh = false)
           AND (ce.created_at AT TIME ZONE 'Asia/Kolkata')::time BETWEEN '13:00:00' AND '20:00:00'
           AND NOT EXISTS (
             SELECT 1 FROM food_coupon_exclusions excl
             WHERE excl.user_id = ce.user_id AND excl.coupon_date = ce.shift_date
           )
         UNION ALL
         SELECT COALESCE(fce.user_id, fce.id)
         FROM food_coupon_extras fce
         WHERE fce.coupon_date = $1
           AND NOT EXISTS (
             SELECT 1 FROM food_coupon_exclusions excl
             WHERE excl.user_id = fce.user_id AND excl.coupon_date = fce.coupon_date
             AND fce.user_id IS NOT NULL
           )
       ) combined`,
      [today]
    );

    res.json({
      coupons_this_month: totalCoupons,
      coupons_today: parseInt(couponsToday.rows[0]?.count || '0', 10),
      total_amount: totalAmount,
      wednesday_price: WEDNESDAY_PRICE,
      regular_price: REGULAR_PRICE,
      daily_breakdown: dailyWithPricing,
      employee_breakdown: employeeWithPricing,
    });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/dinners ────────────────────────────────────────────
// Get food coupon list for a date or date range.
// Combines clock_in events + manual extras.
router.get('/', authenticate, async (req, res, next) => {
  try {
    await init();
    const user = req.user;
    const role = user.role;
    const isPrivileged = role === 'admin' || role === 'manager' || role === 'team_lead';

    const { date, from, to } = req.query;

    // Build date filter
    let dateFilter = '';
    const params = [];
    let idx = 1;

    if (date) {
      dateFilter = `AND coupon_date = $${idx}`;
      params.push(date);
      idx++;
    } else {
      if (from) {
        dateFilter += ` AND coupon_date >= $${idx}`;
        params.push(from);
        idx++;
      }
      if (to) {
        dateFilter += ` AND coupon_date <= $${idx}`;
        params.push(to);
        idx++;
      }
    }

    // User filter: employees see only their own
    let userFilter = '';
    if (!isPrivileged) {
      userFilter = `AND user_id = $${idx}`;
      params.push(user.id);
      idx++;
    }

    // Query clock-in based coupons: office only, clocked in 13:00-20:00 IST
    const clockInCoupons = await query(
      `SELECT DISTINCT ON (ce.user_id, ce.shift_date)
              ce.user_id,
              u.name AS user_name,
              ce.shift_date AS coupon_date,
              'clock_in' AS source,
              NULL AS reason,
              NULL AS added_by_name,
              NULL AS extra_id
       FROM clock_events ce
       JOIN users u ON u.id = ce.user_id
       WHERE ce.event_type IN ('clock_in', 'in')
         AND (ce.is_wfh IS NULL OR ce.is_wfh = false)
         AND (ce.created_at AT TIME ZONE 'Asia/Kolkata')::time BETWEEN '13:00:00' AND '20:00:00'
         AND NOT EXISTS (
           SELECT 1 FROM food_coupon_exclusions excl
           WHERE excl.user_id = ce.user_id AND excl.coupon_date = ce.shift_date
         )
         ${dateFilter.replace(/coupon_date/g, 'ce.shift_date')}
         ${userFilter.replace(/user_id/g, 'ce.user_id')}
       ORDER BY ce.user_id, ce.shift_date, ce.created_at DESC`,
      params
    );

    // Build params for manual extras query separately (guests have no user_id)
    const extrasParams = [];
    let extrasDateFilter = '';
    let eidx = 1;
    if (date) {
      extrasDateFilter = `AND fce.coupon_date = $${eidx}`;
      extrasParams.push(date);
      eidx++;
    } else {
      if (from) {
        extrasDateFilter += ` AND fce.coupon_date >= $${eidx}`;
        extrasParams.push(from);
        eidx++;
      }
      if (to) {
        extrasDateFilter += ` AND fce.coupon_date <= $${eidx}`;
        extrasParams.push(to);
        eidx++;
      }
    }
    let extrasUserFilter = '';
    if (!isPrivileged) {
      extrasUserFilter = `AND fce.user_id = $${eidx}`;
      extrasParams.push(user.id);
      eidx++;
    }

    // Query manual extras (employees + guests), excluding excluded users
    const manualExtras = await query(
      `SELECT fce.id AS extra_id,
              fce.user_id,
              COALESCE(u.name, fce.guest_name) AS user_name,
              fce.guest_name,
              fce.coupon_date,
              'manual' AS source,
              fce.reason,
              ab.name AS added_by_name
       FROM food_coupon_extras fce
       LEFT JOIN users u ON u.id = fce.user_id
       LEFT JOIN users ab ON ab.id = fce.added_by
       WHERE 1=1
         AND (fce.user_id IS NULL OR NOT EXISTS (
           SELECT 1 FROM food_coupon_exclusions excl
           WHERE excl.user_id = fce.user_id AND excl.coupon_date = fce.coupon_date
         ))
         ${extrasDateFilter}
         ${extrasUserFilter}
       ORDER BY fce.coupon_date DESC, COALESCE(u.name, fce.guest_name) ASC`,
      extrasParams
    );

    // Merge and deduplicate (manual extras override clock-in for same user+date)
    const seen = new Set();
    const combined = [];

    // Add manual extras first (they take priority in display)
    for (const row of manualExtras.rows) {
      if (row.user_id) {
        const key = `${row.user_id}_${String(row.coupon_date).slice(0, 10)}`;
        seen.add(key);
      }
      combined.push(row);  // guests always added (no dedup needed)
    }

    // Add clock-in coupons that aren't already covered by manual extras
    for (const row of clockInCoupons.rows) {
      const key = `${row.user_id}_${String(row.coupon_date).slice(0, 10)}`;
      if (!seen.has(key)) {
        seen.add(key);
        combined.push(row);
      }
    }

    // Sort by date desc, then name asc
    combined.sort((a, b) => {
      const dateA = String(a.coupon_date).slice(0, 10);
      const dateB = String(b.coupon_date).slice(0, 10);
      if (dateA !== dateB) return dateB.localeCompare(dateA);
      return (a.user_name || '').localeCompare(b.user_name || '');
    });

    // Normalize dates
    const coupons = combined.map((row) => ({
      ...row,
      coupon_date: row.coupon_date instanceof Date
        ? toDateStr(row.coupon_date)
        : String(row.coupon_date).slice(0, 10),
    }));

    // Fetch exclusions for the requested date range (privileged users only)
    let exclusions = [];
    if (isPrivileged) {
      // Build date filter for exclusions query
      const exclParams = [];
      let exclDateFilter = '';
      let exclIdx = 1;
      if (date) {
        exclDateFilter = `AND excl.coupon_date = $${exclIdx}`;
        exclParams.push(date);
        exclIdx++;
      } else {
        if (from) {
          exclDateFilter += ` AND excl.coupon_date >= $${exclIdx}`;
          exclParams.push(from);
          exclIdx++;
        }
        if (to) {
          exclDateFilter += ` AND excl.coupon_date <= $${exclIdx}`;
          exclParams.push(to);
          exclIdx++;
        }
      }
      const exclResult = await query(
        `SELECT excl.id, excl.user_id, u.name AS user_name, excl.coupon_date,
                excl.reason, eb.name AS excluded_by_name, excl.created_at
         FROM food_coupon_exclusions excl
         JOIN users u ON u.id = excl.user_id
         LEFT JOIN users eb ON eb.id = excl.excluded_by
         WHERE 1=1 ${exclDateFilter}
         ORDER BY excl.coupon_date DESC, u.name ASC`,
        exclParams
      );
      exclusions = exclResult.rows.map((row) => ({
        ...row,
        coupon_date: row.coupon_date instanceof Date
          ? toDateStr(row.coupon_date)
          : String(row.coupon_date).slice(0, 10),
      }));
    }

    res.json({ coupons, exclusions });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/dinners/extras ────────────────────────────────────
// Manually add someone for a date. Admin/manager only.
router.post('/extras', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    await init();
    const { user_id, guest_name, coupon_date, reason } = req.body;

    if (!coupon_date) {
      return res.status(400).json({ error: 'coupon_date is required' });
    }
    if (!user_id && !guest_name) {
      return res.status(400).json({ error: 'Either user_id or guest_name is required' });
    }

    let result;
    if (user_id) {
      // Adding an existing employee
      result = await query(
        `INSERT INTO food_coupon_extras (user_id, coupon_date, added_by, reason)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (user_id, coupon_date) DO NOTHING
         RETURNING *`,
        [user_id, coupon_date, req.user.id, reason || null]
      );
      if (result.rows.length === 0) {
        return res.status(409).json({ error: 'This employee already has a manual coupon for this date' });
      }
    } else {
      // Adding a guest (no user_id, just a name)
      result = await query(
        `INSERT INTO food_coupon_extras (guest_name, coupon_date, added_by, reason)
         VALUES ($1, $2, $3, $4)
         RETURNING *`,
        [guest_name.trim(), coupon_date, req.user.id, reason || null]
      );
    }

    // Fetch full details for response
    const detailed = await query(
      `SELECT fce.id AS extra_id, fce.user_id,
              COALESCE(u.name, fce.guest_name) AS user_name,
              fce.guest_name,
              fce.coupon_date, 'manual' AS source, fce.reason,
              ab.name AS added_by_name
       FROM food_coupon_extras fce
       LEFT JOIN users u ON u.id = fce.user_id
       LEFT JOIN users ab ON ab.id = fce.added_by
       WHERE fce.id = $1`,
      [result.rows[0].id]
    );

    res.status(201).json({ coupon: detailed.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ── POST /api/dinners/exclusions ─────────────────────────────────
// Exclude an employee from the food coupon list for a date. Admin/manager only.
router.post('/exclusions', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    await init();
    const { user_id, coupon_date, reason } = req.body;

    if (!user_id) {
      return res.status(400).json({ error: 'user_id is required' });
    }
    if (!coupon_date) {
      return res.status(400).json({ error: 'coupon_date is required' });
    }

    const result = await query(
      `INSERT INTO food_coupon_exclusions (user_id, coupon_date, excluded_by, reason)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (user_id, coupon_date) DO NOTHING
       RETURNING *`,
      [user_id, coupon_date, req.user.id, reason || null]
    );

    if (result.rows.length === 0) {
      return res.status(409).json({ error: 'This employee is already excluded for this date' });
    }

    // Fetch full details for response
    const detailed = await query(
      `SELECT excl.id, excl.user_id, u.name AS user_name, excl.coupon_date,
              excl.reason, eb.name AS excluded_by_name, excl.created_at
       FROM food_coupon_exclusions excl
       JOIN users u ON u.id = excl.user_id
       LEFT JOIN users eb ON eb.id = excl.excluded_by
       WHERE excl.id = $1`,
      [result.rows[0].id]
    );

    res.status(201).json({ exclusion: detailed.rows[0] });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/dinners/exclusions/:id ──────────────────────────
// Remove an exclusion (re-add the employee to the coupon list). Admin/manager only.
router.delete('/exclusions/:id', authenticate, requireRole('admin', 'manager'), async (req, res, next) => {
  try {
    await init();
    const { id } = req.params;
    const result = await query(
      `DELETE FROM food_coupon_exclusions WHERE id = $1 RETURNING id`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Exclusion not found' });
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── DELETE /api/dinners/extras/:id ──────────────────────────────
// Remove a manually added extra. Admin only.
router.delete('/extras/:id', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    await init();
    const { id } = req.params;
    const result = await query(
      `DELETE FROM food_coupon_extras WHERE id = $1 RETURNING id`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Manual coupon entry not found' });
    }
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

// ── GET /api/dinners/settings — get current token pricing ──────
router.get('/settings', authenticate, async (req, res, next) => {
  try {
    await init();
    const pricing = await getPricing();
    res.json(pricing);
  } catch (err) {
    next(err);
  }
});

// ── PATCH /api/dinners/settings — update token pricing (admin only) ──
router.patch('/settings', authenticate, requireRole('admin'), async (req, res, next) => {
  try {
    await init();
    const { regular_price, wednesday_price } = req.body;
    if (regular_price == null && wednesday_price == null) {
      return res.status(400).json({ error: 'Provide regular_price and/or wednesday_price' });
    }
    const updates = [];
    const params = [];
    let idx = 1;
    if (regular_price != null) { updates.push(`regular_price = $${idx++}`); params.push(regular_price); }
    if (wednesday_price != null) { updates.push(`wednesday_price = $${idx++}`); params.push(wednesday_price); }
    updates.push(`updated_by = $${idx++}`); params.push(req.user.sub);
    updates.push(`updated_at = now()`);
    await query(`UPDATE food_coupon_settings SET ${updates.join(', ')}`, params);
    const pricing = await getPricing();
    res.json(pricing);
  } catch (err) {
    next(err);
  }
});

export default router;
