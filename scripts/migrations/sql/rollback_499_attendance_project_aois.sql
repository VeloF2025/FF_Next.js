-- rollback_499_attendance_project_aois.sql
--
-- ⚠️ DO NOT RUN THIS WHILE ANY INSTANCE IS ON POST-499 CODE.
--
-- dev and production share ONE database. `clockInFinalization.ts` INSERTs
-- into clock_in_aoi_project_id / clock_in_aoi_distance_m and the
-- checkin-locations report SELECTs from project_aois. Dropping them under a
-- running post-499 app makes EVERY CLOCK-IN FAIL with "column does not
-- exist" — and because the database is shared, a rollback triggered by a dev
-- incident takes production clock-ins down with it. Field staff cannot record
-- attendance while that is true.
--
-- Correct order: redeploy BOTH environments onto pre-499 code first, confirm
-- neither references these objects, then run this.
--
-- project_aois is derived data rebuilt from poles by refresh_project_aois(),
-- so dropping it loses nothing recreatable. The attendance_entries columns
-- DO hold observations that cannot be recreated — they record the AOI as-of
-- each clock-in, and the pole data behind it moves. Nothing reads them for a
-- decision yet, so the loss is an audit trail rather than functionality;
-- that is the trade being made, deliberately.

ALTER TABLE staff              DROP COLUMN IF EXISTS aoi_enforcement_enabled;
ALTER TABLE attendance_entries DROP COLUMN IF EXISTS clock_in_aoi_distance_m;
ALTER TABLE attendance_entries DROP COLUMN IF EXISTS clock_in_aoi_project_id;
DROP FUNCTION IF EXISTS refresh_project_aois();
DROP TABLE IF EXISTS project_aois;
