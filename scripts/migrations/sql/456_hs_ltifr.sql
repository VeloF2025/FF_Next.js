-- 456: H&S injury-rate analytics — man-hours + classified injuries (goal Phase 6)
--
-- The two inputs to LTIFR / DIFR / TRIFR: hours worked (per project per month)
-- and classified injuries. Rates are computed in SQL from these (§4.7), never
-- stored, so a corrected man-hour figure re-rates automatically.
--
-- Classification drives which rate an injury counts toward:
--   fatality / lost_time     → LTI  (LTIFR)
--   + restricted_work        → disabling (DIFR)
--   + medical_treatment      → total recordable (TRIFR)
--   first_aid                → none (not recordable)
--
-- Idempotent. Rollback: rollback_456_hs_ltifr.sql.

BEGIN;

CREATE TABLE IF NOT EXISTS hs_man_hours (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid REFERENCES projects(id) ON DELETE SET NULL,
  period_year   integer NOT NULL,
  period_month  integer NOT NULL,
  hours_worked  numeric(12,2) NOT NULL,
  headcount     integer,
  notes         text,
  created_by    uuid,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hs_man_hours_month_check CHECK (period_month BETWEEN 1 AND 12),
  CONSTRAINT hs_man_hours_hours_check CHECK (hours_worked >= 0)
);

-- One man-hours row per project per month (a project_id NULL row = company-wide
-- hours not attributed to a project). The partial unique indexes handle the
-- NULL project_id case, which a plain UNIQUE would not dedupe.
CREATE UNIQUE INDEX IF NOT EXISTS hs_man_hours_project_period_key
  ON hs_man_hours (project_id, period_year, period_month) WHERE project_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS hs_man_hours_noproject_period_key
  ON hs_man_hours (period_year, period_month) WHERE project_id IS NULL;

CREATE TABLE IF NOT EXISTS hs_injuries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id      uuid REFERENCES projects(id) ON DELETE SET NULL,
  -- optional link to the incident maintenance_ticket (no FK — same convention
  -- as hs_ticket_details)
  ticket_id       uuid,
  injury_date     date NOT NULL,
  classification  varchar(24) NOT NULL,
  days_lost       integer NOT NULL DEFAULT 0,
  body_part       text,
  description     text,
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT hs_injuries_classification_check
    CHECK (classification IN ('first_aid','medical_treatment','restricted_work','lost_time','fatality')),
  CONSTRAINT hs_injuries_days_lost_check CHECK (days_lost >= 0)
);

CREATE INDEX IF NOT EXISTS hs_injuries_project_idx ON hs_injuries (project_id);
CREATE INDEX IF NOT EXISTS hs_injuries_date_idx ON hs_injuries (injury_date);
CREATE INDEX IF NOT EXISTS hs_injuries_class_idx ON hs_injuries (classification);

COMMIT;
