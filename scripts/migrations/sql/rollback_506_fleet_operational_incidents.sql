-- Rollback 506. This removes durable incident and audit evidence; execute only with approval.

DELETE FROM user_permission_overrides
 WHERE permission_key IN ('fleet.incidents', 'fleet.incidents-settings');
DELETE FROM role_permissions
 WHERE permission_key IN ('fleet.incidents', 'fleet.incidents-settings');

DROP TABLE IF EXISTS fleet_operational_incident_evidence;
DROP TABLE IF EXISTS fleet_operational_incident_actions;
DROP TABLE IF EXISTS fleet_operational_incident_observations;
DROP TABLE IF EXISTS fleet_operational_incidents;
DROP TABLE IF EXISTS fleet_operational_monitor_runs;
DROP TABLE IF EXISTS fleet_operational_oversight_members;
DROP TABLE IF EXISTS fleet_operational_incident_rules;

DELETE FROM access_permissions
 WHERE key IN ('fleet.incidents', 'fleet.incidents-settings');
DELETE FROM schema_migrations
 WHERE filename = '506_fleet_operational_incidents.sql';
