-- scripts/migrations/sql/rollback_402_sitecam_serial_appeals.sql
DROP TABLE IF EXISTS sitecam_appeals;

ALTER TABLE dr_photo_unified_reviews
  DROP COLUMN IF EXISTS ont_serial_attempts,
  DROP COLUMN IF EXISTS ont_serial_status,
  DROP COLUMN IF EXISTS ups_serial_attempts,
  DROP COLUMN IF EXISTS ups_serial_status;
