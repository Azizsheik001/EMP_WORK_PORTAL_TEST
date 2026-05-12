import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    const res = await pool.query("SELECT '2026-04-10'::date AS start_date");
    const dateObj = res.rows[0].start_date;
    console.log("Raw date object:", dateObj);
    console.log("JSON stringified:", JSON.stringify(res.rows[0]));
  } catch (e) {
    console.error(e);
  } finally {
    pool.end();
  }
}

main();
