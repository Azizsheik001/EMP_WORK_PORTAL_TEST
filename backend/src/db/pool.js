import pg from 'pg';

let pool = null;

export function getPool() {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error('DATABASE_URL is not set');
    }
    const isServerless = !!process.env.VERCEL;
    pool = new pg.Pool({
      connectionString,
      max: isServerless ? 2 : 10,
      idleTimeoutMillis: isServerless ? 3000 : 30000,
      connectionTimeoutMillis: 10000,
    });
  }
  return pool;
}
