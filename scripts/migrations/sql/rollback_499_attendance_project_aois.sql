-- rollback_499_attendance_project_aois.sql
--
-- Reverses 499. project_aois is derived data rebuilt from poles, so dropping
-- it loses nothing. The attendance_entries columns DO hold observations that
-- cannot be recreated (they record the AOI as-of each clock-in, and the pole
-- data behind it moves), so dropping them is a real data loss — deliberate,
-- and the reason this file exists rather than being assumed reversible.

ALTER TABLE staff              DROP COLUMN IF EXISTS aoi_enforcement_enabled;
ALTER TABLE attendance_entries DROP COLUMN IF EXISTS clock_in_aoi_distance_m;
ALTER TABLE attendance_entries DROP COLUMN IF EXISTS clock_in_aoi_project_id;
DROP FUNCTION IF EXISTS refresh_project_aois();
DROP TABLE IF EXISTS project_aois;
