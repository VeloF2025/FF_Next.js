/** Real-Postgres execution contract for the production operational evidence loader. */
if (!process.env.TEST_DATABASE_URL) {
  throw new Error('Integration test needs TEST_DATABASE_URL set. See .env.local.example.');
}

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Pool } from 'pg';

const SCHEMA = 'mig489_fleet_operational_evidence_scratch';
const BASE_URL = process.env.TEST_DATABASE_URL;
const SCOPED_URL = `${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}options=${encodeURIComponent(
  `-c search_path=${SCHEMA},public`,
)}`;
process.env.DATABASE_URL = SCOPED_URL;

const PROJECT = '10000000-0000-4000-8000-000000000001';
const SELECTED_STAFF = '10000000-0000-4000-8000-000000000002';
const AMBIGUOUS_STAFF = '10000000-0000-4000-8000-000000000003';
const INVALID_STAFF = '10000000-0000-4000-8000-000000000004';
const REQUIRED_SITE = '10000000-0000-4000-8000-000000000005';
const WRONG_AOI_SITE = '10000000-0000-4000-8000-000000000006';
const WRONG_CIRCLE_SITE = '10000000-0000-4000-8000-000000000007';
const RETIRED_SITE = '10000000-0000-4000-8000-000000000008';
const REQUIRED_LOCATION = '10000000-0000-4000-8000-000000000009';
const WRONG_LOCATION = '10000000-0000-4000-8000-000000000010';
const WRONG_AOI = '10000000-0000-4000-8000-000000000011';
const RETIRED_AOI = '10000000-0000-4000-8000-000000000012';
const SELECTED_ASSIGNMENT = '10000000-0000-4000-8000-000000000013';
const SELECTED_VEHICLE = '10000000-0000-4000-8000-000000000014';

const admin = new Pool({ connectionString: BASE_URL, ssl: false, max: 1 });
const db = new Pool({ connectionString: SCOPED_URL, ssl: false, max: 1 });
let productionPool: Pool;
let loadOperationalEvidence: typeof import('@/modules/fleet/operations/evidenceQueries').loadOperationalEvidence;

const SCHEMA_SQL = `
  CREATE EXTENSION IF NOT EXISTS postgis;
  CREATE TABLE staff (id UUID PRIMARY KEY, first_name TEXT, last_name TEXT, home_site_id UUID,
    status TEXT DEFAULT 'active', is_active BOOLEAN DEFAULT true);
  CREATE TABLE projects (id UUID PRIMARY KEY, project_name TEXT NOT NULL);
  CREATE TABLE fleet_authorized_locations (id UUID PRIMARY KEY, name TEXT NOT NULL, lat NUMERIC NOT NULL,
    lon NUMERIC NOT NULL, radius_km NUMERIC NOT NULL, is_active BOOLEAN NOT NULL DEFAULT true);
  CREATE TABLE fno_atlas_project_aois (id UUID PRIMARY KEY, geom geometry(MultiPolygon,4326) NOT NULL,
    confidence TEXT NOT NULL, retired_at TIMESTAMPTZ);
  CREATE TABLE fleet_project_operational_sites (id UUID PRIMARY KEY, project_id UUID NOT NULL,
    display_name TEXT NOT NULL, project_aoi_id UUID, authorized_location_id UUID,
    is_active BOOLEAN NOT NULL DEFAULT true, is_default BOOLEAN NOT NULL DEFAULT false);
  CREATE TABLE fleet_vehicles (id UUID PRIMARY KEY, registration_number TEXT, status TEXT);
  CREATE TABLE vehicle_assignments (id UUID PRIMARY KEY, staff_id UUID NOT NULL, fleet_vehicle_id UUID NOT NULL,
    assignment_start DATE NOT NULL, assignment_end DATE);
  CREATE TABLE fleet_vehicle_project_assignments (id UUID PRIMARY KEY, vehicle_id UUID, project_id UUID,
    is_active BOOLEAN, assigned_date DATE, returned_date DATE);
  CREATE TABLE fleet_operational_assignments (id UUID PRIMARY KEY, staff_id UUID NOT NULL, project_id UUID NOT NULL,
    operational_site_id UUID NOT NULL, start_date DATE NOT NULL, end_date DATE NOT NULL,
    assignment_kind TEXT NOT NULL, vehicle_assignment_id UUID, status TEXT NOT NULL);
  CREATE TABLE attendance_policies (id UUID PRIMARY KEY, is_active BOOLEAN, start_time TIME, end_time TIME,
    work_days JSONB);
  CREATE TABLE attendance_policy_assignments (staff_id UUID, policy_id UUID, effective_from DATE, effective_to DATE);
  CREATE TABLE attendance_schedule_policies (id UUID PRIMARY KEY, timezone TEXT, active_from DATE, active_to DATE,
    late_alert_minutes INTEGER);
  CREATE TABLE attendance_entries (id UUID PRIMARY KEY, staff_id UUID, work_date DATE, clock_in_at TIMESTAMPTZ,
    clock_out_at TIMESTAMPTZ, clock_in_lat NUMERIC, clock_in_lon NUMERIC, clock_out_lat NUMERIC,
    clock_out_lon NUMERIC, site_geofence_id UUID);
  CREATE TABLE fleet_vehicle_trackers (id UUID PRIMARY KEY, vehicle_id UUID, provider TEXT, account_ref TEXT,
    is_active BOOLEAN);
  CREATE TABLE fleet_vehicle_positions (id UUID PRIMARY KEY, vehicle_id UUID, recorded_at TIMESTAMPTZ,
    lat NUMERIC, lon NUMERIC, speed_kph NUMERIC);
  CREATE TABLE fleet_operational_status_rules (id UUID PRIMARY KEY, version INTEGER, timezone TEXT,
    effective_from TIMESTAMPTZ, effective_to TIMESTAMPTZ, monitoring_before_minutes INTEGER,
    monitoring_after_minutes INTEGER, arrival_dwell_minutes INTEGER, wrong_site_confirmation_minutes INTEGER,
    early_departure_confirmation_minutes INTEGER, approaching_distance_meters INTEGER,
    approaching_min_readings INTEGER, minimum_moving_speed_kmh NUMERIC,
    evidence_mismatch_tolerance_meters INTEGER, change_reason TEXT, created_by UUID, created_at TIMESTAMPTZ);
`;

const FIXTURES_SQL = `
  INSERT INTO projects VALUES ('${PROJECT}', 'Canonical Project');
  INSERT INTO staff (id,first_name,last_name) VALUES
    ('${SELECTED_STAFF}','Selected','Driver'), ('${AMBIGUOUS_STAFF}','Ambiguous','Driver'),
    ('${INVALID_STAFF}','Invalid','Geometry');
  INSERT INTO fleet_authorized_locations VALUES
    ('${REQUIRED_LOCATION}','Required Circle',-26,28,1,true),
    ('${WRONG_LOCATION}','Wrong Circle',-26.2,28.2,1,true);
  INSERT INTO fno_atlas_project_aois VALUES
    ('${WRONG_AOI}',ST_Multi(ST_GeomFromText('POLYGON((28.99 -26.99,29.01 -26.99,29.01 -27.01,28.99 -27.01,28.99 -26.99))',4326)),'high',NULL),
    ('${RETIRED_AOI}',ST_Multi(ST_GeomFromText('POLYGON((29.99 -27.99,30.01 -27.99,30.01 -28.01,29.99 -28.01,29.99 -27.99))',4326)),'high','2026-01-01');
  INSERT INTO fleet_project_operational_sites VALUES
    ('${REQUIRED_SITE}','${PROJECT}','Required Site',NULL,'${REQUIRED_LOCATION}',true,true),
    ('${WRONG_AOI_SITE}','${PROJECT}','Wrong AOI','${WRONG_AOI}',NULL,true,false),
    ('${WRONG_CIRCLE_SITE}','${PROJECT}','Wrong Circle',NULL,'${WRONG_LOCATION}',true,false),
    ('${RETIRED_SITE}','${PROJECT}','Retired Site','${RETIRED_AOI}',NULL,true,false);
  INSERT INTO fleet_vehicles VALUES
    ('${SELECTED_VEHICLE}','SELECTED','active'),
    ('10000000-0000-4000-8000-000000000015','OTHER','active'),
    ('10000000-0000-4000-8000-000000000016','AMB-1','active'),
    ('10000000-0000-4000-8000-000000000017','AMB-2','active');
  INSERT INTO vehicle_assignments VALUES
    ('${SELECTED_ASSIGNMENT}','${SELECTED_STAFF}','${SELECTED_VEHICLE}','2026-01-01',NULL),
    ('10000000-0000-4000-8000-000000000018','${SELECTED_STAFF}','10000000-0000-4000-8000-000000000015','2026-01-01',NULL),
    ('10000000-0000-4000-8000-000000000019','${AMBIGUOUS_STAFF}','10000000-0000-4000-8000-000000000016','2026-01-01',NULL),
    ('10000000-0000-4000-8000-000000000020','${AMBIGUOUS_STAFF}','10000000-0000-4000-8000-000000000017','2026-01-01',NULL);
  INSERT INTO fleet_operational_assignments VALUES
    ('10000000-0000-4000-8000-000000000021','${SELECTED_STAFF}','${PROJECT}','${REQUIRED_SITE}','2026-08-17','2026-08-17','roster','${SELECTED_ASSIGNMENT}','active'),
    ('10000000-0000-4000-8000-000000000022','${AMBIGUOUS_STAFF}','${PROJECT}','${REQUIRED_SITE}','2026-08-17','2026-08-17','roster',NULL,'active'),
    ('10000000-0000-4000-8000-000000000023','${INVALID_STAFF}','${PROJECT}','${RETIRED_SITE}','2026-08-17','2026-08-17','roster',NULL,'active');
  INSERT INTO attendance_policies VALUES ('10000000-0000-4000-8000-000000000024',true,'08:00','17:00','{"monday":true}');
  INSERT INTO attendance_policy_assignments SELECT id,'10000000-0000-4000-8000-000000000024','2026-01-01',NULL FROM staff;
  INSERT INTO attendance_schedule_policies VALUES ('10000000-0000-4000-8000-000000000025','Africa/Johannesburg','2026-01-01',NULL,15);
  INSERT INTO attendance_entries VALUES
    ('10000000-0000-4000-8000-000000000026','${SELECTED_STAFF}','2026-08-17','2026-08-17T05:00:00Z','2026-08-17T05:30:00Z',-26,28,NULL,NULL,'${REQUIRED_LOCATION}'),
    ('10000000-0000-4000-8000-000000000027','${SELECTED_STAFF}','2026-08-17','2026-08-17T06:10:00Z','2026-08-17T15:00:00Z',-27,29,-27,29,NULL),
    ('10000000-0000-4000-8000-000000000028','${SELECTED_STAFF}','2026-08-17','2026-08-17T13:00:00Z',NULL,-26,28,NULL,NULL,'${REQUIRED_LOCATION}'),
    ('10000000-0000-4000-8000-000000000029','${AMBIGUOUS_STAFF}','2026-08-17','2026-08-17T06:00:00Z',NULL,-26.2,28.2,NULL,NULL,'${WRONG_LOCATION}');
  INSERT INTO fleet_vehicle_trackers VALUES ('10000000-0000-4000-8000-000000000030','${SELECTED_VEHICLE}','netstar','europcar',true);
  INSERT INTO fleet_vehicle_positions VALUES
    ('10000000-0000-4000-8000-000000000031','${SELECTED_VEHICLE}','2026-08-17T11:55:00Z',-26,28,12),
    ('10000000-0000-4000-8000-000000000032','${SELECTED_VEHICLE}','2026-08-17T16:15:00Z',-26.5,28.5,30);
  INSERT INTO fleet_operational_status_rules VALUES
    ('10000000-0000-4000-8000-000000000033',1,'Africa/Johannesburg','2026-01-01',NULL,60,60,5,5,10,10000,2,5,250,NULL,NULL,now());
`;

beforeAll(async () => {
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await db.query(SCHEMA_SQL);
  await db.query(FIXTURES_SQL);
  ({ loadOperationalEvidence } = await import('@/modules/fleet/operations/evidenceQueries'));
  ({ pool: productionPool } = await import('@/lib/db-pool'));
});

afterAll(async () => {
  await productionPool?.end();
  await db.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.end();
});

describe('production operational evidence SQL', () => {
  it('executes canonical GPS, historical Attendance, geometry, and assignment contracts', async () => {
    const page = await loadOperationalEvidence({ projectId: PROJECT, workDate: '2026-08-17',
      asOf: '2026-08-17T12:00:00Z', limit: 25, offset: 0 });
    expect(page.total).toBe(3);
    const selected = page.items.find((item) => item.staffId === SELECTED_STAFF)!;
    expect(selected.attendance).toMatchObject({ entryId: '10000000-0000-4000-8000-000000000027',
      clockOutAt: null, requiredSite: { knownSiteId: WRONG_AOI_SITE } });
    expect(selected.vehicle).toMatchObject({ assignmentId: SELECTED_ASSIGNMENT, vehicleId: SELECTED_VEHICLE,
      positions: [expect.objectContaining({ latitude: -26, longitude: 28, speedKmh: 12 })] });
    const ambiguous = page.items.find((item) => item.staffId === AMBIGUOUS_STAFF)!;
    expect(ambiguous.assignment.ambiguous).toBe(true);
    expect(ambiguous.vehicle.vehicleId).toBeNull();
    expect(ambiguous.attendance.requiredSite?.knownSiteId).toBe(WRONG_CIRCLE_SITE);
    expect(page.items.find((item) => item.staffId === INVALID_STAFF)!.assignment.siteGeometryValid).toBe(false);
  });

  it('does not load GPS fixes after the monitoring end', async () => {
    const page = await loadOperationalEvidence({ projectId: PROJECT, workDate: '2026-08-17',
      asOf: '2026-08-17T16:30:00Z', limit: 25, offset: 0 });
    const selected = page.items.find((item) => item.staffId === SELECTED_STAFF)!;
    expect(selected.vehicle.positions.map((point) => point.recordedAt)).not.toContain('2026-08-17T16:15:00.000Z');
  });
});
