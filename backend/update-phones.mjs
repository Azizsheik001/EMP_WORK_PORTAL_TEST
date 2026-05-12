import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({
  connectionString: 'postgresql://postgres.weikwftcnyjexgrpmpmy:AmericanGreenMadhapur%401976@aws-0-us-west-2.pooler.supabase.com:5432/postgres'
});

async function run() {
  try {
    const res = await pool.query(`UPDATE users SET phone = '+91 ' || phone WHERE length(trim(phone)) = 10 AND phone NOT LIKE '+%'`);
    console.log('Updated ' + res.rowCount + ' rows in users table.');
    
    // Also, some users might have 91xxxxxx instead of +91 xxxxxx
    const res2 = await pool.query(`UPDATE users SET phone = '+91 ' || substr(phone, 3) WHERE length(trim(phone)) = 12 AND phone LIKE '91%'`);
    console.log('Updated ' + res2.rowCount + ' rows in users table missing + sign.');
  } catch (e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}

run();
