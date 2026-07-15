-- Fully reverses 441: it no longer drops fleet_gps_trips.job_id's NOT NULL,
-- so there is no one-way change left to caveat here.
BEGIN;
DROP INDEX IF EXISTS idx_fleet_gps_trips_vehicle;
ALTER TABLE fleet_gps_trips DROP COLUMN IF EXISTS vehicle_id;
DROP TABLE IF EXISTS fleet_tracking_watermarks;
DROP TABLE IF EXISTS fleet_vehicle_positions;
DROP TABLE IF EXISTS fleet_vehicle_trackers;
COMMIT;
