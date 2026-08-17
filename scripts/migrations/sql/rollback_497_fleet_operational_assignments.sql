-- Rollback 488. This removes only the PR 3 operational-assignment schema,
-- permission rows, and its migration tracker. It deliberately leaves btree_gist
-- installed because extensions are shared database capabilities.

DELETE FROM user_permission_overrides
 WHERE permission_key = 'fleet.assignments';

DELETE FROM role_permissions
 WHERE permission_key = 'fleet.assignments';

DROP TABLE IF EXISTS fleet_operational_assignment_audit;
DROP TABLE IF EXISTS fleet_project_operational_site_audit;
DROP TABLE IF EXISTS fleet_operational_assignments;
DROP TABLE IF EXISTS fleet_project_operational_sites;

DELETE FROM access_permissions
 WHERE key = 'fleet.assignments';

DELETE FROM schema_migrations
 WHERE filename = '497_fleet_operational_assignments.sql';
