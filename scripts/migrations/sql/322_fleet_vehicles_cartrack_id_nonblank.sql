-- Migration 322: fleet_vehicles.cartrack_vehicle_id must be NULL or non-blank
--
-- Closes a silent-failure gap flagged in PR #1399 review. The Cartrack
-- event-filter does `String(e.vehicle_id ?? '') === storedId`. If
-- `storedId` is ever the empty string '', that filter matches every
-- Cartrack event where `vehicle_id` happens to be null — producing
-- garbage `match` verdicts on the wrong driver.
--
-- The adapter now rejects empty vehicleId at the boundary, but the DB
-- layer should also forbid it so a hand-written UPDATE can't reintroduce
-- the footgun. NULL remains valid (= vehicle not mapped to Cartrack yet).
--
-- Idempotent: safe to re-run. Constraint is NOT VALID initially then
-- validated in a second statement so existing rows don't block the DDL
-- on a misconfigured staging DB; our dev + prod are clean per the
-- migration runner logs.

ALTER TABLE fleet_vehicles
  DROP CONSTRAINT IF EXISTS fleet_vehicles_cartrack_vehicle_id_nonblank;

ALTER TABLE fleet_vehicles
  ADD CONSTRAINT fleet_vehicles_cartrack_vehicle_id_nonblank
  CHECK (cartrack_vehicle_id IS NULL OR length(cartrack_vehicle_id) > 0);

-- ---------------------------------------------------------------------------
-- Verify (uncomment to run after applying)
-- ---------------------------------------------------------------------------
-- \d+ fleet_vehicles
-- -- Should fail:
-- SAVEPOINT s1; UPDATE fleet_vehicles SET cartrack_vehicle_id = '' WHERE id = (SELECT id FROM fleet_vehicles LIMIT 1); ROLLBACK TO s1;
-- -- Should succeed:
-- SAVEPOINT s2; UPDATE fleet_vehicles SET cartrack_vehicle_id = NULL WHERE id = (SELECT id FROM fleet_vehicles LIMIT 1); ROLLBACK TO s2;
