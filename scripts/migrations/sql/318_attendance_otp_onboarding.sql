-- Migration 318: OTP + PIN onboarding flow for /my portal
--
-- Adds OTP fields to attendance_credentials so that field staff can:
--   1. First-time PIN setup: request an OTP via WhatsApp, verify it, and set
--      their 6-digit PIN. Before verification they have no pin_hash yet, so
--      the CHECK constraint must allow a pending-OTP-only state.
--   2. New device binding: re-run the same flow to rotate
--      device_fingerprint_primary when they replace their phone.
--
-- The CHECK constraint is relaxed: a row is valid if it has ANY of:
--   - pin_hash              (PIN flow completed)
--   - password_hash         (office staff password flow)
--   - pending_otp_hash      (onboarding in progress)
--
-- The pending_* columns are always cleared on successful verify.
-- Expired pending rows with NO other hashes are reaped by PR7's retention cron.
--
-- Idempotent: safe to re-run.

BEGIN;

ALTER TABLE attendance_credentials
  ADD COLUMN IF NOT EXISTS pending_otp_hash        TEXT,
  ADD COLUMN IF NOT EXISTS pending_otp_expires_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS pending_otp_attempts    INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS pending_otp_requested_at TIMESTAMPTZ;

-- Swap the CHECK constraint: pending OTP is now a valid state.
ALTER TABLE attendance_credentials
  DROP CONSTRAINT IF EXISTS attendance_credentials_has_at_least_one_hash;

ALTER TABLE attendance_credentials
  ADD CONSTRAINT attendance_credentials_has_at_least_one_hash
  CHECK (
    pin_hash IS NOT NULL
    OR password_hash IS NOT NULL
    OR pending_otp_hash IS NOT NULL
  );

-- Index used by the retention cron that reaps expired pending-only rows.
CREATE INDEX IF NOT EXISTS idx_attendance_credentials_pending_otp_expires
  ON attendance_credentials (pending_otp_expires_at)
  WHERE pending_otp_hash IS NOT NULL;

COMMIT;
