-- 479_fleet_parking_compliance.sql
-- Overnight parking compliance (Phase 1). See
-- docs/superpowers/specs/2026-08-04-fleet-parking-compliance-design.md

BEGIN;

CREATE TABLE IF NOT EXISTS fleet_vehicle_parking_locations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id           UUID NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
  declared_by_staff_id UUID NOT NULL REFERENCES staff(id),
  lat                  NUMERIC(10,7) NOT NULL,
  lon                  NUMERIC(10,7) NOT NULL,
  accuracy_m           NUMERIC,
  radius_m             INTEGER NOT NULL DEFAULT 200,
  label                VARCHAR(120),
  address_text         TEXT,
  status               VARCHAR(20) NOT NULL,
  request_note         TEXT,
  decision_note        TEXT,
  decided_by           UUID REFERENCES staff(id),
  decided_at           TIMESTAMPTZ,
  effective_from       TIMESTAMPTZ,
  superseded_at        TIMESTAMPTZ,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fleet_parking_status_check
    CHECK (status IN ('pending','active','superseded','rejected','withdrawn')),
  CONSTRAINT fleet_parking_radius_check CHECK (radius_m > 0)
);

-- Business rules enforced in the database, not in bypassable app code.
CREATE UNIQUE INDEX IF NOT EXISTS ux_parking_active_per_vehicle
  ON fleet_vehicle_parking_locations (vehicle_id) WHERE status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS ux_parking_pending_per_vehicle
  ON fleet_vehicle_parking_locations (vehicle_id) WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS ix_parking_vehicle_status
  ON fleet_vehicle_parking_locations (vehicle_id, status);

CREATE TABLE IF NOT EXISTS fleet_parking_compliance_checks (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id           UUID NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
  check_date           DATE NOT NULL,
  evaluated_at         TIMESTAMPTZ NOT NULL,
  -- SET NULL, not CASCADE: compliance history is evidence and must survive
  -- the deletion of the parking-location row it was checked against.
  parking_location_id  UUID REFERENCES fleet_vehicle_parking_locations(id) ON DELETE SET NULL,
  last_fix_at          TIMESTAMPTZ,
  last_fix_lat         NUMERIC(10,7),
  last_fix_lon         NUMERIC(10,7),
  last_fix_age_seconds INTEGER,
  distance_m           INTEGER,
  result               VARCHAR(24) NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fleet_parking_result_check
    CHECK (result IN ('compliant','violation','unknown','not_verifiable','no_address'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_parking_check_per_vehicle_day
  ON fleet_parking_compliance_checks (vehicle_id, check_date);

CREATE INDEX IF NOT EXISTS ix_parking_check_date_result
  ON fleet_parking_compliance_checks (check_date, result);

-- Authorization here is page/route based (access_permissions), not
-- role-capability based. These rows are what "fleet manager" means.
-- parent_key = 'fleet' so these appear under the Fleet module in the
-- admin permissions tree (see pages/api/admin/permissions/module-access.ts,
-- which filters children by parent_key). sort_order 20/21 is clear of the
-- highest known sibling under 'fleet' (fleet.mileage at 15, see
-- scripts/migrations/sql/271_rbac_missing_pages.sql).
INSERT INTO access_permissions (type, key, parent_key, label, description, route, sort_order, is_active)
VALUES
  ('page', 'fleet.parking', 'fleet', 'Parking Compliance',
   'View overnight parking compliance results', '/fleet/parking', 20, true),
  ('page', 'fleet.parking-requests', 'fleet', 'Parking Requests',
   'Approve or reject driver parking address changes', '/fleet/parking/requests', 21, true)
ON CONFLICT (key) DO NOTHING;

COMMIT;
