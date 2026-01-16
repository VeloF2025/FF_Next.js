-- Migration: Rename photo steps from 12 to 10 steps
-- ONT Barcode and UPS Serial are NOT photo steps - they are scanned barcodes
-- stored directly in ont_serial_scanned and ups_serial_scanned fields
--
-- Step changes:
-- - Remove step_08_ont_barcode (data comes from scanning, not photos)
-- - Remove step_09_ups_serial (data comes from scanning, not photos)
-- - Rename step_10_final_installation → step_08_final_installation
-- - Rename step_11_green_lights → step_09_green_lights
-- - Rename step_12_signature → step_10_signature
--
-- Migration executed: 2026-01-16
-- Status: COMPLETED

-- Drop dependent view first
DROP VIEW IF EXISTS v_qa_photo_reviews_compat CASCADE;

-- Add new columns (if they don't exist)
ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS step_08_final_installation BOOLEAN DEFAULT FALSE;

ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS step_09_green_lights BOOLEAN DEFAULT FALSE;

ALTER TABLE dr_photo_unified_reviews
ADD COLUMN IF NOT EXISTS step_10_signature BOOLEAN DEFAULT FALSE;

-- Migrate data from old columns to new (preserve existing values)
UPDATE dr_photo_unified_reviews
SET
  step_08_final_installation = COALESCE(step_08_final_installation, step_10_final_installation, FALSE),
  step_09_green_lights = COALESCE(step_09_green_lights, step_11_green_lights, FALSE),
  step_10_signature = COALESCE(step_10_signature, step_12_signature, FALSE)
WHERE TRUE;

-- Drop old columns
ALTER TABLE dr_photo_unified_reviews
DROP COLUMN IF EXISTS step_08_ont_barcode;

ALTER TABLE dr_photo_unified_reviews
DROP COLUMN IF EXISTS step_09_ups_serial;

ALTER TABLE dr_photo_unified_reviews
DROP COLUMN IF EXISTS step_10_final_installation;

ALTER TABLE dr_photo_unified_reviews
DROP COLUMN IF EXISTS step_11_green_lights;

ALTER TABLE dr_photo_unified_reviews
DROP COLUMN IF EXISTS step_12_signature;

-- Recreate compatibility view with new 10-step structure
CREATE OR REPLACE VIEW v_qa_photo_reviews_compat AS
SELECT
  id,
  drop_number,
  project,
  step_01_house_photo AS step_01,
  step_02_cable_from_pole AS step_02,
  step_03_entry_outside AS step_03,
  step_04_entry_inside AS step_04,
  step_05_wall AS step_05,
  step_06_ont_back AS step_06,
  step_07_power_meter AS step_07,
  step_08_final_installation AS step_08,
  step_09_green_lights AS step_09,
  step_10_signature AS step_10,
  ont_serial_scanned,
  ups_serial_scanned,
  locked_by,
  locked_at,
  created_at,
  updated_at
FROM dr_photo_unified_reviews;

-- Add column comments
COMMENT ON COLUMN dr_photo_unified_reviews.step_08_final_installation IS 'Step 8: Final Installation photo (was step 10)';
COMMENT ON COLUMN dr_photo_unified_reviews.step_09_green_lights IS 'Step 9: Green Lights on ONT photo (was step 11)';
COMMENT ON COLUMN dr_photo_unified_reviews.step_10_signature IS 'Step 10: Signature photo (was step 12)';
