-- PON Tracker Entries
-- Manual input table replacing SharePoint Excel trackers

CREATE TABLE IF NOT EXISTS pon_tracker_entries (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  zone_no       INTEGER,
  hld_pon       INTEGER,
  z_pon         INTEGER,
  olt_port      TEXT,
  scope_poles   INTEGER,
  scope_drops   INTEGER,
  pole_permission         DATE,
  poles_planted           INTEGER,
  cwc_poles_date          DATE,
  cwc_stringing_date      DATE,
  ready_for_optical       DATE,
  cwc_qa                  BOOLEAN NOT NULL DEFAULT FALSE,
  optical_splicing_date   DATE,
  optical_submitted_date  DATE,
  optical_activated_date  DATE,
  atp_qa                  BOOLEAN NOT NULL DEFAULT FALSE,
  sign_ups      INTEGER,
  homes_po      INTEGER,
  homes_recon   INTEGER,
  activated     INTEGER,
  available     INTEGER,
  blockage      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by    TEXT,
  UNIQUE (project_id, hld_pon)
);

CREATE INDEX IF NOT EXISTS idx_pon_tracker_project ON pon_tracker_entries (project_id);
CREATE INDEX IF NOT EXISTS idx_pon_tracker_zone    ON pon_tracker_entries (project_id, zone_no);
