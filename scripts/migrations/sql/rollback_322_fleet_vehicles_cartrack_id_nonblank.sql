-- Rollback for migration 322.

ALTER TABLE fleet_vehicles
  DROP CONSTRAINT IF EXISTS fleet_vehicles_cartrack_vehicle_id_nonblank;
