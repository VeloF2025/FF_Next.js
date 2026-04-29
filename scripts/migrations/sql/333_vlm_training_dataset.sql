-- VLM Training Dataset: national sample of Fibertime home installations
-- Used for VLM categorisation accuracy improvement and few-shot seeding
-- Read-only reference set — excluded from project analytics, OES reconciliation, activations reporting

CREATE TABLE IF NOT EXISTS vlm_training_dataset (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_number TEXT NOT NULL UNIQUE,
  project_name TEXT,                         -- source project (Lawley, Mamelodi, etc.)
  region TEXT NOT NULL,                      -- normalised region for distribution reporting
  client TEXT NOT NULL DEFAULT 'Fibertime',
  contractor TEXT,
  installer_name TEXT,
  installation_date DATE,
  latitude NUMERIC(12, 10),
  longitude NUMERIC(13, 10),
  location_address TEXT,

  -- photo completeness (core 9 steps; excludes step_10_signature + dome steps 11-12)
  core_steps_present INT NOT NULL,
  dome_steps_present INT NOT NULL DEFAULT 0,
  steps_present JSONB NOT NULL DEFAULT '{}',
  photos_metadata JSONB NOT NULL DEFAULT '[]',

  source TEXT NOT NULL DEFAULT 'onemap',
  source_imported_at TIMESTAMPTZ,
  snapshot_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  notes TEXT,
  excluded_from_training BOOLEAN NOT NULL DEFAULT false,
  excluded_reason TEXT,
  excluded_at TIMESTAMPTZ,
  excluded_by TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_vlm_training_region       ON vlm_training_dataset(region);
CREATE INDEX IF NOT EXISTS idx_vlm_training_project      ON vlm_training_dataset(project_name);
CREATE INDEX IF NOT EXISTS idx_vlm_training_core_steps   ON vlm_training_dataset(core_steps_present);
CREATE INDEX IF NOT EXISTS idx_vlm_training_active
  ON vlm_training_dataset(created_at DESC)
  WHERE excluded_from_training = false;
