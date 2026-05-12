import { Router } from 'express';
import { z } from 'zod';
import { authenticate, requireRole } from '../middleware/auth.js';
import { query } from '../lib/db.js';

const router = Router();

function toDateStr(d) {
  if (!d) return null;
  if (d instanceof Date) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return String(d).slice(0, 10);
}

const uploadSchema = z.object({
  client_id: z.string().uuid(),
  iso_year: z.number().int().min(2000).max(2100),
  start_week: z.number().int().min(1).max(53),
  weeks_count: z.number().int().min(1).max(10),
  file_url: z.string().url().optional().nullable(),
});

// Upload: record schedule_uploads for week range; optionally create shift_assignments from body
router.post('/', authenticate, requireRole('team_lead', 'admin'), async (req, res, next) => {
  try {
    const body = uploadSchema.parse(req.body);
    const uploadedBy = req.user.sub;
    const inserts = [];
    for (let w = 0; w < body.weeks_count; w++) {
      const weekNumber = body.start_week + w;
      await query(
        `INSERT INTO schedule_uploads (client_id, iso_year, week_number, uploaded_by, file_url)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (client_id, iso_year, week_number) DO UPDATE SET uploaded_by = $4, file_url = COALESCE($5, schedule_uploads.file_url), updated_at = now()`,
        [body.client_id, body.iso_year, weekNumber, uploadedBy, body.file_url || null]
      );
      inserts.push({ iso_year: body.iso_year, week_number: weekNumber });
    }
    res.status(201).json({ ok: true, start_week: body.start_week, weeks_count: body.weeks_count, inserted: inserts });
  } catch (e) {
    if (e.name === 'ZodError') return res.status(400).json({ error: e.errors.map(err => err.message).join(', ') });
    next(e);
  }
});

router.get('/', authenticate, async (req, res, next) => {
  try {
    const r = await query(
      `SELECT s.*, c.name AS client_name
       FROM schedule_uploads s
       JOIN clients c ON c.id = s.client_id
       ORDER BY s.iso_year DESC, s.week_number DESC, c.name`
    );
    res.json({ schedules: r.rows });
  } catch (e) {
    next(e);
  }
});

// POST /api/schedules/parse-csv — parse CSV text, match employee names to user IDs, return assignments for preview
const parseCsvSchema = z.object({
  client_id: z.string().uuid().optional().nullable(),
  start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'start_date must be YYYY-MM-DD'),
  csv_text: z.string().min(1, 'csv_text is required'),
});

router.post('/parse-csv', authenticate, requireRole('team_lead', 'admin', 'manager'), async (req, res, next) => {
  try {
    const { client_id, start_date, csv_text } = parseCsvSchema.parse(req.body);

    // Fetch employees — for a specific client or ALL non-admin employees
    const byAssignments = [];
    if (client_id) {
      try {
        const r = await query(
          `SELECT u.id, u.name, u.role, u.email
           FROM user_client_assignments uca
           JOIN users u ON u.id = uca.user_id AND u.deleted_at IS NULL
           WHERE uca.client_id = $1`,
          [client_id]
        );
        byAssignments.push(...r.rows);
      } catch (e) {
        if (e.code !== '42P01') throw e;
      }
      const byPrimary = await query(
        `SELECT id, name, role, email FROM users WHERE client_id = $1 AND deleted_at IS NULL`,
        [client_id]
      );
      const seen = new Set(byAssignments.map((u) => u.id));
      for (const u of byPrimary.rows) {
        if (!seen.has(u.id)) {
          byAssignments.push(u);
          seen.add(u.id);
        }
      }
    } else {
      // No client filter — fetch all non-admin employees
      const allUsers = await query(
        `SELECT id, name, role, email, client_id FROM users WHERE deleted_at IS NULL AND role != 'admin'`
      );
      byAssignments.push(...allUsers.rows);
    }

    // Build name-to-user lookup (case-insensitive, trimmed)
    const nameMap = {};
    for (const u of byAssignments) {
      nameMap[(u.name || '').trim().toLowerCase()] = u;
    }

    // Parse CSV lines
    const lines = csv_text.split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) {
      return res.status(400).json({ error: 'CSV must have a header row and at least one data row' });
    }

    const header = lines[0].split(',').map((h) => h.trim());
    // Column 0: Employee Name, Column 1: Employee ID, Columns 2+: day columns (Mon-Sun)
    // We compute dates from start_date: start_date is Monday of the week
    const startDt = new Date(start_date + 'T00:00:00');
    const dayDates = [];
    // Day columns start at index 2 (after name and ID) — no cap, support multi-week templates
    for (let i = 2; i < header.length; i++) {
      const d = new Date(startDt);
      d.setDate(startDt.getDate() + (i - 2));
      dayDates.push(toDateStr(d));
    }

    const assignments = [];
    const warnings = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map((c) => c.trim());
      const empName = cols[0] || '';
      if (!empName) continue;

      const user = nameMap[empName.toLowerCase()];
      if (!user) {
        warnings.push(`Row ${i + 1}: Employee "${empName}" not found for this client`);
        continue;
      }

      // Day columns start at index 2 (after name and employee ID)
      for (let d = 0; d < dayDates.length && d + 2 < cols.length; d++) {
        const cellVal = cols[d + 2] || '';
        if (!cellVal) continue;

        const isOff = cellVal.toUpperCase() === 'OFF';
        let shift_start_time = null;
        let shift_end_time = null;

        if (!isOff) {
          const m = cellVal.match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})$/);
          if (m) {
            shift_start_time = m[1].length === 4 ? '0' + m[1] : m[1];
            shift_end_time = m[2].length === 4 ? '0' + m[2] : m[2];
          } else {
            warnings.push(`Row ${i + 1}, ${header[d + 1] || 'day ' + (d + 1)}: Invalid time format "${cellVal}" — expected HH:MM-HH:MM or OFF`);
            continue;
          }
        }

        assignments.push({
          user_id: user.id,
          employee_name: user.name,
          shift_date: dayDates[d],
          shift_start_time,
          shift_end_time,
          is_off: isOff,
        });
      }
    }

    res.json({ assignments, warnings, dates: dayDates });
  } catch (e) {
    if (e.name === 'ZodError') return res.status(400).json({ error: e.errors.map(err => err.message).join(', ') });
    next(e);
  }
});

export default router;
