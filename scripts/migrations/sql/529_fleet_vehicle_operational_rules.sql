-- 529_fleet_vehicle_operational_rules.sql
-- Effective-dated, auditable thresholds for the vehicle telematics detectors,
-- modelled 1:1 on 498_fleet_operational_status_rules.sql.
--
-- Three things ship together because they are one decision:
--   1. the versioned vehicle rule table (thresholds measured by PR0, not guessed);
--   2. fleet_vehicles.after_hours_exempt, which the theft detector reads;
--   3. a re-version of four telematics incident rules from 'critical' to 'high'.
--
-- (3) is the WhatsApp gate. `requiresMandatoryIncidentWhatsApp(severity, producerKind)`
-- in src/modules/fleet/incidents/types.ts is `severity === 'critical' && producerKind ===
-- 'source_event'`, and migration 510 seeded ALL SIX telematics types critical with
-- whatsapp_enabled = true. Wiring the detectors (PR4) before this lands would blast a
-- WhatsApp for every harsh-braking event and every prolonged stop. Severity is the only
-- lever, so the four non-emergency types drop to 'high'. `accident_sos` and
-- `theft_after_hours_movement` stay critical and stay on WhatsApp — deliberately.
--
-- NO explicit BEGIN/COMMIT here, and that is load-bearing.
--
-- Forward migrations are applied by scripts/run-pending-migrations.sh:127 as
--
--     psql -v ON_ERROR_STOP=1 -q -1 -c '\i <file>' -c 'INSERT INTO schema_migrations ...'
--
-- `-1` already wraps BOTH the file and the schema_migrations record in ONE
-- transaction. An explicit BEGIN inside the file nests (a warning) and the
-- COMMIT ends that transaction early, so the record insert then autocommits
-- separately. Measured on PostgreSQL 15: with an inner BEGIN/COMMIT, a failure
-- in the trailing -c leaves the migration APPLIED and UNRECORDED — and an
-- unrecorded migration re-runs on the next deploy. Without it, `-1` rolls
-- everything back correctly.
--
-- (run.ts:151 wraps a transaction too, but that is the ROLLBACK path —
-- `npm run db:migrate rollback <n>` — not this one.)
--
-- The one place a file genuinely needs its own atomicity is the incident-rule
-- re-versioning at the foot of this file, because closing a row and opening its
-- replacement are only correct together. That is solved by making THAT pair a
-- single statement, which is atomic in every execution mode without any
-- transaction control at all — including a hand-run `psql -f`, which
-- autocommits.
--
-- The re-versioning is two statements overall (active rows, then pending rows),
-- but they touch DISJOINT sets of rows, neither leaves a type without an open
-- rule on its own, and both are idempotent under their `severity = 'critical'`
-- filter. A `psql -f` run that dies between them is repaired by re-running the
-- file; there is no state in which one has run and the other must not.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS fleet_vehicle_operational_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version INTEGER NOT NULL UNIQUE,
  timezone TEXT NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ,
  after_hours_start_time TIME NOT NULL DEFAULT '18:00',
  after_hours_end_time TIME NOT NULL DEFAULT '06:00',
  weekends_are_after_hours BOOLEAN NOT NULL DEFAULT true,
  public_holidays_are_after_hours BOOLEAN NOT NULL DEFAULT true,
  theft_displacement_meters INTEGER NOT NULL DEFAULT 500,
  theft_min_positions INTEGER NOT NULL DEFAULT 2,
  harsh_linear_g NUMERIC(5,3) NOT NULL DEFAULT 0.350,
  harsh_lateral_g NUMERIC(5,3) NOT NULL DEFAULT 0.350,
  harsh_min_speed_kph NUMERIC(6,2) NOT NULL DEFAULT 20,
  speed_over_limit_kph NUMERIC(6,2) NOT NULL DEFAULT 15,
  unauthorized_stop_minutes INTEGER NOT NULL DEFAULT 45,
  lost_contact_minutes INTEGER NOT NULL DEFAULT 30,
  idle_alert_minutes INTEGER NOT NULL DEFAULT 20,
  known_site_radius_meters INTEGER NOT NULL DEFAULT 500,
  change_reason TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fleet_vehicle_operational_rules_version_positive CHECK (version > 0),
  CONSTRAINT fleet_vehicle_operational_rules_timezone_nonblank CHECK (btrim(timezone) <> ''),
  CONSTRAINT fleet_vehicle_operational_rules_range_order CHECK (effective_to IS NULL OR effective_to > effective_from),
  -- A single GPS blip must never be able to fire the theft detector, so two fixes is the floor.
  CONSTRAINT fleet_vehicle_operational_rules_theft_thresholds CHECK (
    theft_displacement_meters > 0 AND theft_min_positions >= 2
  ),
  CONSTRAINT fleet_vehicle_operational_rules_gforce_nonnegative CHECK (
    harsh_linear_g >= 0 AND harsh_lateral_g >= 0 AND harsh_min_speed_kph >= 0 AND speed_over_limit_kph >= 0
  ),
  CONSTRAINT fleet_vehicle_operational_rules_minutes_positive CHECK (
    unauthorized_stop_minutes > 0 AND lost_contact_minutes > 0 AND idle_alert_minutes > 0
  ),
  CONSTRAINT fleet_vehicle_operational_rules_radius_positive CHECK (known_site_radius_meters > 0),
  CONSTRAINT fleet_vehicle_operational_rules_reason_nonblank CHECK (
    change_reason IS NULL OR btrim(change_reason) <> ''
  )
);

-- Guarded because ADD CONSTRAINT has no IF NOT EXISTS: a re-run of the file
-- would otherwise abort with 42P07 before reaching the re-versioning below.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'fleet_vehicle_operational_rules_no_overlap'
       AND conrelid = 'fleet_vehicle_operational_rules'::regclass
  ) THEN
    ALTER TABLE fleet_vehicle_operational_rules
      ADD CONSTRAINT fleet_vehicle_operational_rules_no_overlap
      EXCLUDE USING gist (
        tstzrange(effective_from, COALESCE(effective_to, 'infinity'::timestamptz), '[)') WITH &&
      );
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_fleet_vehicle_operational_rules_one_open
  ON fleet_vehicle_operational_rules ((true)) WHERE effective_to IS NULL;

REVOKE ALL ON fleet_vehicle_operational_rules FROM fibreflow_user;
GRANT SELECT, INSERT, UPDATE ON fleet_vehicle_operational_rules TO fibreflow_user;

-- Version 1 takes every column default. The defaults ARE the seeded thresholds
-- (PR0 measured them on 30 days of fleet_vehicle_positions); spelling them out
-- again in a VALUES list would let the two drift.
INSERT INTO fleet_vehicle_operational_rules (version, timezone, effective_from)
VALUES (1, 'Africa/Johannesburg', now())
ON CONFLICT (version) DO NOTHING;

-- Additive and defaulted: safe against the running production code, which never
-- names fleet_vehicles' columns exhaustively.
ALTER TABLE fleet_vehicles ADD COLUMN IF NOT EXISTS after_hours_exempt BOOLEAN NOT NULL DEFAULT false;

-- Re-version the four non-emergency telematics incident rules. See the header.
--
-- Two things make this safe against a database an operator has already touched
-- through the incident-settings UI, which `version = 1` did NOT:
--
--   * The close is scoped by `severity = 'critical'`, not by version. That is
--     self-limiting: after this migration no open row among the four is
--     critical, so a re-run closes nothing and inserts nothing. It also leaves
--     an operator's own deliberate non-critical version alone rather than
--     re-versioning on top of it.
--   * The new row takes `max(version) + 1` FOR THAT TYPE, computed per type
--     from the rows just closed. Hard-coding 2 collides with an operator's
--     existing version 2 — and under `ON CONFLICT DO NOTHING` that collision is
--     silent, leaving the type critical with WhatsApp armed and the migration
--     exiting 0. There is deliberately no ON CONFLICT clause here: a collision
--     must fail the migration loudly.
--
-- The re-versioning splits by STATE, because an open row is not necessarily an
-- effective one.
--
-- `fleet_operational_incident_rules_range_order` is
-- `CHECK (effective_to IS NULL OR effective_to > effective_from)`, so closing an
-- open row whose `effective_from` is in the future is earlier than its own start
-- and fails: the runner aborts the whole deploy, and a hand-run `psql -f`
-- half-applies and exits 0 with all four types still critical and still on
-- WhatsApp.
--
-- How a pending row gets there matters for judging the risk, so be precise:
-- `IncidentSettingsDialog.tsx`'s RULED_TYPES is ['late', 'wrong_site',
-- 'evidence_mismatch', 'left_early'], so the settings UI cannot author a version
-- for ANY of the four telematics types. `versionIncidentRule` in
-- settingsRepository.ts accepts any IncidentType, though, and every version it
-- writes is future-dated. A pending critical row for these four is therefore
-- API- or SQL-authored, not clicked — reachable, and not something a migration
-- may assume away.
--
-- Branch A — ACTIVE open rows (`effective_from < now()`): close and open a
-- successor, which is the ordinary versioning move and preserves the history of
-- a rule that has actually been in force.
--
-- Branch B — WHATEVER BRANCH A LEFT OPEN: update IN PLACE. A pending row has
-- never judged an incident, so there is no history to preserve, no successor to
-- open, and no range to touch. Branch B carries NO `effective_from` predicate of
-- its own — reading the clock a second time opens a gap between the two
-- statements under `psql -f`; see the note on the statement itself.
--
-- Both branches filter on `severity = 'critical'`, which is what makes them
-- idempotent and what leaves an operator's deliberate non-critical version
-- alone. The two sets are disjoint and together cover every open row.

-- Branch A. ONE statement, for two independent reasons.
--
--   * Atomicity in every mode. Closing a row and opening its replacement are
--     only correct together: the close alone leaves four incident types with NO
--     open rule, and `loadEffectiveIncidentRule` throws for a type with no open
--     row — taking the whole operational monitor down. As two statements this
--     holds only where something supplies a transaction; as one statement it
--     holds under `psql -f` autocommit too.
--   * `closed.effective_to` is carried out of the UPDATE by RETURNING and used
--     as the new row's `effective_from`. Adjacency is then a DATA DEPENDENCY,
--     not a coincidence of two statements happening to observe the same
--     `now()`. The rollback identifies what to reopen by exactly this equality,
--     so if the two instants could ever differ — by a millisecond, under any
--     execution mode — the rollback would silently reopen nothing and exit 0.
--
-- The half-open '[)' ranges therefore MEET rather than overlap, which is what
-- the gist exclusion constraint requires.
--
-- The version is `max(version) + 1` FOR THAT TYPE. A global max would hand a
-- type a version number unrelated to its own history and break the per-type
-- `(incident_type, version)` sequence the audit trail reads.
--
-- No ON CONFLICT clause: hard-coding a version collides with an operator's
-- existing one, and ON CONFLICT DO NOTHING would make that collision silent —
-- leaving the type critical with WhatsApp armed and the migration exiting 0.
WITH closed AS (
  UPDATE fleet_operational_incident_rules
     SET effective_to = now(), updated_at = now()
   WHERE effective_to IS NULL
     AND effective_from < now()
     AND severity = 'critical'
     AND incident_type = ANY(ARRAY[
       'severe_driving', 'prolonged_unauthorized_stop', 'lost_contact_moving', 'dangerous_area_entry'
     ]::text[])
  RETURNING incident_type, effective_to
)
INSERT INTO fleet_operational_incident_rules (
  incident_type, version, effective_from, creates_incident, severity, immediate_notification,
  in_app_enabled, email_enabled, whatsapp_enabled, include_in_morning_summary,
  acknowledgement_target_minutes, change_reason
)
SELECT closed.incident_type,
       (SELECT max(existing.version) + 1 FROM fleet_operational_incident_rules existing
         WHERE existing.incident_type = closed.incident_type),
       closed.effective_to,
       true, 'high', false, true, true, false, true, 5,
       'Migration 529: telematics detectors report through the morning summary, not a WhatsApp blast'
  FROM closed;

-- Branch B. Whatever branch A left open.
--
-- No `effective_from` predicate, deliberately. Branch A already took every
-- ACTIVE row, so any open `critical` row of these four types that survives it is
-- pending by construction. A mirror-image `effective_from >= now()` here would
-- read the clock a SECOND time, and under `psql -f` the two statements are two
-- transactions: a row whose effective_from falls between branch A's now() and
-- branch B's now() is pending to A and active to B, and neither matches it. It
-- would stay critical with WhatsApp armed, silently.
--
-- A pending row is edited where it stands; its version, its effective_from and
-- its place in the history are all left exactly as the operator set them. That
-- is the only option available: `effective_to = now()` on a row whose
-- effective_from is in the future is earlier than its own start and fails
-- fleet_operational_incident_rules_range_order.
--
-- The marker appended to change_reason CARRIES THE PRIOR FLAG VALUES, because
-- the `severity = 'critical'` filter constrains severity and nothing else. An
-- operator may perfectly well hold a critical row with whatsapp_enabled false;
-- restoring 510's seed shape on rollback would silently turn their WhatsApp
-- back on. The three booleans are read from the row being updated — a SET
-- expression sees the OLD values — and the rollback parses them back out.
UPDATE fleet_operational_incident_rules
   SET severity = 'high',
       whatsapp_enabled = false,
       immediate_notification = false,
       include_in_morning_summary = true,
       change_reason = CASE
         WHEN NULLIF(btrim(COALESCE(change_reason, '')), '') IS NULL
           THEN '529:pending{wa=' || whatsapp_enabled
                || ',imm=' || immediate_notification
                || ',morn=' || include_in_morning_summary || '}'
         ELSE btrim(change_reason) || ' | 529:pending{wa=' || whatsapp_enabled
                || ',imm=' || immediate_notification
                || ',morn=' || include_in_morning_summary || '}'
       END,
       updated_at = now()
 WHERE effective_to IS NULL
   AND severity = 'critical'
   AND incident_type = ANY(ARRAY[
     'severe_driving', 'prolonged_unauthorized_stop', 'lost_contact_moving', 'dangerous_area_entry'
   ]::text[]);

INSERT INTO access_permissions (type, key, parent_key, label, description, route, sort_order, is_active)
VALUES
  ('page', 'fleet.vehicle-stats', 'fleet', 'Vehicle Stats', 'View per-vehicle telematics day statistics', '/fleet/vehicles', 27, true),
  ('page', 'fleet.vehicle-rules', 'fleet', 'Vehicle Rules', 'Manage versioned Fleet vehicle telematics thresholds', '/fleet/assignments', 28, true)
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role, permission_key, actions)
VALUES
  ('super_admin', 'fleet.vehicle-stats', '{"view":true,"create":false,"edit":false,"delete":false}'::jsonb),
  ('admin', 'fleet.vehicle-stats', '{"view":true,"create":false,"edit":false,"delete":false}'::jsonb),
  ('manager', 'fleet.vehicle-stats', '{"view":true,"create":false,"edit":false,"delete":false}'::jsonb),
  ('project_manager', 'fleet.vehicle-stats', '{"view":true,"create":false,"edit":false,"delete":false}'::jsonb),
  ('viewer', 'fleet.vehicle-stats', '{"view":true,"create":false,"edit":false,"delete":false}'::jsonb),
  ('super_admin', 'fleet.vehicle-rules', '{"view":true,"create":true,"edit":true,"delete":false}'::jsonb),
  ('admin', 'fleet.vehicle-rules', '{"view":true,"create":true,"edit":true,"delete":false}'::jsonb)
ON CONFLICT (role, permission_key) DO NOTHING;
