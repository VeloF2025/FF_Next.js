/**
 * Real-Postgres contract for migration 518 (Fleet operations analytics and
 * retention). Mirrors 510/511's pattern: apply the real migration SQL into a
 * disposable schema, exercise its constraints against a live Postgres, then
 * roll back.
 *
 * Two invariants are the reason this file exists, and both are enforced in the
 * schema rather than in application code:
 *
 *   1. A public monthly aggregate is INCAPABLE of carrying identity. Every
 *      text column is domain-restricted, the table holds no foreign key to any
 *      person/vehicle/incident table, and the column list is a closed set that
 *      this test pins exactly. Adding `driver_id` or `resolution_note` fails
 *      here before it can ever be written to.
 *
 *   2. Retention CANNOT delete an incident that is still active or on hold.
 *      A BEFORE DELETE trigger on fleet_operational_incidents refuses, so the
 *      guarantee does not depend on the purge service asking politely — a
 *      stray DELETE from psql is refused the same way.
 *
 * The TS-union half of the contract lives in
 * src/modules/fleet/incidents/analytics/__tests__/migrationContract.test.ts.
 */
if (!process.env.TEST_DATABASE_URL) {
  throw new Error('Integration test needs TEST_DATABASE_URL set. See .env.local.example.');
}

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

import { PUBLIC_AGGREGATE_COLUMNS } from '../../src/modules/fleet/incidents/analytics/types';

const SCHEMA = 'mig518_fleet_operational_analytics_scratch';
const BASE_URL = process.env.TEST_DATABASE_URL;
const SCOPED_URL = `${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}options=${encodeURIComponent(`-c search_path=${SCHEMA}`)}`;
const SQL_DIR = join(process.cwd(), 'scripts/migrations/sql');
const INCIDENTS = readFileSync(join(SQL_DIR, '510_fleet_operational_incidents.sql'), 'utf8');
const FORWARD = readFileSync(join(SQL_DIR, '518_fleet_operational_analytics_retention.sql'), 'utf8');
const ROLLBACK = readFileSync(join(SQL_DIR, 'rollback_518_fleet_operational_analytics_retention.sql'), 'utf8');

const USER = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';
const SITE = '44444444-4444-4444-8444-444444444444';

const PR8_TABLES = [
  'fleet_operational_analytics_settings',
  'fleet_operational_aggregation_runs',
  'fleet_operational_monthly_aggregates',
  'fleet_incident_retention_holds',
  'fleet_incident_retention_hold_actions',
  'fleet_operational_retention_runs',
  'fleet_operational_retention_items',
];

const admin = new Pool({ connectionString: BASE_URL, ssl: false, max: 1 });
const db = new Pool({ connectionString: SCOPED_URL, ssl: false, max: 1 });

// Mirrors the real tables 510 depends on. Deliberately the same block
// 510_fleet_operational_incidents.test.ts uses, so the two files agree about
// what production looks like rather than each inventing a shape.
const PREREQUISITES = `
  CREATE TABLE schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE TABLE users (id UUID PRIMARY KEY, email TEXT NOT NULL UNIQUE);
  CREATE TABLE staff (id UUID PRIMARY KEY, full_name TEXT NOT NULL);
  CREATE TABLE projects (id UUID PRIMARY KEY, project_name TEXT NOT NULL);
  CREATE TABLE fleet_vehicles (id UUID PRIMARY KEY, registration TEXT);
  CREATE TABLE fleet_project_operational_sites (id UUID PRIMARY KEY);
  CREATE TABLE fleet_operational_status_rules (id UUID PRIMARY KEY);
  CREATE TABLE fleet_operational_assignments (id UUID PRIMARY KEY);
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
  INSERT INTO users (id, email) VALUES ('${USER}', 'migration-518@example.test');
  INSERT INTO staff (id, full_name) VALUES ('${STAFF}', 'Migration Test Staff');
  INSERT INTO projects (id, project_name) VALUES ('${PROJECT}', 'Migration Test Project');
  INSERT INTO fleet_project_operational_sites (id) VALUES ('${SITE}');
  INSERT INTO access_permissions (type, key, label) VALUES ('module', 'fleet', 'Fleet');
`;

let referenceCounter = 0;
function nextReference(): string {
  referenceCounter += 1;
  return `INC-MIG518-${String(referenceCounter).padStart(4, '0')}`;
}

/** An incident in the given lifecycle state, using 510's real column set. */
async function insertIncident(lifecycle: 'open' | 'resolved' = 'open'): Promise<string> {
  if (lifecycle === 'open') {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO fleet_operational_incidents
         (incident_reference, incident_type, severity, staff_id, project_id, detected_at, work_date)
       VALUES ($1, 'late', 'high', $2, $3, now(), DATE '2024-06-10') RETURNING id`,
      [nextReference(), STAFF, PROJECT],
    );
    return rows[0]!.id;
  }
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO fleet_operational_incidents (
       incident_reference, incident_type, severity, staff_id, project_id, detected_at, work_date,
       lifecycle_status, acknowledged_by, acknowledged_at, review_started_by, review_started_at,
       resolved_by, resolved_at, outcome, resolution_note
     ) VALUES ($1, 'late', 'high', $2, $3, now(), DATE '2024-06-10',
       'resolved', $4, now(), $4, now(), $4, now(), 'confirmed', 'closed out') RETURNING id`,
    [nextReference(), STAFF, PROJECT, USER],
  );
  return rows[0]!.id;
}

async function insertHold(incidentId: string, category = 'legal', status: 'active' | 'released' = 'active'): Promise<string> {
  const released = status === 'released';
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO fleet_incident_retention_holds
       (incident_id, category, status, reason, owner_user_id, created_by, hold_start_at, next_review_at,
        released_at, released_by, release_reason)
     VALUES ($1, $2, $3, 'pending litigation', $4, $4, now(), now() + INTERVAL '30 days',
       CASE WHEN $5 THEN now() END, CASE WHEN $5 THEN $4::uuid END, CASE WHEN $5 THEN 'matter closed' END)
     RETURNING id`,
    [incidentId, category, status, USER, released],
  );
  return rows[0]!.id;
}

async function insertRun(): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO fleet_operational_retention_runs (dry_run, cutoff_work_date, policy_months)
     VALUES (false, DATE '2025-06-01', 12) RETURNING id`,
  );
  return rows[0]!.id;
}

const AGGREGATE_COLUMNS = `metric_version, month_start, dimension_level, dimension_project_id, dimension_site_id,
  metric_key, metric_kind, numerator, denominator, contributor_count`;

async function insertAggregate(overrides: Partial<{
  monthStart: string; level: string; projectId: string | null; siteId: string | null;
  metricKey: string; metricKind: string; numerator: number; denominator: number; contributorCount: number;
}> = {}) {
  const v = {
    monthStart: '2024-06-01', level: 'project', projectId: PROJECT, siteId: null,
    metricKey: 'incident.late', metricKind: 'ratio', numerator: 3, denominator: 40, contributorCount: 7,
    ...overrides,
  };
  return db.query(
    `INSERT INTO fleet_operational_monthly_aggregates (${AGGREGATE_COLUMNS})
     VALUES (1, $1::date, $2, $3::uuid, $4::uuid, $5, $6, $7, $8, $9)`,
    [v.monthStart, v.level, v.projectId, v.siteId, v.metricKey, v.metricKind,
      v.numerator, v.denominator, v.contributorCount],
  );
}

beforeAll(async () => {
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  // Owned by public — see 510's test: a btree_gist installed into the scratch
  // schema dies with this file's DROP SCHEMA CASCADE and breaks whichever
  // sibling migration test runs next in the shared container.
  await admin.query('CREATE EXTENSION IF NOT EXISTS btree_gist SCHEMA public');
  await admin.query(`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fibreflow_user') THEN
        CREATE ROLE fibreflow_user NOLOGIN;
      END IF;
    END $$;`);
  await db.query(PREREQUISITES);
  // 518 extends the PR6 incident tables, so it is applied on top of the real
  // 510 rather than a hand-rolled stand-in.
  await db.query(INCIDENTS);
  await db.query(FORWARD);
});

afterAll(async () => {
  await db.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.end();
});

beforeEach(async () => {
  await db.query(`TRUNCATE fleet_operational_monthly_aggregates, fleet_operational_aggregation_runs`);
  // TRUNCATE ... CASCADE, not DELETE: the purge guard added by this migration
  // refuses to delete a non-terminal incident, which is the whole point of it,
  // and that includes the open incidents these tests create. TRUNCATE fires
  // only TRUNCATE triggers, so it clears the fixture without disarming the
  // guard under test. CASCADE reaches the retention/hold/evidence children.
  await db.query(`TRUNCATE fleet_operational_incidents, fleet_operational_retention_runs CASCADE`);
});

describe('migration 518 identifier lengths', () => {
  it('keeps every constraint and index name under 63 bytes, unshortened by Postgres', async () => {
    const { rows } = await db.query<{ name: string }>(
      `SELECT conname AS name FROM pg_constraint
        WHERE conrelid = ANY (SELECT unnest($1::text[])::regclass)
       UNION ALL
       SELECT indexname AS name FROM pg_indexes WHERE schemaname = $2 AND tablename = ANY ($1::text[])`,
      [PR8_TABLES, SCHEMA],
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(Buffer.byteLength(row.name, 'utf8')).toBeLessThanOrEqual(63);
    }
  });
});

// ---------------------------------------------------------------------------
// Invariant 1: a public aggregate cannot carry identity.
// ---------------------------------------------------------------------------
describe('invariant 1: public aggregates are incapable of carrying identity', () => {
  it('exposes exactly the allow-listed columns and nothing else', async () => {
    const { rows } = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'fleet_operational_monthly_aggregates'
        ORDER BY ordinal_position`,
      [SCHEMA],
    );
    expect(rows.map((row) => row.column_name)).toEqual([...PUBLIC_AGGREGATE_COLUMNS]);
  });

  // The strongest structural statement available: the aggregate table is not
  // joined to any table that names a person, a vehicle, or an incident, so it
  // cannot be re-identified by following a reference out of it.
  it('holds no foreign key into any person, vehicle, or incident table', async () => {
    const { rows } = await db.query<{ target: string }>(
      `SELECT confrelid::regclass::text AS target FROM pg_constraint
        WHERE contype = 'f' AND conrelid = 'fleet_operational_monthly_aggregates'::regclass`,
    );
    const targets = rows.map((row) => row.target.replace(`${SCHEMA}.`, ''));
    for (const forbidden of [
      'staff', 'users', 'fleet_vehicles', 'fleet_operational_incidents',
      'fleet_operational_incident_evidence', 'fleet_operational_assignments',
    ]) {
      expect(targets).not.toContain(forbidden);
    }
  });

  it('has no column able to hold free text, geometry, or JSON', async () => {
    const { rows } = await db.query<{ column_name: string; data_type: string; udt_name: string }>(
      `SELECT column_name, data_type, udt_name FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'fleet_operational_monthly_aggregates'`,
      [SCHEMA],
    );
    for (const row of rows) {
      expect(['json', 'jsonb', 'USER-DEFINED', 'ARRAY']).not.toContain(row.data_type);
      expect(['geometry', 'geography', 'point']).not.toContain(row.udt_name);
    }
    // Every text column must be pinned by a CHECK. Introspection proves the
    // constraint exists; the runtime cases below prove it bites.
    const textColumns = rows.filter((row) => row.data_type === 'text').map((row) => row.column_name);
    expect(textColumns.slice().sort())
      .toEqual(['checksum', 'dimension_level', 'generalized_from_level', 'metric_key', 'metric_kind']);
    const { rows: checks } = await db.query<{ def: string }>(
      `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
        WHERE contype = 'c' AND conrelid = 'fleet_operational_monthly_aggregates'::regclass`,
    );
    const allChecks = checks.map((row) => row.def).join(' ');
    for (const column of textColumns) {
      expect(allChecks).toContain(column);
    }
  });

  it('rejects an unknown metric key, dimension level, and metric kind', async () => {
    await expect(insertAggregate({ metricKey: 'driver.john_smith_lateness' }))
      .rejects.toMatchObject({ code: '23514' });
    await expect(insertAggregate({ level: 'driver' })).rejects.toMatchObject({ code: '23514' });
    await expect(insertAggregate({ metricKind: 'prose' })).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects prose in checksum, which is shape-guarded to a sha256 hex digest', async () => {
    await expect(db.query(
      `INSERT INTO fleet_operational_monthly_aggregates (${AGGREGATE_COLUMNS}, checksum)
       VALUES (1, DATE '2024-06-01', 'project', $1::uuid, NULL, 'incident.late', 'ratio', 3, 40, 7, $2)`,
      [PROJECT, 'Driver arrived 40 minutes late at Ivory Park, see photo IMG_2231.jpg'],
    )).rejects.toMatchObject({ code: '23514' });
    await expect(db.query(
      `INSERT INTO fleet_operational_monthly_aggregates (${AGGREGATE_COLUMNS}, checksum)
       VALUES (1, DATE '2024-06-01', 'project', $1::uuid, NULL, 'incident.late', 'ratio', 3, 40, 7, $2)`,
      // 64 characters, but outside the hex alphabet. ('a'.repeat(64) would be
      // a VALID digest and pass, which is what makes this the honest negative.)
      [PROJECT, 'z'.repeat(64)],
    )).rejects.toMatchObject({ code: '23514' });
    await expect(db.query(
      `INSERT INTO fleet_operational_monthly_aggregates (${AGGREGATE_COLUMNS}, checksum)
       VALUES (1, DATE '2024-06-01', 'project', $1::uuid, NULL, 'incident.late', 'ratio', 3, 40, 7, $2)`,
      [PROJECT, '0'.repeat(63)],
    )).rejects.toMatchObject({ code: '23514' });
    await expect(db.query(
      `INSERT INTO fleet_operational_monthly_aggregates (${AGGREGATE_COLUMNS}, checksum)
       VALUES (1, DATE '2024-06-01', 'project', $1::uuid, NULL, 'incident.late', 'ratio', 3, 40, 7, $2)`,
      [PROJECT, '0'.repeat(64)],
    )).resolves.toBeDefined();
  });

  // k-anonymity as a table constraint, not a service convention: a group of
  // four cannot be stored at all, so it cannot leak by a later query bug.
  it('rejects a released group below five contributors', async () => {
    await expect(insertAggregate({ contributorCount: 4 })).rejects.toMatchObject({ code: '23514' });
    await expect(insertAggregate({ contributorCount: 5 })).resolves.toBeDefined();
  });

  it('rejects an exact date: month_start must be the first of a month', async () => {
    await expect(insertAggregate({ monthStart: '2024-06-17' })).rejects.toMatchObject({ code: '23514' });
  });

  it('enforces the dimension level / project / site pairing', async () => {
    await expect(insertAggregate({ level: 'organisation', projectId: PROJECT }))
      .rejects.toMatchObject({ code: '23514' });
    await expect(insertAggregate({ level: 'site', projectId: PROJECT, siteId: null }))
      .rejects.toMatchObject({ code: '23514' });
    await expect(insertAggregate({ level: 'project', projectId: PROJECT, siteId: SITE }))
      .rejects.toMatchObject({ code: '23514' });
    await expect(insertAggregate({ level: 'organisation', projectId: null, siteId: null }))
      .resolves.toBeDefined();
  });

  it('pairs duration histograms with the timing metrics and nothing else', async () => {
    await expect(insertAggregate({ metricKey: 'timing.resolution', metricKind: 'ratio' }))
      .rejects.toMatchObject({ code: '23514' });
    await expect(insertAggregate({ metricKey: 'incident.late', metricKind: 'duration_histogram' }))
      .rejects.toMatchObject({ code: '23514' });
  });

  it('is unique per metric version, month, dimension, and metric key across all three levels', async () => {
    await insertAggregate();
    await expect(insertAggregate()).rejects.toMatchObject({ code: '23505' });
    // The organisation row has NULL project and site. A naive unique index
    // would treat those NULLs as distinct and let duplicates through.
    await insertAggregate({ level: 'organisation', projectId: null, siteId: null });
    await expect(insertAggregate({ level: 'organisation', projectId: null, siteId: null }))
      .rejects.toMatchObject({ code: '23505' });
  });
});

// ---------------------------------------------------------------------------
// Invariant 2: retention cannot delete active or held data.
// ---------------------------------------------------------------------------
describe('invariant 2: retention can never delete active or held data', () => {
  it('refuses to delete an incident that is not in a terminal state', async () => {
    const incidentId = await insertIncident('open');
    await expect(db.query(`DELETE FROM fleet_operational_incidents WHERE id = $1`, [incidentId]))
      .rejects.toMatchObject({ code: '23514', message: expect.stringContaining('not in a terminal state') });
  });

  it('refuses to delete a resolved incident while a hold is active', async () => {
    const incidentId = await insertIncident('resolved');
    await insertHold(incidentId, 'legal', 'active');
    await expect(db.query(`DELETE FROM fleet_operational_incidents WHERE id = $1`, [incidentId]))
      .rejects.toMatchObject({ code: '23514', message: expect.stringContaining('active retention hold') });
  });

  it('allows deleting a resolved incident whose only hold is released', async () => {
    const incidentId = await insertIncident('resolved');
    await insertHold(incidentId, 'legal', 'released');
    await expect(db.query(`DELETE FROM fleet_operational_incidents WHERE id = $1`, [incidentId]))
      .resolves.toMatchObject({ rowCount: 1 });
    await expect(db.query(`SELECT 1 FROM fleet_incident_retention_holds WHERE incident_id = $1`, [incidentId]))
      .resolves.toMatchObject({ rows: [] });
  });

  // The guard is on the table, not on the purge service, so it also stops a
  // hold raised AFTER the incident was claimed for deletion.
  it('refuses to claim a retention item for a non-terminal or held incident', async () => {
    const runId = await insertRun();
    const openId = await insertIncident('open');
    await expect(db.query(
      `INSERT INTO fleet_operational_retention_items (retention_run_id, incident_id, stage, storage_objects_total)
       VALUES ($1, $2, 'claimed', 0)`, [runId, openId],
    )).rejects.toMatchObject({ code: '23514', message: expect.stringContaining('not in a terminal state') });

    const heldId = await insertIncident('resolved');
    await insertHold(heldId, 'insurance', 'active');
    await expect(db.query(
      `INSERT INTO fleet_operational_retention_items (retention_run_id, incident_id, stage, storage_objects_total)
       VALUES ($1, $2, 'claimed', 0)`, [runId, heldId],
    )).rejects.toMatchObject({ code: '23514', message: expect.stringContaining('active retention hold') });
  });

  it('refuses to advance a claimed item once a hold is raised mid-run', async () => {
    const runId = await insertRun();
    const incidentId = await insertIncident('resolved');
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO fleet_operational_retention_items (retention_run_id, incident_id, stage, storage_objects_total)
       VALUES ($1, $2, 'claimed', 0) RETURNING id`, [runId, incidentId],
    );
    await insertHold(incidentId, 'disciplinary', 'active');
    await expect(db.query(
      `UPDATE fleet_operational_retention_items SET stage = 'pending_storage' WHERE id = $1`, [rows[0]!.id],
    )).rejects.toMatchObject({ code: '23514', message: expect.stringContaining('active retention hold') });
  });

  it('requires identity to be cleared and storage finished before an item is database_complete', async () => {
    const runId = await insertRun();
    const incidentId = await insertIncident('resolved');
    await expect(db.query(
      `INSERT INTO fleet_operational_retention_items
         (retention_run_id, incident_id, stage, storage_objects_total, storage_objects_deleted, completed_at)
       VALUES ($1, $2, 'database_complete', 2, 2, now())`, [runId, incidentId],
    )).rejects.toMatchObject({ code: '23514' });
    await expect(db.query(
      `INSERT INTO fleet_operational_retention_items
         (retention_run_id, incident_id, stage, storage_objects_total, storage_objects_deleted, completed_at)
       VALUES ($1, NULL, 'database_complete', 2, 1, now())`, [runId],
    )).rejects.toMatchObject({ code: '23514' });
    await expect(db.query(
      `INSERT INTO fleet_operational_retention_items
         (retention_run_id, incident_id, stage, storage_objects_total, storage_objects_deleted, completed_at)
       VALUES ($1, NULL, 'database_complete', 2, 2, now())`, [runId],
    )).resolves.toBeDefined();
  });

  it('allows only one live retention item per incident', async () => {
    const runId = await insertRun();
    const incidentId = await insertIncident('resolved');
    await db.query(
      `INSERT INTO fleet_operational_retention_items (retention_run_id, incident_id, stage, storage_objects_total)
       VALUES ($1, $2, 'claimed', 0)`, [runId, incidentId]);
    await expect(db.query(
      `INSERT INTO fleet_operational_retention_items (retention_run_id, incident_id, stage, storage_objects_total)
       VALUES ($1, $2, 'claimed', 0)`, [runId, incidentId],
    )).rejects.toMatchObject({ code: '23505' });
  });

  it('keeps run totals non-identifying', async () => {
    const { rows } = await db.query<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
        WHERE table_schema = $1 AND table_name = 'fleet_operational_retention_runs'`,
      [SCHEMA],
    );
    for (const row of rows) {
      for (const token of ['staff', 'driver', 'vehicle', 'incident_id', 'project']) {
        expect(row.column_name).not.toContain(token);
      }
    }
  });
});

describe('migration 518 retention holds', () => {
  it('allows only one active hold per incident and category, but permits a second category', async () => {
    const incidentId = await insertIncident('resolved');
    await insertHold(incidentId, 'legal', 'active');
    await expect(insertHold(incidentId, 'legal', 'active')).rejects.toMatchObject({ code: '23505' });
    await expect(insertHold(incidentId, 'insurance', 'active')).resolves.toBeDefined();
    // A released hold does not block a fresh one in the same category.
    await db.query(`UPDATE fleet_incident_retention_holds
      SET status = 'released', released_at = now(), released_by = $1, release_reason = 'closed'
      WHERE incident_id = $2 AND category = 'legal'`, [USER, incidentId]);
    await expect(insertHold(incidentId, 'legal', 'active')).resolves.toBeDefined();
  });

  it('pairs the released fields with the released status', async () => {
    const incidentId = await insertIncident('resolved');
    await expect(db.query(
      `INSERT INTO fleet_incident_retention_holds
         (incident_id, category, status, reason, owner_user_id, created_by, hold_start_at, next_review_at)
       VALUES ($1, 'legal', 'released', 'reason', $2, $2, now(), now() + INTERVAL '10 days')`,
      [incidentId, USER],
    )).rejects.toMatchObject({ code: '23514' });
    const holdId = await insertHold(incidentId, 'accident', 'active');
    await expect(db.query(
      `UPDATE fleet_incident_retention_holds SET released_at = now() WHERE id = $1`, [holdId],
    )).rejects.toMatchObject({ code: '23514' });
  });

  it('caps the review interval at 90 days from the last review', async () => {
    const incidentId = await insertIncident('resolved');
    await expect(db.query(
      `INSERT INTO fleet_incident_retention_holds
         (incident_id, category, status, reason, owner_user_id, created_by, hold_start_at, next_review_at)
       VALUES ($1, 'legal', 'active', 'reason', $2, $2, now(), now() + INTERVAL '91 days')`,
      [incidentId, USER],
    )).rejects.toMatchObject({ code: '23514' });
    await expect(db.query(
      `INSERT INTO fleet_incident_retention_holds
         (incident_id, category, status, reason, owner_user_id, created_by, hold_start_at, next_review_at)
       VALUES ($1, 'legal', 'active', 'reason', $2, $2, now(), now() - INTERVAL '1 day')`,
      [incidentId, USER],
    )).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects a blank hold reason', async () => {
    const incidentId = await insertIncident('resolved');
    await expect(db.query(
      `INSERT INTO fleet_incident_retention_holds
         (incident_id, category, status, reason, owner_user_id, created_by, hold_start_at, next_review_at)
       VALUES ($1, 'legal', 'active', '   ', $2, $2, now(), now() + INTERVAL '10 days')`,
      [incidentId, USER],
    )).rejects.toMatchObject({ code: '23514' });
  });

  it('keeps hold actions append-only', async () => {
    const incidentId = await insertIncident('resolved');
    const holdId = await insertHold(incidentId, 'legal', 'active');
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO fleet_incident_retention_hold_actions (hold_id, action_type, actor_user_id, occurred_at, note)
       VALUES ($1, 'created', $2, now(), 'opened for litigation') RETURNING id`, [holdId, USER],
    );
    await expect(db.query(
      `UPDATE fleet_incident_retention_hold_actions SET note = 'rewritten' WHERE id = $1`, [rows[0]!.id],
    )).rejects.toMatchObject({ code: '23514', message: expect.stringContaining('append-only') });
  });
});

describe('migration 518 seeds and permissions', () => {
  it('seeds exactly one open settings version with the approved defaults', async () => {
    const { rows } = await db.query<Record<string, unknown>>(
      `SELECT version, retention_months, anonymity_min_contributors, recalculation_window_months,
              retention_batch_size, maximum_hold_review_days, hold_review_reminder_lead_days,
              aggregation_run_hour_sast, aggregation_run_minute_sast,
              retention_run_hour_sast, retention_run_minute_sast,
              permitted_hold_categories, live_retention_enabled
         FROM fleet_operational_analytics_settings WHERE effective_to IS NULL`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      version: 1, retention_months: 12, anonymity_min_contributors: 5, recalculation_window_months: 3,
      retention_batch_size: 100, maximum_hold_review_days: 90, hold_review_reminder_lead_days: 14,
      aggregation_run_hour_sast: 1, aggregation_run_minute_sast: 0,
      retention_run_hour_sast: 3, retention_run_minute_sast: 30,
      live_retention_enabled: false,
    });
    expect(rows[0]!.permitted_hold_categories).toEqual(
      ['health_safety', 'accident', 'insurance', 'disciplinary', 'legal', 'other_approved']);
  });

  it('seeds no user, email, or staff row', async () => {
    await expect(db.query(`SELECT id FROM users`)).resolves.toMatchObject({ rowCount: 1 });
    await expect(db.query(`SELECT id FROM staff`)).resolves.toMatchObject({ rowCount: 1 });
  });

  it('is idempotent: re-applying the migration changes nothing', async () => {
    await db.query(FORWARD);
    await expect(db.query(`SELECT 1 FROM fleet_operational_analytics_settings`))
      .resolves.toMatchObject({ rowCount: 1 });
  });

  // Hold authority is deliberately NOT granted to manager or project_manager:
  // a PM may see a hold on an incident in their own project, but raising or
  // releasing one is an admin act (plan Task 1 Interfaces).
  it('grants fleet.retention-holds to admin roles only', async () => {
    const { rows } = await db.query<{ role: string }>(
      `SELECT role FROM role_permissions WHERE permission_key = 'fleet.retention-holds' ORDER BY role`,
    );
    expect(rows.map((row) => row.role)).toEqual(['admin', 'super_admin']);
  });
});

describe('migration 518 rollback', () => {
  it('removes only PR8 objects and leaves the PR6 incident tables intact', async () => {
    await db.query(`INSERT INTO schema_migrations (filename)
      VALUES ('518_fleet_operational_analytics_retention.sql')`);
    await db.query(`INSERT INTO user_permission_overrides (user_id, permission_key, override_type, actions)
      VALUES ($1, 'fleet.retention-holds', 'grant', '{"view":true,"edit":true}')`, [USER]);
    const incidentId = await insertIncident('open');

    await db.query(ROLLBACK);

    const { rows } = await db.query<Record<string, string | null>>(
      `SELECT ${PR8_TABLES.map((t) => `to_regclass('${t}') AS ${t}`).join(', ')}`,
    );
    for (const table of PR8_TABLES) {
      expect(rows[0]![table]).toBeNull();
    }
    // PR6 survives, and so does the incident that was open when PR8 went away.
    await expect(db.query(`SELECT id FROM fleet_operational_incidents WHERE id = $1`, [incidentId]))
      .resolves.toMatchObject({ rowCount: 1 });
    await expect(db.query(`SELECT 1 FROM access_permissions WHERE key = 'fleet.incidents'`))
      .resolves.toMatchObject({ rowCount: 1 });
    await expect(db.query(`SELECT 1 FROM access_permissions WHERE key = 'fleet.retention-holds'`))
      .resolves.toMatchObject({ rows: [] });
    await expect(db.query(`SELECT 1 FROM role_permissions WHERE permission_key = 'fleet.retention-holds'`))
      .resolves.toMatchObject({ rows: [] });
    await expect(db.query(`SELECT 1 FROM user_permission_overrides WHERE permission_key = 'fleet.retention-holds'`))
      .resolves.toMatchObject({ rows: [] });
    await expect(db.query(`SELECT filename FROM schema_migrations
      WHERE filename = '518_fleet_operational_analytics_retention.sql'`)).resolves.toMatchObject({ rows: [] });
    // The purge guard must be gone too, or PR6 keeps a trigger whose body
    // reads a table that no longer exists.
    await expect(db.query(`DELETE FROM fleet_operational_incidents WHERE id = $1`, [incidentId]))
      .resolves.toMatchObject({ rowCount: 1 });

    // Restore for any later file in the shared container.
    await db.query(FORWARD);
  });
});
