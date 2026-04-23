-- Optional: manual seed (run after supabase_schema.sql).
-- Prefer the Node seed script: from backend run  npm run seed  (creates admin@amgsol.com / admin123 and a Demo Client).

-- Manual insert example (replace PASSWORD_HASH with output of: node -e "import('bcryptjs').then(b=>console.log(b.default.hashSync('admin123',10)))")
-- INSERT INTO clients (name) VALUES ('Demo Client');
-- INSERT INTO users (email, password_hash, name, role) VALUES ('admin@amgsol.com', 'PASSWORD_HASH', 'Admin', 'admin');
