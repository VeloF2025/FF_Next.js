/**
 * The retention-hold repository SQL, executed against a real Postgres.
 *
 * The unit tests for the hold SERVICE mock this repository out — correctly,
 * they test authorisation and validation — which leaves every statement in
 * `holdRepository.ts` unparsed by anything. That is the class of bug this repo
 * has shipped past green CI before: a stub client records SQL text and never
 * sends it, so a wrong column name or a violated CHECK only surfaces in
 * production.
 *
 * It also covers the half of the contract that lives in the schema rather than
 * in TypeScript: one active hold per incident/category, append-only history,
 * and the 90-day review ceiling. The service validates those too, but the
 * service is not the only thing that can write these tables.
 *
 * SAFETY / ISOLATION: everything is built in a scratch schema and the
 * application pool is pointed at it through `options=-c search_path=...`, so
 * the unqualified service SQL resolves there and never reaches public.
 */
if (!process.env.TEST_DATABASE_URL) {
  throw new Error('Integration test needs TEST_DATABASE_URL set. See .env.local.example.');
}

const SCHEMA = 'mig518_retention_holds_scratch';
const BASE_URL = process.env.TEST_DATABASE_URL;
const SCOPED_URL = `${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}options=${encodeURIComponent(`-c search_path=${SCHEMA}`)}`;
// Read by src/lib/db.ts at import time, hence the dynamic import in beforeAll.
process.env.DATABASE_URL = SCOPED_URL;

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';

import type { RetentionHold } from '@/modules/fleet/incidents/analytics/types';

const SQL_DIR = join(process.cwd(), 'scripts/migrations/sql');
const INCIDENTS = readFileSync(join(SQL_DIR, '510_fleet_operational_incidents.sql'), 'utf8');
const RETENTION = readFileSync(join(SQL_DIR, '518_fleet_operational_analytics_retention.sql'), 'utf8');

const ADMIN = '11111111-1111-4111-8111-111111111111';
const OWNER = '11111111-1111-4111-8111-111111111112';
const GRANTED = '11111111-1111-4111-8111-111111111113';
const REVOKED = '11111111-1111-4111-8111-111111111114';
const INACTIVE = '11111111-1111-4111-8111-111111111115';
const PM_ONLY = '11111111-1111-4111-8111-111111111116';
const STAFF = '22222222-2222-4222-8222-222222222222';
const PROJECT = '33333333-3333-4333-8333-333333333333';

const PREREQUISITES = `
  -- EVERY column below mirrors production's name AND type, verified against
  -- information_schema on the shared database. A fixture may declare a SUBSET
  -- of production's columns; it may never invent one, or retype one.
  CREATE TABLE schema_migrations (filename TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now());
  CREATE TABLE users (
    id UUID PRIMARY KEY, email VARCHAR(255) NOT NULL UNIQUE,
    role VARCHAR(50) DEFAULT 'user', is_active BOOLEAN DEFAULT true
  );
  -- Production staff has first_name/last_name and NO full_name/name column.
  CREATE TABLE staff (
    id UUID PRIMARY KEY, first_name VARCHAR(100) NOT NULL, last_name VARCHAR(100) NOT NULL
  );
  CREATE TABLE projects (
    id UUID PRIMARY KEY, project_name VARCHAR(255) NOT NULL, project_manager UUID
  );
  CREATE TABLE fleet_vehicles (id UUID PRIMARY KEY, registration VARCHAR(20) NOT NULL);
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
    expires_at TIMESTAMPTZ, UNIQUE (user_id, permission_key)
  );
  INSERT INTO users (id, email, role, is_active) VALUES
    ('${ADMIN}', 'holds-admin@example.test', 'admin', true),
    ('${OWNER}', 'holds-owner@example.test', 'admin', true),
    ('${GRANTED}', 'holds-granted@example.test', 'manager', true),
    ('${REVOKED}', 'holds-revoked@example.test', 'admin', true),
    ('${INACTIVE}', 'holds-inactive@example.test', 'admin', false),
    ('${PM_ONLY}', 'holds-pm@example.test', 'project_manager', true);
  INSERT INTO staff (id, first_name, last_name) VALUES ('${STAFF}', 'Migration', 'Test Staff');
  INSERT INTO projects (id, project_name, project_manager) VALUES ('${PROJECT}', 'Test Project', '${PM_ONLY}');
  INSERT INTO fleet_project_operational_sites (id) VALUES ('44444444-4444-4444-8444-444444444444');
  INSERT INTO access_permissions (type, key, label) VALUES ('module', 'fleet', 'Fleet');
`;

const admin = new Pool({ connectionString: BASE_URL, ssl: false, max: 1 });
const db = new Pool({ connectionString: SCOPED_URL, ssl: false, max: 1 });

type Repo = typeof import('@/modules/fleet/incidents/retention/holdRepository');
let repo: Repo;
let transaction: typeof import('@/lib/db-pool').transaction;

let referenceCounter = 0;

async function insertResolvedIncident(): Promise<string> {
  referenceCounter += 1;
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO fleet_operational_incidents (
       incident_reference, incident_type, severity, staff_id, project_id, detected_at, work_date,
       lifecycle_status, acknowledged_by, acknowledged_at, review_started_by, review_started_at,
       resolved_by, resolved_at, outcome, resolution_note
     ) VALUES ($1, 'late', 'high', $2, $3, now(), DATE '2024-06-10',
       'resolved', $4, now(), $4, now(), $4, now(), 'confirmed', 'closed out') RETURNING id`,
    [`INC-HOLDS-${String(referenceCounter).padStart(4, '0')}`, STAFF, PROJECT, ADMIN],
  );
  return rows[0]!.id;
}

async function createHold(incidentId: string, category = 'legal', nextReviewAt = '2026-09-01T00:00:00.000Z'): Promise<RetentionHold> {
  return transaction(async (txn) => {
    const hold = await repo.insertHold(txn, {
      incidentId, category: category as RetentionHold['category'], reason: 'Litigation pending',
      ownerUserId: OWNER, createdBy: ADMIN, nextReviewAt,
    });
    await repo.insertHoldAction(txn, {
      holdId: hold.id, actionType: 'created', actorUserId: ADMIN, note: 'Litigation pending',
      previousNextReviewAt: null, newNextReviewAt: nextReviewAt,
    });
    return hold;
  });
}

/**
 * Backdates a hold so its review is already overdue. `insertHold` stamps
 * `hold_start_at` with now() exactly as production does, and the schema
 * refuses a review date before the hold started, so an overdue hold can only
 * be built by moving the START back — which is what the passage of time does
 * in production.
 */
async function backdate(holdId: string, holdStartAt: string, nextReviewAt: string): Promise<void> {
  await db.query(
    `UPDATE fleet_incident_retention_holds SET hold_start_at = $2::timestamptz, next_review_at = $3::timestamptz WHERE id = $1`,
    [holdId, holdStartAt, nextReviewAt],
  );
}

beforeAll(async () => {
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  // The migration's GRANTs name fibreflow_user, which the disposable
  // container does not have (the same block 510/511/518's tests carry).
  await admin.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fibreflow_user') THEN
      CREATE ROLE fibreflow_user NOLOGIN;
    END IF;
  END $$;`);
  await admin.query(`GRANT USAGE ON SCHEMA ${SCHEMA} TO fibreflow_user`);
  await db.query(PREREQUISITES);
  await db.query(INCIDENTS);
  await db.query(RETENTION);
  repo = await import('@/modules/fleet/incidents/retention/holdRepository');
  ({ transaction } = await import('@/lib/db-pool'));
}, 120_000);

afterAll(async () => {
  const { pool: appPool } = await import('@/lib/db-pool');
  await appPool.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await db.end();
  await admin.end();
});

beforeEach(async () => {
  await db.query('TRUNCATE fleet_incident_retention_hold_actions, fleet_incident_retention_holds RESTART IDENTITY CASCADE');
  await db.query('DELETE FROM fleet_operational_incidents');
  await db.query('DELETE FROM user_permission_overrides');
  await db.query(`DELETE FROM role_permissions WHERE permission_key = 'fleet.retention-holds'`);
  await db.query(`INSERT INTO role_permissions (role, permission_key, actions) VALUES
    ('admin', 'fleet.retention-holds', '{"view":true,"create":true,"edit":true,"delete":false}'::jsonb)`);
});

describe('hold lifecycle', () => {
  it('creates an active hold with its opening action and reads both back', async () => {
    const incidentId = await insertResolvedIncident();
    const hold = await createHold(incidentId);

    expect(hold).toMatchObject({ incidentId, category: 'legal', status: 'active', ownerUserId: OWNER });
    const holds = await repo.listIncidentHolds(incidentId);
    expect(holds).toHaveLength(1);
    const actions = await repo.listHoldActions(hold.id);
    expect(actions.map((action) => action.actionType)).toEqual(['created']);
  });

  it('refuses a second ACTIVE hold on the same incident and category', async () => {
    const incidentId = await insertResolvedIncident();
    await createHold(incidentId, 'legal');
    await expect(createHold(incidentId, 'legal')).rejects.toMatchObject({ code: '23505' });
  });

  it('allows a second hold in a different category', async () => {
    const incidentId = await insertResolvedIncident();
    await createHold(incidentId, 'legal');
    await createHold(incidentId, 'insurance');
    expect(await repo.listIncidentHolds(incidentId)).toHaveLength(2);
  });

  it('records a review, moving the review date and stamping the reviewer', async () => {
    const incidentId = await insertResolvedIncident();
    const hold = await createHold(incidentId);
    const reviewed = await transaction(async (txn) => repo.recordHoldReview(txn, {
      holdId: hold.id, actorUserId: ADMIN, nextReviewAt: '2026-11-01T00:00:00.000Z', at: '2026-08-25T00:00:00.000Z',
    }));
    expect(reviewed.nextReviewAt).toBe('2026-11-01T00:00:00.000Z');
    expect(reviewed.lastReviewedAt).toBe('2026-08-25T00:00:00.000Z');
    expect(reviewed.status).toBe('active');
  });

  // The 90-day ceiling is a schema CHECK, not only a service rule: an
  // indefinite hold is how identifiable data quietly becomes permanent.
  it('refuses a review date more than 90 days past the review instant', async () => {
    const incidentId = await insertResolvedIncident();
    const hold = await createHold(incidentId);
    await expect(transaction(async (txn) => repo.recordHoldReview(txn, {
      holdId: hold.id, actorUserId: ADMIN, nextReviewAt: '2027-01-01T00:00:00.000Z', at: '2026-08-25T00:00:00.000Z',
    }))).rejects.toMatchObject({ code: '23514' });
  });

  it('releases a hold and keeps it readable until the incident is purged', async () => {
    const incidentId = await insertResolvedIncident();
    const hold = await createHold(incidentId);
    const released = await transaction(async (txn) => repo.recordHoldRelease(txn, {
      holdId: hold.id, actorUserId: ADMIN, releaseReason: 'Matter closed', at: '2026-08-26T00:00:00.000Z',
    }));
    expect(released).toMatchObject({ status: 'released', releasedAt: '2026-08-26T00:00:00.000Z' });
    expect(await repo.listIncidentHolds(incidentId)).toHaveLength(1);
  });

  // The service checks this too, but the UPDATE carries its own status guard:
  // a review landing on a released hold would re-date a hold nobody holds.
  it('refuses to review a hold that has already been released', async () => {
    const incidentId = await insertResolvedIncident();
    const hold = await createHold(incidentId);
    await transaction(async (txn) => repo.recordHoldRelease(txn, {
      holdId: hold.id, actorUserId: ADMIN, releaseReason: 'Matter closed', at: '2026-08-26T00:00:00.000Z',
    }));
    await expect(transaction(async (txn) => repo.recordHoldReview(txn, {
      holdId: hold.id, actorUserId: ADMIN, nextReviewAt: '2026-09-20T00:00:00.000Z', at: '2026-08-27T00:00:00.000Z',
    }))).rejects.toThrow(/is not active/);
  });

  it('locks the hold row for update so a concurrent review and release cannot interleave', async () => {
    const incidentId = await insertResolvedIncident();
    const hold = await createHold(incidentId);

    let releaseStarted = false;
    let releaseFinishedAfterFirstCommit = false;
    const first = transaction(async (txn) => {
      await repo.lockHold(txn, hold.id);
      await new Promise((resolve) => setTimeout(resolve, 250));
      releaseFinishedAfterFirstCommit = !releaseStarted;
      return repo.recordHoldRelease(txn, {
        holdId: hold.id, actorUserId: ADMIN, releaseReason: 'Matter closed', at: '2026-08-26T00:00:00.000Z',
      });
    });
    const second = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
      return transaction(async (txn) => {
        const locked = await repo.lockHold(txn, hold.id);
        releaseStarted = true;
        return locked;
      });
    })();

    const [, secondSeen] = await Promise.all([first, second]);
    // The second transaction could not read the row until the first committed,
    // so it sees the RELEASED state rather than a stale active one.
    expect(releaseFinishedAfterFirstCommit).toBe(true);
    expect(secondSeen?.status).toBe('released');
  });

  it('refuses to rewrite hold history', async () => {
    const incidentId = await insertResolvedIncident();
    const hold = await createHold(incidentId);
    const actions = await repo.listHoldActions(hold.id);
    await expect(
      db.query(`UPDATE fleet_incident_retention_hold_actions SET note = 'rewritten' WHERE id = $1`, [actions[0]!.id]),
    ).rejects.toMatchObject({ code: '23514' });
  });
});

describe('listHoldsDueForReview', () => {
  it('returns approaching and overdue active holds, and nothing else', async () => {
    const approachingIncident = await insertResolvedIncident();
    const overdueIncident = await insertResolvedIncident();
    const distantIncident = await insertResolvedIncident();
    const releasedIncident = await insertResolvedIncident();

    await createHold(approachingIncident, 'legal', '2026-09-05T00:00:00.000Z');
    const overdueHold = await createHold(overdueIncident, 'legal', '2026-09-05T00:00:00.000Z');
    await backdate(overdueHold.id, '2026-06-01T00:00:00.000Z', '2026-08-20T00:00:00.000Z');
    await createHold(distantIncident, 'legal', '2026-10-20T00:00:00.000Z');
    const releasedHold = await createHold(releasedIncident, 'legal', '2026-09-05T00:00:00.000Z');
    await backdate(releasedHold.id, '2026-06-01T00:00:00.000Z', '2026-08-20T00:00:00.000Z');
    await transaction(async (txn) => repo.recordHoldRelease(txn, {
      holdId: releasedHold.id, actorUserId: ADMIN, releaseReason: 'done', at: '2026-08-26T00:00:00.000Z',
    }));

    const due = await repo.listHoldsDueForReview({ asOf: '2026-08-27T00:00:00.000Z', leadDays: 14 });
    const byIncident = new Map(due.map((row) => [row.incidentId, row]));
    expect(byIncident.get(approachingIncident)).toMatchObject({ overdue: false });
    expect(byIncident.get(overdueIncident)).toMatchObject({ overdue: true });
    expect(byIncident.has(distantIncident)).toBe(false);
    expect(byIncident.has(releasedIncident)).toBe(false);
  });

  it('carries the incident reference and project so a notification can link without re-querying', async () => {
    const incidentId = await insertResolvedIncident();
    const hold = await createHold(incidentId, 'legal', '2026-09-05T00:00:00.000Z');
    await backdate(hold.id, '2026-06-01T00:00:00.000Z', '2026-08-20T00:00:00.000Z');
    const [due] = await repo.listHoldsDueForReview({ asOf: '2026-08-27T00:00:00.000Z', leadDays: 14 });
    expect(due).toMatchObject({ incidentId, category: 'legal', ownerUserId: OWNER, projectId: PROJECT });
    expect(due!.incidentReference).toMatch(/^INC-HOLDS-/);
  });
});

describe('listHoldAuthorityCandidates', () => {
  it('offers exactly the active users who could hold authority, and no one else', async () => {
    await db.query(
      `INSERT INTO user_permission_overrides (user_id, permission_key, override_type, actions)
       VALUES ($1, 'fleet.retention-holds', 'grant', '{"view":true,"create":true,"edit":true}'::jsonb),
              ($2, 'fleet.retention-holds', 'revoke', '{"view":true,"create":true,"edit":true}'::jsonb)`,
      [GRANTED, REVOKED],
    );
    const candidates = await repo.listHoldAuthorityCandidates();

    expect(candidates).toContain(ADMIN);
    // A per-user grant makes someone a candidate without the role.
    expect(candidates).toContain(GRANTED);
    // A revoked user IS a candidate here and is dropped by the permission
    // filter in holdAuthority.ts — this list is deliberately a superset.
    expect(candidates).toContain(REVOKED);
    // An inactive account is never paged about a named person's record.
    expect(candidates).not.toContain(INACTIVE);
    // A project manager sees holds on their own project's incidents; they have
    // no authority over them and must never be paged as if they had.
    expect(candidates).not.toContain(PM_ONLY);
  });
});
