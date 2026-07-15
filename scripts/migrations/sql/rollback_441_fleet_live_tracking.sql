BEGIN;
DROP INDEX IF EXISTS idx_fleet_gps_trips_vehicle;
ALTER TABLE fleet_gps_trips DROP COLUMN IF EXISTS vehicle_id;
-- job_id NOT NULL is intentionally NOT restored: rows created after 441 may
-- legitimately have NULL job_id, and re-adding the constraint would fail.
DROP TABLE IF EXISTS fleet_tracking_watermarks;
DROP TABLE IF EXISTS fleet_vehicle_positions;
DROP TABLE IF EXISTS fleet_vehicle_trackers;
COMMIT;
