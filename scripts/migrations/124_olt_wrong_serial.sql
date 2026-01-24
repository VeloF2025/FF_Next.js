-- Migration: 124_olt_wrong_serial.sql
-- Purpose: Add column to store wrong 1Map serial from OLT Excel report
-- Date: 2026-01-24

-- Add column to store the wrong 1Map serial directly from Excel column 21
ALTER TABLE offline_devices
ADD COLUMN IF NOT EXISTS olt_wrong_onemap_serial VARCHAR(50);

COMMENT ON COLUMN offline_devices.olt_wrong_onemap_serial IS 'Wrong 1Map serial from OLT Excel column 21 - what needs to be fixed';

-- Update view to use the stored wrong serial instead of joining dr_photo_unified_reviews
CREATE OR REPLACE VIEW v_olt_onemap_mismatches AS
SELECT
  o.id,
  o.drop_number,
  o.zone,
  o.address,
  o.olt_serial,
  -- Use stored wrong serial from Excel, fallback to dr_photo_unified_reviews
  COALESCE(o.olt_wrong_onemap_serial, r.ont_serial_scanned) as onemap_serial,
  NULL::TEXT as onemap_prop_id,
  o.serial_number as offline_serial,
  e.serial_number as oes_serial,
  o.onemap_fix_attempted,
  o.onemap_fix_result,
  o.onemap_fix_old_value,
  o.onemap_fix_at,
  COALESCE(o.mismatch_status, 'pending_investigation') as status,
  oi.filename as import_filename,
  oi.imported_at as import_date,
  -- Comparison logic: use stored wrong serial if available
  CASE
    WHEN o.olt_serial IS NULL THEN 'empty_olt'
    WHEN o.olt_wrong_onemap_serial IS NOT NULL AND UPPER(o.olt_serial) != UPPER(o.olt_wrong_onemap_serial) THEN 'mismatch'
    WHEN o.olt_wrong_onemap_serial IS NOT NULL AND UPPER(o.olt_serial) = UPPER(o.olt_wrong_onemap_serial) THEN 'match'
    WHEN r.ont_serial_scanned IS NULL THEN 'no_onemap'
    WHEN UPPER(o.olt_serial) = UPPER(r.ont_serial_scanned) THEN 'match'
    ELSE 'mismatch'
  END as comparison_status
FROM offline_devices o
LEFT JOIN dr_photo_unified_reviews r ON o.drop_number = r.drop_number
LEFT JOIN oes_activations e ON o.drop_number = e.drop_number
LEFT JOIN olt_report_imports oi ON o.olt_report_id = oi.id
WHERE o.olt_serial IS NOT NULL
   OR o.olt_report_id IS NOT NULL
   OR o.olt_wrong_onemap_serial IS NOT NULL;

-- Verify
DO $$
BEGIN
  RAISE NOTICE '=== Migration 124 Complete ===';
  RAISE NOTICE 'Added olt_wrong_onemap_serial column and updated view';
END $$;
