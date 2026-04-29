-- Rollback for migration 333.
--
-- Re-adds the original constraint requiring at least one hash on
-- attendance_credentials. Lockout-only rows (all three hash columns NULL)
-- created under the new login flow would violate the constraint, so they
-- must be removed first. Wrapping both steps in a transaction so a partial
-- rollback can never leave the table in a half-restored state.

BEGIN;

DELETE FROM attendance_credentials
WHERE pin_hash IS NULL
  AND password_hash IS NULL
  AND pending_otp_hash IS NULL;

ALTER TABLE attendance_credentials
  ADD CONSTRAINT attendance_credentials_has_at_least_one_hash
  CHECK (pin_hash IS NOT NULL OR password_hash IS NOT NULL OR pending_otp_hash IS NOT NULL);

COMMIT;
