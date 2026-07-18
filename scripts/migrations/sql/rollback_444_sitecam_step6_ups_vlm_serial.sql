BEGIN;
ALTER TABLE dr_photo_unified_reviews DROP COLUMN IF EXISTS vlm_ups_serial_step6;
COMMIT;
