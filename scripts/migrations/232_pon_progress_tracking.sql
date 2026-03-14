-- Migration 232: PON Progress Tracking
-- Adds target dates, maintenance stage, blockage field, daily activity log, and monthly targets
-- Related: Build > Progress working page

-- === Target dates per category (planned completion) ===
ALTER TABLE pon_stage_tracking ADD COLUMN IF NOT EXISTS cwc_target_date DATE;
ALTER TABLE pon_stage_tracking ADD COLUMN IF NOT EXISTS optical_target_date DATE;
ALTER TABLE pon_stage_tracking ADD COLUMN IF NOT EXISTS activation_target_date DATE;

-- === Maintenance stage (new) ===
ALTER TABLE pon_stage_tracking ADD COLUMN IF NOT EXISTS maintenance_total INTEGER DEFAULT 0;
ALTER TABLE pon_stage_tracking ADD COLUMN IF NOT EXISTS maintenance_complete INTEGER DEFAULT 0;
ALTER TABLE pon_stage_tracking ADD COLUMN IF NOT EXISTS maintenance_first_date DATE;
ALTER TABLE pon_stage_tracking ADD COLUMN IF NOT EXISTS maintenance_last_date DATE;
ALTER TABLE pon_stage_tracking ADD COLUMN IF NOT EXISTS maintenance_target_date DATE;

-- === Blockage/status field (from tracker "Blockage" column) ===
ALTER TABLE pon_stage_tracking ADD COLUMN IF NOT EXISTS blockage TEXT;

-- Update overall_stage CHECK to include 'maintenance'
ALTER TABLE pon_stage_tracking DROP CONSTRAINT IF EXISTS pon_stage_tracking_overall_stage_check;
ALTER TABLE pon_stage_tracking ADD CONSTRAINT pon_stage_tracking_overall_stage_check
  CHECK (overall_stage IN ('not_started','permissions','poles','cwc','optical','atp','activation','maintenance','complete'));

-- === Daily activity log per PON (replaces Johan's daily date columns) ===
CREATE TABLE IF NOT EXISTS pon_daily_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pon_stage_id UUID NOT NULL REFERENCES pon_stage_tracking(id) ON DELETE CASCADE,
  log_date DATE NOT NULL,
  category VARCHAR(20) NOT NULL CHECK (category IN ('cwc','optical','activation','maintenance')),
  activity TEXT NOT NULL,
  delay_reason VARCHAR(50) CHECK (delay_reason IN ('rain','smme_issues','stock_issues','site_stopped','access_issues','power_issues','permit_delay','equipment_failure','other')),
  logged_by VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(pon_stage_id, log_date, category)
);
CREATE INDEX IF NOT EXISTS idx_pon_daily_log_stage ON pon_daily_log(pon_stage_id);
CREATE INDEX IF NOT EXISTS idx_pon_daily_log_date ON pon_daily_log(log_date);
CREATE INDEX IF NOT EXISTS idx_pon_daily_log_lookup ON pon_daily_log(pon_stage_id, category, log_date DESC);

-- === Monthly targets per project per category ===
CREATE TABLE IF NOT EXISTS project_monthly_targets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  month DATE NOT NULL,
  category VARCHAR(20) NOT NULL CHECK (category IN ('cwc','optical','activation','maintenance')),
  target_pons INTEGER DEFAULT 0,
  target_hps INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, month, category)
);
CREATE INDEX IF NOT EXISTS idx_project_monthly_targets_lookup ON project_monthly_targets(project_id, month);
