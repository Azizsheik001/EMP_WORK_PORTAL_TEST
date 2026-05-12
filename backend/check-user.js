import pg from 'pg';
import dotenv from 'dotenv';
dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    const res = await pool.query('SELECT * FROM users WHERE email ILIKE $1', ['%abdulaziz%']);
    console.log('Users found:', res.rows.map(r => ({ id: r.id, email: r.email, role: r.role })));
  } catch (e) {
    console.error(e);
  } finally {
    pool.end();
  }
}

main();
