-- Rollback 529_fleet_vehicle_operational_rules.sql.
-- Rule history is operational evidence; execute only with approval.
--
-- WRAPPED IN AN EXPLICIT BEGIN/COMMIT, and it must stay that way.
--
-- The incident-rule restoration below is two statements that are only correct
-- together: removing 529's rows without reopening what they replaced leaves
-- four incident types with NO effective rule, and `loadEffectiveIncidentRule`
-- throws for a type with no open row — which takes the whole operational
-- monitor down, not just the vehicle detectors. Run under `psql -f` every
-- statement autocommits, so a failure on the second one would ship exactly that
-- outage. The transaction block is what makes the file safe outside the runner.
--
-- Interaction with `npm run db:migrate rollback 529`: run.ts (rollbackMigration)
-- already opens its own transaction, so the BEGIN below nests and the COMMIT
-- ends the runner's transaction early. The runner's own trailing bookkeeping
-- then autocommits and its final COMMIT is a no-op warning. That is the
-- established shape for rollback files in this repo (see rollback_468, 471,
-- 490) and it is the safer trade: the runner loses cross-statement atomicity it
-- would only need if the file were NOT atomic on its own.
--
-- What it deliberately does NOT do: delete "version 2" of the four types. That
-- version number is not 529's to claim — an operator may have authored their
-- own. Only rows carrying 529's exact change_reason are removed.

BEGIN;

-- 1. Remove only the rows migration 529 inserted.
DELETE FROM fleet_operational_incident_rules
 WHERE change_reason = 'Migration 529: telematics detectors report through the morning summary, not a WhatsApp blast'
   AND severity = 'high'
   AND incident_type = ANY(ARRAY[
     'severe_driving', 'prolonged_unauthorized_stop', 'lost_contact_moving', 'dangerous_area_entry'
   ]::text[]);

-- 2. Reopen whatever 529 closed: per type, the newest closed `critical` row.
--    529 closes exactly those, and it stamps effective_to = now(), so the
--    newest closed critical row per type IS the row it closed — whether that
--    was version 1 or an operator's own later version.
--
--    The NOT EXISTS guard keeps this idempotent and keeps it from ever creating
--    a second open row: if a type already has one (because 529 skipped it, or
--    because this rollback already ran), nothing is reopened.
WITH restore AS (
  SELECT DISTINCT ON (incident_type) id, incident_type
    FROM fleet_operational_incident_rules
   WHERE effective_to IS NOT NULL
     AND severity = 'critical'
     AND incident_type = ANY(ARRAY[
       'severe_driving', 'prolonged_unauthorized_stop', 'lost_contact_moving', 'dangerous_area_entry'
     ]::text[])
   ORDER BY incident_type, effective_to DESC, version DESC
)
UPDATE fleet_operational_incident_rules target
   SET effective_to = NULL, updated_at = now()
  FROM restore
 WHERE target.id = restore.id
   AND NOT EXISTS (
     SELECT 1 FROM fleet_operational_incident_rules open_rule
      WHERE open_rule.incident_type = restore.incident_type
        AND open_rule.effective_to IS NULL
   );

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

COMMIT;
