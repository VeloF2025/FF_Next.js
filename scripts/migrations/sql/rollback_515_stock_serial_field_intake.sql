-- Rollback 515_stock_serial_field_intake.sql
--
-- ⚠️ Destroys the record of which serials came from the field rather than the
-- sheet, and which of those were never confirmed. Export before running:
--   SELECT serial_number, intake_carton_id, intake_at, intake_by_staff_id
--   FROM stock_serials WHERE provenance = 'field_intake';
-- The serial rows themselves are NOT deleted — they are real stock that was
-- really issued to a real technician. Only the provenance metadata goes.
DROP INDEX IF EXISTS idx_stock_serials_unconfirmed_intake;
ALTER TABLE stock_serials DROP CONSTRAINT IF EXISTS stock_serials_provenance_check;
ALTER TABLE stock_serials
  DROP COLUMN IF EXISTS intake_at,
  DROP COLUMN IF EXISTS intake_by_staff_id,
  DROP COLUMN IF EXISTS intake_carton_id,
  DROP COLUMN IF EXISTS source_confirmed_at,
  DROP COLUMN IF EXISTS provenance;
