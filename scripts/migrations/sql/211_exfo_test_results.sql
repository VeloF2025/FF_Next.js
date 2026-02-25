-- Migration 211: EXFO Exchange Test Results
-- Stores fiber optic test data synced from EXFO Exchange platform
-- Supports OLTS (Optical Loss Test Set) and iOLM (intelligent Optical Link Mapper) results

-- =============================================================================
-- 1. Main test results table
-- =============================================================================
CREATE TABLE IF NOT EXISTS exfo_test_results (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- EXFO identifiers
  exfo_result_id        TEXT NOT NULL UNIQUE,
  exfo_account_id       TEXT,
  exfo_workspace_id     TEXT NOT NULL,
  exfo_job_id           TEXT,
  exfo_brief_job_id     TEXT,

  -- Test metadata
  test_type             TEXT NOT NULL,            -- 'olts' or 'iolm'
  test_name             TEXT NOT NULL,            -- Full test name e.g. MOA.STS.1.DIS.DM.P.B756-C5P5.L14-L1
  job_name              TEXT,
  config_name           TEXT,
  global_verdict        TEXT,                     -- 'Pass', 'Fail', null
  test_date_time        TIMESTAMPTZ,
  server_updated_date   TIMESTAMPTZ,

  -- Parsed name components (from naming convention)
  parsed_project        TEXT,                     -- MOA, GRA, etc.
  parsed_section        TEXT,                     -- STS
  parsed_section_num    INTEGER,                  -- 1, 2, etc.
  parsed_pole           TEXT,                     -- B756
  parsed_cabinet        TEXT,                     -- C5
  parsed_port           TEXT,                     -- P5
  parsed_link           TEXT,                     -- L14
  parsed_fiber          TEXT,                     -- L1

  -- Equipment (Unit A)
  unit_a_serial         TEXT,
  unit_a_model          TEXT,
  unit_a_calibration    DATE,

  -- Equipment (Unit B - for OLTS bidirectional tests)
  unit_b_serial         TEXT,
  unit_b_model          TEXT,
  unit_b_calibration    DATE,

  -- Platform / handheld device
  platform_serial       TEXT,
  platform_model        TEXT,

  -- Identification
  company_name          TEXT,
  customer_name         TEXT,
  operator_a            TEXT,
  operator_b            TEXT,
  test_point_name       TEXT,

  -- Fiber info
  fiber_type            TEXT,
  location_direction    TEXT,

  -- Identifiers from brief
  cable_id              TEXT,
  fiber_id              TEXT,
  location_a            TEXT,
  location_b            TEXT,

  -- Geolocation
  geolocation           JSONB,

  -- Technician
  created_by_uuid       TEXT,                     -- EXFO user UUID
  updated_by_uuid       TEXT,

  -- Full measurement data (large JSON blob)
  measurement_data      JSONB,

  -- Attachments count
  attachments_count     INTEGER DEFAULT 0,

  -- FibreFlow cross-references (populated by matching logic)
  project_id            UUID REFERENCES projects(id),
  asset_id              UUID,                     -- FK to assets table (testing equipment)
  asset_id_b            UUID,                     -- FK to assets (second unit for OLTS)
  feature_id            TEXT,                     -- Matched construction feature

  -- Sync metadata
  sync_batch_id         UUID,
  synced_at             TIMESTAMPTZ DEFAULT NOW(),
  raw_search_data       JSONB,                    -- Original search result
  raw_measurement_data  JSONB,                    -- Original measurement detail

  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_exfo_results_workspace ON exfo_test_results(exfo_workspace_id);
CREATE INDEX IF NOT EXISTS idx_exfo_results_test_type ON exfo_test_results(test_type);
CREATE INDEX IF NOT EXISTS idx_exfo_results_verdict ON exfo_test_results(global_verdict);
CREATE INDEX IF NOT EXISTS idx_exfo_results_project ON exfo_test_results(project_id);
CREATE INDEX IF NOT EXISTS idx_exfo_results_asset ON exfo_test_results(asset_id);
CREATE INDEX IF NOT EXISTS idx_exfo_results_test_date ON exfo_test_results(test_date_time DESC);
CREATE INDEX IF NOT EXISTS idx_exfo_results_server_updated ON exfo_test_results(server_updated_date DESC);
CREATE INDEX IF NOT EXISTS idx_exfo_results_parsed_project ON exfo_test_results(parsed_project);
CREATE INDEX IF NOT EXISTS idx_exfo_results_unit_a_serial ON exfo_test_results(unit_a_serial);

-- =============================================================================
-- 2. Sync configuration — one row per EXFO workspace
-- =============================================================================
CREATE TABLE IF NOT EXISTS exfo_sync_config (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          TEXT NOT NULL UNIQUE,
  workspace_name        TEXT NOT NULL,
  org_id                TEXT NOT NULL,
  is_active             BOOLEAN DEFAULT true,
  sync_interval_minutes INTEGER DEFAULT 60,
  last_sync_at          TIMESTAMPTZ,
  last_sync_cursor      TEXT,                     -- serverUpdatedDate of last synced result
  project_id            UUID REFERENCES projects(id),  -- Default project mapping
  created_at            TIMESTAMPTZ DEFAULT NOW(),
  updated_at            TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================================================
-- 3. Sync history / audit log
-- =============================================================================
CREATE TABLE IF NOT EXISTS exfo_sync_history (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id          TEXT NOT NULL,
  sync_type             TEXT NOT NULL DEFAULT 'incremental',  -- 'full' or 'incremental'
  status                TEXT NOT NULL DEFAULT 'running',      -- 'running', 'completed', 'failed'
  results_fetched       INTEGER DEFAULT 0,
  results_inserted      INTEGER DEFAULT 0,
  results_updated       INTEGER DEFAULT 0,
  details_fetched       INTEGER DEFAULT 0,
  assets_matched        INTEGER DEFAULT 0,
  error_message         TEXT,
  started_at            TIMESTAMPTZ DEFAULT NOW(),
  completed_at          TIMESTAMPTZ,
  created_at            TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exfo_sync_history_workspace ON exfo_sync_history(workspace_id);
CREATE INDEX IF NOT EXISTS idx_exfo_sync_history_status ON exfo_sync_history(status);
