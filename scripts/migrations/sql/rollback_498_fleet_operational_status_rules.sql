-- Rollback 489. Rule history is operational evidence; execute only with approval.

DELETE FROM user_permission_overrides
 WHERE permission_key IN ('fleet.operations-status', 'fleet.operations-rules');
DELETE FROM role_permissions
 WHERE permission_key IN ('fleet.operations-status', 'fleet.operations-rules');
DROP TABLE IF EXISTS fleet_operational_status_rules;
DELETE FROM access_permissions
 WHERE key IN ('fleet.operations-status', 'fleet.operations-rules');
DELETE FROM schema_migrations
 WHERE filename = '489_fleet_operational_status_rules.sql';
