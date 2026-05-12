import { config } from 'dotenv';
config();
import { getPool } from './src/db/pool.js';
async function run() {
  const pool = getPool();
  try {
    const res = await pool.query(`SELECT column_name FROM information_schema.columns WHERE table_name='shift_change_requests'`);
    console.log(res.rows.map(x=>x.column_name));
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}
run();
