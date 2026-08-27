-- 529_fleet_vehicle_operational_rules.sql
-- Effective-dated, auditable thresholds for the vehicle telematics detectors,
-- modelled 1:1 on 498_fleet_operational_status_rules.sql.
--
-- Three things ship together because they are one decision:
--   1. the versioned vehicle rule table (thresholds measured by PR0, not guessed);
--   2. fleet_vehicles.after_hours_exempt, which the theft detector reads;
--   3. a re-version of four telematics incident rules from 'critical' to 'high',
--      in place, behind a guard that proves no incident references them.
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
-- re-versioning at the foot of this file, and that is a single DO block: a
-- guard and an UPDATE that cannot be half-executed in any mode, with no
-- transaction control of its own. Every other statement here is independently
-- idempotent (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`), so a `psql -f` run
-- that dies part-way is repaired by re-running the file.

-- THE GUARD RUNS FIRST, BEFORE ANY DDL IN THIS FILE.
--
-- If it fires, nothing this migration would otherwise do has happened yet:
-- under the runner (`psql -1`) the transaction rolls back, and under any
-- statement-at-a-time application that stops on error — which is what
-- ON_ERROR_STOP gives, and what the runner passes — execution never reaches
-- the CREATE TABLE below. (A bare `psql -f` with no ON_ERROR_STOP carries on
-- past an error; the statements after this point are all additive and
-- idempotent, so what it would leave behind is an unused table, not a rewritten
-- rule. The rules are what the guard protects.)
-- Re-version the four non-emergency telematics incident rules.
--
-- ONE statement. No branches, no version arithmetic, no close-and-insert, no
-- clock read, no interaction with any constraint on the table.
--
-- WHY IT IS ALLOWED TO REWRITE HISTORY IN PLACE
--
-- Versioning exists so that an incident can say which rule judged it. These
-- four rules have never judged anything: nothing calls the telematics
-- detectors yet — they arrive in PR4, strictly after this migration — so no
-- row of `fleet_operational_incidents` carries any of these four types. Rows
-- that never governed an incident carry no history worth preserving, and
-- editing them in place is therefore not a rewrite of the record but a
-- correction of a seed that was wrong the day 510 wrote it.
--
-- The guard below PROVES that at apply time rather than asserting it. If a
-- single incident of any of the four types exists, the migration refuses and
-- says so, and a human decides. It is inside the same DO block as the UPDATE
-- deliberately: as two statements it would only stop the UPDATE under
-- ON_ERROR_STOP, which scripts/run-pending-migrations.sh:127 does pass
-- (`psql -v ON_ERROR_STOP=1 -q -1`) but a hand-run `psql -f` does not. One
-- block cannot be half-executed in any mode.
--
-- WHAT IT REPLACES, AND WHY
--
-- Five earlier shapes of this migration tried to preserve version history —
-- close the open row and insert a successor. Every one of them was defeated by
-- a state the previous one had not considered: an operator's own version 2, a
-- closed version 2 in the history, a PENDING open row that cannot be closed at
-- all (`effective_to = now()` is earlier than its own `effective_from` and
-- fails fleet_operational_incident_rules_range_order), a row that activates
-- between two statements' clock reads, and a closed-but-still-effective
-- predecessor left behind by `versionIncidentRule`. That is a design problem,
-- not five bugs: the state machine of "which row is the current rule" has more
-- states than a migration can enumerate. This shape has no state machine. It
-- matches on `incident_type` and `severity` and nothing else, so it is correct
-- for every row of those types whatever its dates, its version number or its
-- open/closed state.
--
-- IDEMPOTENT by the `severity = 'critical'` filter: after it runs, no row of
-- these four types is critical, so a re-run matches nothing. It also leaves an
-- operator's deliberate non-critical row alone.
--
-- The marker appended to change_reason CARRIES THE PRIOR FLAG VALUES, because
-- the filter constrains severity and nothing else. An operator may hold a
-- critical row with whatsapp_enabled false; restoring 510's seed shape on
-- rollback would silently re-arm their WhatsApp. The three booleans are read
-- from the row being updated — a SET expression sees the OLD values — and the
-- rollback parses them back out.
--
-- The marker is anchored to the END of change_reason and the rollback matches
-- it with `$`. Residual risk, accepted and stated: an operator whose own prose
-- happens to END with the exact literal `529:reversioned{wa=...,imm=...,
-- morn=...}` would have that row restored by the rollback. Prose that merely
-- CONTAINS the marker mid-string is not matched, which is the case worth
-- guarding and is tested.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM fleet_operational_incidents
     WHERE incident_type = ANY(ARRAY[
       'severe_driving', 'prolonged_unauthorized_stop', 'lost_contact_moving', 'dangerous_area_entry'
     ]::text[])
  ) THEN
    RAISE EXCEPTION '529: operational incidents already exist for the telematics incident types. '
      'This migration rewrites those rules in place, which is only safe while no incident '
      'references them. Decide manually how to version them and re-run.';
  END IF;

  UPDATE fleet_operational_incident_rules
     SET severity = 'high',
         whatsapp_enabled = false,
         immediate_notification = false,
         include_in_morning_summary = true,
         -- Any marker already on the row is STRIPPED before the new one is
         -- appended. Without that, an operator who puts a row back to critical
         -- by hand and then re-runs this migration accumulates two markers, and
         -- the rollback's `$`-anchored match then restores the flags from the
         -- LAST one while the first is left as litter in the prose. One marker,
         -- always, carrying the flags the row held on the way in.
         change_reason = CASE
           WHEN NULLIF(btrim(regexp_replace(
                  COALESCE(change_reason, ''), '( \| )?529:reversioned\{[^}]*\}$', '')), '') IS NULL
             THEN '529:reversioned{wa=' || whatsapp_enabled
                  || ',imm=' || immediate_notification
                  || ',morn=' || include_in_morning_summary || '}'
           ELSE btrim(regexp_replace(
                  change_reason, '( \| )?529:reversioned\{[^}]*\}$', ''))
                  || ' | 529:reversioned{wa=' || whatsapp_enabled
                  || ',imm=' || immediate_notification
                  || ',morn=' || include_in_morning_summary || '}'
         END,
         updated_at = now()
   WHERE severity = 'critical'
     AND incident_type = ANY(ARRAY[
       'severe_driving', 'prolonged_unauthorized_stop', 'lost_contact_moving', 'dangerous_area_entry'
     ]::text[]);
END $$;

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS fleet_vehicle_operational_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version INTEGER NOT NULL UNIQUE,
  timezone TEXT NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ,
  after_hours_start_time TIME NOT NULL DEFAULT '21:00',
  after_hours_end_time TIME NOT NULL DEFAULT '05:00',
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
