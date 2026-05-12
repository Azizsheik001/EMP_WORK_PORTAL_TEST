import 'dotenv/config';
import { query } from './src/lib/db.js';

async function run() {
  const r2 = await query(`
    SELECT sa.shift_date, sa.client_id, sa.created_at, sa.updated_at
    FROM shift_assignments sa
    JOIN users u ON u.id = sa.user_id
    WHERE u.name ILIKE '%keerthi%' AND sa.shift_date = '2026-05-04'
  `);
  console.table(r2.rows);
  process.exit();
}
run();
