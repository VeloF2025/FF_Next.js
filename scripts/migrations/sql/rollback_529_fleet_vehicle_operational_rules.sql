-- Rollback 529_fleet_vehicle_operational_rules.sql.
-- Rule history is operational evidence; execute only with approval.
--
-- WRAPPED IN AN EXPLICIT BEGIN/COMMIT, and it must stay that way.
--
-- The incident-rule restoration below is three statements that are only correct
-- together: removing 529's rows without reopening what they replaced leaves
-- four incident types with NO effective rule, and `loadEffectiveIncidentRule`
-- throws for a type with no open row — which takes the whole operational
-- monitor down, not just the vehicle detectors. Run under `psql -f` every
-- statement autocommits, so a failure on a later one would ship exactly that
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
-- own. Only rows carrying 529's exact change_reason, still open, are removed.

BEGIN;

-- 1. Capture exactly the rows migration 529 wrote AND still has open.
--
--    `effective_to IS NULL` is what keeps a SUPERSEDED 529 row: if an operator
--    later versioned past it, incidents opened in the meantime carry that row's
--    id in `incident_rule_id`, and deleting it would break the audit link (the
--    FK is ON DELETE SET NULL, so the incident silently forgets which rule
--    judged it). It also means the rollback leaves an operator's later work
--    alone rather than reaching back through it.
--
--    `effective_from` is captured with the id because it is the handle on what
--    each row REPLACED — see statement 3.
DROP TABLE IF EXISTS rb529_authored;
CREATE TEMP TABLE rb529_authored AS
SELECT id, incident_type, effective_from
  FROM fleet_operational_incident_rules
 WHERE change_reason = 'Migration 529: telematics detectors report through the morning summary, not a WhatsApp blast'
   AND severity = 'high'
   AND effective_to IS NULL
   AND incident_type = ANY(ARRAY[
     'severe_driving', 'prolonged_unauthorized_stop', 'lost_contact_moving', 'dangerous_area_entry'
   ]::text[]);

-- 2. Remove them.
DELETE FROM fleet_operational_incident_rules target
 USING rb529_authored authored
 WHERE target.id = authored.id;

-- 3. Reopen EXACTLY the row each of them closed.
--
--    529 closes a row and opens its replacement in one transaction, so the two
--    share one `now()` and the half-open ranges MEET: the closed row's
--    effective_to equals the 529 row's effective_from, to the microsecond. That
--    is an exact identification and it is why this is not a heuristic.
--
--    It must not be "the newest closed critical row per type". Ranges cannot
--    overlap, so reopening any row other than the latest-ending one extends it
--    to 'infinity' straight through a later row and raises 23P01 — which is
--    precisely what a severity-based selection does the moment a type's newest
--    closed row is not critical. In that state (529's row closed by hand with
--    no replacement) this statement correctly matches nothing and the rollback
--    leaves the type alone instead of failing the whole file.
--
--    The NOT EXISTS guard keeps it idempotent and stops it ever creating a
--    second open row for a type.
UPDATE fleet_operational_incident_rules target
   SET effective_to = NULL, updated_at = now()
  FROM rb529_authored authored
 WHERE target.incident_type = authored.incident_type
   AND target.effective_to = authored.effective_from
   AND NOT EXISTS (
     SELECT 1 FROM fleet_operational_incident_rules open_rule
      WHERE open_rule.incident_type = target.incident_type
        AND open_rule.effective_to IS NULL
   );

DROP TABLE rb529_authored;

-- 4. Restore the PENDING rows 529 edited in place.
--
--    529 could not close these — a pending row's effective_from is in the
--    future, so effective_to = now() would fail the range-order CHECK — so it
--    changed them where they stood and appended a marker to change_reason. That
--    marker is the ONLY handle on them: an operator's own pending `high` row
--    carries no marker and is left alone.
--
--    The restored values are 510's seed shape for these four types. They are
--    the only state 529 can have overwritten, because branch B fires solely on
--    rows that were `severity = 'critical'`. (Restoring whatsapp_enabled is
--    cosmetic in any case: `requiresMandatoryIncidentWhatsApp` reads severity
--    and producer kind, never the flag.)
--
--    Stripping the marker is what makes this idempotent — a second run no
--    longer matches.
UPDATE fleet_operational_incident_rules
   SET severity = 'critical',
       whatsapp_enabled = true,
       immediate_notification = true,
       include_in_morning_summary = false,
       change_reason = NULLIF(
         btrim(regexp_replace(change_reason, '( \| )?529: re-versioned pending row to high$', '')),
         ''
       ),
       updated_at = now()
 WHERE severity = 'high'
   AND change_reason LIKE '%529: re-versioned pending row to high'
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
