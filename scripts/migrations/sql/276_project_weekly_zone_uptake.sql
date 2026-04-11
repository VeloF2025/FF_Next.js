-- Migration 276: Weekly zone + zone/PON uptake tables
-- Context: The FT weekly upload bundle includes two additional PDFs per project
-- ("installation uptake per zone" and "installation uptake per zone per pon")
-- that contain cumulative completion metrics — planned drops, installed, and %
-- per zone (and per PON within each zone). We now ingest these so we can show
-- zone-level progress trends alongside billing.
-- Safety: Additive only — new tables, no changes to existing tables.

CREATE TABLE IF NOT EXISTS project_weekly_zone_uptake (
  id               SERIAL PRIMARY KEY,
  week_ending      DATE NOT NULL,
  project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  project_name     VARCHAR(100) NOT NULL,
  zone_no          INTEGER NOT NULL,
  planned_drops    INTEGER NOT NULL DEFAULT 0,
  installed        INTEGER NOT NULL DEFAULT 0,
  pct_installed    NUMERIC(5,2) NOT NULL DEFAULT 0,
  uploaded_by      VARCHAR(200),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT project_weekly_zone_uptake_unique UNIQUE (week_ending, project_id, zone_no)
);

CREATE INDEX IF NOT EXISTS idx_pwzu_project_week
  ON project_weekly_zone_uptake (project_id, week_ending DESC);

COMMENT ON TABLE project_weekly_zone_uptake IS
  'Cumulative zone-level installation uptake snapshot per billing week. One row per (week, project, zone). Sourced from FT "installation uptake per zone" PDF.';

CREATE TABLE IF NOT EXISTS project_weekly_zone_pon_uptake (
  id               SERIAL PRIMARY KEY,
  week_ending      DATE NOT NULL,
  project_id       UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  project_name     VARCHAR(100) NOT NULL,
  zone_no          INTEGER NOT NULL,
  pon_no           INTEGER NOT NULL,
  planned_drops    INTEGER NOT NULL DEFAULT 0,
  installed        INTEGER NOT NULL DEFAULT 0,
  pct_installed    NUMERIC(5,2) NOT NULL DEFAULT 0,
  uploaded_by      VARCHAR(200),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT project_weekly_zone_pon_uptake_unique UNIQUE (week_ending, project_id, zone_no, pon_no)
);

CREATE INDEX IF NOT EXISTS idx_pwzpu_project_week
  ON project_weekly_zone_pon_uptake (project_id, week_ending DESC);

COMMENT ON TABLE project_weekly_zone_pon_uptake IS
  'Cumulative zone+PON-level installation uptake snapshot per billing week. One row per (week, project, zone, pon). Sourced from FT "installation uptake per zone per pon" PDF.';
