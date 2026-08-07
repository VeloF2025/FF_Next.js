# Fleet Parking Compliance — PR 3 (Fleet Web) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the fleet side the two screens the first two PRs assume exist — an approval queue that turns a driver's `pending` address into an `active` one, and a compliance dashboard that shows what the nightly job decided and why.

**Architecture:** Two pages under the existing Fleet nav, each backed by a thin API route gated with `withAuth(withPermission(...))` on the permission keys migration 483 already seeds. The approval decision is one transaction in a query module: supersede the current `active` row and promote the `pending` row, with the driver's vehicle assignment re-validated at decision time. The dashboard reads `fleet_parking_compliance_checks` and shows the fix that decided each outcome.

**Tech Stack:** TypeScript, Next.js 14.2 Pages Router, `pg` via `@/lib/db-pool`, Vitest, Tailwind, `lucide-react`, `notify()` from the notification bus.

**Spec:** `docs/superpowers/specs/2026-08-04-fleet-parking-compliance-design.md` §6.1 (lifecycle), §9, §10, §11

**Depends on:** PR 1 (merged, #2370) and **PR 2 (#2389, open)**. This branches off `feat/fleet-parking-driver-pwa`, not master, because it consumes `ParkingDeclaration`/`ParkingDeclarationStatus` from PR 2's `types.ts` and `findApproverUserIds` from PR 2's `parkingApprovers.ts`. **It must merge after PR 2.**

## Global Constraints

- **Branch:** `feat/fleet-parking-approval-queue`, cut from `feat/fleet-parking-driver-pwa`. Never commit to master; PR required.
- **No credential values in any tracked file.**
- **New files < 300 lines. New components < 200 lines.** CI ratchets this.
- **No `console.log`** — use `log` from `@/lib/logger`. No empty catch blocks. Changed code fully typed.
- **Conditional tagged-template SQL fragments are broken in this repo.** Never write ``${cond ? sql`AND x` : sql``}``. Use explicit query branches — the dashboard's filters are the place this temptation appears.
- **`notify()` is fire-and-forget** and callers resolve `recipient_user_ids`.
- **A query module that a `tests/migrations` test imports must not pull in `notificationBus`.** `vitest.migrations.config.ts` has a deliberately minimal alias table and `notificationBus` imports `@/lib/db-neon`, which it cannot resolve. This is what broke PR 2's first CI run; keep the decision transaction in a query module and the notification in a separate one.
- Use `apiResponse` helpers for every response.
- Run `npm run ci:quick` before the PR.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/modules/fleet/parking/types.ts` (modify) | Add `PendingRequest`, `ComplianceRow`, `DecisionOutcome` |
| `src/modules/fleet/parking/approvalQueries.ts` (create) | Pending list + the approve/reject transaction |
| `src/modules/fleet/parking/complianceQueries.ts` (create) | Dashboard reads over `fleet_parking_compliance_checks` |
| `src/modules/fleet/parking/decisionNotifications.ts` (create) | `fleet.parking_change_decided` to the requesting driver |
| `pages/api/fleet/parking/requests.ts` (create) | `GET` pending queue |
| `pages/api/fleet/parking/requests/[requestId]/decide.ts` (create) | `POST` approve/reject |
| `pages/api/fleet/parking/compliance.ts` (create) | `GET` dashboard rows |
| `pages/fleet/parking/requests.tsx` (create) | Approval queue page |
| `pages/fleet/parking/index.tsx` (create) | Compliance dashboard page |
| `src/modules/fleet/parking/web/RequestCard.tsx` (create) | One pending request + decide actions |
| `src/modules/fleet/parking/web/ComplianceTable.tsx` (create) | Result rows + evidence drill-in |
| `src/components/fleet/fleetNavConfig.ts` (modify) | Two entries under Operations + `getActiveTabId` |
| `src/components/fleet/__tests__/fleetNavConfig.test.ts` (modify) | Cover both new routes |
| `tests/migrations/483_fleet_parking_approval.test.ts` (create) | The decision transaction against real Postgres |

---

### Task 1: Types for the fleet side

**Files:**
- Modify: `src/modules/fleet/parking/types.ts`

**Interfaces:**
- Produces: `PendingRequest`, `ComplianceRow`, `DecisionOutcome`, `DecisionInput`

- [ ] **Step 1: Append the types**

Add to `src/modules/fleet/parking/types.ts`, below the driver-side block PR 2 added:

```typescript
/* -------------------------------------------------------------------------
 * Fleet side (web). The approval queue and the compliance dashboard.
 * ---------------------------------------------------------------------- */

/** A pending request, with everything an approver needs to judge it. */
export interface PendingRequest {
  id: string;
  vehicleId: string;
  registration: string;
  driverStaffId: string;
  driverName: string | null;
  /** The address being requested. */
  requested: {
    lat: number;
    lon: number;
    accuracyM: number | null;
    label: string | null;
    addressText: string | null;
  };
  /** The address in force today, or null when this is a first declaration. */
  current: {
    lat: number;
    lon: number;
    label: string | null;
    addressText: string | null;
  } | null;
  /** Metres between current and requested. Null when there is no current. */
  moveDistanceM: number | null;
  requestNote: string | null;
  createdAt: string;
}

/** One night's verdict for one vehicle, with the evidence behind it. */
export interface ComplianceRow {
  id: string;
  vehicleId: string | null;
  registration: string;
  checkDate: string;
  result: ParkingCheckResult;
  distanceM: number | null;
  lastFixAt: string | null;
  lastFixLat: number | null;
  lastFixLon: number | null;
  lastFixAgeSeconds: number | null;
  /** The declared address this was judged against, when there was one. */
  addressLabel: string | null;
}

export type DecisionOutcome = 'approved' | 'rejected';

export interface DecisionInput {
  requestId: string;
  outcome: DecisionOutcome;
  decidedByUserId: string;
  decidedByStaffId: string | null;
  decisionNote: string | null;
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep parking || echo clean`
Expected: `clean`.

- [ ] **Step 3: Commit**

```bash
git add src/modules/fleet/parking/types.ts
git commit -m "feat(fleet): types for the parking approval queue and dashboard"
```

---

### Task 2: The approval transaction

This is the task with the real risk in it. Approving must supersede exactly one previous row and promote exactly one pending row, atomically, and it must not resurrect an address for a driver who no longer holds the vehicle (spec §11).

**Files:**
- Create: `src/modules/fleet/parking/approvalQueries.ts`
- Test: `src/modules/fleet/parking/__tests__/approvalQueries.test.ts`

**Interfaces:**
- Consumes: `pool` and `sql` from `@/lib/db-pool`; `haversineDistanceM` from `@/lib/geo`; types from `./types`
- Produces:
  - `loadPendingRequests(): Promise<PendingRequest[]>`
  - `decideRequest(input: DecisionInput): Promise<{ ok: true; vehicleId: string; registration: string; driverStaffId: string } | { ok: false; reason: 'not_found' | 'not_pending' | 'assignment_ended' }>`

- [ ] **Step 1: Write the failing test**

Create `src/modules/fleet/parking/__tests__/approvalQueries.test.ts`. These cover mapping and the branch logic; the transaction itself is covered against real Postgres in Task 8.

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
const connectMock = vi.fn();
vi.mock('@/lib/db-pool', () => ({
  sql: (...a: unknown[]) => sqlMock(...a),
  pool: { connect: (...a: unknown[]) => connectMock(...a) },
}));

import { loadPendingRequests } from '../approvalQueries';

beforeEach(() => {
  sqlMock.mockReset();
  connectMock.mockReset();
});

const ROW = {
  id: 'req-1',
  vehicle_id: 'veh-1',
  registration: 'LN40MGGP',
  driver_staff_id: 'staff-1',
  driver_name: 'Thabo M',
  req_lat: '-26.2041000',
  req_lon: '28.0473000',
  req_accuracy_m: '12',
  req_label: 'My yard',
  req_address_text: 'Braamfontein',
  cur_lat: null,
  cur_lon: null,
  cur_label: null,
  cur_address_text: null,
  request_note: null,
  created_at: '2026-08-06T10:00:00.000Z',
};

describe('loadPendingRequests', () => {
  it('parses the requested address as numbers', async () => {
    sqlMock.mockResolvedValue([ROW]);
    const [req] = await loadPendingRequests();
    expect(req!.requested).toMatchObject({ lat: -26.2041, lon: 28.0473, accuracyM: 12 });
  });

  // A first declaration has no current address; the UI must not render a
  // move distance of 0, which reads as "did not move".
  it('reports a null current address and a null move distance for a first declaration', async () => {
    sqlMock.mockResolvedValue([ROW]);
    const [req] = await loadPendingRequests();
    expect(req!.current).toBeNull();
    expect(req!.moveDistanceM).toBeNull();
  });

  it('computes the move distance when an address is already in force', async () => {
    sqlMock.mockResolvedValue([
      { ...ROW, cur_lat: '-26.2041000', cur_lon: '28.0473000', cur_label: 'Old yard' },
    ]);
    const [req] = await loadPendingRequests();
    expect(req!.current).toMatchObject({ lat: -26.2041, lon: 28.0473 });
    expect(req!.moveDistanceM).toBe(0);
  });

  it('rounds the move distance to whole metres', async () => {
    // ~111m north at this latitude.
    sqlMock.mockResolvedValue([{ ...ROW, cur_lat: '-26.2051000', cur_lon: '28.0473000' }]);
    const [req] = await loadPendingRequests();
    expect(Number.isInteger(req!.moveDistanceM)).toBe(true);
    expect(req!.moveDistanceM).toBeGreaterThan(80);
    expect(req!.moveDistanceM).toBeLessThan(140);
  });

  it('returns an empty list when nothing is pending', async () => {
    sqlMock.mockResolvedValue([]);
    expect(await loadPendingRequests()).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/modules/fleet/parking/__tests__/approvalQueries.test.ts`
Expected: FAIL — cannot resolve `../approvalQueries`.

- [ ] **Step 3: Write the implementation**

Create `src/modules/fleet/parking/approvalQueries.ts`:

```typescript
/**
 * The approval queue's reads, and the one write that matters.
 *
 * Imports nothing but the pool and the geo helpers: the real-Postgres test in
 * tests/migrations runs under an alias table that cannot resolve
 * notificationBus. Telling the driver lives in decisionNotifications.ts.
 */
import { pool, sql } from '@/lib/db-pool';
import { haversineDistanceM } from '@/lib/geo';
import type { DecisionInput, PendingRequest } from './types';

interface PendingRow extends Record<string, unknown> {
  id: string;
  vehicle_id: string;
  registration: string;
  driver_staff_id: string;
  driver_name: string | null;
  req_lat: string;
  req_lon: string;
  req_accuracy_m: string | null;
  req_label: string | null;
  req_address_text: string | null;
  cur_lat: string | null;
  cur_lon: string | null;
  cur_label: string | null;
  cur_address_text: string | null;
  request_note: string | null;
  created_at: string | Date;
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : value;
}

export async function loadPendingRequests(): Promise<PendingRequest[]> {
  const rows = await sql<PendingRow>`
    SELECT
      p.id,
      p.vehicle_id,
      v.registration,
      p.declared_by_staff_id AS driver_staff_id,
      s.full_name            AS driver_name,
      p.lat::text            AS req_lat,
      p.lon::text            AS req_lon,
      p.accuracy_m::text     AS req_accuracy_m,
      p.label                AS req_label,
      p.address_text         AS req_address_text,
      cur.lat::text          AS cur_lat,
      cur.lon::text          AS cur_lon,
      cur.label              AS cur_label,
      cur.address_text       AS cur_address_text,
      p.request_note,
      p.created_at
    FROM fleet_vehicle_parking_locations p
    JOIN fleet_vehicles v ON v.id = p.vehicle_id
    LEFT JOIN staff s ON s.id = p.declared_by_staff_id
    LEFT JOIN fleet_vehicle_parking_locations cur
      ON cur.vehicle_id = p.vehicle_id AND cur.status = 'active'
    WHERE p.status = 'pending'
    ORDER BY p.created_at ASC
  `;

  return rows.map((r) => {
    const requested = {
      lat: Number(r.req_lat),
      lon: Number(r.req_lon),
      accuracyM: r.req_accuracy_m === null ? null : Number(r.req_accuracy_m),
      label: r.req_label,
      addressText: r.req_address_text,
    };
    const current =
      r.cur_lat === null || r.cur_lon === null
        ? null
        : {
            lat: Number(r.cur_lat),
            lon: Number(r.cur_lon),
            label: r.cur_label,
            addressText: r.cur_address_text,
          };
    return {
      id: r.id,
      vehicleId: r.vehicle_id,
      registration: r.registration,
      driverStaffId: r.driver_staff_id,
      driverName: r.driver_name,
      requested,
      current,
      // Null, not 0, when there is nothing to move from — a 0 here reads as
      // "the driver did not move the address", which is a different claim.
      moveDistanceM:
        current === null
          ? null
          : Math.round(
              haversineDistanceM(
                { lat: current.lat, lon: current.lon },
                { lat: requested.lat, lon: requested.lon }
              )
            ),
      requestNote: r.request_note,
      createdAt: toIso(r.created_at),
    };
  });
}

export type DecisionResult =
  | { ok: true; vehicleId: string; registration: string; driverStaffId: string }
  | { ok: false; reason: 'not_found' | 'not_pending' | 'assignment_ended' };

/**
 * Approve or reject one request.
 *
 * Approval is two writes that must not be separable: the row in force becomes
 * `superseded`, and this row becomes `active`. Half of that leaves either two
 * active rows (which ux_parking_active_per_vehicle refuses, aborting the
 * request) or none (which silently turns every future check into
 * `no_address`). So both run on one pinned connection inside one transaction.
 *
 * The row is re-read FOR UPDATE inside the transaction rather than trusted
 * from the list the approver was looking at, which may be minutes old: two
 * approvers on the same request would otherwise both promote it.
 *
 * Spec §11 requires the driver's assignment to be re-validated here. A request
 * from someone who has since handed the vehicle over is refused rather than
 * applied — approving it would attach an address to a vehicle on the say-so of
 * someone no longer responsible for it.
 */
export async function decideRequest(input: DecisionInput): Promise<DecisionResult> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows: found } = await client.query<{
      id: string;
      vehicle_id: string;
      status: string;
      declared_by_staff_id: string;
      registration: string;
    }>(
      `SELECT p.id, p.vehicle_id, p.status, p.declared_by_staff_id, v.registration
         FROM fleet_vehicle_parking_locations p
         JOIN fleet_vehicles v ON v.id = p.vehicle_id
        WHERE p.id = $1
          FOR UPDATE OF p`,
      [input.requestId]
    );

    const request = found[0];
    if (!request) {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'not_found' };
    }
    if (request.status !== 'pending') {
      await client.query('ROLLBACK');
      return { ok: false, reason: 'not_pending' };
    }

    if (input.outcome === 'approved') {
      const { rows: stillAssigned } = await client.query<{ ok: boolean }>(
        `SELECT true AS ok
           FROM vehicle_assignments va
          WHERE va.staff_id = $1
            AND va.vehicle_registration = $2
            AND va.is_active = true
          LIMIT 1`,
        [request.declared_by_staff_id, request.registration]
      );
      if (!stillAssigned[0]) {
        await client.query('ROLLBACK');
        return { ok: false, reason: 'assignment_ended' };
      }

      await client.query(
        `UPDATE fleet_vehicle_parking_locations
            SET status = 'superseded', superseded_at = now(), updated_at = now()
          WHERE vehicle_id = $1 AND status = 'active'`,
        [request.vehicle_id]
      );
      await client.query(
        `UPDATE fleet_vehicle_parking_locations
            SET status = 'active', effective_from = now(),
                decided_by = $2, decided_at = now(),
                decision_note = $3, updated_at = now()
          WHERE id = $1`,
        [input.requestId, input.decidedByStaffId, input.decisionNote]
      );
    } else {
      await client.query(
        `UPDATE fleet_vehicle_parking_locations
            SET status = 'rejected', decided_by = $2, decided_at = now(),
                decision_note = $3, updated_at = now()
          WHERE id = $1`,
        [input.requestId, input.decidedByStaffId, input.decisionNote]
      );
    }

    await client.query('COMMIT');
    return {
      ok: true,
      vehicleId: request.vehicle_id,
      registration: request.registration,
      driverStaffId: request.declared_by_staff_id,
    };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/modules/fleet/parking/__tests__/approvalQueries.test.ts`
Expected: PASS.

- [ ] **Step 5: Confirm `haversineDistanceM`'s signature**

Run: `grep -n "export function haversineDistanceM" -A 6 src/lib/geo.ts`

It must take two `{lat, lon}` objects and return metres. If it takes four scalars instead, adjust the two call sites above; do not add a wrapper.

- [ ] **Step 6: Commit**

```bash
git add src/modules/fleet/parking/approvalQueries.ts src/modules/fleet/parking/__tests__/approvalQueries.test.ts
git commit -m "feat(fleet): approval queue reads and the decision transaction"
```

---

### Task 3: Compliance dashboard queries

**Files:**
- Create: `src/modules/fleet/parking/complianceQueries.ts`
- Test: `src/modules/fleet/parking/__tests__/complianceQueries.test.ts`

**Interfaces:**
- Consumes: `sql` from `@/lib/db-pool`; types from `./types`
- Produces: `loadCompliance(filter: { from: string; to: string; result?: ParkingCheckResult }): Promise<ComplianceRow[]>`

- [ ] **Step 1: Write the failing test**

Create `src/modules/fleet/parking/__tests__/complianceQueries.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@/lib/db-pool', () => ({ sql: (...a: unknown[]) => sqlMock(...a) }));

import { loadCompliance } from '../complianceQueries';

const ROW = {
  id: 'chk-1',
  vehicle_id: 'veh-1',
  registration: 'LN40MGGP',
  check_date: '2026-08-06',
  result: 'violation',
  distance_m: 1420,
  last_fix_at: '2026-08-06T17:30:00.000Z',
  last_fix_lat: '-26.2100000',
  last_fix_lon: '28.0500000',
  last_fix_age_seconds: 9000,
  address_label: 'My yard',
};

beforeEach(() => {
  sqlMock.mockReset();
  sqlMock.mockResolvedValue([ROW]);
});

describe('loadCompliance', () => {
  it('parses the fix coordinates as numbers', async () => {
    const [row] = await loadCompliance({ from: '2026-08-01', to: '2026-08-07' });
    expect(row!.lastFixLat).toBe(-26.21);
    expect(row!.lastFixLon).toBe(28.05);
  });

  // Every one of these is nullable on a no_address or not_verifiable row, and
  // Number(null) is 0 — which would draw a vehicle at the equator.
  it('keeps null evidence as null', async () => {
    sqlMock.mockResolvedValue([
      {
        ...ROW,
        result: 'no_address',
        distance_m: null,
        last_fix_at: null,
        last_fix_lat: null,
        last_fix_lon: null,
        last_fix_age_seconds: null,
        address_label: null,
      },
    ]);
    const [row] = await loadCompliance({ from: '2026-08-01', to: '2026-08-07' });
    expect(row!.lastFixLat).toBeNull();
    expect(row!.lastFixLon).toBeNull();
    expect(row!.distanceM).toBeNull();
    expect(row!.lastFixAt).toBeNull();
  });

  /**
   * Conditional tagged-template fragments are broken in this repo, so the
   * result filter has to be a separate query rather than an interpolated
   * clause. Asserting on the call count is what keeps someone from "tidying"
   * the two branches back into one.
   */
  it('uses a distinct query when a result filter is supplied', async () => {
    await loadCompliance({ from: '2026-08-01', to: '2026-08-07' });
    const unfiltered = sqlMock.mock.calls[0];

    sqlMock.mockClear();
    await loadCompliance({ from: '2026-08-01', to: '2026-08-07', result: 'violation' });
    const filtered = sqlMock.mock.calls[0];

    expect(filtered).not.toEqual(unfiltered);
  });

  it('returns an empty list when the range holds no checks', async () => {
    sqlMock.mockResolvedValue([]);
    expect(await loadCompliance({ from: '2026-08-01', to: '2026-08-07' })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/modules/fleet/parking/__tests__/complianceQueries.test.ts`
Expected: FAIL — cannot resolve `../complianceQueries`.

- [ ] **Step 3: Write the implementation**

Create `src/modules/fleet/parking/complianceQueries.ts`:

```typescript
/**
 * Reads behind the compliance dashboard.
 *
 * The result filter is two whole queries rather than one with a conditional
 * fragment. That is not style: `${cond ? sql`AND x` : sql``}` is broken in this
 * codebase and silently produces wrong SQL. See CLAUDE.md.
 */
import { sql } from '@/lib/db-pool';
import type { ComplianceRow, ParkingCheckResult } from './types';

interface ComplianceQueryRow extends Record<string, unknown> {
  id: string;
  vehicle_id: string | null;
  registration: string;
  check_date: string | Date;
  result: ParkingCheckResult;
  distance_m: number | null;
  last_fix_at: string | Date | null;
  last_fix_lat: string | null;
  last_fix_lon: string | null;
  last_fix_age_seconds: number | null;
  address_label: string | null;
}

function toIso(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function mapRow(r: ComplianceQueryRow): ComplianceRow {
  return {
    id: r.id,
    vehicleId: r.vehicle_id,
    registration: r.registration,
    checkDate: typeof r.check_date === 'string' ? r.check_date : r.check_date.toISOString().slice(0, 10),
    result: r.result,
    distanceM: r.distance_m,
    lastFixAt: toIso(r.last_fix_at),
    lastFixLat: r.last_fix_lat === null ? null : Number(r.last_fix_lat),
    lastFixLon: r.last_fix_lon === null ? null : Number(r.last_fix_lon),
    lastFixAgeSeconds: r.last_fix_age_seconds,
    addressLabel: r.address_label,
  };
}

export async function loadCompliance(filter: {
  from: string;
  to: string;
  result?: ParkingCheckResult;
}): Promise<ComplianceRow[]> {
  if (filter.result) {
    const rows = await sql<ComplianceQueryRow>`
      SELECT c.id, c.vehicle_id, c.vehicle_registration AS registration,
             to_char(c.check_date, 'YYYY-MM-DD') AS check_date, c.result,
             c.distance_m, c.last_fix_at,
             c.last_fix_lat::text AS last_fix_lat,
             c.last_fix_lon::text AS last_fix_lon,
             c.last_fix_age_seconds,
             pl.label AS address_label
        FROM fleet_parking_compliance_checks c
        LEFT JOIN fleet_vehicle_parking_locations pl ON pl.id = c.parking_location_id
       WHERE c.check_date BETWEEN ${filter.from}::date AND ${filter.to}::date
         AND c.result = ${filter.result}
       ORDER BY c.check_date DESC, c.vehicle_registration ASC
       LIMIT 1000
    `;
    return rows.map(mapRow);
  }

  const rows = await sql<ComplianceQueryRow>`
    SELECT c.id, c.vehicle_id, c.vehicle_registration AS registration,
           to_char(c.check_date, 'YYYY-MM-DD') AS check_date, c.result,
           c.distance_m, c.last_fix_at,
           c.last_fix_lat::text AS last_fix_lat,
           c.last_fix_lon::text AS last_fix_lon,
           c.last_fix_age_seconds,
           pl.label AS address_label
      FROM fleet_parking_compliance_checks c
      LEFT JOIN fleet_vehicle_parking_locations pl ON pl.id = c.parking_location_id
     WHERE c.check_date BETWEEN ${filter.from}::date AND ${filter.to}::date
     ORDER BY c.check_date DESC, c.vehicle_registration ASC
     LIMIT 1000
  `;
  return rows.map(mapRow);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/modules/fleet/parking/__tests__/complianceQueries.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/fleet/parking/complianceQueries.ts src/modules/fleet/parking/__tests__/complianceQueries.test.ts
git commit -m "feat(fleet): compliance dashboard queries"
```

---

### Task 4: Telling the driver the outcome

Spec §10 makes this a deliberate exception to "no automatic contact with drivers": someone who submits a request must learn its outcome or the workflow stalls. In-app only.

**Files:**
- Create: `src/modules/fleet/parking/decisionNotifications.ts`
- Test: `src/modules/fleet/parking/__tests__/decisionNotifications.test.ts`

**Interfaces:**
- Consumes: `sql`, `log`, `notify`
- Produces: `notifyParkingChangeDecided(args: { driverStaffId: string; registration: string; outcome: DecisionOutcome; decisionNote: string | null; requestId: string }): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `src/modules/fleet/parking/__tests__/decisionNotifications.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
const notifyMock = vi.fn();
vi.mock('@/lib/db-pool', () => ({ sql: (...a: unknown[]) => sqlMock(...a) }));
vi.mock('@/modules/notifications/services/notificationBus', () => ({
  notify: (...a: unknown[]) => notifyMock(...a),
}));

import { notifyParkingChangeDecided } from '../decisionNotifications';

const ARGS = {
  driverStaffId: 'staff-1',
  registration: 'LN40MGGP',
  outcome: 'approved' as const,
  decisionNote: null,
  requestId: 'req-1',
};

beforeEach(() => {
  sqlMock.mockReset().mockResolvedValue([{ user_id: 'user-9' }]);
  notifyMock.mockReset().mockResolvedValue(undefined);
});

describe('notifyParkingChangeDecided', () => {
  it('notifies the requesting driver', async () => {
    await notifyParkingChangeDecided(ARGS);
    expect(notifyMock.mock.calls[0]![0]).toMatchObject({
      event_type: 'fleet.parking_change_decided',
      recipient_user_ids: ['user-9'],
      source_id: 'req-1',
    });
  });

  it('says which way it went', async () => {
    await notifyParkingChangeDecided({ ...ARGS, outcome: 'rejected', decisionNote: 'Too far' });
    const payload = notifyMock.mock.calls[0]![0] as { title: string; body: string };
    expect(`${payload.title} ${payload.body}`.toLowerCase()).toContain('declin');
    expect(payload.body).toContain('Too far');
  });

  /**
   * Field staff do not all have a users row — staff.user_id is nullable. The
   * bus addresses users, so there is simply nobody to notify. That is a
   * logged fact, not an error, and above all not a throw: the decision has
   * already been committed.
   */
  it('does no work when the driver has no linked user account', async () => {
    sqlMock.mockResolvedValue([{ user_id: null }]);
    await expect(notifyParkingChangeDecided(ARGS)).resolves.toBeUndefined();
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('does no work when the staff row is gone', async () => {
    sqlMock.mockResolvedValue([]);
    await notifyParkingChangeDecided(ARGS);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it('swallows a bus failure', async () => {
    notifyMock.mockRejectedValue(new Error('bus down'));
    await expect(notifyParkingChangeDecided(ARGS)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/modules/fleet/parking/__tests__/decisionNotifications.test.ts`
Expected: FAIL — cannot resolve `../decisionNotifications`.

- [ ] **Step 3: Write the implementation**

Create `src/modules/fleet/parking/decisionNotifications.ts`:

```typescript
/**
 * Telling a driver what happened to their parking request.
 *
 * Spec §10 marks this a deliberate exception to "no automatic contact with
 * drivers" — that rule was set for violations. Someone who submits a request
 * has to learn the outcome or the workflow stalls at their end.
 *
 * In-app only, per the event's registered channel defaults.
 */
import { sql } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import { notify } from '@/modules/notifications/services/notificationBus';
import type { DecisionOutcome } from './types';

export async function notifyParkingChangeDecided(args: {
  driverStaffId: string;
  registration: string;
  outcome: DecisionOutcome;
  decisionNote: string | null;
  requestId: string;
}): Promise<void> {
  try {
    // The bus addresses users; the driver is staff. staff.user_id is nullable
    // and is null for most field staff, so this legitimately finds nobody.
    const rows = await sql<{ user_id: string | null }>`
      SELECT user_id FROM staff WHERE id = ${args.driverStaffId} LIMIT 1
    `;
    const userId = rows[0]?.user_id ?? null;
    if (!userId) {
      log.info(
        '[fleet/parking] decision made but the driver has no linked user account to notify',
        { staffId: args.driverStaffId, requestId: args.requestId },
        'fleet'
      );
      return;
    }

    const approved = args.outcome === 'approved';
    const note = args.decisionNote ? ` Note: ${args.decisionNote}` : '';
    await notify({
      event_type: 'fleet.parking_change_decided',
      title: approved
        ? `Parking address approved for ${args.registration}`
        : `Parking address declined for ${args.registration}`,
      body: approved
        ? `Your overnight parking address for ${args.registration} is now in effect.${note}`
        : `Your overnight parking address request for ${args.registration} was declined.${note}`,
      action_url: '/my/vehicle/parking',
      source_module: 'fleet',
      source_id: args.requestId,
      recipient_user_ids: [userId],
    });
  } catch (err) {
    // The decision is already committed. A notification failure must not turn
    // a completed approval into a 500 the approver retries.
    log.error(
      '[fleet/parking] failed to notify the driver of a decision',
      { error: err, requestId: args.requestId },
      'fleet'
    );
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/modules/fleet/parking/__tests__/decisionNotifications.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/fleet/parking/decisionNotifications.ts src/modules/fleet/parking/__tests__/decisionNotifications.test.ts
git commit -m "feat(fleet): notify a driver when their parking request is decided"
```

---

### Task 5: API routes

**Files:**
- Create: `pages/api/fleet/parking/requests.ts`
- Create: `pages/api/fleet/parking/requests/[requestId]/decide.ts`
- Create: `pages/api/fleet/parking/compliance.ts`
- Test: `pages/api/fleet/parking/__tests__/decide.test.ts`

**Interfaces:**
- Consumes: `withAuth` and `withPermission` from `@/lib/auth/middleware`; Task 2–4 modules
- Produces:
  - `GET /api/fleet/parking/requests` → `{ requests: PendingRequest[] }`, gated `fleet.parking-requests` view
  - `POST /api/fleet/parking/requests/[requestId]/decide` `{ outcome, decisionNote? }` → `{ decided: true }`, gated `fleet.parking-requests` **edit**
  - `GET /api/fleet/parking/compliance?from=&to=&result=` → `{ rows: ComplianceRow[] }`, gated `fleet.parking` view

- [ ] **Step 1: Write the failing test for the decision route**

Only the decision route gets a test: the two GETs are a permission wrapper over a query with no branching of their own, while this one maps four outcomes onto four status codes.

Create `pages/api/fleet/parking/__tests__/decide.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

vi.mock('@/lib/auth/middleware', () => ({
  withAuth: (h: unknown) => h,
  withPermission: () => (h: unknown) => h,
}));

const decideRequest = vi.fn();
vi.mock('@/modules/fleet/parking/approvalQueries', () => ({
  decideRequest: (...a: unknown[]) => decideRequest(...a),
}));

const notifyParkingChangeDecided = vi.fn();
vi.mock('@/modules/fleet/parking/decisionNotifications', () => ({
  notifyParkingChangeDecided: (...a: unknown[]) => notifyParkingChangeDecided(...a),
}));

const resolveStaffId = vi.fn();
vi.mock('@/modules/fleet/parking/staffLookup', () => ({
  resolveStaffIdForUser: (...a: unknown[]) => resolveStaffId(...a),
}));

import handler from '../requests/[requestId]/decide';

function mockRes() {
  const res = {
    statusCode: 0,
    body: undefined as unknown,
    status(code: number) { this.statusCode = code; return this; },
    json(payload: unknown) { this.body = payload; return this; },
    setHeader() { return this; },
    end() { return this; },
  };
  return res as unknown as NextApiResponse & { statusCode: number; body: unknown };
}

function call(req: Partial<NextApiRequest>) {
  const res = mockRes();
  return Promise.resolve(
    (handler as (q: NextApiRequest, s: NextApiResponse) => unknown)(
      { user: { id: 'user-1', role: 'manager' }, ...req } as NextApiRequest,
      res
    )
  ).then(() => res);
}

const OK = { ok: true, vehicleId: 'veh-1', registration: 'LN40MGGP', driverStaffId: 'staff-1' };

beforeEach(() => {
  decideRequest.mockReset().mockResolvedValue(OK);
  notifyParkingChangeDecided.mockReset().mockResolvedValue(undefined);
  resolveStaffId.mockReset().mockResolvedValue('staff-approver');
});

describe('POST /api/fleet/parking/requests/[requestId]/decide', () => {
  it('approves and notifies the driver', async () => {
    const res = await call({
      method: 'POST',
      query: { requestId: 'req-1' },
      body: { outcome: 'approved' },
    });
    expect(res.statusCode).toBe(200);
    expect(decideRequest.mock.calls[0]![0]).toMatchObject({
      requestId: 'req-1',
      outcome: 'approved',
      decidedByUserId: 'user-1',
    });
    expect(notifyParkingChangeDecided).toHaveBeenCalledTimes(1);
  });

  it('rejects with a note', async () => {
    await call({
      method: 'POST',
      query: { requestId: 'req-1' },
      body: { outcome: 'rejected', decisionNote: 'Too far from the depot' },
    });
    expect(decideRequest.mock.calls[0]![0]).toMatchObject({
      outcome: 'rejected',
      decisionNote: 'Too far from the depot',
    });
  });

  it.each([
    ['an unknown outcome', { outcome: 'maybe' }],
    ['a missing outcome', {}],
  ])('400s on %s', async (_label, body) => {
    const res = await call({ method: 'POST', query: { requestId: 'req-1' }, body });
    expect(res.statusCode).toBe(400);
    expect(decideRequest).not.toHaveBeenCalled();
  });

  it('404s when the request does not exist', async () => {
    decideRequest.mockResolvedValue({ ok: false, reason: 'not_found' });
    const res = await call({
      method: 'POST', query: { requestId: 'nope' }, body: { outcome: 'approved' },
    });
    expect(res.statusCode).toBe(404);
    expect(notifyParkingChangeDecided).not.toHaveBeenCalled();
  });

  // Someone else got there first. That is a conflict, not a server fault.
  it('409s when the request was already decided', async () => {
    decideRequest.mockResolvedValue({ ok: false, reason: 'not_pending' });
    const res = await call({
      method: 'POST', query: { requestId: 'req-1' }, body: { outcome: 'approved' },
    });
    expect(res.statusCode).toBe(409);
  });

  it('409s when the driver no longer holds the vehicle', async () => {
    decideRequest.mockResolvedValue({ ok: false, reason: 'assignment_ended' });
    const res = await call({
      method: 'POST', query: { requestId: 'req-1' }, body: { outcome: 'approved' },
    });
    expect(res.statusCode).toBe(409);
    expect(notifyParkingChangeDecided).not.toHaveBeenCalled();
  });

  it('rejects a non-POST method', async () => {
    const res = await call({ method: 'GET', query: { requestId: 'req-1' } });
    expect(res.statusCode).toBe(405);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run pages/api/fleet/parking/__tests__/decide.test.ts`
Expected: FAIL — cannot resolve `../requests/[requestId]/decide`.

- [ ] **Step 3: Write the staff lookup helper**

The decision records `decided_by`, which is a `staff(id)` FK, while the session carries a `users.id`. Create `src/modules/fleet/parking/staffLookup.ts`:

```typescript
/**
 * users.id → staff.id, for the decided_by FK.
 *
 * decided_by references staff(id), but web sessions carry a users.id. Most
 * approvers are office users with a staff row; some are not, and a decision by
 * one of those stores a null decided_by rather than failing — the decision
 * itself matters more than the attribution, and decided_at still records that
 * it happened.
 */
import { sql } from '@/lib/db-pool';

export async function resolveStaffIdForUser(userId: string): Promise<string | null> {
  const rows = await sql<{ id: string }>`
    SELECT id FROM staff WHERE user_id = ${userId} LIMIT 1
  `;
  return rows[0]?.id ?? null;
}
```

- [ ] **Step 4: Write the decision route**

Create `pages/api/fleet/parking/requests/[requestId]/decide.ts`:

```typescript
/**
 * POST /api/fleet/parking/requests/[requestId]/decide
 *
 * Approve or reject a driver's parking address request. Gated on `edit` of
 * fleet.parking-requests, not `view`: migration 483 grants viewer no access to
 * this page at all, and manager edit-but-not-delete.
 */
import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import { decideRequest } from '@/modules/fleet/parking/approvalQueries';
import { notifyParkingChangeDecided } from '@/modules/fleet/parking/decisionNotifications';
import { resolveStaffIdForUser } from '@/modules/fleet/parking/staffLookup';
import type { DecisionOutcome } from '@/modules/fleet/parking/types';

interface AuthedRequest extends NextApiRequest {
  user?: { id: string; role: string };
}

const OUTCOMES: DecisionOutcome[] = ['approved', 'rejected'];

async function handler(req: AuthedRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }

  const userId = req.user?.id;
  if (!userId) return apiResponse.unauthorized(res, 'Authentication required');

  const requestId = req.query.requestId;
  if (typeof requestId !== 'string' || requestId.length === 0) {
    return apiResponse.badRequest(res, 'A single requestId is required');
  }

  const body = (req.body ?? {}) as { outcome?: unknown; decisionNote?: unknown };
  const outcome = body.outcome;
  if (typeof outcome !== 'string' || !OUTCOMES.includes(outcome as DecisionOutcome)) {
    return apiResponse.badRequest(res, 'outcome must be "approved" or "rejected"');
  }
  const decisionNote =
    typeof body.decisionNote === 'string' && body.decisionNote.trim().length > 0
      ? body.decisionNote.trim()
      : null;

  try {
    const result = await decideRequest({
      requestId,
      outcome: outcome as DecisionOutcome,
      decidedByUserId: userId,
      decidedByStaffId: await resolveStaffIdForUser(userId),
      decisionNote,
    });

    if (!result.ok) {
      if (result.reason === 'not_found') {
        return apiResponse.notFound(res, 'Parking request', requestId);
      }
      return apiResponse.conflict(
        res,
        result.reason === 'not_pending'
          ? 'That request has already been decided.'
          : 'That driver is no longer assigned to the vehicle, so the address cannot be approved.'
      );
    }

    // Fire-and-forget: the decision is committed, and the helper swallows and
    // logs its own failures.
    void notifyParkingChangeDecided({
      driverStaffId: result.driverStaffId,
      registration: result.registration,
      outcome: outcome as DecisionOutcome,
      decisionNote,
      requestId,
    });

    return apiResponse.success(res, { decided: true });
  } catch (err) {
    log.error('[fleet/parking] decision failed', { error: err, requestId }, 'fleet');
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(withPermission('fleet.parking-requests', 'edit')(handler));
```

- [ ] **Step 5: Write the two GET routes**

Create `pages/api/fleet/parking/requests.ts`:

```typescript
/** GET /api/fleet/parking/requests — the pending approval queue. */
import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import { loadPendingRequests } from '@/modules/fleet/parking/approvalQueries';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }
  try {
    return apiResponse.success(res, { requests: await loadPendingRequests() });
  } catch (err) {
    log.error('[fleet/parking] failed to load the approval queue', { error: err }, 'fleet');
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(withPermission('fleet.parking-requests', 'view')(handler));
```

Create `pages/api/fleet/parking/compliance.ts`:

```typescript
/**
 * GET /api/fleet/parking/compliance?from=&to=&result=
 *
 * Defaults to the last 7 days when no range is given. Dates are validated
 * strictly rather than coerced: a malformed `from` that fell through to a
 * default would quietly answer for the wrong period, which on a compliance
 * screen is worse than an error.
 */
import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import { loadCompliance } from '@/modules/fleet/parking/complianceQueries';
import type { ParkingCheckResult } from '@/modules/fleet/parking/types';

const RESULTS: ParkingCheckResult[] = [
  'compliant', 'violation', 'unknown', 'not_verifiable', 'no_address',
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True only for a real calendar date in YYYY-MM-DD. */
function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function sastToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Johannesburg' }).format(new Date());
}

function daysAgo(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  const today = sastToday();
  const rawFrom = req.query.from;
  const rawTo = req.query.to;
  const rawResult = req.query.result;

  const from = rawFrom === undefined ? daysAgo(today, 7) : rawFrom;
  const to = rawTo === undefined ? today : rawTo;
  if (typeof from !== 'string' || !isIsoDate(from) || typeof to !== 'string' || !isIsoDate(to)) {
    return apiResponse.badRequest(res, 'from and to must be YYYY-MM-DD dates');
  }
  if (from > to) {
    return apiResponse.badRequest(res, 'from must not be after to');
  }

  let result: ParkingCheckResult | undefined;
  if (rawResult !== undefined) {
    if (typeof rawResult !== 'string' || !RESULTS.includes(rawResult as ParkingCheckResult)) {
      return apiResponse.badRequest(res, `result must be one of: ${RESULTS.join(', ')}`);
    }
    result = rawResult as ParkingCheckResult;
  }

  try {
    return apiResponse.success(res, { rows: await loadCompliance({ from, to, result }) });
  } catch (err) {
    log.error('[fleet/parking] failed to load compliance rows', { error: err }, 'fleet');
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(withPermission('fleet.parking', 'view')(handler));
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run pages/api/fleet/parking/__tests__/decide.test.ts`
Expected: PASS.

- [ ] **Step 7: Verify the middleware's actual signature**

Run: `sed -n '250,290p' src/lib/auth/middleware.ts`

Confirm `withPermission(key, action)` returns a handler wrapper and that `withAuth` attaches `req.user`. If the composition order differs from the `activate/reporting/*` routes, copy those exactly rather than inventing an order.

- [ ] **Step 8: Commit**

```bash
git add pages/api/fleet/parking src/modules/fleet/parking/staffLookup.ts
git commit -m "feat(fleet): approval-queue and compliance APIs"
```

---

### Task 6: The two pages

**Files:**
- Create: `src/modules/fleet/parking/web/RequestCard.tsx`
- Create: `src/modules/fleet/parking/web/ComplianceTable.tsx`
- Create: `pages/fleet/parking/requests.tsx`
- Create: `pages/fleet/parking/index.tsx`

**Interfaces:**
- Consumes: `AppLayout` and `ModulePage` as used by `pages/fleet/locations.tsx`; `PendingRequest`, `ComplianceRow`
- Produces: the routes `/fleet/parking` and `/fleet/parking/requests`

- [ ] **Step 1: Read the page shell the module already uses**

Run: `sed -n '1,40p' pages/fleet/locations.tsx && grep -n "AppLayout\|ModulePage\|fleetConfig" pages/fleet/locations.tsx | head`

Match that shell exactly — this is the fleet module's convention, and it is what puts the FleetNav tab bar on the page. Do not introduce a different layout.

- [ ] **Step 2: Write `RequestCard.tsx`**

One pending request: registration, driver, the requested address, the current one and the distance between them, the driver's note, and Approve / Decline with an optional note. Keep it under 200 lines; it is presentational and takes `onDecide(outcome, note)` from the page.

Required behaviours, each of which is a real failure if missed:
- When `current` is null, render "First address for this vehicle" — never a distance of 0.
- Disable both buttons while a decision is in flight, so a double-tap cannot fire two POSTs.
- Show `requested.accuracyM` — an approver judging a 90 m capture should see that.

- [ ] **Step 3: Write `ComplianceTable.tsx`**

Rows of `ComplianceRow` with a coloured result chip per state, and an expandable evidence row showing `lastFixAt`, the coordinates, `distanceM` and the age in hours. The five states must stay visually distinct — the whole point of not collapsing them (spec §6.3) is that they go to different people.

- [ ] **Step 4: Write the two pages**

`pages/fleet/parking/requests.tsx` — fetch `/api/fleet/parking/requests`, render `RequestCard` per row, POST the decision, reload on success. On a 409, reload the list and show the conflict message: the queue the approver is looking at has moved on.

`pages/fleet/parking/index.tsx` — date-range and result filters, fetch `/api/fleet/parking/compliance`, render `ComplianceTable`, plus a count-per-state summary across the returned rows.

- [ ] **Step 5: Type-check and check file sizes**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i parking || echo clean`
Run: `wc -l pages/fleet/parking/*.tsx src/modules/fleet/parking/web/*.tsx`
Expected: clean; every file under 200 lines.

- [ ] **Step 6: Commit**

```bash
git add pages/fleet/parking src/modules/fleet/parking/web
git commit -m "feat(fleet): parking approval queue and compliance dashboard pages"
```

---

### Task 7: Navigation

**Files:**
- Modify: `src/components/fleet/fleetNavConfig.ts`
- Modify: `src/components/fleet/__tests__/fleetNavConfig.test.ts`

- [ ] **Step 1: Write the failing test**

Add to `src/components/fleet/__tests__/fleetNavConfig.test.ts`, inside the existing `describe('getActiveTabId')`:

```typescript
  // Both parking routes live under Operations. /fleet/parking/requests must
  // not fall through to 'dashboard' — the existing catch-all return is what
  // silently swallowed /fleet/mileage and /fleet/import before.
  it('resolves the compliance dashboard to operations', () => {
    expect(getActiveTabId('/fleet/parking', {})).toBe('operations');
  });

  it('resolves the approval queue to operations', () => {
    expect(getActiveTabId('/fleet/parking/requests', {})).toBe('operations');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/components/fleet/__tests__/fleetNavConfig.test.ts`
Expected: FAIL — both return `'dashboard'`.

- [ ] **Step 3: Add the nav entries**

In `src/components/fleet/fleetNavConfig.ts`, add a section to the `operations` tab's `items`:

```typescript
      {
        section: 'Parking',
        items: [
          { label: 'Parking Compliance', href: '/fleet/parking' },
          { label: 'Parking Requests', href: '/fleet/parking/requests' },
        ],
      },
```

Extend the `operations` branch of `getActiveTabId`:

```typescript
  // Operations — drivers, fuel, mileage, maintenance, overnight parking
  if (pathname.startsWith('/fleet/drivers') ||
      pathname.startsWith('/fleet/fuel') ||
      pathname.startsWith('/fleet/mileage') ||
      pathname.startsWith('/fleet/maintenance') ||
      pathname.startsWith('/fleet/parking')) {
    return 'operations';
  }
```

Add both routes to the header comment's route table, which the file maintains as documentation.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/components/fleet/__tests__/fleetNavConfig.test.ts`
Expected: PASS, including the existing "every href resolves" test which now covers both new entries.

- [ ] **Step 5: Commit**

```bash
git add src/components/fleet/fleetNavConfig.ts src/components/fleet/__tests__/fleetNavConfig.test.ts
git commit -m "feat(fleet): put both parking screens under the Operations tab"
```

---

### Task 8: The decision transaction against real Postgres

The unit tests mock the pool out, so the transaction — the part that can leave a vehicle with two active addresses or none — is unparsed and unexecuted by anything. This is the same gap PR 1 and PR 2 each closed with a `tests/migrations` file.

**Files:**
- Create: `tests/migrations/483_fleet_parking_approval.test.ts`

**Interfaces:**
- Consumes: `@/modules/fleet/parking/approvalQueries` — which must import nothing beyond `@/lib/db-pool` and `@/lib/geo`, or it will not resolve under `vitest.migrations.config.ts`

- [ ] **Step 1: Check the alias table can resolve `@/lib/geo`**

Run: `grep -n "@/lib" vitest.migrations.config.ts`

`@/lib/geo` is not in that table and the generic `@/lib` fallback points at `./lib`, where only `logger` lives. Confirm whether `src/lib/geo.ts` resolves; if it does not, add one alias entry for it, following the file's own instruction to add entries only when a test genuinely needs them:

```typescript
      { find: '@/lib/geo', replacement: path.resolve(__dirname, './src/lib/geo') },
```

- [ ] **Step 2: Write the test**

Copy the harness from `tests/migrations/483_fleet_parking_driver_queries.test.ts` verbatim — the scratch schema, the two pools, the prerequisite tables, the dynamic import in `beforeAll` — changing `SCHEMA` to `mig483_approval_scratch`. Then cover exactly what the transaction decides:

```typescript
describe('decideRequest — approval', () => {
  it('promotes the pending row and supersedes the one in force, atomically', async () => {
    // seed: one active row, one pending row, driver still assigned
    const result = await queries.decideRequest({
      requestId: PENDING_ID, outcome: 'approved',
      decidedByUserId: 'irrelevant', decidedByStaffId: STAFF, decisionNote: null,
    });

    expect(result.ok).toBe(true);
    const { rows } = await db.query(
      `SELECT id, status FROM fleet_vehicle_parking_locations WHERE vehicle_id = $1`,
      [VEHICLE]
    );
    const byId = Object.fromEntries(rows.map((r) => [r.id, r.status]));
    expect(byId[PENDING_ID]).toBe('active');
    expect(byId[ACTIVE_ID]).toBe('superseded');
    // The partial unique index would have aborted the transaction if both
    // ended active; asserting the count proves it did not merely survive.
    expect(rows.filter((r) => r.status === 'active')).toHaveLength(1);
  });

  it('stamps effective_from, decided_by and decided_at on the promoted row', async () => { /* … */ });

  it('approves a first declaration when there is no row in force', async () => { /* … */ });

  // Spec §11. The list an approver is looking at can be minutes old.
  it('refuses to approve when the driver no longer holds the vehicle', async () => {
    // seed: assignment is_active = false
    const result = await queries.decideRequest({ /* … */ outcome: 'approved' });
    expect(result).toEqual({ ok: false, reason: 'assignment_ended' });
    // and nothing moved
  });

  it('leaves the pending row untouched when the assignment check refuses it', async () => { /* … */ });
});

describe('decideRequest — rejection', () => {
  it('marks the row rejected with the note and leaves the active row in force', async () => { /* … */ });

  // A rejection is not an assignment question: the driver may already be gone,
  // and the request still needs closing out.
  it('rejects even when the assignment has ended', async () => { /* … */ });
});

describe('decideRequest — races', () => {
  it('reports not_pending on the second decision of the same request', async () => { /* … */ });

  it('reports not_found for an id that does not exist', async () => { /* … */ });
});
```

Fill every `/* … */` with real seeding and assertions — a placeholder here is a test that passes by doing nothing.

- [ ] **Step 3: Add the file to the unit-run exclude list**

`vitest.config.ts` excludes this family because each throws at module load without `TEST_DATABASE_URL`. Add:

```typescript
      'tests/migrations/483_fleet_parking_approval.test.ts',
```

**Do not** add it to `vitest.migrations.config.ts`'s exclude list — that is the config CI runs it under, and excluding it there is what would make this test silently never run.

- [ ] **Step 4: Verify the import closure resolves under the migrations aliases**

This is the check that would have caught PR 2's CI failure locally. Write a throwaway config at the repo root mirroring `vitest.migrations.config.ts`'s alias table with no `globalSetup`, and a throwaway test that dynamically imports `@/modules/fleet/parking/approvalQueries`; run it, confirm it passes, then delete both files.

Run: `npx vitest run --config ./vitest.resolve-check.tmp.ts`
Expected: PASS. A "Failed to load url … /lib/…" here means the module pulled in something the alias table cannot reach — fix by moving that dependency out of the closure, not by growing the alias table.

- [ ] **Step 5: Commit**

```bash
git add tests/migrations/483_fleet_parking_approval.test.ts vitest.config.ts vitest.migrations.config.ts
git commit -m "test(fleet): exercise the approval transaction against real Postgres"
```

---

### Task 9: Docs, CI, and the PR

- [ ] **Step 1: Update the module reference**

In `.claude/modules/fleet.md`, change the parking heading to "(mig 483, PRs 1–3)", add the fleet-web files to the table, and replace the "Not built yet (PR 3)" paragraph with the real rules:

- Approval is one transaction; a partial application leaves a vehicle with two active addresses or none.
- The decision re-validates the driver's assignment; a request from someone who has handed the vehicle over is refused, not applied.
- `decided_by` is a `staff(id)` FK while the session carries `users.id` — hence `resolveStaffIdForUser`, and a null when the approver has no staff row.
- `fleet.parking-requests` is gated on `edit` for deciding, `view` for reading the queue.

Add the two new routes to `src/modules/fleet/.claude.md` (keep it inside its ≤50-line target).

- [ ] **Step 2: Mirror the agent docs**

Run: `npm run agents:mirror && npm run agents:check`

Then check `git status`: the mirror rewrites every `AGENTS.md` on this workstation because of line endings. Stage **only** `src/modules/fleet/AGENTS.md`; leave the rest unstaged.

- [ ] **Step 3: Run the full suite and CI**

Run: `npx vitest run src/modules/fleet/parking pages/api/fleet/parking pages/api/my/vehicle src/components/fleet`
Expected: PASS, including every PR 1 and PR 2 test.

Run: `npm run ci:quick`
Expected: ESLint 0 errors and **no new warnings** — the budget was exactly at its ceiling after PR 2, so any new warning fails the gate. Fix warnings rather than raising the baseline.

- [ ] **Step 4: Open the PR against the PR 2 branch**

```bash
git push -u origin feat/fleet-parking-approval-queue
gh pr create --base feat/fleet-parking-driver-pwa --title "feat(fleet): overnight parking compliance — PR 3 of 3 (fleet web)" --body "..."
```

`--base` matters: opened against master this diff would include all of PR 2's commits and be unreviewable. Retarget to master once PR 2 merges.

**Stop at "PR opened".** Do not merge and do not deploy.

- [ ] **Step 5: State the verification gaps in the PR body**

- `tests/migrations/483_fleet_parking_approval.test.ts` runs under CI's migration suite; report what CI actually said about it rather than assuming.
- Browser verification of both screens is required (spec §12) and cannot be done from this workstation.
- After this merges, the ops items from PR 2 still stand: migration 483 applied, and the 20:00 crontab entry registered.

---

## Self-Review

**Spec coverage (§9, §10, §11):**

| Spec requirement | Task |
|---|---|
| Approval queue: vehicle, driver, current vs requested, distance, note | Tasks 2, 6 |
| Approve or reject with a note | Tasks 2, 5, 6 |
| Approval supersedes previous and promotes pending, in one transaction | Task 2 |
| Re-validate the vehicle assignment at approval time (§11) | Task 2 |
| Authorization via `fleet.parking` / `fleet.parking-requests` | Task 5 |
| Compliance dashboard: last night per vehicle across five states | Tasks 3, 6 |
| History filterable by date range and result | Tasks 3, 5, 6 |
| Drill-in showing the deciding fix (timestamp, coords, distance, age) | Tasks 3, 6 |
| Both screens under the Operations tab; `getActiveTabId` + its test | Task 7 |
| `fleet.parking_change_decided` to the requesting driver, in-app | Task 4 |
| No empty catch blocks; `log` from `@/lib/logger` | Tasks 2, 4, 5 |

**Type consistency:** `PendingRequest` / `ComplianceRow` / `DecisionOutcome` / `DecisionInput` defined in Task 1 and consumed unchanged in Tasks 2–6. `decideRequest` returns the discriminated `DecisionResult` from Task 2; Task 5 branches on exactly its three `reason` values. `resolveStaffIdForUser` is defined in Task 5 Step 3 and mocked under that path in Task 5's test.

**Carried forward from PR 2's CI failure:** the constraint that a `tests/migrations` import closure must not reach `notificationBus` appears in Global Constraints, is the reason Task 4 is a separate module from Task 2, and is checked explicitly in Task 8 Step 4.

**Deliberately out of scope**, per spec §13: daytime project geofencing, the dead `/fleet/locations` geofence screen, the parked-reads-as-stale behaviour on the live map, and a retention policy for `fleet_vehicle_positions`.
