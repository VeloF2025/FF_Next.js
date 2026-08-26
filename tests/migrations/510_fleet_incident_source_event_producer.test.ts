/**
 * `produceIncident` on the SOURCE-EVENT path, executed against a real Postgres.
 *
 * The producer's unit test drives a mocked repository, so it can only prove what
 * the producer PASSED — never what Postgres accepted. That blind spot shipped a
 * production incident: `fleet_operational_incident_observations.rule_id` is an FK
 * to `fleet_operational_status_rules` (migration 510), and the source-event path
 * wrote the INCIDENT rule's id (from `fleet_operational_incident_rules`) into it.
 * No such id exists in the status-rules table, so every real source event failed
 * with `fleet_operational_incident_observations_rule_id_fkey`, the transaction
 * rolled back, and no incident was ever opened — latent until the vehicle
 * detectors started producing source events.
 *
 * Reading the code did not catch it in review. Executing it does.
 *
 * SAFETY / ISOLATION: scratch schema, like the sibling 510 file; the shared
 * container is not otherwise touched.
 */

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'Integration test needs TEST_DATABASE_URL set (real DB connection string). See .env.local.example.',
  );
}

const SCHEMA = 'mig510_source_event_producer_scratch';
const BASE_URL = process.env.TEST_DATABASE_URL;
const SCOPED_URL = `${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}options=${encodeURIComponent(
  `-c search_path=${SCHEMA}`,
)}`;
// Read by the application pool when the producer is imported below, which is why
// that import is dynamic and happens in beforeAll.
process.env.DATABASE_URL = SCOPED_URL;

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

const SQL_DIR = join(process.cwd(), 'scripts/migrations/sql');
const FORWARD_510 = readFileSync(join(SQL_DIR, '510_fleet_operational_incidents.sql'), 'utf8');
// 511 is applied too because it adds `fleet_operational_incident_actions.visibility`,
// which the producer's `opened` action reads back — production runs both, so a
// 510-only schema would not be the schema this code actually meets.
const FORWARD_511 = readFileSync(join(SQL_DIR, '511_fleet_incident_driver_input.sql'), 'utf8');

const USER = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';
const VEHICLE = '44444444-4444-4444-8444-444444444444';
const SITE = '55555555-5555-4555-8555-555555555555';

const PREREQUISITES = `
  CREATE TABLE schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE TABLE users (id UUID PRIMARY KEY, email TEXT NOT NULL UNIQUE);
  CREATE TABLE staff (id UUID PRIMARY KEY, full_name TEXT NOT NULL);
  CREATE TABLE projects (id UUID PRIMARY KEY, project_name TEXT NOT NULL);
  CREATE TABLE fleet_vehicles (id UUID PRIMARY KEY, registration TEXT);
  CREATE TABLE fleet_project_operational_sites (id UUID PRIMARY KEY);
  CREATE TABLE fleet_operational_status_rules (id UUID PRIMARY KEY);
  CREATE TABLE fleet_operational_assignments (id UUID PRIMARY KEY);
  CREATE TABLE attendance_adjustments (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE TABLE access_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), type VARCHAR(20) NOT NULL, key VARCHAR(100) UNIQUE NOT NULL,
    parent_key VARCHAR(100), label VARCHAR(100) NOT NULL, description TEXT, route VARCHAR(200),
    sort_order INTEGER DEFAULT 0, is_active BOOLEAN DEFAULT TRUE
  );
  CREATE TABLE role_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), role VARCHAR(50) NOT NULL,
    permission_key VARCHAR(100) NOT NULL REFERENCES access_permissions(key) ON DELETE CASCADE,
    actions JSONB NOT NULL, UNIQUE (role, permission_key)
  );
  CREATE TABLE user_permission_overrides (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL REFERENCES users(id),
    permission_key VARCHAR(100) NOT NULL, override_type VARCHAR(10) NOT NULL, actions JSONB NOT NULL,
    UNIQUE (user_id, permission_key)
  );
  INSERT INTO users (id, email) VALUES ('${USER}', 'producer-510@example.test');
  INSERT INTO staff (id, full_name) VALUES ('${STAFF}', 'Producer Test Staff');
  INSERT INTO projects (id, project_name) VALUES ('${PROJECT}', 'Producer Test Project');
  INSERT INTO fleet_vehicles (id, registration) VALUES ('${VEHICLE}', 'ABC 123 GP');
  INSERT INTO fleet_project_operational_sites (id) VALUES ('${SITE}');
  INSERT INTO access_permissions (type, key, label) VALUES ('module', 'fleet', 'Fleet');
`;

/** Creates and drops the schema; must not be scoped to it. */
const admin = new Pool({ connectionString: BASE_URL, ssl: false, max: 1 });
/** The same view of the database the application pool gets. */
const db = new Pool({ connectionString: SCOPED_URL, ssl: false, max: 2 });

type Producer = typeof import('@/modules/fleet/incidents/incidentProducer');
let producer: Producer;

function sourceEvent(sourceEventId: string) {
  return {
    producerKind: 'source_event' as const,
    incidentType: 'accident_sos' as const,
    sourceEventId,
    // Migration 510 seeds its incident rules with `effective_from = now()` at apply
    // time, so the event must occur after that — a hard-coded past instant makes the
    // rule lookup miss and the producer refuse before it ever reaches the database.
    occurredAt: new Date().toISOString(),
    staffId: STAFF,
    vehicleId: VEHICLE,
    projectId: PROJECT,
    operationalSiteId: SITE,
    operationalAssignmentId: null,
    vehicleRegistrationSnapshot: 'ABC 123 GP',
    linkedHsReference: null,
    linkedMaintenanceReference: null,
    metadata: { speedKmh: 140 },
  };
}

beforeAll(async () => {
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  // Owned by public, not the scratch schema — see 497's note: installing
  // btree_gist into a scratch schema ties its lifetime to this file's
  // DROP SCHEMA CASCADE and breaks the next migration test in the container.
  await admin.query('CREATE EXTENSION IF NOT EXISTS btree_gist SCHEMA public');
  // 510 ends with GRANT/REVOKE against fibreflow_user, which exists on the real
  // database but not in a fresh cluster. Roles are cluster-global, so create it
  // once and deliberately do not drop it (same approach as the sibling 510 file).
  await admin.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fibreflow_user') THEN
        CREATE ROLE fibreflow_user NOLOGIN;
      END IF;
    END $$;`);
  await db.query(PREREQUISITES);
  await db.query(FORWARD_510);
  await db.query(FORWARD_511);
  producer = await import('@/modules/fleet/incidents/incidentProducer');
});

afterAll(async () => {
  const { pool: appPool } = await import('@/lib/db-pool');
  await appPool.end();
  await db.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.end();
});

beforeEach(async () => {
  // CASCADE because 511 adds driver-input tables that reference incidents; the
  // scratch schema holds nothing else worth keeping between tests.
  await db.query(`TRUNCATE fleet_operational_incident_evidence, fleet_operational_incident_actions,
    fleet_operational_incident_observations, fleet_operational_incidents CASCADE`);
});

describe('produceIncident — source event against a real Postgres', () => {
  it('opens the incident and inserts its observation instead of dying on the rule_id foreign key', async () => {
    const result = await producer.produceIncident(sourceEvent('evt-real-1'));

    expect(result.outcome).toBe('opened');
    expect(result.requiresInitialNotification).toBe(true);
    expect(result.incidentId).not.toBeNull();

    const { rows } = await db.query<{
      incident_id: string; rule_id: string | null; rule_version: number | null;
      source_event_id: string | null; monitor_run_id: string | null; primary_status: string | null;
    }>(
      `SELECT incident_id, rule_id, rule_version, source_event_id, monitor_run_id, primary_status
         FROM fleet_operational_incident_observations`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      incident_id: result.incidentId,
      rule_id: null,
      rule_version: null,
      source_event_id: 'evt-real-1',
      monitor_run_id: null,
      primary_status: 'accident_sos',
    });

    // Nothing is lost: the incident row still carries the incident rule identity,
    // and it resolves to a real fleet_operational_incident_rules row.
    const incident = await db.query<{ incident_rule_id: string | null; incident_rule_version: number | null; status_rule_id: string | null }>(
      `SELECT incident_rule_id, incident_rule_version, status_rule_id FROM fleet_operational_incidents WHERE id = $1`,
      [result.incidentId],
    );
    expect(incident.rows[0]!.status_rule_id).toBeNull();
    expect(incident.rows[0]!.incident_rule_version).toBe(1);
    const rule = await db.query(
      `SELECT 1 FROM fleet_operational_incident_rules WHERE id = $1 AND incident_type = 'accident_sos'`,
      [incident.rows[0]!.incident_rule_id],
    );
    expect(rule.rowCount).toBe(1);
  });

  it('proves the old value would still be rejected: the incident rule id is not a status rule id', async () => {
    // Mutation of the fix, executed rather than reasoned about. If someone
    // restores `ruleId: rule.id` on this path, this is the error they get back.
    const incidentId = (await producer.produceIncident(sourceEvent('evt-real-2'))).incidentId;
    const { rows } = await db.query<{ incident_rule_id: string }>(
      `SELECT incident_rule_id FROM fleet_operational_incidents WHERE id = $1`, [incidentId],
    );

    await expect(db.query(
      `INSERT INTO fleet_operational_incident_observations
         (incident_id, observation_fingerprint, observed_at, rule_id, rule_version)
       VALUES ($1, 'fp-incident-rule', now(), $2, 1)`,
      [incidentId, rows[0]!.incident_rule_id],
    )).rejects.toThrow(/fleet_operational_incident_observations_rule_id_fkey/);
  });

  it('deduplicates a redelivered event without a second incident or observation', async () => {
    const first = await producer.produceIncident(sourceEvent('evt-real-3'));
    const second = await producer.produceIncident(sourceEvent('evt-real-3'));

    expect(second).toEqual({ outcome: 'unchanged', incidentId: first.incidentId, requiresInitialNotification: false });
    const incidents = await db.query(`SELECT 1 FROM fleet_operational_incidents`);
    const observations = await db.query(`SELECT 1 FROM fleet_operational_incident_observations`);
    expect(incidents.rowCount).toBe(1);
    expect(observations.rowCount).toBe(1);
  });

  it('keeps the fingerprint stable across two events with identical context, so dedup semantics survive the null rule columns', async () => {
    await producer.produceIncident(sourceEvent('evt-real-4'));
    await producer.produceIncident(sourceEvent('evt-real-5'));

    const { rows } = await db.query<{ observation_fingerprint: string }>(
      `SELECT observation_fingerprint FROM fleet_operational_incident_observations`,
    );
    expect(rows).toHaveLength(2);
    expect(rows[0]!.observation_fingerprint).toBe(rows[1]!.observation_fingerprint);
  });
});
