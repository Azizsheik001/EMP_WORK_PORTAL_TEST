# Supabase setup — AGS Workforce

## Project

- **URL:** `https://weikwftcnyjexgrpmpmy.supabase.co`
- **Project ref:** `weikwftcnyjexgrpmpmy`

## Keys (keep these secret)

| Key | Use | Where to use |
|-----|-----|--------------|
| **Anon (public)** | Frontend, public API | Browser / React app only. Safe to expose. |
| **Service role** | Full DB access, bypasses RLS | **Backend only.** Never in frontend or in git. |

## 1. Frontend (React / Vite)

Create a `.env` file in the **project root** (same folder as `package.json`):

```env
VITE_SUPABASE_URL=https://weikwftcnyjexgrpmpmy.supabase.co
VITE_SUPABASE_ANON_KEY=<paste your anon key (JWT) here>
```

- Use the **anon** key only in the frontend (from Dashboard: Project Settings → API → anon public).
- Restart the dev server after changing `.env` (`npm run dev`).

## 2. Backend (Node API) with Supabase

If your backend talks to Supabase (e.g. with `@supabase/supabase-js` as a server client), create or update `backend/.env`:

```env
SUPABASE_URL=https://weikwftcnyjexgrpmpmy.supabase.co
SUPABASE_SERVICE_ROLE_KEY=<paste your service_role JWT here — never commit this>
```

- Use **service_role** only in the backend.
- Never commit `backend/.env` or put the service_role key in the frontend.

## 3. Database (PostgreSQL connection)

For direct SQL or a backend that uses a PostgreSQL connection string (e.g. `pg`):

1. In Supabase: **Project Settings → Database**.
2. Copy the **Connection string** (URI or “Session mode”).
3. Put it in `backend/.env` as:

```env
DATABASE_URL=postgresql://postgres.[ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres
```

Use this for running migrations (e.g. `docs/supabase_schema.sql`) or for the Node API if it uses `pg` and `DATABASE_URL`.

## 4. Security

- Add **`.env`** (and `backend/.env`) to **.gitignore** so keys are never committed.
- **Anon key** in frontend is fine; Row Level Security (RLS) in Supabase protects data.
- **Service role** bypasses RLS; use only on the server and keep it secret.

## 5. Run the schema

In Supabase **SQL Editor**, run the contents of `docs/supabase_schema.sql` to create tables. Then enable RLS and add policies as needed for your app.
