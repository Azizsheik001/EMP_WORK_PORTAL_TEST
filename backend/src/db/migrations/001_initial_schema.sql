-- AGS Workforce — Initial schema
-- Run once: psql $DATABASE_URL -f src/db/migrations/001_initial_schema.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE clients (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          VARCHAR(255) NOT NULL UNIQUE,
  password_hash  VARCHAR(255) NOT NULL,
  name           VARCHAR(255) NOT NULL,
  role           VARCHAR(50) NOT NULL CHECK (role IN ('admin','manager','team_lead','employee')),
  client_id      UUID REFERENCES clients(id),
  manager_id     UUID REFERENCES users(id),
  team_lead_id   UUID REFERENCES users(id),
  deleted_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE clients ADD COLUMN team_lead_id UUID REFERENCES users(id);

CREATE TABLE leave_requests (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id    UUID NOT NULL REFERENCES users(id),
  leave_date     DATE NOT NULL,
  reason         TEXT,
  status         VARCHAR(50) NOT NULL DEFAULT 'pending_team_lead'
    CHECK (status IN ('pending_team_lead','pending_manager','pending_ceo','approved','rejected')),
  approval_chain JSONB NOT NULL DEFAULT '[]',
  rejected_by    UUID REFERENCES users(id),
  rejected_at    TIMESTAMPTZ,
  requested_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_leave_requests_employee ON leave_requests(employee_id);
CREATE INDEX idx_leave_requests_status ON leave_requests(status);

CREATE TABLE schedule_uploads (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id    UUID NOT NULL REFERENCES clients(id),
  week_number  INT NOT NULL CHECK (week_number >= 1 AND week_number <= 53),
  uploaded_by  UUID NOT NULL REFERENCES users(id),
  file_url     VARCHAR(500),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (client_id, week_number)
);

CREATE TABLE shift_assignments (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES users(id),
  client_id    UUID NOT NULL REFERENCES clients(id),
  week_number  INT NOT NULL CHECK (week_number >= 1 AND week_number <= 53),
  shift_slot   VARCHAR(100),
  login_time   TIMESTAMPTZ,
  logout_time  TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, week_number)
);

CREATE TABLE clock_events (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES users(id),
  event_type VARCHAR(10) NOT NULL CHECK (event_type IN ('in','out')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_clock_events_user_created ON clock_events(user_id, created_at);
