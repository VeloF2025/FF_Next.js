-- Migration: 122_olt_report_import.sql
-- Purpose: Add OLT report import tracking and extend offline_devices for 5-way serial comparison
-- Date: 2026-01-24
--
-- Extends the existing serial mismatch infrastructure (migration 098) to support:
-- 1. Nokia OLT report imports
-- 2. OLT serial as authoritative source (5th comparison point)
-- 3. Direct 1Map fix tracking

-- OLT Report imports tracking
CREATE TABLE IF NOT EXISTS olt_report_imports (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  filename VARCHAR(255) NOT NULL,
  project VARCHAR(50),  -- LAW, MOH, MAM
  report_date DATE,
  total_records INT DEFAULT 0,
  match_count INT DEFAULT 0,
  mismatch_count INT DEFAULT 0,
  empty_serial_count INT DEFAULT 0,  -- Rows skipped due to empty OLT serial
  not_found_count INT DEFAULT 0,     -- DRs not found in offline_devices
  imported_at TIMESTAMPTZ DEFAULT NOW(),
  imported_by UUID REFERENCES users(id)
);

-- Add OLT serial to offline_devices for 5-way comparison
-- Now we have: OES, Offline, 1Map, WA Photo, OLT
ALTER TABLE offline_devices
ADD COLUMN IF NOT EXISTS olt_serial VARCHAR(50),
ADD COLUMN IF NOT EXISTS olt_report_id UUID,
ADD COLUMN IF NOT EXISTS olt_imported_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS onemap_fix_attempted BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS onemap_fix_result VARCHAR(50),  -- success, failed, skipped
ADD COLUMN IF NOT EXISTS onemap_fix_old_value VARCHAR(50),
ADD COLUMN IF NOT EXISTS onemap_fix_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS onemap_fix_by UUID;

-- Add FK constraint separately (in case table doesn't exist yet)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'fk_offline_olt_report'
  ) THEN
    ALTER TABLE offline_devices
    ADD CONSTRAINT fk_offline_olt_report
    FOREIGN KEY (olt_report_id)
    REFERENCES olt_report_imports(id)
    ON DELETE SET NULL;
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'FK constraint skipped: %', SQLERRM;
END $$;

-- Index for OLT lookups
CREATE INDEX IF NOT EXISTS idx_offline_olt_serial ON offline_devices(olt_serial);
CREATE INDEX IF NOT EXISTS idx_offline_olt_report ON offline_devices(olt_report_id);
CREATE INDEX IF NOT EXISTS idx_offline_onemap_fix ON offline_devices(onemap_fix_attempted, onemap_fix_result);

-- Comments for documentation
COMMENT ON COLUMN offline_devices.olt_serial IS 'Serial from Nokia OLT report - the authoritative source';
COMMENT ON COLUMN offline_devices.olt_report_id IS 'FK to olt_report_imports for tracking which import set this';
COMMENT ON COLUMN offline_devices.onemap_fix_attempted IS 'Whether we tried to fix 1Map with the correct serial';
COMMENT ON COLUMN offline_devices.onemap_fix_result IS 'Result: success, failed, skipped (empty serial)';
COMMENT ON COLUMN offline_devices.onemap_fix_old_value IS 'Old 1Map ph_ont value before fix - for rollback';

-- View for OLT vs 1Map mismatches specifically
-- Note: prop_id comes from OneMap API lookups, not stored in dr_photo_unified_reviews
CREATE OR REPLACE VIEW v_olt_onemap_mismatches AS
SELECT
  o.id,
  o.drop_number,
  o.zone,
  o.address,
  o.olt_serial,
  r.ont_serial_scanned as onemap_serial,
  NULL::TEXT as onemap_prop_id,  -- Fetched dynamically via OneMap API
  o.serial_number as offline_serial,
  e.serial_number as oes_serial,
  o.onemap_fix_attempted,
  o.onemap_fix_result,
  o.onemap_fix_old_value,
  o.onemap_fix_at,
  COALESCE(o.mismatch_status, 'pending_investigation') as status,
  oi.filename as import_filename,
  oi.imported_at as import_date,
  -- Determine if OLT and 1Map match
  CASE
    WHEN o.olt_serial IS NULL THEN 'empty_olt'
    WHEN r.ont_serial_scanned IS NULL THEN 'no_onemap'
    WHEN UPPER(o.olt_serial) = UPPER(r.ont_serial_scanned) THEN 'match'
    ELSE 'mismatch'
  END as comparison_status
FROM offline_devices o
LEFT JOIN dr_photo_unified_reviews r ON o.drop_number = r.drop_number
LEFT JOIN oes_activations e ON o.drop_number = e.drop_number
LEFT JOIN olt_report_imports oi ON o.olt_report_id = oi.id
WHERE o.olt_serial IS NOT NULL
  OR o.olt_report_id IS NOT NULL;

-- Verification
DO $$
DECLARE
  olt_table_exists BOOLEAN;
  col_count INTEGER;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_name = 'olt_report_imports'
  ) INTO olt_table_exists;

  SELECT COUNT(*) INTO col_count
  FROM information_schema.columns
  WHERE table_name = 'offline_devices'
    AND column_name LIKE 'olt_%';

  RAISE NOTICE '=== Migration 122 Complete ===';
  RAISE NOTICE 'olt_report_imports table: %', CASE WHEN olt_table_exists THEN 'Created' ELSE 'Failed' END;
  RAISE NOTICE 'OLT columns in offline_devices: %', col_count;
END $$;
