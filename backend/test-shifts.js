import 'dotenv/config';
import { query } from './src/lib/db.js';

async function run() {
  const r = await query("SELECT id FROM clients WHERE name ILIKE '%cleanleaf%'");
  const cleanleafId = r.rows[0].id;
  
  const r2 = await query(`
    SELECT sa.shift_date, sa.client_id as sa_client_id, u.client_id as u_client_id, 
           EXISTS(SELECT 1 FROM user_client_assignments uca WHERE uca.user_id = u.id AND uca.client_id = $1) as in_uca
    FROM shift_assignments sa
    JOIN users u ON u.id = sa.user_id
    WHERE u.name ILIKE '%keerthi%' AND sa.shift_date >= '2026-05-04' AND sa.shift_date <= '2026-05-10'
  `, [cleanleafId]);
  
  console.log("Cleanleaf ID:", cleanleafId);
  console.table(r2.rows);
  process.exit();
}
run();
