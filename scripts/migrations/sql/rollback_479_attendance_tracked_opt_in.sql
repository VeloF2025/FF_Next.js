-- Rollback migration 479: drop the attendance expectation opt-in flag.
--
-- Reverting restores the previous behaviour: every employed staff member is
-- expected to clock in every Mon-Sat, so `missing_clock_in` exceptions return
-- to ~50/working-day. Nothing else depends on the column.
--
-- Re-runnable: DROP COLUMN is guarded with IF EXISTS, and it clears its own
-- schema_migrations row (that table is keyed on `filename`, not `version`).
-- Without that DELETE the column is dropped while the tracker still reports
-- 479 as applied, so the forward runner skips it and the two never reconcile.
-- Matches rollback_461..467, 476, 477.

ALTER TABLE staff DROP COLUMN IF EXISTS attendance_tracked;

DELETE FROM schema_migrations WHERE filename = '479_attendance_tracked_opt_in.sql';
