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
-- NO explicit BEGIN/COMMIT here. scripts/migrations/run.ts:151 already wraps the whole
-- file in one transaction, and tests/migrations apply it as a single simple query, which
-- Postgres also wraps implicitly. An explicit BEGIN would nest (a warning) and the
-- COMMIT would end the runner's transaction early. The close-then-insert below is
-- therefore atomic, which is what the gist exclusion constraint needs: both statements
-- see the same transaction `now()`, and the '[)' range is half-open, so version 1's
-- effective_to and version 2's effective_from meeting at that instant do not overlap.

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
-- `version = 1` is load-bearing, not decoration. Without it a second run of
-- this file closes the version 2 rows it just opened, and the follow-up INSERT
-- is a no-op under ON CONFLICT — leaving four incident types with NO effective
-- rule, which makes the incident producer throw.
UPDATE fleet_operational_incident_rules
   SET effective_to = now(), updated_at = now()
 WHERE effective_to IS NULL
   AND version = 1
   AND incident_type = ANY(ARRAY[
     'severe_driving', 'prolonged_unauthorized_stop', 'lost_contact_moving', 'dangerous_area_entry'
   ]::text[]);

INSERT INTO fleet_operational_incident_rules (
  incident_type, version, effective_from, creates_incident, severity, immediate_notification,
  in_app_enabled, email_enabled, whatsapp_enabled, include_in_morning_summary,
  acknowledgement_target_minutes, change_reason
) VALUES
  ('severe_driving', 2, now(), true, 'high', false, true, true, false, true, 5,
   'Telematics detectors report through the morning summary, not a WhatsApp blast'),
  ('prolonged_unauthorized_stop', 2, now(), true, 'high', false, true, true, false, true, 5,
   'Telematics detectors report through the morning summary, not a WhatsApp blast'),
  ('lost_contact_moving', 2, now(), true, 'high', false, true, true, false, true, 5,
   'Telematics detectors report through the morning summary, not a WhatsApp blast'),
  ('dangerous_area_entry', 2, now(), true, 'high', false, true, true, false, true, 5,
   'Telematics detectors report through the morning summary, not a WhatsApp blast')
ON CONFLICT (incident_type, version) DO NOTHING;

INSERT INTO access_permissions (type, key, parent_key, label, description, route, sort_order, is_active)
VALUES
  ('page', 'fleet.vehicle-rules', 'fleet', 'Vehicle Rules', 'Manage versioned Fleet vehicle telematics thresholds', '/fleet/assignments', 27, true)
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role, permission_key, actions)
VALUES
  ('super_admin', 'fleet.vehicle-rules', '{"view":true,"create":true,"edit":true,"delete":false}'::jsonb),
  ('admin', 'fleet.vehicle-rules', '{"view":true,"create":true,"edit":true,"delete":false}'::jsonb)
ON CONFLICT (role, permission_key) DO NOTHING;
