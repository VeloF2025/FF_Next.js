-- 488_fleet_operational_assignments.sql
-- Explicit project/site expectations for operational roster assignments.
-- This migration intentionally does not copy geometry, vehicle/project fallback,
-- or attendance evidence into durable assignment rows.

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE IF NOT EXISTS fleet_project_operational_sites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id),
  display_name TEXT NOT NULL,
  project_aoi_id UUID REFERENCES fno_atlas_project_aois(id),
  authorized_location_id UUID REFERENCES fleet_authorized_locations(id),
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fleet_project_operational_sites_one_source_check
    CHECK (num_nonnulls(project_aoi_id, authorized_location_id) = 1),
  CONSTRAINT fleet_project_operational_sites_display_name_nonblank_check
    CHECK (btrim(display_name) <> '')
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_fleet_project_operational_sites_active_default
  ON fleet_project_operational_sites (project_id)
  WHERE is_active AND is_default;

CREATE UNIQUE INDEX IF NOT EXISTS ux_fleet_project_operational_sites_active_aoi
  ON fleet_project_operational_sites (project_id, project_aoi_id)
  WHERE is_active AND project_aoi_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS ux_fleet_project_operational_sites_active_location
  ON fleet_project_operational_sites (project_id, authorized_location_id)
  WHERE is_active AND authorized_location_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS ix_fleet_project_operational_sites_project_active
  ON fleet_project_operational_sites (project_id, is_active);

CREATE TABLE IF NOT EXISTS fleet_operational_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id UUID NOT NULL REFERENCES staff(id),
  project_id UUID NOT NULL REFERENCES projects(id),
  operational_site_id UUID NOT NULL REFERENCES fleet_project_operational_sites(id),
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  assignment_kind TEXT NOT NULL,
  vehicle_assignment_id UUID REFERENCES vehicle_assignments(id),
  status TEXT NOT NULL DEFAULT 'active',
  reason TEXT,
  project_name_snapshot TEXT NOT NULL,
  project_code_snapshot TEXT,
  operational_site_display_name_snapshot TEXT NOT NULL,
  created_by UUID NOT NULL REFERENCES users(id),
  superseded_by UUID REFERENCES fleet_operational_assignments(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fleet_operational_assignments_kind_check
    CHECK (assignment_kind IN ('roster', 'daily_override')),
  CONSTRAINT fleet_operational_assignments_status_check
    CHECK (status IN ('active', 'superseded', 'ended')),
  CONSTRAINT fleet_operational_assignments_date_order_check
    CHECK (end_date >= start_date),
  CONSTRAINT fleet_operational_assignments_daily_override_check
    CHECK (
      assignment_kind <> 'daily_override'
      OR (start_date = end_date AND NULLIF(btrim(reason), '') IS NOT NULL)
    ),
  CONSTRAINT fleet_operational_assignments_project_name_snapshot_nonblank_check
    CHECK (btrim(project_name_snapshot) <> ''),
  CONSTRAINT fleet_operational_assignments_site_snapshot_nonblank_check
    CHECK (btrim(operational_site_display_name_snapshot) <> '')
);

ALTER TABLE fleet_operational_assignments
  ADD CONSTRAINT fleet_operational_assignments_no_overlap
  EXCLUDE USING gist (
    staff_id WITH =,
    daterange(start_date, end_date, '[]') WITH &&
  ) WHERE (status = 'active');

CREATE INDEX IF NOT EXISTS ix_fleet_operational_assignments_project_date
  ON fleet_operational_assignments (project_id, start_date, end_date)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS ix_fleet_operational_assignments_staff_date
  ON fleet_operational_assignments (staff_id, start_date, end_date)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS ix_fleet_operational_assignments_site
  ON fleet_operational_assignments (operational_site_id, start_date, end_date);

CREATE TABLE IF NOT EXISTS fleet_project_operational_site_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operational_site_id UUID NOT NULL REFERENCES fleet_project_operational_sites(id),
  action TEXT NOT NULL,
  actor_user_id UUID NOT NULL REFERENCES users(id),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT,
  request_correlation_id TEXT,
  before_snapshot JSONB,
  after_snapshot JSONB,
  CONSTRAINT fleet_project_operational_site_audit_action_check
    CHECK (action IN ('created', 'default_changed', 'deactivated')),
  CONSTRAINT fleet_project_operational_site_audit_before_snapshot_object_check
    CHECK (before_snapshot IS NULL OR jsonb_typeof(before_snapshot) = 'object'),
  CONSTRAINT fleet_project_operational_site_audit_after_snapshot_object_check
    CHECK (after_snapshot IS NULL OR jsonb_typeof(after_snapshot) = 'object')
);

CREATE INDEX IF NOT EXISTS ix_fleet_project_operational_site_audit_site_occurred
  ON fleet_project_operational_site_audit (operational_site_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS fleet_operational_assignment_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id UUID NOT NULL REFERENCES fleet_operational_assignments(id),
  action TEXT NOT NULL,
  actor_user_id UUID NOT NULL REFERENCES users(id),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  reason TEXT,
  request_correlation_id TEXT,
  before_snapshot JSONB,
  after_snapshot JSONB,
  CONSTRAINT fleet_operational_assignment_audit_action_check
    CHECK (action IN ('created', 'bulk_created', 'moved', 'ended', 'superseded', 'override_created')),
  CONSTRAINT fleet_operational_assignment_audit_before_snapshot_object_check
    CHECK (before_snapshot IS NULL OR jsonb_typeof(before_snapshot) = 'object'),
  CONSTRAINT fleet_operational_assignment_audit_after_snapshot_object_check
    CHECK (after_snapshot IS NULL OR jsonb_typeof(after_snapshot) = 'object')
);

CREATE INDEX IF NOT EXISTS ix_fleet_operational_assignment_audit_assignment_occurred
  ON fleet_operational_assignment_audit (assignment_id, occurred_at DESC);

INSERT INTO access_permissions (type, key, parent_key, label, description, route, sort_order, is_active)
VALUES (
  'page', 'fleet.assignments', 'fleet', 'Operational Assignments',
  'Configure project operational sites and explicit staff assignments', '/fleet/assignments', 22, true
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO role_permissions (role, permission_key, actions)
VALUES
  ('super_admin', 'fleet.assignments', '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb),
  ('admin', 'fleet.assignments', '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb),
  ('manager', 'fleet.assignments', '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb),
  ('viewer', 'fleet.assignments', '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb)
ON CONFLICT (role, permission_key) DO NOTHING;
