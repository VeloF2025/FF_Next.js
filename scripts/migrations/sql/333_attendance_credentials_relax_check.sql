-- Migration 333: Relax attendance_credentials hash CHECK constraint
--
-- Background: /my portal email+password login now sources its hash from
-- `users.password` (see PR migrating away from `attendance_credentials.password_hash`).
-- A staff member may now legitimately have an `attendance_credentials` row that
-- exists purely to track lockout state (failed_attempts, locked_until) without
-- carrying a pin_hash, password_hash, or pending_otp_hash.
--
-- The original constraint (added in 310, kept through 318) required at least
-- one hash. With the new login flow, `recordFailedAttempt` upserts a row on
-- the first bad email-password attempt for a staff member who has neither a
-- PIN nor an OTP in flight — that upsert would fail under the old constraint.
--
-- Drop the constraint. The semantic invariant is now enforced by the app
-- layer (login.ts requires either users.password or attendance_credentials.pin_hash
-- to authenticate); a row with all NULL hashes is harmless lockout-only state.
--
-- Idempotent. The constraint may already be absent on environments where this
-- was applied manually before the migration runner picked it up — that's the
-- intended behaviour, not a deployment bug.

ALTER TABLE attendance_credentials
  DROP CONSTRAINT IF EXISTS attendance_credentials_has_at_least_one_hash;
