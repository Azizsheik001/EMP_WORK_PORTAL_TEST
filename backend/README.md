# AGS Workforce API

Backend for the Employee Shift Management Portal. Node.js + Express + PostgreSQL.

## Role hierarchy and leave flow

- **admin** — CEO / Co-founders (full access; final leave approval).
- **manager** — Manager (second-level leave approval).
- **team_lead** — Team lead (first-level leave approval; upload schedules).
- **employee** — Employee (request leave; clock in/out).

Leave approval chain: **Employee** → **Team Lead** → **Manager** → **Admin (CEO)** → **Approved**.

## Setup

1. **Install dependencies**
   ```bash
   cd backend && npm install
   ```

2. **Environment**
   ```bash
   cp .env.example .env
   # Set DATABASE_URL (PostgreSQL), JWT_SECRET, CORS_ORIGIN
   ```

3. **Database**
   - Use **Supabase** (recommended): set `DATABASE_URL` from Supabase → Project Settings → Database (connection string). Tables are created via `docs/supabase_schema.sql` in the SQL Editor.
   - Or any PostgreSQL: run `docs/supabase_schema.sql` or `src/db/migrations/001_initial_schema.sql`.
   - Seed an admin user and a demo client:
     ```bash
     npm run seed
     ```
     Then log in with **admin@amgsol.com** / **admin123** (or set `SEED_ADMIN_EMAIL`, `SEED_ADMIN_PASSWORD`, `SEED_ADMIN_NAME` in `.env`).

4. **Run**
   ```bash
   npm run dev
   ```
   API: `http://localhost:3000`. Health: `GET /api/health`.

## API overview

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | /api/auth/login | no | Login (email, password) → { user, token } |
| GET | /api/users/me | yes | Current user |
| GET | /api/users | admin, manager | List users |
| GET | /api/clients | yes | List clients |
| POST | /api/leave-requests | employee, team_lead | Create leave request |
| GET | /api/leave-requests | yes | List (my or pending for role) |
| PATCH | /api/leave-requests/:id/approve | team_lead, manager, admin | Approve (advances workflow) |
| PATCH | /api/leave-requests/:id/reject | team_lead, manager, admin | Reject |
| POST | /api/schedules | team_lead, admin | Upload schedule (client_id, iso_year, start_week, weeks_count) |
| GET | /api/shifts | yes | Shifts (query: week, year, client_id) — date-wise |
| POST | /api/shifts/clock-in | yes | Clock in |
| POST | /api/shifts/clock-out | yes | Clock out |

Send JWT in header: `Authorization: Bearer <token>`.

## Database plan

See **`docs/DATABASE_PLAN.md`** for schema, indexes, migrations strategy, and agile guidelines.
