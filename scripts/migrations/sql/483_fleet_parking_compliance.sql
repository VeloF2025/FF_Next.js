-- 483_fleet_parking_compliance.sql
-- Overnight parking compliance (Phase 1). See
-- docs/superpowers/specs/2026-08-04-fleet-parking-compliance-design.md
--
-- Numbered 483, not 479: master already carries 479_attendance_tracked_opt_in
-- and 479_ticket_gps_oes_backfill, and 482 is claimed by the attendance
-- adjustment fix. Forward apply is keyed on filename so a duplicate number
-- still applies, but `npm run db:migrate rollback <N>` resolves the rollback
-- with a first-match `startsWith('rollback_<N>_')` (scripts/migrations/run.ts),
-- so sharing a number makes a rollback pick an arbitrary unrelated migration.
--
-- Deliberately unwrapped: run-pending-migrations.sh supplies the transaction
-- (psql -1) and appends the schema_migrations bookkeeping insert to it. A
-- BEGIN/COMMIT in here ends that transaction early and splits the DDL from the
-- bookkeeping.

CREATE TABLE IF NOT EXISTS fleet_vehicle_parking_locations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- CASCADE is right here: a declared parking address is configuration for a
  -- vehicle, not evidence about it. It has no meaning once the vehicle is gone.
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
  CONSTRAINT fleet_parking_radius_check CHECK (radius_m > 0),
  -- The app validates coordinates via isValidLatLon before it writes, but a
  -- backfill script or a manual psql fix-up does not go through that path, and
  -- an out-of-range address silently degrades every future check on the vehicle
  -- to no_address. NUMERIC(10,7) permits lat = 200 on its own.
  CONSTRAINT fleet_parking_lat_range CHECK (lat BETWEEN -90 AND 90),
  CONSTRAINT fleet_parking_lon_range CHECK (lon BETWEEN -180 AND 180)
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
  -- SET NULL, not CASCADE: a compliance check is evidence, and it has to
  -- outlive the things it was checked against. pages/api/fleet/vehicles.ts
  -- exposes DELETE ?permanent=true, so CASCADE here would let one hard-delete
  -- of a sold vehicle erase every violation ever recorded for it — exactly the
  -- record a disputed deduction is settled from.
  vehicle_id           UUID REFERENCES fleet_vehicles(id) ON DELETE SET NULL,
  -- Snapshot, so an orphaned row still says which vehicle it describes.
  vehicle_registration TEXT NOT NULL,
  check_date           DATE NOT NULL,
  evaluated_at         TIMESTAMPTZ NOT NULL,
  -- SET NULL for the same reason: compliance history must survive the
  -- supersession or deletion of the parking-location row it was checked against.
  parking_location_id  UUID REFERENCES fleet_vehicle_parking_locations(id) ON DELETE SET NULL,
  last_fix_at          TIMESTAMPTZ,
  last_fix_lat         NUMERIC(10,7),
  last_fix_lon         NUMERIC(10,7),
  last_fix_age_seconds INTEGER,
  distance_m           INTEGER,
  result               VARCHAR(24) NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fleet_parking_result_check
    CHECK (result IN ('compliant','violation','unknown','not_verifiable','no_address')),
  CONSTRAINT fleet_parking_fix_lat_range
    CHECK (last_fix_lat IS NULL OR last_fix_lat BETWEEN -90 AND 90),
  CONSTRAINT fleet_parking_fix_lon_range
    CHECK (last_fix_lon IS NULL OR last_fix_lon BETWEEN -180 AND 180)
);

-- Arbiter for the nightly upsert. vehicle_id is nullable, and NULLs are
-- distinct in a unique index, so orphaned evidence rows never collide with
-- each other or block a live vehicle's day slot.
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

-- A page key with no role_permissions rows is not "open by default", it is
-- closed to everyone except super_admin (src/lib/permissions/index.ts bypasses
-- only that role). Without these grants the approval queue ships with zero
-- authorized approvers and presents as a 403 bug rather than a missing seed.
-- Shape and role set mirror 271_rbac_missing_pages.sql.
--
-- NOTE: these are child grants under parent_key 'fleet'. A child grant is inert
-- if the role holds no grant on the 'fleet' parent — that parent already exists
-- for every role below (the Fleet module is live), so nothing is seeded here.
INSERT INTO role_permissions (role, permission_key, actions)
VALUES
  ('super_admin', 'fleet.parking', '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb),
  ('super_admin', 'fleet.parking-requests', '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb),
  ('admin', 'fleet.parking', '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb),
  ('admin', 'fleet.parking-requests', '{"view": true, "create": true, "edit": true, "delete": true}'::jsonb),
  -- Fleet managers run the queue: they approve and reject, but do not delete
  -- the compliance record a decision was based on.
  ('manager', 'fleet.parking', '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb),
  ('manager', 'fleet.parking-requests', '{"view": true, "create": true, "edit": true, "delete": false}'::jsonb),
  -- Viewers see outcomes, never the approval queue.
  ('viewer', 'fleet.parking', '{"view": true, "create": false, "edit": false, "delete": false}'::jsonb),
  ('viewer', 'fleet.parking-requests', '{"view": false, "create": false, "edit": false, "delete": false}'::jsonb)
ON CONFLICT (role, permission_key) DO NOTHING;
