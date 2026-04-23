-- Rollback for migration 323.
-- Narrows the verdict CHECK back to its original four values. Only safe
-- if no row has verdict='device_gps_off' persisted yet; a surviving row
-- would fail the tightened CHECK and abort the DDL.

ALTER TABLE attendance_gps_verifications
  DROP CONSTRAINT IF EXISTS attendance_gps_verifications_verdict_check;

ALTER TABLE attendance_gps_verifications
  ADD CONSTRAINT attendance_gps_verifications_verdict_check
  CHECK (verdict IN (
    'match',
    'mismatch',
    'no_data',
    'vehicle_not_mapped'
  ));
