-- Rollback for 318_attendance_otp_onboarding.sql

BEGIN;

DROP INDEX IF EXISTS idx_attendance_credentials_pending_otp_expires;

ALTER TABLE attendance_credentials
  DROP CONSTRAINT IF EXISTS attendance_credentials_has_at_least_one_hash;

ALTER TABLE attendance_credentials
  ADD CONSTRAINT attendance_credentials_has_at_least_one_hash
  CHECK (pin_hash IS NOT NULL OR password_hash IS NOT NULL);

ALTER TABLE attendance_credentials
  DROP COLUMN IF EXISTS pending_otp_requested_at,
  DROP COLUMN IF EXISTS pending_otp_attempts,
  DROP COLUMN IF EXISTS pending_otp_expires_at,
  DROP COLUMN IF EXISTS pending_otp_hash;

COMMIT;
