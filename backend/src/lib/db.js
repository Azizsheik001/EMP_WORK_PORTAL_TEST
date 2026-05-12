/**
 * DB helpers: run queries with the shared pool.
 * Supabase (PostgreSQL) connection via DATABASE_URL.
 */
import { getPool } from '../db/pool.js';

export async function query(text, params) {
  const pool = getPool();
  return pool.query(text, params);
}

/** Safely format a JS Date as YYYY-MM-DD using local time (avoids UTC shift from toISOString). */
function localDateStr(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Get ISO week date range for a given year and week (1-53). Returns { startDate, endDate } as YYYY-MM-DD. */
export function getWeekDateRange(isoYear, weekNumber) {
  const jan4 = new Date(isoYear, 0, 4);
  const mon = jan4.getDay() === 0 ? 7 : jan4.getDay();
  const start = new Date(jan4);
  start.setDate(jan4.getDate() - (mon - 1) + (weekNumber - 1) * 7);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  return {
    startDate: localDateStr(start),
    endDate: localDateStr(end),
  };
}
