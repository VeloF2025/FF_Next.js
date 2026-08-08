/**
 * The approval transaction, executed against a real Postgres.
 *
 * src/modules/fleet/parking/__tests__/approvalQueries.test.ts mocks the pool
 * out — correctly, it tests the mapping — which leaves `decideRequest`
 * completely unexecuted. That function is two UPDATEs that must both land or
 * neither: half of it leaves a vehicle with two active addresses (which
 * ux_parking_active_per_vehicle refuses) or with none, which silently turns
 * every future nightly check into `no_address`. Nothing short of a real
 * database proves it.
 *
 * SAFETY / ISOLATION: scratch schema, same as the sibling 483 files — these
 * run in one shared container and a sibling test drops role_permissions from
 * public partway through the suite.
 */

if (!process.env.TEST_DATABASE_URL) {
  throw new Error(
    'Integration test needs TEST_DATABASE_URL set (real DB connection string). ' +
      'See .env.local.example.'
  );
}

const SCHEMA = 'mig483_approval_scratch';
const BASE_URL = process.env.TEST_DATABASE_URL;
const SCOPED_URL = `${BASE_URL}${BASE_URL.includes('?') ? '&' : '?'}options=${encodeURIComponent(
  `-c search_path=${SCHEMA}`
)}`;
// Read by src/lib/db.ts when the module below is imported, which is why that
// import is dynamic and happens in beforeAll.
process.env.DATABASE_URL = SCOPED_URL;

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { Pool } from 'pg';
import { readFileSync } from 'fs';
import { join } from 'path';

const SQL_DIR = join(process.cwd(), 'scripts/migrations/sql');
const FORWARD = readFileSync(join(SQL_DIR, '483_fleet_parking_compliance.sql'), 'utf8');

const VEHICLE = '44444444-4444-4444-4444-444444444444';
const DRIVER = '33333333-3333-3333-3333-333333333333';
const APPROVER = '66666666-6666-6666-6666-666666666666';
const REGISTRATION = 'MW67LFGP';

const PREREQUISITES = `
  CREATE TABLE schema_migrations (filename TEXT PRIMARY KEY);
  -- Mirrors the REAL staff table: production has first_name/last_name/name
  -- and NO full_name. Inventing a column here is what let a 500 reach
  -- production — the query passed against a schema that does not exist.
  CREATE TABLE staff (id UUID PRIMARY KEY, name TEXT NOT NULL);
  CREATE TABLE access_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type VARCHAR(20) NOT NULL, key VARCHAR(100) UNIQUE NOT NULL,
    parent_key VARCHAR(100), label VARCHAR(100) NOT NULL, description TEXT,
    route VARCHAR(200), sort_order INTEGER DEFAULT 0, is_active BOOLEAN DEFAULT TRUE
  );
  CREATE TABLE role_permissions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    role VARCHAR(50) NOT NULL,
    permission_key VARCHAR(100) NOT NULL REFERENCES access_permissions(key) ON DELETE CASCADE,
    actions JSONB NOT NULL, UNIQUE (role, permission_key)
  );
  CREATE TABLE fleet_vehicles (
    id UUID PRIMARY KEY, registration VARCHAR(20) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'active'
  );
  CREATE TABLE vehicle_assignments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    staff_id UUID NOT NULL REFERENCES staff(id),
    vehicle_registration VARCHAR(20) NOT NULL,
    assignment_start TIMESTAMPTZ NOT NULL DEFAULT now(),
    is_active BOOLEAN NOT NULL DEFAULT true
  );
  INSERT INTO staff (id, name) VALUES
    ('${DRIVER}', 'Test Driver'), ('${APPROVER}', 'Test Approver');
  INSERT INTO fleet_vehicles (id, registration) VALUES ('${VEHICLE}', '${REGISTRATION}');
`;

/** Creates and drops the schema; must not be scoped to it. */
const admin = new Pool({ connectionString: BASE_URL, ssl: false, max: 1 });
/** Same view of the database the application pool gets. */
const db = new Pool({ connectionString: SCOPED_URL, ssl: false, max: 2 });

type Queries = typeof import('@/modules/fleet/parking/approvalQueries');
let queries: Queries;

/**
 * `$6::text` in BOTH places is load-bearing. Used bare, the same parameter is
 * deduced as `character varying` from the status column and as `text` from the
 * CASE comparison, and Postgres refuses with 42P08 "inconsistent types deduced
 * for parameter $6". Every test that seeds a row dies on it.
 */
async function insertLocation(
  status: 'pending' | 'active',
  over: { lat?: number; lon?: number; label?: string } = {}
): Promise<string> {
  const { rows } = await db.query<{ id: string }>(
    `INSERT INTO fleet_vehicle_parking_locations
       (vehicle_id, declared_by_staff_id, lat, lon, accuracy_m, label, status, effective_from)
     VALUES ($1, $2, $3, $4, 12, $5, $6::text,
             CASE WHEN $6::text = 'active' THEN now() ELSE NULL END)
     RETURNING id`,
    [VEHICLE, DRIVER, over.lat ?? -26.1929, over.lon ?? 28.0305, over.label ?? null, status]
  );
  return rows[0]!.id;
}

async function assign(isActive = true): Promise<void> {
  await db.query(
    `INSERT INTO vehicle_assignments (staff_id, vehicle_registration, is_active)
     VALUES ($1, $2, $3)`,
    [DRIVER, REGISTRATION, isActive]
  );
}

async function statuses(): Promise<Record<string, string>> {
  const { rows } = await db.query<{ id: string; status: string }>(
    `SELECT id, status FROM fleet_vehicle_parking_locations WHERE vehicle_id = $1`,
    [VEHICLE]
  );
  return Object.fromEntries(rows.map((r) => [r.id, r.status]));
}

function input(requestId: string, outcome: 'approved' | 'rejected', note: string | null = null) {
  return {
    requestId,
    outcome,
    decidedByUserId: 'irrelevant-here',
    decidedByStaffId: APPROVER,
    decisionNote: note,
  };
}

beforeAll(async () => {
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await db.query(PREREQUISITES);
  await db.query(FORWARD);
  queries = await import('@/modules/fleet/parking/approvalQueries');
});

afterAll(async () => {
  const { pool: appPool } = await import('@/lib/db-pool');
  await appPool.end();
  await db.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.end();
});

beforeEach(async () => {
  await db.query(`DELETE FROM fleet_vehicle_parking_locations`);
  await db.query(`DELETE FROM vehicle_assignments`);
});

describe('decideRequest — approval', () => {
  it('promotes the pending row and supersedes the one in force', async () => {
    await assign();
    const activeId = await insertLocation('active', { label: 'Old yard' });
    const pendingId = await insertLocation('pending', { label: 'New yard' });

    const result = await queries.decideRequest(input(pendingId, 'approved'));

    expect(result).toMatchObject({ ok: true, vehicleId: VEHICLE, registration: REGISTRATION });
    const byId = await statuses();
    expect(byId[pendingId]).toBe('active');
    expect(byId[activeId]).toBe('superseded');
    // The partial unique index would have aborted the transaction if both
    // ended active; counting proves it did not merely survive by luck.
    expect(Object.values(byId).filter((s) => s === 'active')).toHaveLength(1);
  });

  it('stamps effective_from, decided_by, decided_at and superseded_at', async () => {
    await assign();
    const activeId = await insertLocation('active');
    const pendingId = await insertLocation('pending');

    await queries.decideRequest(input(pendingId, 'approved', 'Fine by me'));

    const { rows } = await db.query<{
      id: string;
      effective_from: Date | null;
      decided_by: string | null;
      decided_at: Date | null;
      superseded_at: Date | null;
      decision_note: string | null;
    }>(
      `SELECT id, effective_from, decided_by, decided_at, superseded_at, decision_note
         FROM fleet_vehicle_parking_locations WHERE vehicle_id = $1`,
      [VEHICLE]
    );
    const promoted = rows.find((r) => r.id === pendingId)!;
    const superseded = rows.find((r) => r.id === activeId)!;

    expect(promoted.effective_from).not.toBeNull();
    expect(promoted.decided_by).toBe(APPROVER);
    expect(promoted.decided_at).not.toBeNull();
    expect(promoted.decision_note).toBe('Fine by me');
    expect(superseded.superseded_at).not.toBeNull();
  });

  it('approves a first declaration when nothing is in force', async () => {
    await assign();
    const pendingId = await insertLocation('pending');

    const result = await queries.decideRequest(input(pendingId, 'approved'));

    expect(result.ok).toBe(true);
    expect((await statuses())[pendingId]).toBe('active');
  });

  /**
   * Spec §11. The queue an approver is looking at can be minutes old, and a
   * vehicle can change hands in that window. Approving then would attach an
   * address on the say-so of someone no longer responsible for the vehicle.
   */
  it('refuses to approve when the driver no longer holds the vehicle', async () => {
    await assign(false);
    const pendingId = await insertLocation('pending');

    const result = await queries.decideRequest(input(pendingId, 'approved'));

    expect(result).toEqual({ ok: false, reason: 'assignment_ended' });
  });

  it('leaves everything untouched when the assignment check refuses it', async () => {
    await assign(false);
    const activeId = await insertLocation('active');
    const pendingId = await insertLocation('pending');

    await queries.decideRequest(input(pendingId, 'approved'));

    const byId = await statuses();
    expect(byId[pendingId]).toBe('pending');
    expect(byId[activeId]).toBe('active');
  });

  it('refuses when the driver has no assignment row at all', async () => {
    const pendingId = await insertLocation('pending');
    expect(await queries.decideRequest(input(pendingId, 'approved'))).toEqual({
      ok: false,
      reason: 'assignment_ended',
    });
  });
});

describe('decideRequest — rejection', () => {
  it('marks the row rejected with the note and leaves the active row in force', async () => {
    await assign();
    const activeId = await insertLocation('active');
    const pendingId = await insertLocation('pending');

    const result = await queries.decideRequest(
      input(pendingId, 'rejected', 'Too far from the depot')
    );

    expect(result.ok).toBe(true);
    const byId = await statuses();
    expect(byId[pendingId]).toBe('rejected');
    expect(byId[activeId]).toBe('active');

    const { rows } = await db.query<{ decision_note: string | null }>(
      `SELECT decision_note FROM fleet_vehicle_parking_locations WHERE id = $1`,
      [pendingId]
    );
    expect(rows[0]!.decision_note).toBe('Too far from the depot');
  });

  // A rejection is not an assignment question: the driver may already be gone,
  // and the request still needs closing out rather than sitting pending forever.
  it('rejects even when the assignment has ended', async () => {
    await assign(false);
    const pendingId = await insertLocation('pending');

    const result = await queries.decideRequest(input(pendingId, 'rejected', 'No longer relevant'));

    expect(result.ok).toBe(true);
    expect((await statuses())[pendingId]).toBe('rejected');
  });
});

describe('decideRequest — races and bad input', () => {
  it('reports not_pending on a second decision of the same request', async () => {
    await assign();
    const pendingId = await insertLocation('pending');
    await queries.decideRequest(input(pendingId, 'approved'));

    expect(await queries.decideRequest(input(pendingId, 'approved'))).toEqual({
      ok: false,
      reason: 'not_pending',
    });
  });

  it('reports not_found for an id that does not exist', async () => {
    expect(
      await queries.decideRequest(input('11111111-1111-1111-1111-111111111111', 'approved'))
    ).toEqual({ ok: false, reason: 'not_found' });
  });

  // The withdraw path in PR 2 sets 'withdrawn'; approving one afterwards would
  // resurrect an address the driver deliberately pulled.
  it('refuses to decide a withdrawn request', async () => {
    await assign();
    const pendingId = await insertLocation('pending');
    await db.query(
      `UPDATE fleet_vehicle_parking_locations SET status = 'withdrawn' WHERE id = $1`,
      [pendingId]
    );

    expect(await queries.decideRequest(input(pendingId, 'approved'))).toEqual({
      ok: false,
      reason: 'not_pending',
    });
  });
});

describe('loadPendingRequests', () => {
  it('returns the pending row with the current address and the move distance', async () => {
    await assign();
    await insertLocation('active', { lat: -26.1929, lon: 28.0305, label: 'Old yard' });
    const pendingId = await insertLocation('pending', {
      lat: -26.2029,
      lon: 28.0305,
      label: 'New yard',
    });

    const requests = await queries.loadPendingRequests();

    expect(requests).toHaveLength(1);
    expect(requests[0]!.id).toBe(pendingId);
    expect(requests[0]!.registration).toBe(REGISTRATION);
    expect(requests[0]!.driverName).toBe('Test Driver');
    expect(requests[0]!.current).not.toBeNull();
    // ~1.1km south.
    expect(requests[0]!.moveDistanceM).toBeGreaterThan(900);
    expect(requests[0]!.moveDistanceM).toBeLessThan(1300);
  });

  it('reports a null current and null distance for a first declaration', async () => {
    await assign();
    await insertLocation('pending');

    const [request] = await queries.loadPendingRequests();

    expect(request!.current).toBeNull();
    expect(request!.moveDistanceM).toBeNull();
  });

  it('ignores decided rows', async () => {
    await assign();
    await insertLocation('active');
    expect(await queries.loadPendingRequests()).toEqual([]);
  });
});

describe('separation of duties', () => {
  it('refuses a decision by the person who declared it', async () => {
    // The exploit this closes: holding fleet.parking-requests:edit and holding
    // a company vehicle are not mutually exclusive. In production today two
    // people are in exactly that position, one a super_admin. Without this
    // guard they could declare their own overnight parking and approve it.
    //
    // Exercised against the REAL decideRequest and a real Postgres, not a
    // mocked route: mocking decideRequest would only prove the route maps the
    // reason to a 403, which is true even with the guard deleted.
    await assign();
    const pendingId = await insertLocation('pending');
    expect(
      await queries.decideRequest({ ...input(pendingId, 'approved'), decidedByStaffId: DRIVER })
    ).toEqual({ ok: false, reason: 'self_decision' });

    // and it must still be pending afterwards — refused, not silently consumed
    expect((await statuses())[pendingId]).toBe('pending');
  });

  it('refuses a self-REJECTION too, not just a self-approval', async () => {
    // Quietly closing your own violation is the same failure of separation as
    // approving it.
    await assign();
    const pendingId = await insertLocation('pending');
    expect(
      await queries.decideRequest({
        ...input(pendingId, 'rejected', 'never mind'),
        decidedByStaffId: DRIVER,
      })
    ).toEqual({ ok: false, reason: 'self_decision' });
  });

  it('still allows a DIFFERENT approver to decide', async () => {
    // Guard must not block the normal path.
    await assign();
    const pendingId = await insertLocation('pending');
    const result = await queries.decideRequest(input(pendingId, 'approved'));
    expect(result.ok).toBe(true);
  });
});

describe('concurrency — overlapping decisions', () => {
  it('lets exactly one of two overlapping decisions win', async () => {
    // What this DOES prove: two decisions started before either finishes
    // produce exactly one winner and never two active rows for a vehicle.
    //
    // What it does NOT prove, stated plainly so nobody reads more into it:
    // that `FOR UPDATE OF p` is what produces that. Deleting the lock leaves
    // this test green — the ux_parking_active_per_vehicle unique index already
    // refuses a second active row, so the invariant holds either way. Writing
    // a test that genuinely fails without the lock needs forced interleaving
    // (advisory lock or a paused transaction), which is flaky in CI.
    //
    // The lock is still correct and worth keeping: it converts a constraint
    // violation (a 500) into a clean `not_pending` (a 409). That difference is
    // what this test's assertion on the loser's reason actually pins.
    await assign();
    const pendingId = await insertLocation('pending');

    const [a, b] = await Promise.all([
      queries.decideRequest(input(pendingId, 'approved')),
      queries.decideRequest(input(pendingId, 'approved')),
    ]);

    // Exactly one wins; the other is refused, never both.
    const outcomes = [a.ok, b.ok].sort();
    expect(outcomes).toEqual([false, true]);
    const loser = a.ok ? b : a;
    expect(loser).toEqual({ ok: false, reason: 'not_pending' });

    // And the invariant that matters: never two active rows for one vehicle.
    const { rows } = await db.query<{ n: string }>(
      `SELECT count(*) AS n FROM fleet_vehicle_parking_locations
        WHERE vehicle_id = $1 AND status = 'active'`,
      [VEHICLE]
    );
    expect(Number(rows[0]!.n)).toBe(1);
  });
});
