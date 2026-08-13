-- 489_fleet_operational_status_rules.sql
-- Effective-dated, auditable thresholds used by Fleet operational status classification.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS fleet_operational_status_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version INTEGER NOT NULL UNIQUE,
  timezone TEXT NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL,
  effective_to TIMESTAMPTZ,
  monitoring_before_minutes INTEGER NOT NULL,
  monitoring_after_minutes INTEGER NOT NULL,
  arrival_dwell_minutes INTEGER NOT NULL,
  wrong_site_confirmation_minutes INTEGER NOT NULL,
  early_departure_confirmation_minutes INTEGER NOT NULL,
  approaching_distance_meters INTEGER NOT NULL,
  approaching_min_readings INTEGER NOT NULL,
  minimum_moving_speed_kmh NUMERIC(8,2) NOT NULL,
  evidence_mismatch_tolerance_meters INTEGER NOT NULL,
  change_reason TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fleet_operational_status_rules_version_positive CHECK (version > 0),
  CONSTRAINT fleet_operational_status_rules_timezone_nonblank CHECK (btrim(timezone) <> ''),
  CONSTRAINT fleet_operational_status_rules_range_order CHECK (effective_to IS NULL OR effective_to > effective_from),
  CONSTRAINT fleet_operational_status_rules_time_thresholds_nonnegative CHECK (
    monitoring_before_minutes >= 0 AND monitoring_after_minutes >= 0 AND arrival_dwell_minutes >= 0
    AND wrong_site_confirmation_minutes >= 0 AND early_departure_confirmation_minutes >= 0
  ),
  CONSTRAINT fleet_operational_status_rules_approaching_positive CHECK (
    approaching_distance_meters > 0 AND approaching_min_readings >= 2
  ),
  CONSTRAINT fleet_operational_status_rules_motion_nonnegative CHECK (
    minimum_moving_speed_kmh >= 0 AND evidence_mismatch_tolerance_meters >= 0
  ),
  CONSTRAINT fleet_operational_status_rules_reason_nonblank CHECK (
    change_reason IS NULL OR btrim(change_reason) <> ''
  )
);

ALTER TABLE fleet_operational_status_rules
  ADD CONSTRAINT fleet_operational_status_rules_no_overlap
  EXCLUDE USING gist (
    tstzrange(effective_from, COALESCE(effective_to, 'infinity'::timestamptz), '[)') WITH &&
  );

CREATE UNIQUE INDEX IF NOT EXISTS ux_fleet_operational_status_rules_one_open
  ON fleet_operational_status_rules ((true)) WHERE effective_to IS NULL;

INSERT INTO fleet_operational_status_rules (
  version, timezone, effective_from, monitoring_before_minutes, monitoring_after_minutes,
  arrival_dwell_minutes, wrong_site_confirmation_minutes, early_departure_confirmation_minutes,
  approaching_distance_meters, approaching_min_readings, minimum_moving_speed_kmh,
  evidence_mismatch_tolerance_meters
) VALUES (1, 'Africa/Johannesburg', now(), 60, 60, 5, 5, 10, 10000, 2, 5, 250)
ON CONFLICT (version) DO NOTHING;

INSERT INTO access_permissions (type, key, parent_key, label, description, route, sort_order, is_active)
VALUES
  ('page', 'fleet.operations-status', 'fleet', 'Operational Status', 'View Fleet operational status', '/fleet/operations', 23, true),
  ('page', 'fleet.operations-rules', 'fleet', 'Operational Rules', 'Manage versioned Fleet operational status rules', '/fleet/operations/rules', 24, true)
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role, permission_key, actions)
VALUES
  ('super_admin', 'fleet.operations-status', '{"view":true,"create":false,"edit":false,"delete":false}'::jsonb),
  ('admin', 'fleet.operations-status', '{"view":true,"create":false,"edit":false,"delete":false}'::jsonb),
  ('manager', 'fleet.operations-status', '{"view":true,"create":false,"edit":false,"delete":false}'::jsonb),
  ('project_manager', 'fleet.operations-status', '{"view":true,"create":false,"edit":false,"delete":false}'::jsonb),
  ('viewer', 'fleet.operations-status', '{"view":true,"create":false,"edit":false,"delete":false}'::jsonb),
  ('super_admin', 'fleet.operations-rules', '{"view":true,"create":true,"edit":true,"delete":false}'::jsonb),
  ('admin', 'fleet.operations-rules', '{"view":true,"create":true,"edit":true,"delete":false}'::jsonb)
ON CONFLICT (role, permission_key) DO NOTHING;
