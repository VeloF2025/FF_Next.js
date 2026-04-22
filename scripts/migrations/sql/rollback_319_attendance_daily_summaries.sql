-- Rollback for migration 319: drop attendance_daily_summaries
--
-- Safe to run pre- or post-migration; uses IF EXISTS. CASCADE is not needed
-- because nothing references this table yet.
--
-- TODO(phase-1c): attendance_adjustments will FK into daily_summaries via
-- recompute-on-approve. Swap `DROP TABLE IF EXISTS attendance_daily_summaries`
-- for `DROP TABLE IF EXISTS attendance_daily_summaries CASCADE` when that
-- migration lands, otherwise this rollback will fail with a dependency error.

DROP INDEX IF EXISTS idx_attendance_daily_summaries_computed_at;
DROP INDEX IF EXISTS idx_attendance_daily_summaries_staff_work_date;
DROP INDEX IF EXISTS idx_attendance_daily_summaries_work_date;

DROP TABLE IF EXISTS attendance_daily_summaries;
