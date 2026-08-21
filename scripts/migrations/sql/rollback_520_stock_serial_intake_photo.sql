-- Rollback 520_stock_serial_intake_photo.sql
-- ⚠️ Drops the evidence for every single-unit intake. Export first:
--   SELECT serial_number, intake_photo_url, intake_at, intake_by_staff_id
--   FROM stock_serials WHERE intake_photo_key IS NOT NULL;
-- The serial rows are NOT deleted — they are real units really issued.
DROP INDEX IF EXISTS idx_stock_serials_intake_photo;
ALTER TABLE stock_serials
  DROP COLUMN IF EXISTS intake_photo_url,
  DROP COLUMN IF EXISTS intake_photo_key;
