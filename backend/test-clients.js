import 'dotenv/config';
import { query } from './src/lib/db.js';

async function run() {
  const r = await query("SELECT id, name FROM clients WHERE id IN ('a4a9c19a-7dd0-4605-8e59-922278d9185c', 'ef47ecc4-c4c3-41de-9ef7-bccbb3619516')");
  console.table(r.rows);
  process.exit();
}
run();
