-- Rollback 529_fleet_vehicle_operational_rules.sql.
-- Rule history is operational evidence; execute only with approval.
--
-- WRAPPED IN AN EXPLICIT BEGIN/COMMIT. Under `psql -f` every statement
-- autocommits, and this file both restores incident rules and drops a table; a
-- failure part-way through would leave the two out of step. The transaction
-- block is what makes the file safe outside the runner.
--
-- Interaction with `npm run db:migrate rollback 529`: run.ts (rollbackMigration)
-- already opens its own transaction, so the BEGIN below nests and the COMMIT
-- ends the runner's transaction early. The runner's own trailing bookkeeping
-- then autocommits and its final COMMIT is a no-op warning. That is the
-- established shape for rollback files in this repo (see rollback_468, 471,
-- 490) and it is the safer trade: the runner loses cross-statement atomicity it
-- would only need if the file were NOT atomic on its own.

BEGIN;

-- 1. Undo the in-place re-versioning.
--
--    529 inserted no rows and closed none: it edited the four telematics rules
--    where they stood, behind a guard proving no incident referenced them. So
--    there is nothing to delete and nothing to reopen — only the flags to put
--    back.
--
--    The marker CARRIES THE PRIOR FLAG VALUES and they are parsed back out here
--    rather than restored from 510's seed shape. 529's filter constrains
--    severity and nothing else, so an operator may perfectly well have held a
--    critical row with whatsapp_enabled false — and putting the seed shape back
--    would silently re-arm their WhatsApp. Severity is the one value the filter
--    does pin, so it alone is restored from a constant.
--
--    The marker is anchored with `$`: prose that merely CONTAINS it mid-string
--    is not matched. Residual risk, accepted and stated in 529's header: an
--    operator whose own change_reason ENDS with the exact literal would have
--    that row restored too.
--
--    Stripping the marker is what makes this idempotent — a second run no
--    longer matches.
UPDATE fleet_operational_incident_rules
   SET severity = 'critical',
       whatsapp_enabled = (regexp_match(
         change_reason, '529:reversioned\{wa=(true|false),imm=(true|false),morn=(true|false)\}$'))[1]::boolean,
       immediate_notification = (regexp_match(
         change_reason, '529:reversioned\{wa=(true|false),imm=(true|false),morn=(true|false)\}$'))[2]::boolean,
       include_in_morning_summary = (regexp_match(
         change_reason, '529:reversioned\{wa=(true|false),imm=(true|false),morn=(true|false)\}$'))[3]::boolean,
       change_reason = NULLIF(
         btrim(regexp_replace(change_reason, '( \| )?529:reversioned\{[^}]*\}$', '')),
         ''
       ),
       updated_at = now()
 WHERE severity = 'high'
   AND change_reason ~ '529:reversioned\{wa=(true|false),imm=(true|false),morn=(true|false)\}$'
   AND incident_type = ANY(ARRAY[
     'severe_driving', 'prolonged_unauthorized_stop', 'lost_contact_moving', 'dangerous_area_entry'
   ]::text[]);

DELETE FROM user_permission_overrides
 WHERE permission_key IN ('fleet.vehicle-rules', 'fleet.vehicle-stats');
DELETE FROM role_permissions
 WHERE permission_key IN ('fleet.vehicle-rules', 'fleet.vehicle-stats');

ALTER TABLE fleet_vehicles DROP COLUMN IF EXISTS after_hours_exempt;
DROP TABLE IF EXISTS fleet_vehicle_operational_rules;

DELETE FROM access_permissions
 WHERE key IN ('fleet.vehicle-rules', 'fleet.vehicle-stats');
DELETE FROM schema_migrations
 WHERE filename = '529_fleet_vehicle_operational_rules.sql';

COMMIT;
