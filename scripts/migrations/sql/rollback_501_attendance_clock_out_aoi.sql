-- rollback_501_attendance_clock_out_aoi.sql
--
-- Drops the clock-out AOI columns added by 501. Destructive: the recorded
-- as-of-clock-out AOI match cannot be reconstructed exactly once dropped,
-- because project_aois is rebuilt nightly from a pole register that moves.

ALTER TABLE attendance_entries
  DROP COLUMN IF EXISTS clock_out_aoi_project_id,
  DROP COLUMN IF EXISTS clock_out_aoi_distance_m;
