import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

// Override parsing for DATE type (OID 1082)
pg.types.setTypeParser(pg.types.builtins.DATE, (val) => val);

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    const res = await pool.query("SELECT '2026-04-10'::date AS start_date");
    console.log("JSON stringified:", JSON.stringify(res.rows[0]));
  } catch (e) {
    console.error(e);
  } finally {
    pool.end();
  }
}

main();
