-- SP Tracker Configuration and Data Tables
-- Created: 2026-03-25

-- Table 1: SharePoint Tracker Configuration
CREATE TABLE IF NOT EXISTS sp_tracker_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  project_name varchar(100) NOT NULL,
  drive_id varchar(200) NOT NULL,
  item_id varchar(200) NOT NULL,
  sheet_name varchar(100) NOT NULL DEFAULT 'PON Tracker(N)',
  header_row integer NOT NULL DEFAULT 3,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (project_id)
);

-- Table 2: SP PON Tracker Details
CREATE TABLE IF NOT EXISTS sp_pon_tracker (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  zone_no integer NOT NULL,
  hld_pon integer NOT NULL,
  z_pon integer,
  olt_port varchar(100),
  scope_poles integer,
  scope_drops integer,
  scope_string integer,
  pole_perm integer,
  poles_planted integer,
  sign_ups integer,
  cwc_poles_date date,
  cwc_stringing_date date,
  ready_for_optical_date date,
  cwc_qa_approved integer DEFAULT 0,
  optical_splicing_date date,
  optical_submitted_date date,
  optical_activated_date date,
  atp_qa_approved integer DEFAULT 0,
  homes_po integer,
  homes_recon integer,
  activated integer,
  available integer,
  pon_age_days integer,
  pct_original numeric(5, 4),
  pct_recon numeric(5, 4),
  blockage text,
  synced_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (project_id, zone_no, hld_pon)
);

-- Table 3: SP Project Summary
CREATE TABLE IF NOT EXISTS sp_project_summary (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  permissions_scope integer,
  permissions_complete integer,
  pct_permissions numeric(5, 4),
  poles_scope integer,
  poles_complete integer,
  pct_poles numeric(5, 4),
  signups_scope integer,
  signups_complete integer,
  pct_signups numeric(5, 4),
  cwc_scope integer,
  cwc_complete integer,
  pct_cwc numeric(5, 4),
  optical_scope integer,
  optical_complete integer,
  pct_optical numeric(5, 4),
  connected_scope integer,
  connected_complete integer,
  pct_connected numeric(5, 4),
  synced_at timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (project_id)
);

-- Seed sp_tracker_config with the 3 projects
INSERT INTO sp_tracker_config (project_id, project_name, drive_id, item_id, sheet_name)
SELECT id, 'Lawley', 'b!54aBz82X_0qdf-Qc8hPv-PQzZQ4Q2eFGrzwQ6nSz79cVH1Quyz5vQavmQwdsBGRy', '01XUF54KEFF3BAOWJHP5FY3PEDZYRP5NJB', 'PON Tracker(N)'
FROM projects WHERE project_name = 'Lawley' ON CONFLICT DO NOTHING;

INSERT INTO sp_tracker_config (project_id, project_name, drive_id, item_id, sheet_name)
SELECT id, 'Mohadin', 'b!54aBz82X_0qdf-Qc8hPv-PQzZQ4Q2eFGrzwQ6nSz79cVH1Quyz5vQavmQwdsBGRy', '01XUF54KEJXOBUYOTDK5CYAYD7TODCKBYY', 'PON Tracker(N)'
FROM projects WHERE project_name = 'Mohadin' ON CONFLICT DO NOTHING;

INSERT INTO sp_tracker_config (project_id, project_name, drive_id, item_id, sheet_name)
SELECT id, 'Mamelodi', 'b!54aBz82X_0qdf-Qc8hPv-PQzZQ4Q2eFGrzwQ6nSz79cVH1Quyz5vQavmQwdsBGRy', '01XUF54KD6XKU4LYAF7JGLTUCUFPA6NV3K', 'PON Tracker(N)'
FROM projects WHERE project_name = 'Mamelodi' ON CONFLICT DO NOTHING;

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_sp_pon_tracker_project_id ON sp_pon_tracker(project_id);
CREATE INDEX IF NOT EXISTS idx_sp_pon_tracker_zone_on sp_pon_tracker(project_id, zone_no);
CREATE INDEX IF NOT EXISTS idx_sp_project_summary_project_id ON sp_project_summary(project_id);
