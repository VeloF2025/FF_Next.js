-- 442: Drop fleet_vehicles.cartrack_vehicle_id — contract half of 441.
--
-- Superseded by fleet_vehicle_trackers (441). The column is populated on
-- 0 of 37 vehicles, so there is no data to migrate.
--
-- IMPORTANT: this must only be applied AFTER the code that reads
-- fleet_vehicle_trackers is deployed everywhere. Dev and production share
-- one Postgres instance, so dropping this column while prod's old code
-- still reads it would break prod immediately.

BEGIN;

ALTER TABLE fleet_vehicles DROP COLUMN IF EXISTS cartrack_vehicle_id;

COMMIT;
