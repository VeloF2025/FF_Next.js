-- rollback_483_fleet_parking_compliance.sql
--
-- Re-runnable: every statement is guarded, and it clears its own
-- schema_migrations row so the forward runner will re-apply the migration
-- afterwards. Deliberately unwrapped — scripts/migrations/run.ts opens the
-- transaction. An embedded COMMIT here would commit the DROPs and leave the
-- tracker deletes below outside the transaction, so a crash between them would
-- drop the tables while schema_migrations still reported 483 as applied, and
-- the forward runner would never recreate them.

-- Dropped before the locations table it references.
DROP TABLE IF EXISTS fleet_parking_compliance_checks;
DROP TABLE IF EXISTS fleet_vehicle_parking_locations;

-- Role grants go before the pages they reference, mirroring the FK direction.
DELETE FROM role_permissions
 WHERE permission_key IN ('fleet.parking', 'fleet.parking-requests');

DELETE FROM access_permissions WHERE key IN ('fleet.parking', 'fleet.parking-requests');

-- schema_migrations is keyed on `filename`, not on the version number.
DELETE FROM schema_migrations WHERE filename = '483_fleet_parking_compliance.sql';
