/**
 * Migration 522 against a real Postgres.
 *
 * Three things here cannot be tested any other way:
 *
 *  1. The dwell SQL. It is PostGIS containment plus a window function plus
 *     fractional attribution across overlapping AOIs. A stub TxnClient records
 *     the text and proves nothing about the arithmetic.
 *  2. The override guard. The claim is "a recompute can never overwrite a human
 *     decision". That claim is about what the DATABASE will accept, so only a
 *     database can answer it.
 *  3. The CHECK constraints that stop a `roaming` row from carrying a project.
 *
 * SAFETY / ISOLATION: scratch schema, same as the 483 siblings - these run in
 * one shared container.
 */

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'Integration test needs TEST_DATABASE_URL set (real DB connection string). ' +
      'See .env.local.example.'
  );
}

const SCHEMA = 'mig522_inference_scratch';
const BASE_URL = process.env.TEST_DATABASE_URL;
const SCOPED_URL = `${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}options=${encodeURIComponent(
  // public is on the path for PostGIS, which the seed installs there.
  `-c search_path=${SCHEMA},public`
)}`;
process.env.DATABASE_URL = SCOPED_URL;

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import type { DecisionInput } from '@/modules/fleet/assignments/inference/proposalRepository';
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

const SQL_DIR = join(process.cwd(), 'scripts/migrations/sql');
const FORWARD = readFileSync(join(SQL_DIR, '522_fleet_site_inference.sql'), 'utf8');
const ROLLBACK = readFileSync(join(SQL_DIR, 'rollback_522_fleet_site_inference.sql'), 'utf8');

const VEHICLE = '52200000-0000-0000-0000-000000000001';
const VEHICLE_B = '52200000-0000-0000-0000-000000000002';
const LAWLEY = '52200000-0000-0000-0000-0000000000a1';
const POP1 = '52200000-0000-0000-0000-0000000000a2';
const STAFF = '52200000-0000-0000-0000-0000000000b1';
const USER_A = '52200000-0000-0000-0000-0000000000c1';
const USER_B = '52200000-0000-0000-0000-0000000000c2';

/**
 * Column types were diffed against production information_schema on
 * 2026-08-21. The ones that matter and are easy to get wrong:
 *   projects.project_name       varchar(255)  (onemap.projects is varchar(100) - wrong table)
 *   fleet_vehicles.registration varchar(20)
 *   fleet_vehicle_positions.lat/lon  numeric(10,7), NOT double precision and NOT
 *                               bare numeric - production rounds coordinates to
 *                               7 decimal places, so a bare NUMERIC fixture
 *                               stores test points production could not hold
 *   fleet_vehicle_positions.speed_kph  numeric(6,2)
 *   project_aois.aoi            geography(Geometry,4326) - the ::geometry cast
 *                               in the dwell SQL exists because of this
 *   vehicle_assignments.vehicle_registration varchar(20) - and on production 5 of
 *                               24 active rows disagree with
 *                               fleet_vehicles.registration for the same
 *                               fleet_vehicle_id, which is why nothing joins on it.
 * fleet_operational_assignments appears with `id` only: migration 522 needs it
 * solely as an FK target and declaring the rest would be fiction.
 */
const PREREQUISITES = `
  CREATE TABLE schema_migrations (filename TEXT PRIMARY KEY);
  CREATE TABLE users (id UUID PRIMARY KEY);
  CREATE TABLE staff (
    id UUID PRIMARY KEY,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL
  );
  CREATE TABLE projects (
    id UUID PRIMARY KEY,
    project_name VARCHAR(255) NOT NULL
  );
  CREATE TABLE fleet_vehicles (
    id UUID PRIMARY KEY,
    registration VARCHAR(20) NOT NULL
  );
  CREATE TABLE vehicle_assignments (
    id UUID PRIMARY KEY,
    staff_id UUID NOT NULL REFERENCES staff(id),
    fleet_vehicle_id UUID REFERENCES fleet_vehicles(id),
    vehicle_registration VARCHAR(20) NOT NULL,
    assignment_start DATE NOT NULL,
    is_active BOOLEAN DEFAULT TRUE
  );
  CREATE TABLE fleet_operational_assignments (id UUID PRIMARY KEY);
  CREATE TABLE project_aois (
    project_id UUID PRIMARY KEY REFERENCES projects(id) ON DELETE CASCADE,
    aoi GEOGRAPHY(Geometry, 4326) NOT NULL,
    pole_count INTEGER NOT NULL,
    computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
  );
  CREATE TABLE fleet_vehicle_positions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    vehicle_id UUID NOT NULL REFERENCES fleet_vehicles(id),
    recorded_at TIMESTAMPTZ NOT NULL,
    lat NUMERIC(10, 7) NOT NULL,
    lon NUMERIC(10, 7) NOT NULL,
    speed_kph NUMERIC(6, 2),
    ignition BOOLEAN
  );
`;

// Two squares that overlap in x=[2,3], mirroring the real POP 1 / POP 3 overlap.
const LAWLEY_AOI = 'POLYGON((0 0, 3 0, 3 3, 0 3, 0 0))';
const POP1_AOI = 'POLYGON((2 0, 6 0, 6 3, 2 3, 2 0))';

let pool: Pool;
let recordDecision: (v: string, i: DecisionInput, a: string) => Promise<void>;
let InferenceDecisionErrorClass: new (...args: never[]) => Error;

async function seed(): Promise<void> {
  await pool.query(`INSERT INTO users (id) VALUES ($1), ($2)`, [USER_A, USER_B]);
  await pool.query(
    `INSERT INTO staff (id, first_name, last_name) VALUES ($1, 'Byron', 'Viviers')`, [STAFF]);
  await pool.query(
    `INSERT INTO projects (id, project_name) VALUES ($1, 'Lawley'), ($2, 'Thembisa POP 1')`,
    [LAWLEY, POP1]);
  await pool.query(
    `INSERT INTO fleet_vehicles (id, registration) VALUES ($1, 'MW67LZGP'), ($2, 'KN74ZSGP')`,
    [VEHICLE, VEHICLE_B]);
  await pool.query(`
    INSERT INTO project_aois (project_id, aoi, pole_count)
    VALUES ($1, ST_GeogFromText($3), 100), ($2, ST_GeogFromText($4), 100)`,
    [LAWLEY, POP1, `SRID=4326;${LAWLEY_AOI}`, `SRID=4326;${POP1_AOI}`]);
  await pool.query(`
    INSERT INTO vehicle_assignments
      (id, staff_id, fleet_vehicle_id, vehicle_registration, assignment_start, is_active)
    VALUES (gen_random_uuid(), $1, $2, 'EMN890GP', DATE '2026-01-01', TRUE)`,
    [STAFF, VEHICLE]);
}

beforeAll(async () => {
  pool = new Pool({ connectionString: BASE_URL });
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await pool.query(`CREATE SCHEMA ${SCHEMA}`);
  await pool.query(`SET search_path = ${SCHEMA}, public`);
  await pool.end();
  pool = new Pool({ connectionString: SCOPED_URL });
  await pool.query(PREREQUISITES);
  await pool.query(FORWARD);
  await seed();
  // db-pool binds DATABASE_URL at import time, hence the dynamic import.
  const repository = await import('@/modules/fleet/assignments/inference/proposalRepository');
  recordDecision = repository.recordDecision;
  InferenceDecisionErrorClass = repository.InferenceDecisionError;
}, 120_000);

afterAll(async () => {
  await pool.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await pool.end();
});

beforeEach(async () => {
  await pool.query('DELETE FROM fleet_site_inference_decisions');
  await pool.query('DELETE FROM fleet_site_inference_evidence');
  await pool.query('DELETE FROM fleet_vehicle_positions');
});

async function insertEvidence(overrides: Record<string, unknown> = {}): Promise<void> {
  const row = {
    vehicle_id: VEHICLE,
    outcome: 'confident',
    inferred_project_id: LAWLEY,
    dominant_share: 0.85,
    pings: 1000,
    dwell_seconds: 50_000,
    distinct_days: 20,
    total_positions: 1200,
    ...overrides,
  };
  await pool.query(`
    INSERT INTO fleet_site_inference_evidence (
      vehicle_id, outcome, inferred_project_id, dominant_share, pings, dwell_seconds,
      distinct_days, total_positions, window_start, window_end, breakdown
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
              now() - interval '35 days', now(), '[]'::jsonb)
    ON CONFLICT (vehicle_id) DO UPDATE SET
      outcome = EXCLUDED.outcome,
      inferred_project_id = EXCLUDED.inferred_project_id,
      dominant_share = EXCLUDED.dominant_share,
      computed_at = now()`,
    [row.vehicle_id, row.outcome, row.inferred_project_id, row.dominant_share,
      row.pings, row.dwell_seconds, row.distinct_days, row.total_positions]);
}

async function insertDecision(
  decision: string, projectId: string | null, from: string | null, user = USER_A,
): Promise<void> {
  await pool.query(`
    INSERT INTO fleet_site_inference_decisions
      (vehicle_id, decision, decided_project_id, decided_from, decided_by)
    VALUES ($1, $2, $3, $4, $5)`, [VEHICLE, decision, projectId, from, user]);
}

describe('522_fleet_site_inference: schema invariants', () => {
  it('registers itself and rolls back cleanly', async () => {
    const applied = await pool.query(
      `SELECT 1 FROM schema_migrations WHERE filename = '522_fleet_site_inference.sql'`);
    expect(applied.rowCount).toBe(1);

    await pool.query(ROLLBACK);
    const gone = await pool.query(
      `SELECT to_regclass('${SCHEMA}.fleet_site_inference_evidence') AS t,
              to_regclass('${SCHEMA}.fleet_site_inference_proposals') AS v`);
    expect(gone.rows[0].t).toBeNull();
    expect(gone.rows[0].v).toBeNull();

    await pool.query(FORWARD);
    await pool.query('DELETE FROM fleet_site_inference_evidence');
  });

  it('stays re-runnable over a previous version of its own view', async () => {
    // CREATE OR REPLACE VIEW only permits APPENDING columns. A column added in
    // the middle of the select list makes the file fail against an older view
    // with 42P16 - which nobody would notice while 522 is still unapplied.
    await pool.query(FORWARD);
    await pool.query(FORWARD);
    const columns = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = 'fleet_site_inference_proposals'
      ORDER BY ordinal_position DESC LIMIT 1`, [SCHEMA]);
    expect(columns.rows[0].column_name).toBe('decision_revision');
  });

  it('refuses a roaming row that still names a project', async () => {
    await expect(insertEvidence({ outcome: 'roaming' })).rejects.toMatchObject({ code: '23514' });
  });

  it('refuses a confident row with no project', async () => {
    await expect(insertEvidence({ inferred_project_id: null }))
      .rejects.toMatchObject({ code: '23514' });
  });

  it('refuses a share outside 0..1', async () => {
    await expect(insertEvidence({ dominant_share: 1.5 }))
      .rejects.toMatchObject({ code: '23514' });
  });

  it('refuses an assigned decision with no project, and a roaming_confirmed with one', async () => {
    await insertEvidence();
    await expect(insertDecision('assigned', null, 'inference'))
      .rejects.toMatchObject({ code: '23514' });
    await expect(insertDecision('roaming_confirmed', LAWLEY, null))
      .rejects.toMatchObject({ code: '23514' });
  });

  it('refuses an applied stamp on a decision that is not assigned', async () => {
    await insertEvidence();
    await insertDecision('rejected', null, null);
    await expect(pool.query(`
      UPDATE fleet_site_inference_decisions
      SET applied_assignment_id = gen_random_uuid(), applied_at = now(), applied_by = $1`,
      [USER_A])).rejects.toMatchObject({ code: '23514' });
  });
});

describe('522_fleet_site_inference: the human override cannot be overwritten', () => {
  it('leaves the decision untouched when the evidence is recomputed to something else', async () => {
    await insertEvidence({ outcome: 'confident', inferred_project_id: LAWLEY });
    // A human disagrees with the machine and picks POP 1.
    await insertDecision('assigned', POP1, 'override');

    // The recompute now says the vehicle roams. This is the write the inference
    // service actually issues.
    await insertEvidence({ outcome: 'roaming', inferred_project_id: null, dominant_share: 0.4 });

    const view = await pool.query(
      `SELECT * FROM fleet_site_inference_proposals WHERE vehicle_id = $1`, [VEHICLE]);
    expect(view.rows[0].outcome).toBe('roaming');
    expect(view.rows[0].inferred_project_id).toBeNull();
    // The human's answer survived, and stays the effective one.
    expect(view.rows[0].decided_project_id).toBe(POP1);
    expect(view.rows[0].effective_project_id).toBe(POP1);
    expect(view.rows[0].decision_matches_inference).toBe(false);
  });

  it('keeps the human project effective when the machine still names a different one', async () => {
    // The sibling case above lands on effective_project_id = POP1 whichever way
    // the COALESCE is written, because the recompute nulls the inferred project.
    // This one is the discriminating case: BOTH sides are non-null and differ,
    // so it fails if the view ever prefers the machine.
    await insertEvidence({ outcome: 'confident', inferred_project_id: LAWLEY });
    await insertDecision('assigned', POP1, 'override');
    await insertEvidence({ outcome: 'confident', inferred_project_id: LAWLEY });

    const view = await pool.query(
      `SELECT inferred_project_id, decided_project_id, effective_project_id,
              decision_matches_inference
       FROM fleet_site_inference_proposals WHERE vehicle_id = $1`, [VEHICLE]);
    expect(view.rows[0].inferred_project_id).toBe(LAWLEY);
    expect(view.rows[0].decided_project_id).toBe(POP1);
    expect(view.rows[0].effective_project_id).toBe(POP1);
    expect(view.rows[0].decision_matches_inference).toBe(false);
  });

  it('reports decision_matches_inference true when the human agreed', async () => {
    await insertEvidence({ outcome: 'confident', inferred_project_id: LAWLEY });
    await insertDecision('assigned', LAWLEY, 'inference');
    const view = await pool.query(
      `SELECT decision_matches_inference, effective_project_id
       FROM fleet_site_inference_proposals WHERE vehicle_id = $1`, [VEHICLE]);
    expect(view.rows[0].decision_matches_inference).toBe(true);
    expect(view.rows[0].effective_project_id).toBe(LAWLEY);
  });

  it('reports decision_matches_inference NULL when the decision names no project', async () => {
    // Both sides null used to read as `true` - "the human agreed" - when in
    // fact there was nothing to agree about.
    await insertEvidence({ outcome: 'roaming', inferred_project_id: null, dominant_share: 0.4 });
    await insertDecision('roaming_confirmed', null, null);
    const view = await pool.query(
      `SELECT decision_matches_inference FROM fleet_site_inference_proposals
       WHERE vehicle_id = $1`, [VEHICLE]);
    expect(view.rows[0].decision_matches_inference).toBeNull();
  });

  it('reports false when the human named a project and the machine named none', async () => {
    await insertEvidence({ outcome: 'roaming', inferred_project_id: null, dominant_share: 0.4 });
    await insertDecision('assigned', LAWLEY, 'override');
    const view = await pool.query(
      `SELECT decision_matches_inference FROM fleet_site_inference_proposals
       WHERE vehicle_id = $1`, [VEHICLE]);
    expect(view.rows[0].decision_matches_inference).toBe(false);
  });

  it('has no column on the evidence table for a decision to be written into', async () => {
    // This is the actual guard: the recompute cannot clobber the decision
    // because the table it writes to has nowhere to put one. If someone later
    // merges the two tables, this fails.
    const columns = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = 'fleet_site_inference_evidence'`, [SCHEMA]);
    const names = columns.rows.map((row) => row.column_name);
    for (const forbidden of ['decision', 'decided_project_id', 'decided_by', 'decided_from']) {
      expect(names).not.toContain(forbidden);
    }
  });

  it('rejects a change to what was decided that does not re-stamp who decided it', async () => {
    await insertEvidence();
    await insertDecision('assigned', LAWLEY, 'inference');

    // Exactly what a background job would do: change the answer, leave the
    // provenance alone.
    await expect(pool.query(`
      UPDATE fleet_site_inference_decisions SET decided_project_id = $1 WHERE vehicle_id = $2`,
      [POP1, VEHICLE])).rejects.toMatchObject({ code: '23514' });

    const still = await pool.query(
      `SELECT decided_project_id FROM fleet_site_inference_decisions WHERE vehicle_id = $1`,
      [VEHICLE]);
    expect(still.rows[0].decided_project_id).toBe(LAWLEY);
  });

  it('allows the same change when a human is named for it', async () => {
    await insertEvidence();
    await insertDecision('assigned', LAWLEY, 'inference');
    await pool.query(`
      UPDATE fleet_site_inference_decisions
      SET decided_project_id = $1, decided_by = $2, decided_at = now()
      WHERE vehicle_id = $3`, [POP1, USER_B, VEHICLE]);
    const row = await pool.query(
      `SELECT decided_project_id, decided_by FROM fleet_site_inference_decisions
       WHERE vehicle_id = $1`, [VEHICLE]);
    expect(row.rows[0].decided_project_id).toBe(POP1);
    expect(row.rows[0].decided_by).toBe(USER_B);
  });

  it('lets a non-decision column be touched without re-stamping', async () => {
    // markApplied/clearApplied must not be caught by the guard.
    await insertEvidence();
    await insertDecision('assigned', LAWLEY, 'inference');
    await pool.query(`INSERT INTO fleet_operational_assignments (id) VALUES ($1)`, [USER_B]);
    await expect(pool.query(`
      UPDATE fleet_site_inference_decisions
      SET applied_assignment_id = $1, applied_at = now(), applied_by = $2
      WHERE vehicle_id = $3`, [USER_B, USER_A, VEHICLE])).resolves.toBeTruthy();
  });
});

describe('522_fleet_site_inference: the view surfaces the driver', () => {
  it('joins the driver on fleet_vehicle_id and shows the divergent registration', async () => {
    await insertEvidence();
    const view = await pool.query(
      `SELECT registration, drivers FROM fleet_site_inference_proposals WHERE vehicle_id = $1`,
      [VEHICLE]);
    expect(view.rows[0].registration).toBe('MW67LZGP');
    expect(view.rows[0].drivers).toHaveLength(1);
    expect(view.rows[0].drivers[0].staffName).toBe('Byron Viviers');
    // Joining on the registration string would have dropped this row entirely.
    expect(view.rows[0].drivers[0].assignmentRegistration).toBe('EMN890GP');
  });

  it('returns an empty driver list rather than a null for a vehicle with no driver', async () => {
    await insertEvidence({ vehicle_id: VEHICLE_B, outcome: 'no_aoi_coverage',
      inferred_project_id: null, dominant_share: null });
    const view = await pool.query(
      `SELECT drivers FROM fleet_site_inference_proposals WHERE vehicle_id = $1`, [VEHICLE_B]);
    expect(view.rows[0].drivers).toEqual([]);
  });
});

describe('522_fleet_site_inference: an applied decision cannot be quietly rewritten', () => {
  const assigned = (projectId: string, expectedRevision: number | null = null): DecisionInput => ({
    decision: 'assigned', decidedProjectId: projectId, decidedFrom: 'override',
    evidenceComputedAt: null, note: null, expectedRevision,
  });

  async function currentRevision(): Promise<number> {
    const row = await pool.query(
      `SELECT revision FROM fleet_site_inference_decisions WHERE vehicle_id = $1`, [VEHICLE]);
    return row.rows[0].revision as number;
  }

  it('lets a decision be changed by someone working from the row they read', async () => {
    await insertEvidence();
    await recordDecision(VEHICLE, assigned(LAWLEY), USER_A);
    await recordDecision(VEHICLE, assigned(POP1, await currentRevision()), USER_B);
    const row = await pool.query(
      `SELECT decided_project_id, decided_by FROM fleet_site_inference_decisions
       WHERE vehicle_id = $1`, [VEHICLE]);
    expect(row.rows[0].decided_project_id).toBe(POP1);
    expect(row.rows[0].decided_by).toBe(USER_B);
  });

  it('refuses a write from someone who read the row before it last changed', async () => {
    await insertEvidence();
    await recordDecision(VEHICLE, assigned(LAWLEY), USER_A);
    const stale = await currentRevision();
    // A third person decides in between. Both people believe they are editing
    // the same row; only one of them is. A clock-based token cannot tell these
    // two writes apart when they land in the same millisecond; a counter can.
    await recordDecision(VEHICLE, assigned(POP1, stale), USER_B);

    const error = await recordDecision(VEHICLE, assigned(LAWLEY, stale), USER_A)
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(InferenceDecisionErrorClass);
    expect(error.code).toBe('stale_decision');

    const row = await pool.query(
      `SELECT decided_project_id, decided_by FROM fleet_site_inference_decisions
       WHERE vehicle_id = $1`, [VEHICLE]);
    expect(row.rows[0].decided_project_id).toBe(POP1);
    expect(row.rows[0].decided_by).toBe(USER_B);
  });

  it('increments the revision on every accepted change', async () => {
    await insertEvidence();
    await recordDecision(VEHICLE, assigned(LAWLEY), USER_A);
    expect(await currentRevision()).toBe(1);
    await recordDecision(VEHICLE, assigned(POP1, 1), USER_B);
    expect(await currentRevision()).toBe(2);
    await recordDecision(VEHICLE, assigned(LAWLEY, 2), USER_A);
    expect(await currentRevision()).toBe(3);
  });

  it('refuses a write that claims no decision exists when one does', async () => {
    await insertEvidence();
    await recordDecision(VEHICLE, assigned(LAWLEY), USER_A);
    const error = await recordDecision(VEHICLE, assigned(POP1, null), USER_B)
      .catch((caught) => caught);
    expect(error.code).toBe('stale_decision');
    const row = await pool.query(
      `SELECT decided_project_id FROM fleet_site_inference_decisions WHERE vehicle_id = $1`,
      [VEHICLE]);
    expect(row.rows[0].decided_project_id).toBe(LAWLEY);
  });

  it('refuses to change a decision that is already on the roster, and changes nothing', async () => {
    await insertEvidence();
    await recordDecision(VEHICLE, assigned(LAWLEY), USER_A);
    const revision = await currentRevision();
    const assignmentId = '52200000-0000-0000-0000-0000000000e1';
    await pool.query(`INSERT INTO fleet_operational_assignments (id) VALUES ($1)`, [assignmentId]);
    await pool.query(`
      UPDATE fleet_site_inference_decisions
      SET applied_assignment_id = $1, applied_at = now(), applied_by = $2
      WHERE vehicle_id = $3`, [assignmentId, USER_A, VEHICLE]);

    const error = await recordDecision(VEHICLE, assigned(POP1, revision), USER_B)
      .catch((caught) => caught);
    expect(error).toBeInstanceOf(InferenceDecisionErrorClass);
    expect(error.code).toBe('already_applied');

    // The roster entry still has a decision pointing at it.
    const row = await pool.query(
      `SELECT decided_project_id, applied_assignment_id FROM fleet_site_inference_decisions
       WHERE vehicle_id = $1`, [VEHICLE]);
    expect(row.rows[0].decided_project_id).toBe(LAWLEY);
    expect(row.rows[0].applied_assignment_id).toBe(assignmentId);
  });
});
