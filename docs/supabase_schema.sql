-- AGS Workforce — Supabase schema
-- Exact date filters and date-wise scheduling
-- Run in Supabase SQL Editor (or psql) to create all tables.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================================
-- 1. CLIENTS
-- =============================================================================
CREATE TABLE clients (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(255) NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- =============================================================================
-- 2. USERS (team_lead_id on clients added after users exist)
-- =============================================================================
CREATE TABLE users (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email            VARCHAR(255) NOT NULL UNIQUE,
  password_hash    VARCHAR(255) NOT NULL,
  name             VARCHAR(255) NOT NULL,
  role             VARCHAR(50) NOT NULL CHECK (role IN ('admin','manager','team_lead','employee')),
  date_of_birth    DATE,
  client_id        UUID REFERENCES clients(id),
  manager_id       UUID REFERENCES users(id),
  team_lead_id     UUID REFERENCES users(id),
  is_active        BOOLEAN NOT NULL DEFAULT true,
  deleted_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE clients ADD COLUMN team_lead_id UUID REFERENCES users(id);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_role ON users(role);
CREATE INDEX idx_users_client_id ON users(client_id);
CREATE INDEX idx_users_manager_id ON users(manager_id);
CREATE INDEX idx_users_team_lead_id ON users(team_lead_id);
CREATE INDEX idx_users_is_active ON users(is_active) WHERE deleted_at IS NULL;

-- =============================================================================
-- 3. SHIFT_ASSIGNMENTS — date-wise scheduling (one row per user per client per date)
-- =============================================================================
CREATE TABLE shift_assignments (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id),
  client_id        UUID NOT NULL REFERENCES clients(id),
  shift_date       DATE NOT NULL,
  shift_start_time TIME NOT NULL,
  shift_end_time   TIME NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_id, shift_date)
);

CREATE INDEX idx_shift_assignments_shift_date ON shift_assignments(shift_date);
CREATE INDEX idx_shift_assignments_user_date ON shift_assignments(user_id, shift_date);
CREATE INDEX idx_shift_assignments_client_date ON shift_assignments(client_id, shift_date);

-- =============================================================================
-- 4. CLOCK_EVENTS — clock in/out with shift_date for date filters
-- =============================================================================
CREATE TABLE clock_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id),
  shift_date DATE NOT NULL,
  event_type VARCHAR(20) NOT NULL CHECK (event_type IN ('clock_in','clock_out','in','out')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_clock_events_user_shift_date ON clock_events(user_id, shift_date);
CREATE INDEX idx_clock_events_user_created ON clock_events(user_id, created_at);
CREATE INDEX idx_clock_events_shift_date ON clock_events(shift_date);

-- =============================================================================
-- 5. LEAVE_REQUESTS — date range, type, approval chain, rejection
-- =============================================================================
CREATE TABLE leave_requests (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id    UUID NOT NULL REFERENCES users(id),
  start_date     DATE NOT NULL,
  end_date       DATE NOT NULL,
  total_days     NUMERIC(5,2) NOT NULL CHECK (total_days > 0),
  leave_type     VARCHAR(50) NOT NULL DEFAULT 'annual',
  status         VARCHAR(50) NOT NULL DEFAULT 'pending_team_lead'
    CHECK (status IN ('pending_team_lead','pending_manager','pending_ceo','approved','rejected')),
  approval_chain JSONB NOT NULL DEFAULT '[]',
  rejected_by    UUID REFERENCES users(id),
  rejected_at    TIMESTAMPTZ,
  requested_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT leave_requests_date_order CHECK (end_date >= start_date)
);

CREATE INDEX idx_leave_requests_employee ON leave_requests(employee_id);
CREATE INDEX idx_leave_requests_status ON leave_requests(status);
CREATE INDEX idx_leave_requests_start_date ON leave_requests(start_date);
CREATE INDEX idx_leave_requests_end_date ON leave_requests(end_date);
CREATE INDEX idx_leave_requests_dates ON leave_requests(start_date, end_date);

-- =============================================================================
-- 6. LEAVE_BALANCES — per user per year
-- =============================================================================
CREATE TABLE leave_balances (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id),
  year             INT NOT NULL CHECK (year >= 2000 AND year <= 2100),
  total_allocated  NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (total_allocated >= 0),
  total_used        NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (total_used >= 0),
  total_remaining   NUMERIC(6,2) NOT NULL DEFAULT 0 CHECK (total_remaining >= 0),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, year)
);

CREATE INDEX idx_leave_balances_user_year ON leave_balances(user_id, year);

-- =============================================================================
-- 7. NOTIFICATIONS
-- =============================================================================
CREATE TABLE notifications (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id),
  type       VARCHAR(50) NOT NULL,
  title      VARCHAR(255) NOT NULL,
  message    TEXT,
  is_read    BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_user_read ON notifications(user_id, is_read);
CREATE INDEX idx_notifications_created_at ON notifications(created_at);

-- =============================================================================
-- 8. SCHEDULE_UPLOADS (optional — for week-based uploads that feed date-wise shifts)
-- =============================================================================
CREATE TABLE schedule_uploads (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID NOT NULL REFERENCES clients(id),
  iso_year     INT NOT NULL CHECK (iso_year >= 2000 AND iso_year <= 2100),
  week_number  INT NOT NULL CHECK (week_number >= 1 AND week_number <= 53),
  week_start_date DATE,
  uploaded_by  UUID NOT NULL REFERENCES users(id),
  file_url     TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, iso_year, week_number)
);

CREATE INDEX idx_schedule_uploads_client_week ON schedule_uploads(client_id, iso_year, week_number);

-- =============================================================================
-- Optional: updated_at trigger (run once per table if you want auto-update)
-- =============================================================================
-- CREATE OR REPLACE FUNCTION set_updated_at()
-- RETURNS TRIGGER AS $$
-- BEGIN
--   NEW.updated_at = now();
--   RETURN NEW;
-- END;
-- $$ LANGUAGE plpgsql;
--
-- Then for each table with updated_at:
-- CREATE TRIGGER set_clients_updated_at BEFORE UPDATE ON clients
--   FOR EACH ROW EXECUTE FUNCTION set_updated_at();
-- (repeat for users, shift_assignments, leave_requests, leave_balances, schedule_uploads)
