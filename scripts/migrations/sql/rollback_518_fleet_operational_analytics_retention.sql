-- Rollback 518. Removes the PR8 analytics/retention schema. Execute only with
-- approval.
--
-- This destroys the anonymous monthly aggregates, which are the only record of
-- any period whose identifiable detail has already been purged. Once a
-- retention run has completed for a month, that month cannot be rebuilt.
--
-- ORDER: the triggers on the PR6 tables come off FIRST. Dropping
-- fleet_incident_retention_holds while trg_fleet_incident_purge_guard is still
-- attached to fleet_operational_incidents would leave PR6 with a trigger whose
-- body reads a table that no longer exists, and every incident delete would
-- fail with 42P01.
--
-- This file touches no PR4-7 table: it removes only what 518 created, plus the
-- permission rows 518 seeded.

DROP TRIGGER IF EXISTS trg_fleet_incident_purge_guard ON fleet_operational_incidents;
DROP TRIGGER IF EXISTS trg_fleet_retention_item_guard ON fleet_operational_retention_items;
DROP TRIGGER IF EXISTS trg_fleet_hold_action_append_only ON fleet_incident_retention_hold_actions;
DROP FUNCTION IF EXISTS fleet_incident_purge_guard();
DROP FUNCTION IF EXISTS fleet_retention_item_guard();
DROP FUNCTION IF EXISTS fleet_hold_action_append_only();
DROP FUNCTION IF EXISTS fleet_assert_incident_purgeable(UUID);

DELETE FROM user_permission_overrides WHERE permission_key = 'fleet.retention-holds';
DELETE FROM role_permissions WHERE permission_key = 'fleet.retention-holds';

DROP TABLE IF EXISTS fleet_operational_retention_items;
DROP TABLE IF EXISTS fleet_operational_retention_runs;
DROP TABLE IF EXISTS fleet_incident_retention_hold_actions;
DROP TABLE IF EXISTS fleet_incident_retention_holds;
DROP TABLE IF EXISTS fleet_operational_monthly_aggregates;
DROP TABLE IF EXISTS fleet_operational_aggregation_runs;
DROP TABLE IF EXISTS fleet_operational_analytics_settings;

DELETE FROM access_permissions WHERE key = 'fleet.retention-holds';
DELETE FROM schema_migrations
 WHERE filename = '518_fleet_operational_analytics_retention.sql';
