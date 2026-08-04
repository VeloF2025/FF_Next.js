-- rollback_479_fleet_parking_compliance.sql
BEGIN;

DELETE FROM access_permissions WHERE key IN ('fleet.parking', 'fleet.parking-requests');

DROP TABLE IF EXISTS fleet_parking_compliance_checks;
DROP TABLE IF EXISTS fleet_vehicle_parking_locations;

COMMIT;
