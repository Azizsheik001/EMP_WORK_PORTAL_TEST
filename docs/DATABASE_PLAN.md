# AGS Workforce — Database Plan

Industry-standard, agile-friendly database design for the Employee Shift Management Portal.

---

## 1. Design principles

- **Single source of truth:** Normalized tables; avoid duplicating data.
- **Audit trail:** `created_at`, `updated_at`, and where needed `deleted_at` (soft delete).
- **Role-based access:** Enforced in API; DB stores `role` and hierarchy (manager_id, team_lead_id, client_id).
- **Agile:** Schema changes via versioned migrations; no breaking changes without a migration.
- **Indexes:** On foreign keys, status, and frequently filtered columns (week_number, client_id, email).

---

## 2. Role hierarchy

| Role      | Description        | Leave approval step      |
|-----------|--------------------|---------------------------|
| `admin`   | CEO / Co-founder   | Final approval (pending_ceo → approved) |
| `manager` | Manager            | Second (pending_manager → pending_ceo) |
| `team_lead` | Team lead        | First (pending_team_lead → pending_manager) |
| `employee`  | Employee          | Submits request          |

Leave flow: **Employee** → **Team Lead** → **Manager** → **Admin (CEO)** → **Approved**.

---

## 3. Schema overview

### 3.1 Core entities

```
clients          (id, name, team_lead_id, created_at, updated_at)
users            (id, email, password_hash, name, role, client_id, manager_id, team_lead_id, ...)
leave_requests   (id, employee_id, leave_date, reason, status, approval_chain, rejected_by, ...)
schedule_uploads (id, client_id, week_number, uploaded_by, file_url or metadata, ...)
shift_assignments (id, user_id, client_id, week_number, shift_slot, ...)
clock_events     (id, user_id, event_type, created_at)
notifications    (optional: id, user_id, type, payload, read_at, created_at)
```

### 3.2 Table definitions (PostgreSQL)

#### `clients`
| Column        | Type      | Notes                    |
|---------------|-----------|--------------------------|
| id            | UUID PK   | default gen_random_uuid() |
| name          | VARCHAR   | not null                 |
| team_lead_id  | UUID FK→users | nullable            |
| created_at    | TIMESTAMPTZ | default now()          |
| updated_at    | TIMESTAMPTZ | default now()          |

#### `users`
| Column         | Type       | Notes                    |
|----------------|------------|--------------------------|
| id             | UUID PK    | default gen_random_uuid() |
| email          | VARCHAR    | unique, not null         |
| password_hash  | VARCHAR    | not null (bcrypt)        |
| name           | VARCHAR    | not null                 |
| role           | VARCHAR    | admin \| manager \| team_lead \| employee |
| client_id      | UUID FK→clients | nullable (for employee/team_lead) |
| manager_id     | UUID FK→users | nullable (for team_lead) |
| team_lead_id   | UUID FK→users | nullable (for employee) |
| deleted_at     | TIMESTAMPTZ | nullable, soft delete   |
| created_at     | TIMESTAMPTZ | default now()          |
| updated_at     | TIMESTAMPTZ | default now()          |

#### `leave_requests`
| Column         | Type       | Notes                    |
|----------------|------------|--------------------------|
| id             | UUID PK    | default gen_random_uuid() |
| employee_id    | UUID FK→users | not null               |
| leave_date     | DATE       | not null                 |
| reason         | TEXT       | nullable                 |
| status         | VARCHAR    | pending_team_lead \| pending_manager \| pending_ceo \| approved \| rejected |
| approval_chain | JSONB      | [] array of { role, user_id, user_name, at } |
| rejected_by    | UUID FK→users | nullable               |
| rejected_at    | TIMESTAMPTZ | nullable                |
| requested_at   | TIMESTAMPTZ | default now()          |
| updated_at     | TIMESTAMPTZ | default now()          |

#### `schedule_uploads`
| Column      | Type       | Notes                    |
|-------------|------------|--------------------------|
| id          | UUID PK    | default gen_random_uuid() |
| client_id   | UUID FK→clients | not null             |
| week_number | INT        | 1–53, not null          |
| uploaded_by | UUID FK→users | not null               |
| file_url    | VARCHAR    | optional storage URL    |
| created_at  | TIMESTAMPTZ | default now()          |
| updated_at  | TIMESTAMPTZ | default now()          |
| UNIQUE (client_id, week_number) | | one upload per client per week |

#### `shift_assignments`
| Column      | Type       | Notes                    |
|-------------|------------|--------------------------|
| id          | UUID PK    | default gen_random_uuid() |
| user_id     | UUID FK→users | not null               |
| client_id   | UUID FK→clients | not null               |
| week_number | INT        | 1–53                     |
| shift_slot  | VARCHAR    | e.g. '6:00 AM - 2:00 PM' |
| login_time  | TIMESTAMPTZ | nullable                |
| logout_time | TIMESTAMPTZ | nullable                |
| created_at  | TIMESTAMPTZ | default now()          |
| UNIQUE (user_id, week_number) | | one assignment per user per week |

#### `clock_events`
| Column     | Type       | Notes                    |
|------------|------------|--------------------------|
| id         | UUID PK    | default gen_random_uuid() |
| user_id    | UUID FK→users | not null               |
| event_type | VARCHAR    | 'in' \| 'out'            |
| created_at | TIMESTAMPTZ | default now()          |

---

## 4. Migrations strategy (agile)

- **Tool:** Versioned SQL files or a small runner (e.g. `node src/db/migrate.js`).
- **Naming:** `migrations/001_initial_schema.sql`, `002_add_notifications.sql`, etc.
- **Order:** Each migration is additive or has explicit alter/drop; no destructive change without a dedicated migration.
- **Rollback:** Prefer additive changes; document reverse steps in migration file header if needed.

---

## 5. Indexes

- `users(email)` unique, `users(role)`, `users(client_id)`, `users(manager_id)`, `users(team_lead_id)`.
- `leave_requests(employee_id)`, `leave_requests(status)`, `leave_requests(leave_date)`.
- `schedule_uploads(client_id, week_number)` unique.
- `shift_assignments(user_id, week_number)` unique, `shift_assignments(client_id, week_number)`.
- `clock_events(user_id, created_at)`.

---

## 6. Security and environment

- **Secrets:** Passwords hashed with bcrypt; JWT secret and `DATABASE_URL` from environment.
- **Connections:** Use connection pooling (pg.Pool); never log `DATABASE_URL` or tokens.
- **Backups:** Regular PostgreSQL backups; point-in-time recovery where required.

---

## 7. Next steps

1. Run initial migration to create tables.
2. Seed minimal data (clients, admin users) for development.
3. Connect frontend to API (replace mock data with `fetch`/axios to backend).
4. Add further migrations as features evolve (e.g. notifications table, file storage for schedules).
