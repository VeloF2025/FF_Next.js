-- Migration 323: widen attendance_gps_verifications.verdict to include 'device_gps_off'
--
-- Closes a silent-failure gap in Phase 2: when the reconcile orchestrator
-- finds that `parseLatLon(clock_*_lat, clock_*_lon)` returns null, it
-- could not distinguish "phone GPS was off at clock time" from "Cartrack
-- returned no position samples." Both collapsed into the `no_data`
-- verdict — so a supervisor looking at a string of grey badges had no
-- way to know whether Cartrack or the driver's phone was the silent
-- party. Different remediation paths (rotate creds / reboot tenant vs
-- train staff / enforce location permission), so the conflation is not
-- cosmetic.
--
-- This migration widens the existing CHECK constraint. A follow-up
-- application change (same PR) starts emitting `device_gps_off` when
-- `parseLatLon` returns null.
--
-- Idempotent: DROP IF EXISTS before ADD. Postgres CHECK constraints
-- have no IF NOT EXISTS today (16+), so we drop-then-recreate instead.

ALTER TABLE attendance_gps_verifications
  DROP CONSTRAINT IF EXISTS attendance_gps_verifications_verdict_check;

ALTER TABLE attendance_gps_verifications
  ADD CONSTRAINT attendance_gps_verifications_verdict_check
  CHECK (verdict IN (
    'match',
    'mismatch',
    'no_data',
    'vehicle_not_mapped',
    'device_gps_off'
  ));

-- ---------------------------------------------------------------------------
-- Verify (uncomment to run after applying)
-- ---------------------------------------------------------------------------
-- SELECT conname, pg_get_constraintdef(oid)
-- FROM pg_constraint
-- WHERE conname = 'attendance_gps_verifications_verdict_check';
-- -- Should fail (unknown verdict):
-- SAVEPOINT s1;
-- INSERT INTO attendance_gps_verifications (entry_id, check_type, verdict, threshold_m)
-- VALUES ((SELECT id FROM attendance_entries LIMIT 1), 'in', 'bogus', 500);
-- ROLLBACK TO s1;
-- -- Should succeed:
-- SAVEPOINT s2;
-- INSERT INTO attendance_gps_verifications (entry_id, check_type, verdict, threshold_m)
-- VALUES ((SELECT id FROM attendance_entries LIMIT 1), 'in', 'device_gps_off', 500);
-- ROLLBACK TO s2;
