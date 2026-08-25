-- Rollback 529_fleet_vehicle_operational_rules.sql.
-- Rule history is operational evidence; execute only with approval.
--
-- The incident-rule restoration below is NOT optional bookkeeping. Deleting
-- version 2 without reopening version 1 leaves four incident types with no
-- effective rule at all, and `loadEffectiveIncidentRule` throws for a type with
-- no open row — which takes the whole operational monitor down, not just the
-- vehicle detectors.
--
-- Order matters: version 2 goes first. `ux_fleet_operational_incident_rules_open_type`
-- is unique on incident_type WHERE effective_to IS NULL, so clearing version 1's
-- effective_to while version 2 is still open raises 23505.

DELETE FROM fleet_operational_incident_rules
 WHERE version = 2
   AND incident_type = ANY(ARRAY[
     'severe_driving', 'prolonged_unauthorized_stop', 'lost_contact_moving', 'dangerous_area_entry'
   ]::text[]);

UPDATE fleet_operational_incident_rules
   SET effective_to = NULL, updated_at = now()
 WHERE version = 1
   AND incident_type = ANY(ARRAY[
     'severe_driving', 'prolonged_unauthorized_stop', 'lost_contact_moving', 'dangerous_area_entry'
   ]::text[]);

DELETE FROM user_permission_overrides
 WHERE permission_key = 'fleet.vehicle-rules';
DELETE FROM role_permissions
 WHERE permission_key = 'fleet.vehicle-rules';

ALTER TABLE fleet_vehicles DROP COLUMN IF EXISTS after_hours_exempt;
DROP TABLE IF EXISTS fleet_vehicle_operational_rules;

DELETE FROM access_permissions
 WHERE key = 'fleet.vehicle-rules';
DELETE FROM schema_migrations
 WHERE filename = '529_fleet_vehicle_operational_rules.sql';
