-- Rollback for migration 324.
-- Drops the paired-nullable constraint and the snapshot column.
-- Only safe when no row has hourly_rate_snapshot_cents populated yet;
-- a surviving row would fail subsequent constraint re-adds.

ALTER TABLE attendance_daily_summaries
  DROP CONSTRAINT IF EXISTS attendance_daily_summaries_wage_and_rate_together;

ALTER TABLE attendance_daily_summaries
  DROP COLUMN IF EXISTS hourly_rate_snapshot_cents;
