/**
 * The retention pipeline's SQL, executed against a real Postgres: eligibility,
 * the aggregate coverage gate, claim guards, and the purge itself.
 *
 * This file exists because the purge is the one operation in the module that
 * destroys evidence about named people. A stub client that records SQL text
 * proves nothing about what a DELETE actually reaches, what an ON DELETE
 * RESTRICT refuses, or what privileges the application role really has — and
 * all three decide whether this pipeline works or corrupts an audit trail.
 *
 * It therefore asserts BOTH halves of "deletes only programme-owned PR4-7
 * data": that every child record for the target incident is gone, and that the
 * Attendance adjustment, staff, project, vehicle and neighbouring incident it
 * touched are all still there afterwards.
 *
 * SAFETY / ISOLATION: scratch schema, application pool pointed at it via
 * `options=-c search_path=...`. Nothing here can reach the shared database.
 */
if (!process.env.TEST_DATABASE_URL) {
  throw new Error('Integration test needs TEST_DATABASE_URL set. See .env.local.example.');
}

const SCHEMA = 'mig518_retention_purge_scratch';
const BASE_URL = process.env.TEST_DATABASE_URL;
const SCOPED_URL = `${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}options=${encodeURIComponent(`-c search_path=${SCHEMA}`)}`;
process.env.DATABASE_URL = SCOPED_URL;

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

const SQL_DIR = join(process.cwd(), 'scripts/migrations/sql');
const INCIDENTS = readFileSync(join(SQL_DIR, '510_fleet_operational_incidents.sql'), 'utf8');
const DRIVER_INPUT = readFileSync(join(SQL_DIR, '511_fleet_incident_driver_input.sql'), 'utf8');
const RETENTION = readFileSync(join(SQL_DIR, '518_fleet_operational_analytics_retention.sql'), 'utf8');
// 521 is what makes the purge executable as the application role at all; the
// grant contract itself lives in 521_fleet_retention_delete_grants.test.ts.
const DELETE_GRANTS = readFileSync(join(SQL_DIR, '521_fleet_retention_delete_grants.sql'), 'utf8');
// 525 creates the published view. `hasCompleteAggregateCoverage` reads it
// rather than the base table, so the coverage gate cannot be exercised without
// it — the view is part of this fixture's schema, not an optional extra.
const PUBLISHED_VIEW = readFileSync(join(SQL_DIR, '525_fleet_aggregates_published_view.sql'), 'utf8');

const USER = '11111111-1111-4111-8111-111111111111';
const STAFF = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';
const SITE = '44444444-4444-4444-8444-444444444444';
const VEHICLE = '55555555-5555-4555-8555-555555555555';
const ADJUSTMENT = '66666666-6666-4666-8666-666666666666';

const PREREQUISITES = `
  -- EVERY column below mirrors production's name, type AND LENGTH, verified
  -- against information_schema on the shared database. Length matters in the
  -- unsafe direction: a fixture wider than production lets an over-long value
  -- pass here and raise 22001 there. A fixture may declare a SUBSET
  -- of production's columns; it may never declare a column production does not
  -- have, or the same column with a different type. A TEXT stand-in for a uuid
  -- column is not a harmless simplification: it makes a ::text comparison parse
  -- here and fail with 42883 in production, which is exactly the bug this
  -- fixture hid until 2026-08-21. (No backticks in these comments — the block
  -- is a JS template literal and a backtick would terminate it.)
  CREATE TABLE schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE TABLE users (id UUID PRIMARY KEY, email VARCHAR(255) NOT NULL UNIQUE);
  -- Production staff has first_name/last_name and NO full_name/name column.
  CREATE TABLE staff (
    id UUID PRIMARY KEY, first_name VARCHAR(100) NOT NULL, last_name VARCHAR(100) NOT NULL
  );
  CREATE TABLE projects (id UUID PRIMARY KEY, project_name VARCHAR(255) NOT NULL);
  CREATE TABLE fleet_vehicles (id UUID PRIMARY KEY, registration VARCHAR(20) NOT NULL);
  CREATE TABLE fleet_project_operational_sites (id UUID PRIMARY KEY);
  CREATE TABLE fleet_operational_status_rules (id UUID PRIMARY KEY);
  CREATE TABLE fleet_operational_assignments (id UUID PRIMARY KEY);
  -- The Attendance record a correction LINK points at. Retention deletes the
  -- link; this row is source Attendance data and must survive.
  CREATE TABLE attendance_adjustments (id UUID PRIMARY KEY DEFAULT gen_random_uuid());
  -- source_id is UUID in production, not text. The purge's WHERE clause has to
  -- cast to match it, and this fixture is what proves the cast is right.
  CREATE TABLE user_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(), user_id UUID NOT NULL,
    event_type VARCHAR(100) NOT NULL, title VARCHAR(500) NOT NULL, body TEXT,
    severity VARCHAR(20) NOT NULL DEFAULT 'info', source_module VARCHAR(50), source_id UUID,
    is_read BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
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
  INSERT INTO users (id, email) VALUES ('${USER}', 'migration-518-purge@example.test');
  INSERT INTO staff (id, first_name, last_name) VALUES ('${STAFF}', 'Migration', 'Test Driver');
  INSERT INTO projects (id, project_name) VALUES ('${PROJECT}', 'Migration Test Project');
  INSERT INTO fleet_vehicles (id, registration) VALUES ('${VEHICLE}', 'CA 123-456');
  INSERT INTO fleet_project_operational_sites (id) VALUES ('${SITE}');
  INSERT INTO attendance_adjustments (id) VALUES ('${ADJUSTMENT}');
  INSERT INTO access_permissions (type, key, label) VALUES ('module', 'fleet', 'Fleet');
`;

const admin = new Pool({ connectionString: BASE_URL, ssl: false, max: 1 });
const db = new Pool({ connectionString: SCOPED_URL, ssl: false, max: 2 });
/** A connection string that runs as `role`, so privileges are tested rather than assumed. */
function urlAsRole(role: string): string {
  const options = encodeURIComponent(`-c search_path=${SCHEMA} -c role=${role}`);
  return `${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}options=${options}`;
}

/** A role with no grants at all, used to prove the identity seam actually routes. */
const UNPRIVILEGED_ROLE = 'fleet_retention_seam_probe';

type Repo = typeof import('@/modules/fleet/incidents/retention/retentionRepository')
  & typeof import('@/modules/fleet/incidents/retention/retentionRunRepository');
type Purge = typeof import('@/modules/fleet/incidents/retention/incidentPurge');
type RetentionDb = typeof import('@/modules/fleet/incidents/retention/retentionDb');
let repo: Repo;
let purge: Purge;
let retentionDb: RetentionDb;
let transaction: typeof import('@/lib/db-pool').transaction;

let referenceCounter = 0;

interface SeededIncident { incidentId: string; evidenceId: string; requestId: string; submissionId: string; linkId: string }

/** One incident with the full PR4-7 record set hanging off it. */
async function seedIncident(options: {
  lifecycle?: 'open' | 'resolved'; workDate?: string; evidenceCount?: number;
} = {}): Promise<SeededIncident> {
  const lifecycle = options.lifecycle ?? 'resolved';
  const workDate = options.workDate ?? '2025-01-15';
  referenceCounter += 1;
  const reference = `INC-PURGE-${String(referenceCounter).padStart(4, '0')}`;
  const terminalColumns = lifecycle === 'resolved'
    ? `, lifecycle_status, acknowledged_by, acknowledged_at, review_started_by, review_started_at,
       resolved_by, resolved_at, outcome, resolution_note`
    : '';
  const terminalValues = lifecycle === 'resolved'
    ? `, 'resolved', $5, now(), $5, now(), $5, now(), 'confirmed', 'closed out'`
    : '';
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO fleet_operational_incidents
       (incident_reference, incident_type, severity, staff_id, project_id, operational_site_id, vehicle_id,
        detected_at, work_date${terminalColumns})
     VALUES ($1, 'late', 'high', $2, $3, '${SITE}', '${VEHICLE}', now(), $4::date${terminalValues})
     RETURNING id`,
    lifecycle === 'resolved' ? [reference, STAFF, PROJECT, workDate, USER] : [reference, STAFF, PROJECT, workDate],
  );
  const incidentId = rows[0]!.id;

  await db.query(
    `INSERT INTO fleet_operational_incident_observations (incident_id, observation_fingerprint, observed_at)
     VALUES ($1, 'fingerprint-1', now())`, [incidentId],
  );
  await db.query(
    `INSERT INTO fleet_operational_incident_actions (incident_id, action_type, actor_user_id)
     VALUES ($1, 'acknowledged', $2)`, [incidentId, USER],
  );
  let evidenceId = '';
  for (let index = 0; index < (options.evidenceCount ?? 1); index += 1) {
    const evidence = await db.query<{ id: string }>(
      `INSERT INTO fleet_operational_incident_evidence
         (incident_id, storage_url, storage_key, evidence_type, uploaded_by)
       VALUES ($1, $2, $3, 'photo', $4) RETURNING id`,
      [incidentId, `/storage/fleet/incidents/${reference}-${index}.jpg`, `fleet/incidents/${reference}-${index}.jpg`, USER],
    );
    evidenceId = evidence.rows[0]!.id;
  }
  const request = await db.query<{ id: string }>(
    `INSERT INTO fleet_incident_driver_input_requests (incident_id, requested_by, respond_by, idempotency_key)
     VALUES ($1, $2, now() + INTERVAL '2 days', $3) RETURNING id`,
    [incidentId, USER, `${reference}-req`],
  );
  const submission = await db.query<{ id: string }>(
    `INSERT INTO fleet_incident_driver_submissions
       (incident_id, input_request_id, staff_id, submission_kind, explanation, idempotency_key)
     VALUES ($1, $2, $3, 'response', 'I was at the depot', $4) RETURNING id`,
    [incidentId, request.rows[0]!.id, STAFF, `${reference}-sub`],
  );
  const link = await db.query<{ id: string }>(
    `INSERT INTO fleet_incident_attendance_correction_links
       (incident_id, driver_submission_id, attendance_correction_id, staff_id, linked_by)
     VALUES ($1, $2, '${ADJUSTMENT}', $3, $3) RETURNING id`,
    [incidentId, submission.rows[0]!.id, STAFF],
  );
  await db.query(
    `INSERT INTO user_notifications (user_id, event_type, title, source_module, source_id)
     VALUES ($1, 'fleet.operational_incident_opened', 'Incident opened', 'fleet-incidents', $2)`,
    [USER, incidentId],
  );
  return {
    incidentId, evidenceId, requestId: request.rows[0]!.id,
    submissionId: submission.rows[0]!.id, linkId: link.rows[0]!.id,
  };
}

async function seedActiveHold(incidentId: string): Promise<void> {
  await db.query(
    `INSERT INTO fleet_incident_retention_holds
       (incident_id, category, reason, owner_user_id, created_by, next_review_at)
     VALUES ($1, 'legal', 'Litigation pending', $2, $2, now() + INTERVAL '30 days')`,
    [incidentId, USER],
  );
}

async function seedAggregateCoverage(monthStart: string): Promise<void> {
  await db.query(
    `INSERT INTO fleet_operational_monthly_aggregates
       (metric_version, month_start, dimension_level, metric_key, metric_kind, numerator, contributor_count)
     VALUES (1, $1::date, 'organisation', 'incident.late', 'count', 4, 6)`,
    [monthStart],
  );
}

async function count(table: string, where: string, params: unknown[]): Promise<number> {
  const { rows } = await db.query<{ total: string }>(`SELECT COUNT(*) AS total FROM ${table} WHERE ${where}`, params);
  return Number(rows[0]!.total);
}

beforeAll(async () => {
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fibreflow_user') THEN
      CREATE ROLE fibreflow_user NOLOGIN;
    END IF;
  END $$;`);
  await admin.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${UNPRIVILEGED_ROLE}') THEN
      CREATE ROLE ${UNPRIVILEGED_ROLE} NOLOGIN;
    END IF;
  END $$;`);
  await admin.query(`GRANT USAGE ON SCHEMA ${SCHEMA} TO fibreflow_user`);
  await admin.query(`GRANT USAGE ON SCHEMA ${SCHEMA} TO ${UNPRIVILEGED_ROLE}`);
  await db.query(PREREQUISITES);
  await db.query(INCIDENTS);
  await db.query(DRIVER_INPUT);
  await db.query(RETENTION);
  await db.query(DELETE_GRANTS);
  await db.query(PUBLISHED_VIEW);
  // The purge also removes this module's bell notifications; the real table
  // already grants the application DELETE, and the scratch copy mirrors that.
  await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${SCHEMA}.user_notifications TO fibreflow_user`);
  repo = {
    ...await import('@/modules/fleet/incidents/retention/retentionRepository'),
    ...await import('@/modules/fleet/incidents/retention/retentionRunRepository'),
  };
  purge = await import('@/modules/fleet/incidents/retention/incidentPurge');
  retentionDb = await import('@/modules/fleet/incidents/retention/retentionDb');
  ({ transaction } = await import('@/lib/db-pool'));
}, 120_000);

afterAll(async () => {
  const { pool: appPool } = await import('@/lib/db-pool');
  await appPool.end();
  await retentionDb.__closeRetentionPoolForTests();
  await db.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.end();
});

beforeEach(async () => {
  delete process.env.FLEET_RETENTION_DATABASE_URL;
  retentionDb.__resetRetentionPoolForTests();
  await db.query(`TRUNCATE fleet_operational_retention_items, fleet_operational_retention_runs,
    fleet_incident_retention_hold_actions, fleet_incident_retention_holds,
    fleet_operational_monthly_aggregates RESTART IDENTITY CASCADE`);
  await db.query(`DELETE FROM fleet_incident_attendance_correction_links`);
  await db.query(`DELETE FROM fleet_incident_driver_submissions`);
  await db.query(`DELETE FROM fleet_incident_driver_input_requests`);
  await db.query(`DELETE FROM fleet_operational_incident_evidence`);
  await db.query(`DELETE FROM fleet_operational_incident_actions`);
  await db.query(`DELETE FROM fleet_operational_incident_observations`);
  await db.query(`DELETE FROM user_notifications`);
  // The purge guard refuses to delete a non-terminal incident — correctly, and
  // that includes this fixture cleanup. Disable it for the teardown only, so a
  // leftover open incident from one test cannot poison the next.
  await admin.query(`ALTER TABLE ${SCHEMA}.fleet_operational_incidents DISABLE TRIGGER trg_fleet_incident_purge_guard`);
  await db.query(`DELETE FROM fleet_operational_incidents`);
  await admin.query(`ALTER TABLE ${SCHEMA}.fleet_operational_incidents ENABLE TRIGGER trg_fleet_incident_purge_guard`);
});

describe('eligibility', () => {
  it('offers a terminal incident past the cutoff', async () => {
    const { incidentId } = await seedIncident({ workDate: '2025-01-15' });
    const candidates = await repo.listPurgeCandidates({ cutoffWorkDate: '2025-08-21', limit: 100 });
    expect(candidates.map((candidate) => candidate.incidentId)).toEqual([incidentId]);
    expect(candidates[0]).toMatchObject({ workDate: '2025-01-15', monthStart: '2025-01-01' });
  });

  it('never offers an incident that is still open', async () => {
    await seedIncident({ lifecycle: 'open' });
    expect(await repo.listPurgeCandidates({ cutoffWorkDate: '2025-08-21', limit: 100 })).toEqual([]);
  });

  it('never offers an incident inside the retention period', async () => {
    await seedIncident({ workDate: '2026-08-01' });
    expect(await repo.listPurgeCandidates({ cutoffWorkDate: '2025-08-21', limit: 100 })).toEqual([]);
  });

  it('excludes an incident under an active hold and counts it as held', async () => {
    const { incidentId } = await seedIncident();
    await seedActiveHold(incidentId);
    expect(await repo.listPurgeCandidates({ cutoffWorkDate: '2025-08-21', limit: 100 })).toEqual([]);
    expect(await repo.countCandidatesHeld({ cutoffWorkDate: '2025-08-21' })).toBe(1);
  });

  it('offers an incident again once its hold is released', async () => {
    const { incidentId } = await seedIncident();
    await seedActiveHold(incidentId);
    await db.query(
      `UPDATE fleet_incident_retention_holds
          SET status = 'released', released_at = now(), released_by = $2, release_reason = 'Matter closed'
        WHERE incident_id = $1`, [incidentId, USER],
    );
    expect(await repo.listPurgeCandidates({ cutoffWorkDate: '2025-08-21', limit: 100 })).toHaveLength(1);
  });

  it('never offers an incident another run already claimed', async () => {
    const { incidentId } = await seedIncident();
    const runId = await repo.insertRetentionRun({ dryRun: false, cutoffWorkDate: '2025-08-21', policyMonths: 12, triggerSource: 'cron' });
    await transaction(async (txn) => repo.claimIncident(txn, { runId, incidentId, storageObjectsTotal: 1 }));
    expect(await repo.listPurgeCandidates({ cutoffWorkDate: '2025-08-21', limit: 100 })).toEqual([]);
  });

  // Clearing the pointer alone violates the duplicate-link CHECK, and
  // rewriting the OTHER incident's outcome would edit a record whose own
  // retention period has not expired. So this one waits its turn.
  it('never offers an incident that another incident marks as its duplicate', async () => {
    const target = await seedIncident();
    const other = await seedIncident();
    await db.query(
      `UPDATE fleet_operational_incidents
          SET lifecycle_status = 'dismissed', outcome = 'duplicate', duplicate_incident_id = $1
        WHERE id = $2`,
      [target.incidentId, other.incidentId],
    );
    const candidates = await repo.listPurgeCandidates({ cutoffWorkDate: '2025-08-21', limit: 100 });
    expect(candidates.map((candidate) => candidate.incidentId)).toEqual([other.incidentId]);
  });

  it('bounds the batch', async () => {
    await seedIncident();
    await seedIncident();
    await seedIncident();
    expect(await repo.listPurgeCandidates({ cutoffWorkDate: '2025-08-21', limit: 2 })).toHaveLength(2);
  });
});

describe('claim guards', () => {
  it('refuses to claim an incident that is not terminal', async () => {
    const { incidentId } = await seedIncident({ lifecycle: 'open' });
    const runId = await repo.insertRetentionRun({ dryRun: false, cutoffWorkDate: '2025-08-21', policyMonths: 12, triggerSource: 'cron' });
    await expect(transaction(async (txn) => repo.claimIncident(txn, { runId, incidentId, storageObjectsTotal: 0 })))
      .rejects.toMatchObject({ code: '23514' });
  });

  // A hold raised between selection and claim wins. This is the schema
  // trigger, not the service, so a stray claim from psql loses too.
  it('refuses to claim an incident a hold was raised on after selection', async () => {
    const { incidentId } = await seedIncident();
    const runId = await repo.insertRetentionRun({ dryRun: false, cutoffWorkDate: '2025-08-21', policyMonths: 12, triggerSource: 'cron' });
    await seedActiveHold(incidentId);
    await expect(transaction(async (txn) => repo.claimIncident(txn, { runId, incidentId, storageObjectsTotal: 0 })))
      .rejects.toMatchObject({ code: '23514' });
  });

  it('refuses a second live claim on the same incident', async () => {
    const { incidentId } = await seedIncident();
    const runId = await repo.insertRetentionRun({ dryRun: false, cutoffWorkDate: '2025-08-21', policyMonths: 12, triggerSource: 'cron' });
    await transaction(async (txn) => repo.claimIncident(txn, { runId, incidentId, storageObjectsTotal: 0 }));
    await expect(transaction(async (txn) => repo.claimIncident(txn, { runId, incidentId, storageObjectsTotal: 0 })))
      .rejects.toMatchObject({ code: '23505' });
  });
});

describe('a hold landing after the claim', () => {
  // The premise of the service's hold handling, proved against the real
  // trigger rather than against a mock: once a hold exists, the item guard
  // refuses EVERY update to a still-identified item — including the two
  // bookkeeping writes the failure path would want to make. Code that assumes
  // it can always record a failure is wrong, and this is why.
  async function claimThenHold(): Promise<{ itemId: string; incidentId: string }> {
    const seeded = await seedIncident();
    const runId = await repo.insertRetentionRun({ dryRun: false, cutoffWorkDate: '2025-08-21', policyMonths: 12, triggerSource: 'cron' });
    const item = await transaction(async (txn) => repo.claimIncident(txn, { runId, incidentId: seeded.incidentId, storageObjectsTotal: 1 }));
    await seedActiveHold(seeded.incidentId);
    return { itemId: item.id, incidentId: seeded.incidentId };
  }

  it('refuses the storage re-baseline — the last write before anything is deleted', async () => {
    const { itemId } = await claimThenHold();
    await expect(repo.rebaselineStoragePlan(itemId, 1)).rejects.toMatchObject({ code: '23514' });
  });

  it('refuses the post-deletion progress write too', async () => {
    const { itemId } = await claimThenHold();
    await expect(repo.recordStorageProgress(itemId, 1)).rejects.toMatchObject({ code: '23514' });
  });

  it('refuses the attempt counter the resume path increments', async () => {
    const { itemId } = await claimThenHold();
    await expect(repo.recordItemAttempt(itemId)).rejects.toMatchObject({ code: '23514' });
  });

  it('reports the incident as held so the service can stop before deleting anything', async () => {
    const { incidentId } = await claimThenHold();
    expect(await repo.getIncidentPurgeState(incidentId)).toBe('held');
  });

  it('reports a purgeable incident as purgeable and a still-open one as not terminal', async () => {
    const resolved = await seedIncident();
    const open = await seedIncident({ lifecycle: 'open' });
    expect(await repo.getIncidentPurgeState(resolved.incidentId)).toBe('purgeable');
    expect(await repo.getIncidentPurgeState(open.incidentId)).toBe('not_terminal');
  });

  it('reports an incident that no longer exists as missing', async () => {
    expect(await repo.getIncidentPurgeState('99999999-9999-4999-8999-999999999999')).toBe('missing');
  });

  // The check takes a row lock that conflicts with the FOR KEY SHARE a hold
  // insert takes, so a hold still MID-COMMIT when the check runs is waited for
  // rather than missed. (This is a different race from the purge/hold one the
  // FK already closes — see getIncidentPurgeState.)
  it('waits for an in-flight hold insert instead of reading past it', async () => {
    const seeded = await seedIncident();
    const holdClient = await db.connect();
    let checkResolved = false;
    try {
      await holdClient.query('BEGIN');
      await holdClient.query(
        `INSERT INTO fleet_incident_retention_holds
           (incident_id, category, reason, owner_user_id, created_by, next_review_at)
         VALUES ($1, 'legal', 'Litigation pending', $2, $2, now() + INTERVAL '30 days')`,
        [seeded.incidentId, USER],
      );
      const check = repo.getIncidentPurgeState(seeded.incidentId).then((state) => {
        checkResolved = true;
        return state;
      });
      await new Promise((resolve) => setTimeout(resolve, 250));
      // Still blocked on the uncommitted hold rather than answering "purgeable".
      expect(checkResolved).toBe(false);
      await holdClient.query('COMMIT');
      expect(await check).toBe('held');
    } finally {
      holdClient.release();
    }
  });
});

describe('resuming a partially deleted item', () => {
  // The failure this whole phase split exists to stop. A first attempt deleted
  // one of two objects and failed; the resume re-lists BOTH objects, and the
  // counter guard rejects the second increment because the counter has already
  // reached the total recorded at claim time. A legitimate resume becomes a
  // failed item, and on the next run its storage objects are orphaned while
  // the evidence rows are purged.
  it('a resumed item can account for its whole object set without raising', async () => {
    const seeded = await seedIncident({ evidenceCount: 2 });
    const runId = await repo.insertRetentionRun({ dryRun: false, cutoffWorkDate: '2025-08-21', policyMonths: 12, triggerSource: 'cron' });
    const item = await transaction(async (txn) => repo.claimIncident(txn, { runId, incidentId: seeded.incidentId, storageObjectsTotal: 2 }));

    // First attempt: one object deleted, then the process died.
    await repo.rebaselineStoragePlan(item.id, 2);
    await repo.recordStorageProgress(item.id, 1);

    // The resume re-plans the whole set and must be able to record all of it.
    const resumed = (await repo.getItem(item.id))!;
    await repo.rebaselineStoragePlan(resumed.id, 2);
    await expect(repo.recordStorageProgress(resumed.id, 2)).resolves.toBeUndefined();
    expect((await repo.getItem(item.id))?.storageObjectsDeleted).toBe(2);
  });

  // The re-baseline is the LAST write before anything is deleted, so it is
  // also the last point at which the guard can refuse cheaply.
  it('re-baselining is refused for a held incident, before any deletion', async () => {
    const seeded = await seedIncident({ evidenceCount: 2 });
    const runId = await repo.insertRetentionRun({ dryRun: false, cutoffWorkDate: '2025-08-21', policyMonths: 12, triggerSource: 'cron' });
    const item = await transaction(async (txn) => repo.claimIncident(txn, { runId, incidentId: seeded.incidentId, storageObjectsTotal: 2 }));
    await seedActiveHold(seeded.incidentId);
    await expect(repo.rebaselineStoragePlan(item.id, 2)).rejects.toMatchObject({ code: '23514' });
  });

  it('re-baselining adopts an evidence set that grew after the claim', async () => {
    const seeded = await seedIncident({ evidenceCount: 1 });
    const runId = await repo.insertRetentionRun({ dryRun: false, cutoffWorkDate: '2025-08-21', policyMonths: 12, triggerSource: 'cron' });
    const item = await transaction(async (txn) => repo.claimIncident(txn, { runId, incidentId: seeded.incidentId, storageObjectsTotal: 1 }));
    await db.query(
      `INSERT INTO fleet_operational_incident_evidence (incident_id, storage_url, storage_key, evidence_type, uploaded_by)
       VALUES ($1, '/storage/fleet/incidents/late.jpg', 'fleet/incidents/late.jpg', 'photo', $2)`,
      [seeded.incidentId, USER],
    );
    await repo.rebaselineStoragePlan(item.id, 2);
    const rebaselined = await repo.getItem(item.id);
    expect(rebaselined).toMatchObject({ storageObjectsTotal: 2, storageObjectsDeleted: 0 });
  });
});

describe('aggregate coverage gate', () => {
  it('reports no coverage before the month has been aggregated', async () => {
    expect(await repo.hasCompleteAggregateCoverage('2025-01-01', 1)).toBe(false);
  });

  it('reports coverage once an active aggregate exists for that month and metric version', async () => {
    await seedAggregateCoverage('2025-01-01');
    expect(await repo.hasCompleteAggregateCoverage('2025-01-01', 1)).toBe(true);
  });

  it('does not accept another month or another metric version as coverage', async () => {
    await seedAggregateCoverage('2025-02-01');
    expect(await repo.hasCompleteAggregateCoverage('2025-01-01', 1)).toBe(false);
    expect(await repo.hasCompleteAggregateCoverage('2025-02-01', 2)).toBe(false);
  });

  it('does not accept a superseded (inactive) aggregate as coverage', async () => {
    await seedAggregateCoverage('2025-01-01');
    await db.query(`UPDATE fleet_operational_monthly_aggregates SET is_active = false`);
    expect(await repo.hasCompleteAggregateCoverage('2025-01-01', 1)).toBe(false);
  });
});

describe('purge', () => {
  it('removes every programme-owned record for the incident and completes the item', async () => {
    const seeded = await seedIncident();
    const survivor = await seedIncident();
    const runId = await repo.insertRetentionRun({ dryRun: false, cutoffWorkDate: '2025-08-21', policyMonths: 12, triggerSource: 'cron' });
    const item = await transaction(async (txn) => repo.claimIncident(txn, { runId, incidentId: seeded.incidentId, storageObjectsTotal: 1 }));
    await repo.rebaselineStoragePlan(item.id, 1);
    await repo.recordStorageProgress(item.id, 1);

    await purge.purgeIncidentRecords({ itemId: item.id, incidentId: seeded.incidentId });

    for (const table of [
      'fleet_operational_incident_observations', 'fleet_operational_incident_actions',
      'fleet_operational_incident_evidence', 'fleet_incident_driver_input_requests',
      'fleet_incident_driver_submissions', 'fleet_incident_attendance_correction_links',
    ]) {
      expect(await count(table, 'incident_id = $1', [seeded.incidentId])).toBe(0);
    }
    expect(await count('fleet_operational_incidents', 'id = $1', [seeded.incidentId])).toBe(0);
    expect(await count('user_notifications', 'source_id = $1', [seeded.incidentId])).toBe(0);

    const completed = await repo.getItem(item.id);
    expect(completed).toMatchObject({ stage: 'database_complete', incidentId: null });

    // The neighbouring incident is untouched, so the purge is scoped to one id.
    expect(await count('fleet_operational_incidents', 'id = $1', [survivor.incidentId])).toBe(1);
    expect(await count('fleet_operational_incident_evidence', 'incident_id = $1', [survivor.incidentId])).toBe(1);
  });

  it('leaves source Attendance, staff, project and vehicle records alone', async () => {
    const seeded = await seedIncident();
    const runId = await repo.insertRetentionRun({ dryRun: false, cutoffWorkDate: '2025-08-21', policyMonths: 12, triggerSource: 'cron' });
    const item = await transaction(async (txn) => repo.claimIncident(txn, { runId, incidentId: seeded.incidentId, storageObjectsTotal: 0 }));
    await purge.purgeIncidentRecords({ itemId: item.id, incidentId: seeded.incidentId });

    expect(await count('attendance_adjustments', 'id = $1', [ADJUSTMENT])).toBe(1);
    expect(await count('staff', 'id = $1', [STAFF])).toBe(1);
    expect(await count('projects', 'id = $1', [PROJECT])).toBe(1);
    expect(await count('fleet_vehicles', 'id = $1', [VEHICLE])).toBe(1);
    expect(await count('fleet_project_operational_sites', 'id = $1', [SITE])).toBe(1);
  });

  it('takes released holds and their history with the incident', async () => {
    const seeded = await seedIncident();
    await seedActiveHold(seeded.incidentId);
    const { rows } = await db.query<{ id: string }>(
      `UPDATE fleet_incident_retention_holds
          SET status = 'released', released_at = now(), released_by = $2, release_reason = 'Matter closed'
        WHERE incident_id = $1 RETURNING id`, [seeded.incidentId, USER],
    );
    await db.query(
      `INSERT INTO fleet_incident_retention_hold_actions (hold_id, action_type, actor_user_id)
       VALUES ($1, 'released', $2)`, [rows[0]!.id, USER],
    );
    const runId = await repo.insertRetentionRun({ dryRun: false, cutoffWorkDate: '2025-08-21', policyMonths: 12, triggerSource: 'cron' });
    const item = await transaction(async (txn) => repo.claimIncident(txn, { runId, incidentId: seeded.incidentId, storageObjectsTotal: 0 }));
    await purge.purgeIncidentRecords({ itemId: item.id, incidentId: seeded.incidentId });

    expect(await count('fleet_incident_retention_holds', 'incident_id = $1', [seeded.incidentId])).toBe(0);
    expect(await count('fleet_incident_retention_hold_actions', 'hold_id = $1', [rows[0]!.id])).toBe(0);
  });


  // Failure-safe: the whole purge is one transaction, so a hold raised while
  // it runs rolls back every child deletion with it.
  it('keeps every record when the incident delete is refused mid-transaction', async () => {
    const seeded = await seedIncident();
    const runId = await repo.insertRetentionRun({ dryRun: false, cutoffWorkDate: '2025-08-21', policyMonths: 12, triggerSource: 'cron' });
    const item = await transaction(async (txn) => repo.claimIncident(txn, { runId, incidentId: seeded.incidentId, storageObjectsTotal: 0 }));
    await seedActiveHold(seeded.incidentId);

    await expect(purge.purgeIncidentRecords({ itemId: item.id, incidentId: seeded.incidentId }))
      .rejects.toMatchObject({ code: '23514' });

    expect(await count('fleet_operational_incidents', 'id = $1', [seeded.incidentId])).toBe(1);
    expect(await count('fleet_operational_incident_evidence', 'incident_id = $1', [seeded.incidentId])).toBe(1);
    expect(await count('fleet_incident_driver_submissions', 'incident_id = $1', [seeded.incidentId])).toBe(1);
    expect((await repo.getItem(item.id))?.incidentId).toBe(seeded.incidentId);
  });

  it('refuses to complete an item while a storage object is still unaccounted for', async () => {
    const seeded = await seedIncident({ evidenceCount: 2 });
    const runId = await repo.insertRetentionRun({ dryRun: false, cutoffWorkDate: '2025-08-21', policyMonths: 12, triggerSource: 'cron' });
    const item = await transaction(async (txn) => repo.claimIncident(txn, { runId, incidentId: seeded.incidentId, storageObjectsTotal: 2 }));
    await repo.rebaselineStoragePlan(item.id, 2);
    await repo.recordStorageProgress(item.id, 1);
    await expect(purge.purgeIncidentRecords({ itemId: item.id, incidentId: seeded.incidentId }))
      .rejects.toMatchObject({ code: '23514' });
    expect(await count('fleet_operational_incidents', 'id = $1', [seeded.incidentId])).toBe(1);
  });
});

describe('retention database identity', () => {
  /**
   * The migration tests run as a superuser, so every DELETE above succeeds
   * regardless of what the configured retention role may actually do.
   * Production does not. These two run the REAL purge function through the
   * identity seam, because a purge that is only provable as superuser is not
   * provable at all.
   */
  async function claimOne(): Promise<{ itemId: string; incidentId: string }> {
    const seeded = await seedIncident();
    const runId = await repo.insertRetentionRun({ dryRun: false, cutoffWorkDate: '2025-08-21', policyMonths: 12, triggerSource: 'cron' });
    const item = await transaction(async (txn) => repo.claimIncident(txn, { runId, incidentId: seeded.incidentId, storageObjectsTotal: 0 }));
    return { itemId: item.id, incidentId: seeded.incidentId };
  }

  // Proves the seam ROUTES, independently of any grant decision: a role with
  // no privileges must fail, which it can only do if the purge really ran as
  // that role rather than on the shared application pool.
  it('runs the purge as the configured identity, not the application pool', async () => {
    const claimed = await claimOne();
    process.env.FLEET_RETENTION_DATABASE_URL = urlAsRole(UNPRIVILEGED_ROLE);
    retentionDb.__resetRetentionPoolForTests();
    expect(retentionDb.retentionIdentityDescription()).toBe('dedicated');

    await expect(purge.purgeIncidentRecords(claimed)).rejects.toMatchObject({ code: '42501' });
    // Nothing was destroyed on the way to being refused.
    expect(await count('fleet_operational_incidents', 'id = $1', [claimed.incidentId])).toBe(1);
    expect(await count('fleet_operational_incident_evidence', 'incident_id = $1', [claimed.incidentId])).toBe(1);
    await retentionDb.__closeRetentionPoolForTests();
  });

  // The preflight is what turns a deterministic, run-wide fault into a run
  // that fails before deleting anything, instead of one destroyed attachment
  // at a time. It has to be exercised against a real role and real SQL.
  it('preflight passes for the granted retention role and changes nothing', async () => {
    const seeded = await seedIncident();
    await purge.preflightPurgeStatements();
    expect(await count('fleet_operational_incidents', 'id = $1', [seeded.incidentId])).toBe(1);
    expect(await count('fleet_operational_incident_evidence', 'incident_id = $1', [seeded.incidentId])).toBe(1);
    expect(await count('user_notifications', 'source_id = $1', [seeded.incidentId])).toBe(1);
  });

  it('preflight fails loudly for a role without the grants', async () => {
    process.env.FLEET_RETENTION_DATABASE_URL = urlAsRole(UNPRIVILEGED_ROLE);
    retentionDb.__resetRetentionPoolForTests();
    await expect(purge.preflightPurgeStatements()).rejects.toMatchObject({ code: '42501' });
    await retentionDb.__closeRetentionPoolForTests();
  });

  // The grant question itself. RED until DELETE is granted — either to
  // fibreflow_user, or to a dedicated retention role this test then points at.
  it('lets the retention role execute the whole purge', async () => {
    const claimed = await claimOne();
    process.env.FLEET_RETENTION_DATABASE_URL = urlAsRole(process.env.FLEET_RETENTION_TEST_ROLE ?? 'fibreflow_user');
    retentionDb.__resetRetentionPoolForTests();

    await purge.purgeIncidentRecords(claimed);
    expect(await count('fleet_operational_incidents', 'id = $1', [claimed.incidentId])).toBe(0);
    await retentionDb.__closeRetentionPoolForTests();
  });
});
