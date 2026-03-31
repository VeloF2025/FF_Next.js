-- Migration 238: Add missing columns to hs_project_config
-- These columns are required by the H&S config API but were not in the original migration

ALTER TABLE hs_project_config
  ADD COLUMN IF NOT EXISTS custom_frequency_days INTEGER,
  ADD COLUMN IF NOT EXISTS min_score_threshold INTEGER DEFAULT 80,
  ADD COLUMN IF NOT EXISTS requires_daily_briefing BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS height_work_permitted BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS hot_work_permitted BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS confined_space_work BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS excavation_work BOOLEAN DEFAULT false,
  ADD COLUMN IF NOT EXISTS notes TEXT;

-- Ensure one config per project for ON CONFLICT upsert
CREATE UNIQUE INDEX IF NOT EXISTS hs_project_config_project_id_key
  ON hs_project_config (project_id);

-- Add missing columns to hs_project_audits
ALTER TABLE hs_project_audits
  ADD COLUMN IF NOT EXISTS audit_type VARCHAR(50) DEFAULT 'routine',
  ADD COLUMN IF NOT EXISTS weather_conditions TEXT,
  ADD COLUMN IF NOT EXISTS site_personnel_count INTEGER;
