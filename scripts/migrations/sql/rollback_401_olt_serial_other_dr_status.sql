-- Rollback for migration 401: remove 'serial_other_dr' fix_status.
--
-- PRE-FLIGHT: any rows still carrying fix_status='serial_other_dr' would
-- violate the reverted CHECK constraint. Re-map them to 'not_found' (their
-- prior verdict) before restoring the narrower constraint and index predicate.

BEGIN;

UPDATE olt_mismatch_records
SET fix_status = 'not_found'
WHERE fix_status = 'serial_other_dr';

ALTER TABLE olt_mismatch_records
  DROP CONSTRAINT IF EXISTS olt_mismatch_records_status_check;

ALTER TABLE olt_mismatch_records
  ADD CONSTRAINT olt_mismatch_records_status_check
  CHECK (fix_status IN (
    'pending', 'fixed', 'skipped', 'not_found', 'empty_serial',
    'escalated', 'resolved', 'needs_reinvestigation', 'needs_investigation'
  ));

DROP INDEX IF EXISTS idx_olt_mismatch_drop_active_uniq;

CREATE UNIQUE INDEX idx_olt_mismatch_drop_active_uniq
  ON olt_mismatch_records (drop_number)
  WHERE fix_status IN (
    'pending', 'needs_investigation', 'not_found', 'empty_serial',
    'needs_reinvestigation'
  );

COMMIT;
