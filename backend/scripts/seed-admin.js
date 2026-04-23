#!/usr/bin/env node
/**
 * Seed one client and one admin user so you can log in.
 * Run: npm run seed   (from backend folder)
 * Then log in with the email and password below (default: admin@amgsol.com / admin123).
 */
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { getPool } from '../src/db/pool.js';

const DEFAULT_EMAIL = 'admin@amgsol.com';
const DEFAULT_PASSWORD = 'admin123';
const DEFAULT_NAME = 'Admin';

async function seed() {
  const email = process.env.SEED_ADMIN_EMAIL || DEFAULT_EMAIL;
  const password = process.env.SEED_ADMIN_PASSWORD || DEFAULT_PASSWORD;
  const name = process.env.SEED_ADMIN_NAME || DEFAULT_NAME;

  const pool = getPool();
  const passwordHash = await bcrypt.hash(password, 10);

  await pool.query(`
    INSERT INTO clients (name)
    SELECT 'Demo Client' WHERE NOT EXISTS (SELECT 1 FROM clients WHERE name = 'Demo Client')
  `);
  const clientRow = await pool.query(`SELECT id FROM clients WHERE name = 'Demo Client' LIMIT 1`);
  const clientId = clientRow.rows[0]?.id || null;

  const r = await pool.query(
    `INSERT INTO users (email, password_hash, name, role, client_id)
     VALUES ($1, $2, $3, 'admin', $4)
     ON CONFLICT (email) DO UPDATE SET password_hash = $2, name = $3, client_id = $4, updated_at = now()
     RETURNING id, email, name, role`,
    [email, passwordHash, name, clientId]
  );
  const user = r.rows[0];
  if (!user) throw new Error('Insert failed');

  if (clientId) {
    try {
      await pool.query(
        `INSERT INTO user_client_assignments (user_id, client_id) VALUES ($1, $2) ON CONFLICT (user_id, client_id) DO NOTHING`,
        [user.id, clientId]
      );
    } catch (e) {
      if (e.code !== '42P01') throw e;
    }
  }

  console.log('Seed done. You can log in with:');
  console.log('  Email:', user.email);
  console.log('  Password:', password);
  console.log('  Name:', user.name, '| Role:', user.role);
  process.exit(0);
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
