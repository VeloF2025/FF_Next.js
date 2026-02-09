-- Migration 171: OES PP (Pre-Provision) Data Import & Resolution
-- Tracks pre-provisioned ONT serial numbers from OES PP DATA tab
-- and resolves them to actual DR numbers via local DB + 1Map lookups

-- Import batch tracking
CREATE TABLE IF NOT EXISTS oes_pp_import_batches (
  id SERIAL PRIMARY KEY,
  filename TEXT NOT NULL,
  total_rows INTEGER NOT NULL DEFAULT 0,
  resolved_count INTEGER NOT NULL DEFAULT 0,
  unresolved_count INTEGER NOT NULL DEFAULT 0,
  imported_by TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- PP data records
CREATE TABLE IF NOT EXISTS oes_pp_data (
  id SERIAL PRIMARY KEY,
  serial_number TEXT NOT NULL,
  project TEXT NOT NULL,
  date_registered DATE,
  resolution_status TEXT NOT NULL DEFAULT 'unresolved'
    CHECK (resolution_status IN ('unresolved', 'matched_oes', 'matched_unified', 'matched_onemap', 'matched_1map')),
  resolved_drop_number TEXT,
  resolved_source TEXT,
  resolved_details JSONB,
  resolved_at TIMESTAMP WITH TIME ZONE,
  import_batch_id INTEGER REFERENCES oes_pp_import_batches(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(serial_number, project)
);

-- Indexes for resolution queries
CREATE INDEX IF NOT EXISTS idx_oes_pp_data_status ON oes_pp_data(resolution_status);
CREATE INDEX IF NOT EXISTS idx_oes_pp_data_serial ON oes_pp_data(serial_number);
CREATE INDEX IF NOT EXISTS idx_oes_pp_data_project ON oes_pp_data(project);
CREATE INDEX IF NOT EXISTS idx_oes_pp_data_batch ON oes_pp_data(import_batch_id);
