# Efficient Schema Changes — Normalized & Industry-Standard

Recommendations for your existing Supabase schema to improve normalization, consistency, and alignment with common practice.

---

## 1. **Naming: snake_case everywhere**

You already use `snake_case` for tables and columns. Keep it consistent and avoid mixing camelCase in the DB.

---

## 2. **Referential integrity**

- **ON DELETE behavior**: Define what happens when a parent row is deleted.
  - **clients**: `team_lead_id` → consider `ON DELETE SET NULL` so deleting a user doesn’t break clients.
  - **users**: `client_id`, `manager_id`, `team_lead_id` → `ON DELETE SET NULL`.
  - **shift_assignments**, **leave_requests**, **clock_events**: keep `ON DELETE` as-is or use `RESTRICT` if you never want to delete a user who has data; otherwise `CASCADE` or `SET NULL` depending on policy.

**Example migration snippet:**
```sql
ALTER TABLE clients
  DROP CONSTRAINT IF EXISTS clients_team_lead_id_fkey,
  ADD CONSTRAINT clients_team_lead_id_fkey
    FOREIGN KEY (team_lead_id) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE users
  DROP CONSTRAINT IF EXISTS users_client_id_fkey,
  ADD CONSTRAINT users_client_id_fkey
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL;
-- Repeat for manager_id, team_lead_id with ON DELETE SET NULL
```

---

## 3. **Normalization**

- **leave_balances**: `total_remaining` is derivable as `total_allocated - total_used`. Storing it is redundant and can get out of sync. Options:
  - **Preferred**: Drop `total_remaining` and compute in queries/views.
  - **Alternative**: Keep it as a cached value and maintain it via trigger or application logic.

- **shift_assignments**: You already have one row per (user, client, date). Good. With `is_off` and nullable times, add a check so that either (`is_off = true`) or (`shift_start_time` and `shift_end_time` are both non-null):

```sql
ALTER TABLE shift_assignments ADD CONSTRAINT chk_shift_or_off
  CHECK (
    (is_off = true AND shift_start_time IS NULL AND shift_end_time IS NULL)
    OR (is_off = false AND shift_start_time IS NOT NULL AND shift_end_time IS NOT NULL)
  );
```

- **users.client_id**: You also have `user_client_assignments`. Decide one source of truth:
  - **Option A**: Keep `client_id` as “primary” client and use `user_client_assignments` for additional clients (many-to-many).
  - **Option B**: Remove `users.client_id` and use only `user_client_assignments` for all user–client links. More normalized but more joins.

---

## 4. **Audit and timestamps**

- **updated_at**: Keep on all main tables. Optionally use a single trigger so it’s never missed:

```sql
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Then per table:
CREATE TRIGGER set_users_updated_at
  BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- (repeat for clients, shift_assignments, leave_requests, leave_balances, schedule_uploads, departments)
```

- **created_by / updated_by**: For stricter audit trails, add `created_by UUID REFERENCES users(id)` and `updated_by UUID REFERENCES users(id)` on key tables (e.g. leave_requests, shift_assignments, schedule_uploads). Optional but industry-common.

---

## 5. **Indexes**

You already have solid indexes. Consider adding:

- **Composite for common filters**:
  - `CREATE INDEX idx_shift_assignments_client_date_user ON shift_assignments(client_id, shift_date, user_id);` if you often filter by client and date then look up users.
- **Partial indexes** for “active” data:
  - `CREATE INDEX idx_leave_requests_pending ON leave_requests(status) WHERE status LIKE 'pending_%';`
- **clock_events**: If you query by (user_id, shift_date, event_type), add:
  - `CREATE INDEX idx_clock_events_user_date_type ON clock_events(user_id, shift_date, event_type);`

---

## 6. **Enums instead of CHECK**

Replace string + CHECK with PostgreSQL enums for clearer types and reuse:

```sql
CREATE TYPE user_role AS ENUM ('admin', 'manager', 'team_lead', 'employee');
CREATE TYPE leave_request_status AS ENUM ('pending_team_lead', 'pending_manager', 'pending_ceo', 'approved', 'rejected');
CREATE TYPE clock_event_type AS ENUM ('clock_in', 'clock_out', 'in', 'out');

-- Then in tables:
ALTER TABLE users ALTER COLUMN role TYPE user_role USING role::user_role;
ALTER TABLE leave_requests ALTER COLUMN status TYPE leave_request_status USING status::leave_request_status;
ALTER TABLE clock_events ALTER COLUMN event_type TYPE clock_event_type USING event_type::clock_event_type;
```

(Migration path: add new enum column, backfill, switch, drop old column if needed.)

---

## 7. **Constraints**

- **leave_requests**: You have `end_date >= start_date`. Good.
- **leave_balances**: Add `CHECK (total_used <= total_allocated)` if you never allow over-use, or enforce in app.
- **schedule_uploads**: `UNIQUE (client_id, iso_year, week_number)` is good. Optionally add `CHECK (week_start_date IS NOT NULL)` if you always compute it.

---

## 8. **Optional but useful**

- **Row-level security (RLS)** in Supabase: Enable RLS on sensitive tables and add policies so each role sees only allowed rows (e.g. employees see only their leave_requests, managers see their team).
- **Soft delete**: You have `users.deleted_at`. Optionally add `deleted_at` on `clients` if you want to “hide” clients without losing history.
- **Tenancy**: If you ever support multiple companies, add `tenant_id` or `organization_id` to all main tables and partition or index by it.

---

## Summary table

| Area              | Change                                      | Benefit                          |
|-------------------|---------------------------------------------|----------------------------------|
| FK behavior       | ON DELETE SET NULL on optional FKs          | Clean deletes, no broken refs     |
| leave_balances    | Drop or derive `total_remaining`             | No redundant/out-of-sync data   |
| shift_assignments | CHECK (shift vs OFF mutually exclusive)     | Data consistency                 |
| updated_at        | Trigger for all tables                       | Always up to date                |
| Indexes           | Composite / partial for hot queries         | Faster filters and joins         |
| Enums             | user_role, leave_request_status, etc.       | Type safety, clarity              |
| RLS               | Policies per role                            | Security at DB layer              |

Apply these in small migrations (one concern per migration) and run tests after each. Your current schema is already in good shape; these changes refine normalization and align with common industry practice.
