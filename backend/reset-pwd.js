import pg from 'pg';
import dotenv from 'dotenv';
import bcrypt from 'bcryptjs';
dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  try {
    const password = 'emp123';
    const hash = await bcrypt.hash(password, 10);
    const res = await pool.query('UPDATE users SET password_hash = $1 WHERE email ILIKE $2 RETURNING id, email', [hash, '%abdulaziz%']);
    console.log('Password reset for:', res.rows[0]);
  } catch (e) {
    console.error(e);
  } finally {
    pool.end();
  }
}

main();
