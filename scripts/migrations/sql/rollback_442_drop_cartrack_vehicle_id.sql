BEGIN;
ALTER TABLE fleet_vehicles ADD COLUMN IF NOT EXISTS cartrack_vehicle_id TEXT;
ALTER TABLE fleet_vehicles ADD CONSTRAINT fleet_vehicles_cartrack_id_nonblank
  CHECK (cartrack_vehicle_id IS NULL OR btrim(cartrack_vehicle_id) <> '') NOT VALID;
COMMIT;
