import 'dotenv/config';
import { query } from './src/lib/db.js';

async function run() {
  const r = await query("SELECT id, name, client_id, department_id FROM users WHERE name ILIKE '%keerthi%'");
  console.log('User:');
  console.table(r.rows);
  if (r.rows.length > 0) {
    const r2 = await query("SELECT client_id FROM user_client_assignments WHERE user_id = $1", [r.rows[0].id]);
    console.log('Client Assignments:');
    console.table(r2.rows);
    
    const r3 = await query("SELECT shift_date, client_id, shift_start_time FROM shift_assignments WHERE user_id = $1 ORDER BY shift_date DESC LIMIT 5", [r.rows[0].id]);
    console.log('Shift Assignments:');
    console.table(r3.rows);
  }
  process.exit();
}
run();
