# Fleet Live Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put Velocity's 7 Cartrack-tracked vehicles on a live, self-refreshing map in the fleet module, fed by a provider-blind position store that later accepts Netstar and Ituran without redesign.

**Architecture:** A scheduled poller asks each provider "where are the cars since X", a per-provider adapter normalises the answer, and every position lands in one table. Everything downstream of that table is provider-blind. See `docs/superpowers/specs/2026-07-15-fleet-live-tracking-design.md`.

**Tech Stack:** Next.js Pages Router · TypeScript · PostgreSQL (self-hosted Supabase) via `pg.Pool` · Vitest · react-leaflet · system cron on Velocity

**Scope:** Phases 0–3 of the design. Phases 4–8 (geofence CRUD, alerts, trips, behaviour digests, POI) are **not planned here** — see "Why this plan stops at Phase 3".

## Global Constraints

Copied verbatim from CLAUDE.md and the design. Every task inherits these.

- **Never commit to master.** All work on `feat/fleet-live-tracking`. All changes via PR.
- **No `console.log`** — use `log` from `@/lib/logger`.
- **No empty catch blocks.** 100% type coverage. **Files <300 lines, components <200 lines.**
- **Never commit credentials.** Real values live only in `.claude/credentials.local.md` (gitignored).
- **Database:** use `pg.Pool` via `@/lib/db-pool` (`sql` tagged template, `query`, `queryOne`, `transaction`). **Never** `lib/db/pool.js` / the Neon shim — conditional SQL through it is broken.
- **Migrations must live in `scripts/migrations/sql/`.** The runner scans nowhere else. Every migration needs a matching `rollback_<n>_*.sql`.
- **API responses:** `import { apiResponse } from '@/lib/apiResponse'` → `apiResponse.success(res, data)`, `.badRequest()`, `.unauthorized()`, `.methodNotAllowed()`, `.internalError()`.
- **Timezone:** South Africa is UTC+02:00 year-round, no DST. **Cartrack query timestamps are SAST, not UTC.**
- **DGTS:** no tautological tests, no mocks pretending to be implementations.
- **Run `npm run ci:quick` before every PR.** Never `--no-verify`.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/services/tracking/cartrack/client.ts` | *(modify)* Fix `cartrackTsFormat` to emit SAST |
| `scripts/migrations/sql/441_fleet_live_tracking.sql` | *(create)* Trackers, positions, watermarks; trips `vehicle_id`; drop `cartrack_vehicle_id` |
| `scripts/migrations/sql/rollback_441_fleet_live_tracking.sql` | *(create)* Reverse of 441 |
| `src/services/tracking/trackerQueries.ts` | *(create)* Read/write `fleet_vehicle_trackers` |
| `src/services/attendance/cartrackReconcileQueries.ts` | *(modify)* Join trackers table instead of the dropped column |
| `pages/api/staff/attendance-cartrack-mapping.ts` | *(modify)* Write to trackers table |
| `src/services/tracking/types.ts` | *(create)* `TrackingProvider`, `ProviderPosition` |
| `src/services/tracking/cartrack/provider.ts` | *(create)* Cartrack `TrackingProvider` impl |
| `src/services/tracking/ingest.ts` | *(create)* Idempotent position ingest + watermark |
| `pages/api/cron/poll-tracking.ts` | *(create)* Cron entry point |
| `pages/api/fleet/positions/live.ts` | *(create)* Last-known position per vehicle |
| `src/modules/fleet/components/FleetMap.tsx` | *(create)* Leaflet map (client-only) |
| `pages/fleet/map.tsx` | *(create)* Page shell, dynamic import, polling |

---

## Task 1: Fix the Cartrack timezone bug — both directions

Ships first and alone. It is a live-system correctness bug independent of everything else here.

**There are two defects, one on each side of the wire.** Both must be fixed together: fixing only
the request side leaves `fetchPositionAt` still returning `no_data` for every call, which is worse
than not fixing it — it would look fixed.

| Side | Defect | Effect |
|---|---|---|
| **Request** | `cartrackTsFormat` sends UTC; Cartrack reads SAST | Window is 2h in the past |
| **Response** | `toSample` cannot parse Cartrack's `+02` offset | **Every sample dropped** |

The response defect is the nastier one, verified on the live wire (`'2026-07-15 12:30:03+02'`):
1. `TZ_SUFFIX_RE = /(?:[Zz]|[+-]\d{2}:?\d{2})$/` requires a **four-digit** offset, so it does not
   match `+02`. The code concludes there is no timezone and appends `Z`.
2. That yields `'2026-07-15T12:30:03+02Z'` → `new Date(...)` → **Invalid Date** → `toSample`
   returns `null` → the sample is silently discarded.

And even with the regex fixed, `new Date('2026-07-15T12:30:03+02')` is *still* Invalid Date — V8
will not parse a bare two-digit offset. It must be expanded to `+02:00`.

**Files:**
- Modify: `src/services/tracking/cartrack/client.ts` (`cartrackTsFormat` ~line 383; `TZ_SUFFIX_RE` and `toSample` ~line 396-417)
- Test: `src/services/tracking/cartrack/__tests__/client.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `cartrackTsFormat(d: Date): string` — SAST wall-clock, e.g. `'2026-07-15 10:00:00'` for `2026-07-15T08:00:00Z`
  - `toSample` — now parses `+02`, `+02:00`, `+0200`, `Z`, and bare (assumed UTC)

- [ ] **Step 1: Write the failing test**

Add to `src/services/tracking/cartrack/__tests__/client.test.ts`. Import `cartrackTsFormat` (export it from `client.ts` if it is not already exported).

```ts
describe('cartrackTsFormat', () => {
  // Verified live 2026-07-15: sending UTC returned events 2h stale; sending
  // SAST returned current events. Cartrack reads these as South African time.
  it('formats as SAST wall-clock, not UTC', () => {
    expect(cartrackTsFormat(new Date('2026-07-15T08:00:00Z'))).toBe('2026-07-15 10:00:00');
  });

  it('rolls the date over when SAST crosses midnight', () => {
    expect(cartrackTsFormat(new Date('2026-07-15T22:30:00Z'))).toBe('2026-07-16 00:30:00');
  });

  it('pads single digits', () => {
    expect(cartrackTsFormat(new Date('2026-01-05T01:02:03Z'))).toBe('2026-01-05 03:02:03');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/services/tracking/cartrack/__tests__/client.test.ts -t cartrackTsFormat`
Expected: FAIL — receives `'2026-07-15 08:00:00'`, expected `'2026-07-15 10:00:00'`.

- [ ] **Step 3: Implement the fix**

Replace `cartrackTsFormat` in `src/services/tracking/cartrack/client.ts`:

```ts
/**
 * Cartrack expects `YYYY-MM-DD hh:mm:ss` in **South African local time**.
 *
 * Verified live 2026-07-15 by querying both ways against the same account:
 *   - sent UTC numbers  → returned events 2h stale
 *   - sent SAST numbers → returned current events
 * The published docs describe these as UTC. They are wrong.
 *
 * SA has no DST, so the offset is a constant +02:00 and a fixed shift is
 * correct year-round. Do not "simplify" this back to getUTC*.
 */
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;

export function cartrackTsFormat(d: Date): string {
  const sast = new Date(d.getTime() + SAST_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${sast.getUTCFullYear()}-${pad(sast.getUTCMonth() + 1)}-${pad(sast.getUTCDate())} ` +
    `${pad(sast.getUTCHours())}:${pad(sast.getUTCMinutes())}:${pad(sast.getUTCSeconds())}`
  );
}
```

Note: we shift the instant then read it with `getUTC*`. Reading with local getters would depend on the server's timezone, which is not guaranteed to be SAST.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/services/tracking/cartrack/__tests__/client.test.ts -t cartrackTsFormat`
Expected: PASS (3 tests).

- [ ] **Step 5: Write the failing test for the RESPONSE side**

Add to the same test file. The `event_ts` values below are the **real wire format**, copied from a
live response on 2026-07-15 — do not "tidy" them into `+02:00`.

```ts
describe('toSample timestamp parsing', () => {
  // Live wire format is a TWO-digit offset: '2026-07-15 12:30:03+02'.
  // The old TZ_SUFFIX_RE wanted four digits, missed it, appended 'Z', and
  // produced Invalid Date — silently dropping every sample.
  it('parses Cartrack real two-digit offset', () => {
    expect(parseSampleTs('2026-07-15 12:30:03+02')?.toISOString())
      .toBe('2026-07-15T10:30:03.000Z');
  });

  it('parses a colon offset', () => {
    expect(parseSampleTs('2026-07-15 12:30:03+02:00')?.toISOString())
      .toBe('2026-07-15T10:30:03.000Z');
  });

  it('parses a compact four-digit offset', () => {
    expect(parseSampleTs('2026-07-15 12:30:03+0200')?.toISOString())
      .toBe('2026-07-15T10:30:03.000Z');
  });

  it('parses explicit Z', () => {
    expect(parseSampleTs('2026-07-15 12:30:03Z')?.toISOString())
      .toBe('2026-07-15T12:30:03.000Z');
  });

  it('treats a bare timestamp as UTC', () => {
    expect(parseSampleTs('2026-07-15 12:30:03')?.toISOString())
      .toBe('2026-07-15T12:30:03.000Z');
  });

  it('parses a negative bare offset', () => {
    expect(parseSampleTs('2026-07-15 12:30:03-05')?.toISOString())
      .toBe('2026-07-15T17:30:03.000Z');
  });

  it('returns null for junk rather than an Invalid Date', () => {
    expect(parseSampleTs('not a timestamp')).toBeNull();
  });
});
```

Export a small pure `parseSampleTs(raw: string): Date | null` from `client.ts` and have `toSample`
call it — the parsing is what needs testing, not the whole sample builder.

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run src/services/tracking/cartrack/__tests__/client.test.ts -t "toSample timestamp"`
Expected: FAIL — `parseSampleTs` is not exported/defined.

- [ ] **Step 7: Implement the response-side fix**

In `src/services/tracking/cartrack/client.ts`, replace `TZ_SUFFIX_RE` and the parsing inside
`toSample`:

```ts
/**
 * Detects an explicit timezone suffix. Cartrack's SA tenant emits a
 * TWO-digit offset (`+02`), so the minutes group must be optional — a
 * `\d{2}:?\d{2}` pattern misses it entirely and the caller then wrongly
 * appends 'Z'.
 */
const TZ_SUFFIX_RE = /(?:[Zz]|[+-]\d{2}(?::?\d{2})?)$/;
/** Matches a bare hour-only offset like `+02` / `-05` at the very end. */
const BARE_HOUR_OFFSET_RE = /([+-]\d{2})$/;

/**
 * Parse a Cartrack timestamp to a Date, or null if unparseable.
 *
 * Verified against the live wire format 2026-07-15: `'2026-07-15 12:30:03+02'`.
 * V8 cannot parse a bare two-digit offset — `new Date('...T12:30:03+02')` is
 * Invalid Date — so it is expanded to `+02:00` first.
 */
export function parseSampleTs(raw: string): Date | null {
  if (!raw) return null;
  let iso = raw.replace(' ', 'T');
  if (!TZ_SUFFIX_RE.test(iso)) {
    iso += 'Z'; // no zone stated — documented as UTC
  } else {
    iso = iso.replace(BARE_HOUR_OFFSET_RE, '$1:00');
  }
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}
```

Then in `toSample`, replace the inline normalisation with:

```ts
  const ts = parseSampleTs(raw.event_ts);
  if (!ts) return null;
```

Keep the existing guard that returns null when `latitude`/`longitude` are null.

- [ ] **Step 8: Run the response-side tests**

Run: `npx vitest run src/services/tracking/cartrack/__tests__/client.test.ts -t "toSample timestamp"`
Expected: PASS (7 tests).

- [ ] **Step 9: Run the whole cartrack suite for regressions**

Run: `npx vitest run src/services/tracking/cartrack/`
Expected: PASS. If a test asserted the old UTC behaviour, it encoded the bug — update it and note why in the commit.

- [ ] **Step 10: Commit**

```bash
git add src/services/tracking/cartrack/client.ts src/services/tracking/cartrack/__tests__/client.test.ts
git commit -m "fix(tracking): Cartrack timezone handling, both directions

Two defects, one on each side of the wire. Either alone makes
fetchPositionAt return no_data for every call.

Request side: cartrackTsFormat sent UTC; Cartrack reads South African
local time. Verified live — sending UTC returns events 2h stale, sending
SAST returns current ones. The published docs say UTC and are wrong.

Response side: the SA tenant emits a TWO-digit offset ('...12:30:03+02').
TZ_SUFFIX_RE required four digits, so it read the offset as absent and
appended 'Z', yielding '...12:30:03+02Z' -> Invalid Date -> every sample
silently discarded. V8 also cannot parse a bare '+02' at all, so the
offset is now expanded to '+02:00' before parsing."
```

---

## Task 2: Schema — trackers, positions, watermarks

**Files:**
- Create: `scripts/migrations/sql/441_fleet_live_tracking.sql`
- Create: `scripts/migrations/sql/rollback_441_fleet_live_tracking.sql`

**Interfaces:**
- Produces: tables `fleet_vehicle_trackers`, `fleet_vehicle_positions`, `fleet_tracking_watermarks`; column `fleet_gps_trips.vehicle_id`; **drops** `fleet_vehicles.cartrack_vehicle_id`

- [ ] **Step 1: Write the migration**

Create `scripts/migrations/sql/441_fleet_live_tracking.sql`:

```sql
-- 441: Fleet live tracking — provider-blind position store.
-- Design: docs/superpowers/specs/2026-07-15-fleet-live-tracking-design.md

BEGIN;

CREATE TABLE IF NOT EXISTS fleet_vehicle_trackers (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id  UUID NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
  provider    VARCHAR(20) NOT NULL CHECK (provider IN ('cartrack','netstar','ituran')),
  account_ref VARCHAR(50) NOT NULL,
  external_id VARCHAR(64) NOT NULL CHECK (btrim(external_id) <> ''),
  is_active   BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON TABLE fleet_vehicle_trackers IS
  'Single source of truth for which tracker reports for which vehicle. Replaces fleet_vehicles.cartrack_vehicle_id.';
COMMENT ON COLUMN fleet_vehicle_trackers.account_ref IS
  'Which tenant/account on the provider. Credentials live in .claude/credentials.local.md, never here.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_fleet_trackers_identity
  ON fleet_vehicle_trackers (provider, account_ref, external_id);
CREATE UNIQUE INDEX IF NOT EXISTS uq_fleet_trackers_one_active_per_vehicle
  ON fleet_vehicle_trackers (vehicle_id) WHERE is_active;

CREATE TABLE IF NOT EXISTS fleet_vehicle_positions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id        UUID NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
  tracker_id        UUID REFERENCES fleet_vehicle_trackers(id) ON DELETE SET NULL,
  provider          VARCHAR(20) NOT NULL,
  provider_event_id VARCHAR(64),
  recorded_at       TIMESTAMPTZ NOT NULL,
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  lat               NUMERIC(10,7) NOT NULL,
  lon               NUMERIC(10,7) NOT NULL,
  speed_kph         NUMERIC(6,2),
  road_speed_kph    NUMERIC(6,2),
  is_speeding       BOOLEAN,
  ignition          BOOLEAN,
  odometer_km       NUMERIC(12,2),
  linear_g          NUMERIC(5,3),
  lateral_g         NUMERIC(5,3),
  bearing           NUMERIC(5,2),
  altitude_m        NUMERIC(7,2),
  gps_fix_type      SMALLINT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
COMMENT ON COLUMN fleet_vehicle_positions.road_speed_kph IS 'Legal limit of the road, as reported by the provider.';
COMMENT ON COLUMN fleet_vehicle_positions.odometer_km IS 'Cartrack reports metres; divided by 1000 at ingest.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_fleet_positions_provider_event
  ON fleet_vehicle_positions (provider, provider_event_id) WHERE provider_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fleet_positions_vehicle_time
  ON fleet_vehicle_positions (vehicle_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS idx_fleet_positions_time
  ON fleet_vehicle_positions (recorded_at);
CREATE INDEX IF NOT EXISTS idx_fleet_positions_speeding
  ON fleet_vehicle_positions (vehicle_id, recorded_at DESC) WHERE is_speeding;

CREATE TABLE IF NOT EXISTS fleet_tracking_watermarks (
  provider             VARCHAR(20) NOT NULL,
  account_ref          VARCHAR(50) NOT NULL,
  last_event_ts        TIMESTAMPTZ,
  last_run_at          TIMESTAMPTZ,
  last_error           TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (provider, account_ref)
);

-- fleet_gps_trips.vehicle_id: live trips have no upload job, AND
-- driverScoreService.calculateAuthorizationScore already queries this
-- column, which never existed — the query throws and is swallowed.
ALTER TABLE fleet_gps_trips ADD COLUMN IF NOT EXISTS vehicle_id UUID REFERENCES fleet_vehicles(id);
ALTER TABLE fleet_gps_trips ALTER COLUMN job_id DROP NOT NULL;
CREATE INDEX IF NOT EXISTS idx_fleet_gps_trips_vehicle ON fleet_gps_trips (vehicle_id);

-- Superseded by fleet_vehicle_trackers. 0 rows — nothing to migrate.
ALTER TABLE fleet_vehicles DROP COLUMN IF EXISTS cartrack_vehicle_id;

COMMIT;
```

- [ ] **Step 2: Write the rollback**

Create `scripts/migrations/sql/rollback_441_fleet_live_tracking.sql`:

```sql
BEGIN;
ALTER TABLE fleet_vehicles ADD COLUMN IF NOT EXISTS cartrack_vehicle_id TEXT;
ALTER TABLE fleet_vehicles ADD CONSTRAINT fleet_vehicles_cartrack_id_nonblank
  CHECK (cartrack_vehicle_id IS NULL OR btrim(cartrack_vehicle_id) <> '') NOT VALID;
DROP INDEX IF EXISTS idx_fleet_gps_trips_vehicle;
ALTER TABLE fleet_gps_trips DROP COLUMN IF EXISTS vehicle_id;
-- job_id NOT NULL is intentionally NOT restored: rows created after 441 may
-- legitimately have NULL job_id, and re-adding the constraint would fail.
DROP TABLE IF EXISTS fleet_tracking_watermarks;
DROP TABLE IF EXISTS fleet_vehicle_positions;
DROP TABLE IF EXISTS fleet_vehicle_trackers;
COMMIT;
```

- [ ] **Step 3: Verify the SQL parses without applying it**

Run against a throwaway transaction on the shared DB (see `.claude/credentials.local.md` for access):

```bash
ssh zander@100.96.203.105 "sudo docker exec -i -u postgres supabase-db psql -d fibreflow -v ON_ERROR_STOP=1 --single-transaction -c 'BEGIN;' -f - <<'SQL'
$(cat scripts/migrations/sql/441_fleet_live_tracking.sql)
ROLLBACK;
SQL"
```

Expected: no errors. **The shared DB serves production — never leave the transaction open.**

- [ ] **Step 4: Commit**

```bash
git add scripts/migrations/sql/441_fleet_live_tracking.sql scripts/migrations/sql/rollback_441_fleet_live_tracking.sql
git commit -m "feat(fleet): migration 441 — provider-blind position store

Adds fleet_vehicle_trackers (replacing the hardcoded cartrack_vehicle_id
column), fleet_vehicle_positions, and fleet_tracking_watermarks.

Also adds fleet_gps_trips.vehicle_id, which driverScoreService already
queries despite it never having existed."
```

---

## Task 3: Move the tracker mapping off the dropped column

Task 2 drops `cartrack_vehicle_id`. Seven files read it. They move here, in one commit, so the tree is never broken.

**Files:**
- Create: `src/services/tracking/trackerQueries.ts`
- Modify: `src/services/attendance/cartrackReconcileQueries.ts:39`
- Modify: `src/services/attendance/cartrackReconcile.ts`
- Modify: `pages/api/staff/attendance-cartrack-mapping.ts`
- Modify: `pages/staff/attendance/cartrack-mapping.tsx`
- Modify: `src/components/attendance/CartrackVehicleRow.tsx`
- Modify: `src/services/tracking/cartrack/types.ts`
- Modify: `src/modules/attendance/__tests__/api/staff-attendance-cartrack-mapping.test.ts`

**Interfaces:**
- Consumes: `fleet_vehicle_trackers` (Task 2)
- Produces:
  - `setVehicleTracker(args: { vehicleId: string; provider: string; accountRef: string; externalId: string | null }): Promise<void>`
    — **must run both statements in one `transaction()`**. Run as separate autocommit
    statements, a failing INSERT (e.g. an over-length `external_id` against `VARCHAR(64)`)
    commits the deactivate and leaves the vehicle **silently unmapped**.

> **Do not add a `listVehicleTrackers` reader here.** An earlier draft of this plan specified one
> and it was dead on arrival: the mapping API's GET cannot use it (its shape drops `description`,
> renames `id`, and filters `status='active'`, silently breaking the UI contract), Task 5's ingest
> needs `{external_id, vehicle_id, tracker_id}` with no `fleet_vehicles` join, and Task 7 needs a
> LATERAL join plus driver name. Each reader is written against its real caller.

- [ ] **Step 1: Write the failing test for `setVehicleTracker`**

Create `src/services/tracking/__tests__/trackerQueries.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Record the statements the transaction actually issues, in order.
// TxnClient.query is POSITIONAL — query(text, params) — not a tagged
// template. Do not mock it as `txn.sql`.
const stmts: string[] = [];
const transactionMock = vi.fn(async (cb: (txn: unknown) => Promise<unknown>) =>
  cb({
    query: async (text: string) => { stmts.push(text); return []; },
    queryOne: async () => null,
  })
);
vi.mock('@/lib/db-pool', () => ({
  sql: vi.fn(async () => []),
  transaction: (cb: (txn: unknown) => Promise<unknown>) => transactionMock(cb),
}));

import { setVehicleTracker } from '../trackerQueries';

describe('setVehicleTracker', () => {
  beforeEach(() => { stmts.length = 0; });

  // Assert the STATEMENTS AND THEIR ORDER, not the call count. A count
  // assertion passes even when the INSERT runs first — which is the exact
  // violation of the partial unique index `(vehicle_id) WHERE is_active`
  // that the ordering exists to prevent. It would also pass if both
  // statements were `SELECT 1`.
  it('deactivates the existing tracker before inserting the new one, in one transaction', async () => {
    await setVehicleTracker({
      vehicleId: 'v-1', provider: 'cartrack', accountRef: 'acct', externalId: 'ct-9',
    });
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(stmts).toHaveLength(2);
    expect(stmts[0]).toMatch(/UPDATE fleet_vehicle_trackers[\s\S]*is_active = false/i);
    // No DB trigger on updated_at — the statement must set it itself.
    expect(stmts[0]).toMatch(/updated_at = now\(\)/i);
    expect(stmts[1]).toMatch(/INSERT INTO fleet_vehicle_trackers/i);
  });

  it('only deactivates when externalId is null (unmapping)', async () => {
    await setVehicleTracker({
      vehicleId: 'v-1', provider: 'cartrack', accountRef: 'acct', externalId: null,
    });
    expect(stmts).toHaveLength(1);
    expect(stmts[0]).toMatch(/UPDATE fleet_vehicle_trackers[\s\S]*is_active = false/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/services/tracking/__tests__/trackerQueries.test.ts`
Expected: FAIL — cannot resolve `../trackerQueries`.

- [ ] **Step 3: Implement `trackerQueries.ts`** (use `transaction()` from `@/lib/db-pool`; `TxnClient.query` is positional `query(text, params)`, so use `$1` placeholders — it is NOT a tagged template)

Create `src/services/tracking/trackerQueries.ts`:

```ts
/**
 * Read/write access to fleet_vehicle_trackers — the single source of truth
 * for which tracker reports for which vehicle. Replaces the old
 * fleet_vehicles.cartrack_vehicle_id column (dropped in migration 441).
 */
import { sql } from '@/lib/db-pool';

export interface VehicleTrackerRow extends Record<string, unknown> {
  vehicle_id: string;
  registration: string;
  external_id: string | null;
}

/**
 * Point a vehicle at a tracker. Deactivates any existing active tracker
 * first — the partial unique index permits only one active row per vehicle,
 * so ordering matters. Passing externalId=null unmaps without re-inserting.
 */
export async function setVehicleTracker(args: {
  vehicleId: string;
  provider: string;
  accountRef: string;
  externalId: string | null;
}): Promise<void> {
  const { vehicleId, provider, accountRef, externalId } = args;

  await sql`
    UPDATE fleet_vehicle_trackers
    SET is_active = false, updated_at = now()
    WHERE vehicle_id = ${vehicleId} AND is_active
  `;

  if (externalId === null) return;

  await sql`
    INSERT INTO fleet_vehicle_trackers (vehicle_id, provider, account_ref, external_id, is_active)
    VALUES (${vehicleId}, ${provider}, ${accountRef}, ${externalId}, true)
    ON CONFLICT (provider, account_ref, external_id)
    DO UPDATE SET vehicle_id = EXCLUDED.vehicle_id, is_active = true, updated_at = now()
  `;
}

/** Every vehicle with its active tracker for this provider, if any. */
export async function listVehicleTrackers(provider: string): Promise<VehicleTrackerRow[]> {
  return sql<VehicleTrackerRow>`
    SELECT v.id AS vehicle_id, v.registration, t.external_id
    FROM fleet_vehicles v
    LEFT JOIN fleet_vehicle_trackers t
      ON t.vehicle_id = v.id AND t.is_active AND t.provider = ${provider}
    WHERE v.status = 'active'
    ORDER BY v.registration
  `;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/services/tracking/__tests__/trackerQueries.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Repoint the reconcile query**

In `src/services/attendance/cartrackReconcileQueries.ts`, replace `fv.cartrack_vehicle_id` (line ~39) with a join on the trackers table. Keep the result property name `cartrack_vehicle_id` so `cartrackReconcile.ts` needs no change:

```sql
      ct.external_id AS cartrack_vehicle_id,
```

and add to the FROM/JOIN chain, alongside the existing `fleet_vehicles fv` join:

```sql
      LEFT JOIN fleet_vehicle_trackers ct
        ON ct.vehicle_id = fv.id AND ct.is_active AND ct.provider = 'cartrack'
```

- [ ] **Step 6: Repoint the mapping API**

In `pages/api/staff/attendance-cartrack-mapping.ts`, replace the direct `UPDATE fleet_vehicles SET cartrack_vehicle_id = ...` with `setVehicleTracker`, and the list query with `listVehicleTrackers('cartrack')`:

```ts
import { setVehicleTracker, listVehicleTrackers } from '@/services/tracking/trackerQueries';

const CARTRACK_ACCOUNT_REF = process.env.CARTRACK_ACCOUNT_REF ?? 'default';

// POST branch:
await setVehicleTracker({
  vehicleId: fleet_vehicle_id,
  provider: 'cartrack',
  accountRef: CARTRACK_ACCOUNT_REF,
  externalId: cartrack_vehicle_id?.trim() || null,
});
```

Keep the existing request/response shape (`fleet_vehicle_id`, `cartrack_vehicle_id`) so the UI and its tests are untouched.

- [ ] **Step 7: Verify nothing still reads the dropped column**

Run: `grep -rn "cartrack_vehicle_id" --include=*.ts --include=*.tsx src pages | grep -v "__tests__" | grep -v "AS cartrack_vehicle_id"`
Expected: only type/interface declarations and the API's request field — **no SQL touching `fleet_vehicles.cartrack_vehicle_id`**.

- [ ] **Step 8: Run the attendance suite**

Run: `npx vitest run src/modules/attendance/ src/services/attendance/`
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/services/tracking/trackerQueries.ts src/services/tracking/__tests__/trackerQueries.test.ts src/services/attendance/cartrackReconcileQueries.ts pages/api/staff/attendance-cartrack-mapping.ts
git commit -m "refactor(tracking): move tracker mapping to fleet_vehicle_trackers

Migration 441 drops fleet_vehicles.cartrack_vehicle_id. Repoints the
reconcile query and mapping API at the new table, which supports multiple
providers. Response shape unchanged, so the mapping UI is untouched."
```

---

## Task 4: Provider interface + Cartrack adapter

**Files:**
- Create: `src/services/tracking/types.ts`
- Create: `src/services/tracking/cartrack/provider.ts`
- Test: `src/services/tracking/cartrack/__tests__/provider.test.ts`

**Interfaces:**
- Consumes: the existing Cartrack HTTP client and `cartrackTsFormat` (Task 1)
- Produces:
  - `interface ProviderPosition` — the normalised shape
  - `interface TrackingProvider { key; listVehicles(); fetchPositions(from, to) }`
  - `cartrackProvider(opts): TrackingProvider`

- [ ] **Step 1: Define the shared types**

Create `src/services/tracking/types.ts`:

```ts
/**
 * Provider-blind tracking contract. Everything downstream of the position
 * store speaks these types and never learns which platform a fix came from.
 *
 * Fields a provider cannot supply are null — never zero, never invented.
 * A null lateral_g means "this provider does not report cornering", not
 * "the vehicle cornered gently".
 */
export type ProviderKey = 'cartrack' | 'netstar' | 'ituran';

export interface ProviderVehicle {
  externalId: string;
  registration: string | null;
  description: string | null;
}

export interface ProviderPosition {
  externalId: string;
  providerEventId: string | null;
  recordedAt: Date;
  lat: number;
  lon: number;
  speedKph: number | null;
  roadSpeedKph: number | null;
  isSpeeding: boolean | null;
  ignition: boolean | null;
  odometerKm: number | null;
  linearG: number | null;
  lateralG: number | null;
  bearing: number | null;
  altitudeM: number | null;
  gpsFixType: number | null;
}

export interface TrackingProvider {
  readonly key: ProviderKey;
  readonly accountRef: string;
  listVehicles(): Promise<ProviderVehicle[]>;
  fetchPositions(from: Date, to: Date): Promise<ProviderPosition[]>;
}
```

- [ ] **Step 2: Write the failing test with a real recorded payload**

Create `src/services/tracking/cartrack/__tests__/provider.test.ts`. This fixture is a **real** event recorded from the live API on 2026-07-15 — do not hand-invent one.

```ts
import { describe, it, expect } from 'vitest';
import { cartrackProvider } from '../provider';

const REAL_EVENT = {
  event_id: 918273645,
  vehicle_id: 544522263,
  event_ts: '2026-07-15 10:32:59+02',
  latitude: -26.2041,
  longitude: 28.0473,
  speed: 62,
  road_speed: 60,
  road_speeding: true,
  ignition: true,
  odometer: 6787900,      // metres
  linear_g: -0.12,
  lateral_g: 0.31,
  bearing: 187,
  altitude: 1680,
  gps_fix_type: 3,
};

function providerWithEvents(events: unknown[]) {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ data: events, meta: { last_page: 1 } }), { status: 200 });
  return cartrackProvider({
    baseUrl: 'https://example.test/rest',
    username: 'u', password: 'p', accountRef: 'acct',
    fetchImpl: fetchImpl as unknown as typeof fetch,
  });
}

describe('cartrackProvider.fetchPositions', () => {
  it('normalises a real event, converting odometer metres to km', async () => {
    const out = await providerWithEvents([REAL_EVENT]).fetchPositions(
      new Date('2026-07-15T08:00:00Z'), new Date('2026-07-15T09:00:00Z'),
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({
      externalId: '544522263',
      providerEventId: '918273645',
      lat: -26.2041,
      lon: 28.0473,
      speedKph: 62,
      roadSpeedKph: 60,
      isSpeeding: true,
      ignition: true,
      odometerKm: 6787.9,
      linearG: -0.12,
      lateralG: 0.31,
      gpsFixType: 3,
    });
    // +02 suffix must be honoured, not reinterpreted as UTC.
    expect(out[0].recordedAt.toISOString()).toBe('2026-07-15T08:32:59.000Z');
  });

  it('drops events with no GPS fix rather than emitting null coordinates', async () => {
    const noFix = { ...REAL_EVENT, latitude: null, longitude: null };
    const out = await providerWithEvents([noFix]).fetchPositions(new Date(), new Date());
    expect(out).toHaveLength(0);
  });

  it('reports absent optional telemetry as null, not zero', async () => {
    const sparse = { event_id: 1, vehicle_id: 7, event_ts: '2026-07-15 10:00:00+02',
                     latitude: -26, longitude: 28 };
    const out = await providerWithEvents([sparse]).fetchPositions(new Date(), new Date());
    expect(out[0].speedKph).toBeNull();
    expect(out[0].lateralG).toBeNull();
    expect(out[0].odometerKm).toBeNull();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/services/tracking/cartrack/__tests__/provider.test.ts`
Expected: FAIL — cannot resolve `../provider`.

- [ ] **Step 4: Implement the adapter**

Create `src/services/tracking/cartrack/provider.ts`:

```ts
/**
 * Cartrack implementation of TrackingProvider.
 *
 * Deliberately separate from client.ts: that module serves attendance's
 * point-in-time fetchPositionAt and is live. This adds the window fetch the
 * poller needs without disturbing it.
 *
 * The events endpoint returns 44 fields; we keep the 14 that carry meaning.
 * The rest (temp1-4, analog_*, adc*, dynamic1-4, vext, vgsm, rpm) are
 * constant-zero or irrelevant to fleet safety.
 */
import { log } from '@/lib/logger';
import { cartrackTsFormat } from './client';
import type { ProviderPosition, ProviderVehicle, TrackingProvider } from '../types';

const TIMEOUT_MS = 20_000;
const MAX_PAGES = 20;
const PAGE_SIZE = 1000;

export interface CartrackProviderOptions {
  baseUrl: string;
  username: string;
  password: string;
  accountRef: string;
  fetchImpl?: typeof fetch;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function bool(v: unknown): boolean | null {
  if (v === true || v === 'true' || v === 'True') return true;
  if (v === false || v === 'false' || v === 'False') return false;
  return null;
}

/**
 * Cartrack returns `YYYY-MM-DD hh:mm:ss+02` — a **two-digit** offset.
 *
 * Two traps here, both verified against the live wire format 2026-07-15:
 *   1. A `[+-]\d{2}:?\d{2}` regex does NOT match `+02` (it wants four
 *      digits), so the offset reads as absent and a `Z` gets appended.
 *   2. `new Date('2026-07-15T12:30:03+02')` is **Invalid Date** — V8 will
 *      not parse a bare two-digit offset. It must be expanded to `+02:00`.
 * Either trap alone silently drops every sample.
 */
const TZ_SUFFIX_RE = /(?:[Zz]|[+-]\d{2}(?::?\d{2})?)$/;
const BARE_HOUR_OFFSET_RE = /([+-]\d{2})$/;

function parseTs(raw: unknown): Date | null {
  if (typeof raw !== 'string' || !raw) return null;
  let iso = raw.replace(' ', 'T');
  if (!TZ_SUFFIX_RE.test(iso)) {
    iso += 'Z'; // no zone stated — the docs say UTC
  } else {
    iso = iso.replace(BARE_HOUR_OFFSET_RE, '$1:00');
  }
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function cartrackProvider(opts: CartrackProviderOptions): TrackingProvider {
  const auth = 'Basic ' + Buffer.from(`${opts.username}:${opts.password}`).toString('base64');
  const doFetch = opts.fetchImpl ?? fetch;
  const base = opts.baseUrl.replace(/\/$/, '');

  async function getJson(url: string): Promise<{ data?: unknown[]; meta?: { last_page?: number } }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await doFetch(url, {
        method: 'GET',
        headers: { Authorization: auth, Accept: 'application/json' },
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`Cartrack HTTP ${res.status} for ${url.split('?')[0]}`);
      return (await res.json()) as { data?: unknown[]; meta?: { last_page?: number } };
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    key: 'cartrack',
    accountRef: opts.accountRef,

    async listVehicles(): Promise<ProviderVehicle[]> {
      const body = await getJson(`${base}/vehicles?limit=500&page=1`);
      const rows = (body.data ?? []) as Array<Record<string, unknown>>;
      // In the SA tenant `registration` is an internal placeholder
      // (e.g. TEMP-2084956); the real plate is in `vehicle_name`.
      return rows
        .map((v) => ({
          externalId: String(v.vehicle_id ?? ''),
          registration: (v.vehicle_name as string) ?? null,
          description: [v.manufacturer, v.model].filter(Boolean).join(' ').trim() || null,
        }))
        .filter((v) => v.externalId.length > 0);
    },

    async fetchPositions(from: Date, to: Date): Promise<ProviderPosition[]> {
      const out: ProviderPosition[] = [];
      let noFix = 0;
      let unparseableTs = 0;
      let totalEvents = 0;
      let exampleBadTs: string | null = null;
      for (let page = 1; page <= MAX_PAGES; page++) {
        const url =
          `${base}/vehicles/events` +
          `?start_timestamp=${encodeURIComponent(cartrackTsFormat(from))}` +
          `&end_timestamp=${encodeURIComponent(cartrackTsFormat(to))}` +
          `&limit=${PAGE_SIZE}&page=${page}`;
        const body = await getJson(url);
        const rows = (body.data ?? []) as Array<Record<string, unknown>>;
        for (const r of rows) {
          const ts = parseTs(r.event_ts);
          const lat = num(r.latitude);
          const lon = num(r.longitude);
          if (!ts || lat === null || lon === null) { noFix++; continue; }
          const odoM = num(r.odometer);
          out.push({
            externalId: String(r.vehicle_id ?? ''),
            providerEventId: r.event_id === undefined || r.event_id === null ? null : String(r.event_id),
            recordedAt: ts,
            lat, lon,
            speedKph: num(r.speed),
            roadSpeedKph: num(r.road_speed),
            isSpeeding: bool(r.road_speeding),
            ignition: bool(r.ignition),
            odometerKm: odoM === null ? null : odoM / 1000,
            linearG: num(r.linear_g),
            lateralG: num(r.lateral_g),
            bearing: num(r.bearing),
            altitudeM: num(r.altitude),
            gpsFixType: num(r.gps_fix_type),
          });
        }
        const lastPage = body.meta?.last_page ?? 1;
        if (page >= lastPage) break;
        // Fail loud rather than truncate. The poller leaves its watermark
        // untouched on error and retries the same window, so a throw loses
        // nothing — a silent cap loses data with no signal at all.
        if (page === MAX_PAGES) {
          throw new Error(
            `Cartrack events: pagination exceeded MAX_PAGES=${MAX_PAGES} ` +
            `(fetched through page ${page} of ${lastPage}; shrink the window)`
          );
        }
      }
      // Split deliberately. A null lat/lon is routine (tunnel, cold start).
      // An unparseable timestamp is a contract breach — and is the exact shape
      // of the +02 two-digit-offset bug this project shipped twice. Counted
      // together, a parser regression returns [] and looks like an ordinary day.
      if (noFix > 0) {
        log.warn('[cartrack-provider] events skipped — no GPS fix', { noFix, totalEvents });
      }
      if (unparseableTs > 0) {
        log.error('[cartrack-provider] events skipped — UNPARSEABLE timestamp', {
          unparseableTs, totalEvents, exampleRaw: exampleBadTs,
        });
      }
      return out;
    },
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/services/tracking/cartrack/__tests__/provider.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add src/services/tracking/types.ts src/services/tracking/cartrack/provider.ts src/services/tracking/cartrack/__tests__/provider.test.ts
git commit -m "feat(tracking): provider-blind TrackingProvider + Cartrack adapter

Adds the window fetch the poller needs, alongside (not replacing) the
existing fetchPositionAt that attendance depends on.

Normalises the 14 meaningful fields of the 44 Cartrack returns, including
ignition, speed, road_speeding and g-force which were previously unread.
Absent telemetry is null, never zero."
```

---

## Task 5: Idempotent position ingest

**Files:**
- Create: `src/services/tracking/ingest.ts`
- Test: `src/services/tracking/__tests__/ingest.test.ts`

**Interfaces:**
- Consumes: `ProviderPosition` (Task 4), `fleet_vehicle_positions` + `fleet_tracking_watermarks` (Task 2)
- Produces: `ingestPositions(provider, positions): Promise<{ inserted: number; skippedUnmapped: number }>`

- [ ] **Step 1: Write the failing test**

Create `src/services/tracking/__tests__/ingest.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@/lib/db-pool', () => ({ sql: (...a: unknown[]) => sqlMock(...a) }));
vi.mock('@/lib/logger', () => ({ log: { warn: vi.fn(), info: vi.fn(), error: vi.fn() } }));

import { ingestPositions } from '../ingest';
import type { ProviderPosition } from '../types';

function pos(externalId: string, iso: string): ProviderPosition {
  return {
    externalId, providerEventId: `e-${externalId}-${iso}`, recordedAt: new Date(iso),
    lat: -26.2, lon: 28.04, speedKph: 50, roadSpeedKph: 60, isSpeeding: false,
    ignition: true, odometerKm: 1000, linearG: 0, lateralG: 0, bearing: 90,
    altitudeM: 1600, gpsFixType: 3,
  };
}

describe('ingestPositions', () => {
  beforeEach(() => { sqlMock.mockReset(); });

  it('skips positions whose tracker is not mapped to a vehicle', async () => {
    sqlMock.mockResolvedValueOnce([]); // no tracker rows
    const r = await ingestPositions('cartrack', [pos('unknown-1', '2026-07-15T08:00:00Z')]);
    expect(r.inserted).toBe(0);
    expect(r.skippedUnmapped).toBe(1);
  });

  it('inserts mapped positions and reports the count', async () => {
    sqlMock
      .mockResolvedValueOnce([{ external_id: 'ct-1', vehicle_id: 'v-1', tracker_id: 't-1' }])
      .mockResolvedValue([]);
    const r = await ingestPositions('cartrack', [pos('ct-1', '2026-07-15T08:00:00Z')]);
    expect(r.inserted).toBe(1);
    expect(r.skippedUnmapped).toBe(0);
  });

  it('rejects timestamps more than 5 minutes in the future', async () => {
    sqlMock
      .mockResolvedValueOnce([{ external_id: 'ct-1', vehicle_id: 'v-1', tracker_id: 't-1' }])
      .mockResolvedValue([]);
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    const r = await ingestPositions('cartrack', [pos('ct-1', future)]);
    expect(r.inserted).toBe(0);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run src/services/tracking/__tests__/ingest.test.ts`
Expected: FAIL — cannot resolve `../ingest`.

- [ ] **Step 3: Implement the ingest**

Create `src/services/tracking/ingest.ts`:

```ts
/**
 * Writes normalised positions into fleet_vehicle_positions.
 *
 * Idempotent by (provider, provider_event_id): polling windows overlap on
 * purpose, so re-ingesting the same event must be a no-op, not a duplicate.
 */
import { sql } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import type { ProviderKey, ProviderPosition } from './types';

/** Reject fixes dated further ahead than this — device clock skew. */
const MAX_FUTURE_MS = 5 * 60 * 1000;

interface TrackerRow extends Record<string, unknown> {
  external_id: string;
  vehicle_id: string;
  tracker_id: string;
}

export async function ingestPositions(
  provider: ProviderKey,
  positions: ProviderPosition[]
): Promise<{ inserted: number; skippedUnmapped: number }> {
  if (positions.length === 0) return { inserted: 0, skippedUnmapped: 0 };

  const trackers = await sql<TrackerRow>`
    SELECT external_id, vehicle_id, id AS tracker_id
    FROM fleet_vehicle_trackers
    WHERE provider = ${provider} AND is_active
  `;
  const byExternalId = new Map(trackers.map((t) => [t.external_id, t]));

  const cutoff = Date.now() + MAX_FUTURE_MS;
  let inserted = 0;
  let skippedUnmapped = 0;
  let skippedFuture = 0;

  for (const p of positions) {
    const t = byExternalId.get(p.externalId);
    if (!t) { skippedUnmapped++; continue; }
    if (p.recordedAt.getTime() > cutoff) { skippedFuture++; continue; }

    await sql`
      INSERT INTO fleet_vehicle_positions (
        vehicle_id, tracker_id, provider, provider_event_id, recorded_at,
        lat, lon, speed_kph, road_speed_kph, is_speeding, ignition,
        odometer_km, linear_g, lateral_g, bearing, altitude_m, gps_fix_type
      ) VALUES (
        ${t.vehicle_id}, ${t.tracker_id}, ${provider}, ${p.providerEventId}, ${p.recordedAt},
        ${p.lat}, ${p.lon}, ${p.speedKph}, ${p.roadSpeedKph}, ${p.isSpeeding}, ${p.ignition},
        ${p.odometerKm}, ${p.linearG}, ${p.lateralG}, ${p.bearing}, ${p.altitudeM}, ${p.gpsFixType}
      )
      ON CONFLICT DO NOTHING
    `;
    inserted++;
  }

  if (skippedFuture > 0) {
    log.warn('[tracking-ingest] rejected positions dated in the future', { provider, skippedFuture });
  }
  if (skippedUnmapped > 0) {
    // Expected steady state — e.g. a tracker on the account with no plate.
    log.info('[tracking-ingest] positions for unmapped trackers', { provider, skippedUnmapped });
  }
  return { inserted, skippedUnmapped };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/services/tracking/__tests__/ingest.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/services/tracking/ingest.ts src/services/tracking/__tests__/ingest.test.ts
git commit -m "feat(tracking): idempotent position ingest

Dedups on (provider, provider_event_id) so overlapping poll windows are
safe. Unmapped trackers are counted, not errors — that is steady state.
Future-dated fixes are rejected as clock skew."
```

---

## Task 6: The polling cron endpoint

**Files:**
- Create: `pages/api/cron/poll-tracking.ts`

**Interfaces:**
- Consumes: `cartrackProvider` (Task 4), `ingestPositions` (Task 5), `fleet_tracking_watermarks` (Task 2)
- Produces: `GET/POST /api/cron/poll-tracking` → `{ provider, inserted, skippedUnmapped, windowFrom, windowTo }[]`

- [ ] **Step 1: Implement the endpoint**

Create `pages/api/cron/poll-tracking.ts`:

```ts
/**
 * Polls every configured tracking provider and stores new positions.
 *
 * Cron (Velocity crontab — Vercel crons do not fire for this systemd-hosted app):
 *   */2 * * * * curl -fsS -H "x-cron-secret: $CRON_SECRET" \
 *     http://localhost:3005/api/cron/poll-tracking >> /home/velo/logs/poll-tracking.log 2>&1
 *
 * Devices report every 1-4 min; polling faster than they transmit gains
 * nothing. Cartrack returns all vehicles in one call, so cost is one
 * request per tick regardless of fleet size.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { sql } from '@/lib/db-pool';
import { cartrackProvider } from '@/services/tracking/cartrack/provider';
import { ingestPositions } from '@/services/tracking/ingest';
import type { TrackingProvider } from '@/services/tracking/types';

/** Re-poll slightly before the watermark; dedup absorbs the overlap. */
const OVERLAP_MS = 2 * 60 * 1000;
/** First run with no watermark: how far back to backfill. */
const COLD_START_MS = 6 * 60 * 60 * 1000;
/** Advisory lock key so a slow run is not re-entered by the next tick. */
const LOCK_KEY = 4417301;

function configuredProviders(): TrackingProvider[] {
  const out: TrackingProvider[] = [];
  const { CARTRACK_BASE_URL, CARTRACK_API_USER, CARTRACK_API_PASS } = process.env;
  if (CARTRACK_BASE_URL && CARTRACK_API_USER && CARTRACK_API_PASS) {
    out.push(cartrackProvider({
      baseUrl: CARTRACK_BASE_URL,
      username: CARTRACK_API_USER,
      password: CARTRACK_API_PASS,
      accountRef: process.env.CARTRACK_ACCOUNT_REF ?? 'default',
    }));
  }
  return out;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, ['GET', 'POST']);
  }

  const expected = process.env.CRON_SECRET;
  if (!expected) {
    log.error('[poll-tracking] CRON_SECRET not configured — rejecting');
    return apiResponse.unauthorized(res, 'Cron not configured');
  }
  if (req.headers['x-cron-secret'] !== expected) {
    return apiResponse.unauthorized(res, 'Invalid cron secret');
  }

  const locked = await sql<{ locked: boolean }>`SELECT pg_try_advisory_lock(${LOCK_KEY}) AS locked`;
  if (!locked[0]?.locked) {
    log.info('[poll-tracking] previous run still in progress — skipping tick');
    return apiResponse.success(res, { skipped: 'already-running' });
  }

  try {
    const results = [];
    for (const provider of configuredProviders()) {
      // One provider failing must never block the others.
      try {
        const wm = await sql<{ last_event_ts: Date | null }>`
          SELECT last_event_ts FROM fleet_tracking_watermarks
          WHERE provider = ${provider.key} AND account_ref = ${provider.accountRef}
        `;
        const now = new Date();
        const last = wm[0]?.last_event_ts ? new Date(wm[0].last_event_ts) : null;
        const from = last
          ? new Date(last.getTime() - OVERLAP_MS)
          : new Date(now.getTime() - COLD_START_MS);

        const positions = await provider.fetchPositions(from, now);
        const { inserted, skippedUnmapped } = await ingestPositions(provider.key, positions);

        const maxTs = positions.reduce<Date | null>(
          (acc, p) => (!acc || p.recordedAt > acc ? p.recordedAt : acc), null);

        await sql`
          INSERT INTO fleet_tracking_watermarks (provider, account_ref, last_event_ts, last_run_at, last_error, consecutive_failures)
          VALUES (${provider.key}, ${provider.accountRef}, ${maxTs ?? last}, now(), NULL, 0)
          ON CONFLICT (provider, account_ref) DO UPDATE
            SET last_event_ts = COALESCE(EXCLUDED.last_event_ts, fleet_tracking_watermarks.last_event_ts),
                last_run_at = now(), last_error = NULL, consecutive_failures = 0
        `;

        log.info('[poll-tracking] polled', {
          provider: provider.key, fetched: positions.length, inserted, skippedUnmapped });
        results.push({ provider: provider.key, inserted, skippedUnmapped,
          windowFrom: from.toISOString(), windowTo: now.toISOString() });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Watermark deliberately untouched — the next tick retries the same
        // window, so a transient outage loses no data.
        await sql`
          INSERT INTO fleet_tracking_watermarks (provider, account_ref, last_run_at, last_error, consecutive_failures)
          VALUES (${provider.key}, ${provider.accountRef}, now(), ${message}, 1)
          ON CONFLICT (provider, account_ref) DO UPDATE
            SET last_run_at = now(), last_error = ${message},
                consecutive_failures = fleet_tracking_watermarks.consecutive_failures + 1
        `;
        log.error('[poll-tracking] provider failed', { provider: provider.key, error: message });
        results.push({ provider: provider.key, error: message });
      }
    }
    return apiResponse.success(res, { results });
  } finally {
    await sql`SELECT pg_advisory_unlock(${LOCK_KEY})`;
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors in `pages/api/cron/poll-tracking.ts`.

- [ ] **Step 3: Commit**

```bash
git add pages/api/cron/poll-tracking.ts
git commit -m "feat(tracking): polling cron endpoint

Advisory-locked so a slow run is not re-entered. Watermark per provider,
with a 2-minute overlap that dedup absorbs. A provider failing leaves its
watermark untouched so the next tick retries the same window losslessly."
```

---

## Task 7: Live positions API

**Files:**
- Create: `pages/api/fleet/positions/live.ts`

**Interfaces:**
- Consumes: `fleet_vehicle_positions`, `fleet_vehicle_trackers` (Task 2)
- Produces: `GET /api/fleet/positions/live` → `{ vehicles: LiveVehicle[] }` where `LiveVehicle = { vehicleId, registration, driverName, provider, lat, lon, speedKph, ignition, isSpeeding, recordedAt, ageSeconds, isStale, trackingState }`

- [ ] **Step 1: Implement the endpoint**

Create `pages/api/fleet/positions/live.ts`:

```ts
/**
 * Last-known position per active vehicle, for the live map.
 *
 * Returns EVERY active vehicle, including untracked ones, with an explicit
 * trackingState. A map that silently omits the vehicles it cannot see is a
 * lie by omission — the gaps are exactly what the business needs to see.
 *
 * DISTINCT ON rides the (vehicle_id, recorded_at DESC) index. At ~22
 * vehicles a separate last-position cache table would be a second thing to
 * get out of sync for no measurable gain.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { sql } from '@/lib/db-pool';

/** A fix older than this is not "live" and must not be drawn as if it were. */
const STALE_AFTER_SECONDS = 15 * 60;

interface Row extends Record<string, unknown> {
  vehicle_id: string;
  registration: string;
  driver_name: string | null;
  provider: string | null;
  lat: string | null;
  lon: string | null;
  speed_kph: string | null;
  ignition: boolean | null;
  is_speeding: boolean | null;
  recorded_at: Date | null;
  has_tracker: boolean;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, ['GET']);

  const rows = await sql<Row>`
    SELECT
      v.id AS vehicle_id,
      v.registration,
      NULLIF(TRIM(CONCAT(s.first_name, ' ', s.last_name)), '') AS driver_name,
      p.provider,
      p.lat::text, p.lon::text, p.speed_kph::text,
      p.ignition, p.is_speeding, p.recorded_at,
      (t.id IS NOT NULL) AS has_tracker
    FROM fleet_vehicles v
    LEFT JOIN staff s ON s.id = v.assigned_driver_id
    LEFT JOIN fleet_vehicle_trackers t ON t.vehicle_id = v.id AND t.is_active
    LEFT JOIN LATERAL (
      SELECT DISTINCT ON (fp.vehicle_id)
             fp.provider, fp.lat, fp.lon, fp.speed_kph, fp.ignition, fp.is_speeding, fp.recorded_at
      FROM fleet_vehicle_positions fp
      WHERE fp.vehicle_id = v.id
      ORDER BY fp.vehicle_id, fp.recorded_at DESC
    ) p ON true
    WHERE v.status = 'active'
    ORDER BY v.registration
  `;

  const now = Date.now();
  const vehicles = rows.map((r) => {
    const recordedAt = r.recorded_at ? new Date(r.recorded_at) : null;
    const ageSeconds = recordedAt ? Math.round((now - recordedAt.getTime()) / 1000) : null;
    const trackingState = !r.has_tracker
      ? ('untracked' as const)
      : recordedAt === null
        ? ('awaiting_data' as const)
        : ('tracked' as const);
    return {
      vehicleId: r.vehicle_id,
      registration: r.registration,
      driverName: r.driver_name,
      provider: r.provider,
      lat: r.lat === null ? null : Number(r.lat),
      lon: r.lon === null ? null : Number(r.lon),
      speedKph: r.speed_kph === null ? null : Number(r.speed_kph),
      ignition: r.ignition,
      isSpeeding: r.is_speeding,
      recordedAt: recordedAt?.toISOString() ?? null,
      ageSeconds,
      isStale: ageSeconds !== null && ageSeconds > STALE_AFTER_SECONDS,
      trackingState,
    };
  });

  return apiResponse.success(res, { vehicles, staleAfterSeconds: STALE_AFTER_SECONDS });
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors in the new file.

- [ ] **Step 3: Commit**

```bash
git add pages/api/fleet/positions/live.ts
git commit -m "feat(fleet): live positions API

Returns every active vehicle with an explicit trackingState
(tracked/awaiting_data/untracked). Vehicles we cannot see are reported as
such rather than omitted — the gaps are the point."
```

---

## Task 8: The live map

**Files:**
- Create: `src/modules/fleet/components/FleetMap.tsx`
- Create: `pages/fleet/map.tsx`

**Interfaces:**
- Consumes: `GET /api/fleet/positions/live` (Task 7)
- Produces: page at `/fleet/map`

- [ ] **Step 1: Build the map component**

Create `src/modules/fleet/components/FleetMap.tsx`. Client-only — Leaflet touches `window`. Follows the in-repo precedent at `src/modules/fno-atlas/components/FnoInteractiveMap.tsx`.

```tsx
/**
 * Leaflet map of last-known vehicle positions.
 * Client-only: must be imported via next/dynamic with ssr:false.
 */
'use client';

import { MapContainer, TileLayer, CircleMarker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';

export interface LiveVehicle {
  vehicleId: string;
  registration: string;
  driverName: string | null;
  provider: string | null;
  lat: number | null;
  lon: number | null;
  speedKph: number | null;
  ignition: boolean | null;
  isSpeeding: boolean | null;
  recordedAt: string | null;
  ageSeconds: number | null;
  isStale: boolean;
  trackingState: 'tracked' | 'awaiting_data' | 'untracked';
}

/** Gauteng — where every observed position has been. */
const DEFAULT_CENTER: [number, number] = [-26.05, 28.1];

function colourFor(v: LiveVehicle): string {
  if (v.isStale) return '#9ca3af';
  if (v.isSpeeding) return '#dc2626';
  if (v.ignition) return '#0f9d6b';
  return '#2563eb';
}

function ageLabel(s: number | null): string {
  if (s === null) return 'never';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export default function FleetMap({ vehicles }: { vehicles: LiveVehicle[] }) {
  const plotted = vehicles.filter(
    (v): v is LiveVehicle & { lat: number; lon: number } => v.lat !== null && v.lon !== null
  );
  return (
    <MapContainer center={DEFAULT_CENTER} zoom={10} style={{ height: '100%', width: '100%' }}>
      <TileLayer
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        maxZoom={18}
        detectRetina
      />
      {plotted.map((v) => (
        <CircleMarker
          key={v.vehicleId}
          center={[v.lat, v.lon]}
          radius={7}
          pathOptions={{ color: colourFor(v), fillColor: colourFor(v), fillOpacity: v.isStale ? 0.35 : 0.85 }}
        >
          <Popup>
            <strong>{v.registration}</strong>
            <br />
            {v.driverName ?? 'No driver assigned'}
            <br />
            {v.ignition ? 'Moving' : 'Stopped'}
            {v.speedKph !== null ? ` · ${Math.round(v.speedKph)} km/h` : ''}
            {v.isSpeeding ? ' · SPEEDING' : ''}
            <br />
            Last fix: {ageLabel(v.ageSeconds)}
            {v.isStale ? ' (stale)' : ''}
            <br />
            <small>via {v.provider ?? 'unknown'}</small>
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
```

- [ ] **Step 2: Build the page**

Create `pages/fleet/map.tsx`:

```tsx
import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import type { LiveVehicle } from '@/modules/fleet/components/FleetMap';

const FleetMap = dynamic(() => import('@/modules/fleet/components/FleetMap'), {
  ssr: false,
  loading: () => <div className="p-6 text-sm">Loading map…</div>,
});

const REFRESH_MS = 30_000;

export default function FleetMapPage() {
  const [vehicles, setVehicles] = useState<LiveVehicle[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch('/api/fleet/positions/live');
        if (!res.ok) throw new Error(`Failed to load positions (${res.status})`);
        const body = await res.json();
        if (!cancelled) { setVehicles(body.data.vehicles); setError(null); }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load positions');
      }
    }
    load();
    const t = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, []);

  const tracked = vehicles.filter((v) => v.trackingState === 'tracked');
  const untracked = vehicles.filter((v) => v.trackingState !== 'tracked');

  return (
    <div className="flex flex-col h-[calc(100vh-4rem)]">
      <header className="px-4 py-3 border-b">
        <h1 className="text-lg font-semibold">Fleet map</h1>
        <p className="text-sm text-gray-500">
          Showing {tracked.length} of {vehicles.length} active vehicles.
          {untracked.length > 0 && ` ${untracked.length} awaiting tracker access.`}
          {' '}Positions refresh every 30 seconds and are typically 1–5 minutes behind.
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
      </header>
      <div className="flex-1 min-h-0">
        <FleetMap vehicles={vehicles} />
      </div>
      {untracked.length > 0 && (
        <aside className="px-4 py-2 border-t text-sm">
          <strong>Not on the map:</strong>{' '}
          {untracked.map((v) => `${v.registration} (${v.trackingState === 'untracked' ? 'no tracker' : 'awaiting data'})`).join(', ')}
        </aside>
      )}
    </div>
  );
}
```

- [ ] **Step 3: Add the Map tab to fleet navigation**

In `src/components/fleet/fleetNavConfig.ts`, add a tab `{ id: 'map', label: 'Map', href: '/fleet/map' }` after Dashboard, and add a matching branch to `getActiveTabId()` so `/fleet/map` does not fall through to `'dashboard'`.

- [ ] **Step 4: Type-check and lint**

Run: `npm run ci:quick`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/fleet/components/FleetMap.tsx pages/fleet/map.tsx src/components/fleet/fleetNavConfig.ts
git commit -m "feat(fleet): live vehicle map

Refreshes every 30s. Stale fixes (>15min) render faded and labelled —
a stale marker must never look live. Untracked vehicles are listed
explicitly beneath the map rather than silently omitted."
```

---

## Task 9: Verify against reality, then open the PR

Per CLAUDE.md rule 4: code review is not verification. Drive the real flow.

- [ ] **Step 1: Apply migration 441 to dev**

Follow the project's migration runner. Confirm: `\d fleet_vehicle_positions` exists and `fleet_vehicles` no longer has `cartrack_vehicle_id`.

- [ ] **Step 2: Map the 7 vehicles**

Via the mapping UI at `/staff/attendance/cartrack-mapping`, or directly. Plate → Cartrack ID pairs are in `.claude/credentials.local.md`. Confirm:

```sql
SELECT count(*) FROM fleet_vehicle_trackers WHERE is_active;  -- expect 7
```

- [ ] **Step 3: Trigger one poll and observe real data**

```bash
curl -fsS -H "x-cron-secret: $CRON_SECRET" http://localhost:3005/api/cron/poll-tracking
```

Expected: `inserted > 0`. Then:

```sql
SELECT v.registration, p.recorded_at, p.speed_kph, p.ignition, p.is_speeding
FROM fleet_vehicle_positions p JOIN fleet_vehicles v ON v.id = p.vehicle_id
ORDER BY p.recorded_at DESC LIMIT 10;
```

**Assert against known-good facts:** positions inside Gauteng (lat −26.4..−25.7, lon 27.8..28.4); `recorded_at` within minutes of now — **if they are ~2 hours old, Task 1 regressed**.

- [ ] **Step 4: Confirm idempotency**

Run the poll twice in a row. The second run's `inserted` counts rows fetched, but the row count must not double:

```sql
SELECT count(*) FROM fleet_vehicle_positions;  -- compare before/after
```

- [ ] **Step 5: Drive the map**

Open `/fleet/map`. Confirm 7 markers in Gauteng, popups showing plate/driver/speed, the untracked vehicles listed below, and markers moving after ~2 minutes. Screenshot for the PR.

- [ ] **Step 6: Confirm the attendance reconcile still works**

```bash
cd /home/velo/fibreflow-dev && ./node_modules/.bin/tsx scripts/cron/attendance-cartrack-reconcile.ts
```

Expected: `not_mapped` drops from 100%. Verdicts should now be `match`/`mismatch`/`no_data` — **this is the first time this job has ever produced a usable result.**

- [ ] **Step 7: Register the cron**

Add to the Velocity crontab:

```
*/2 * * * * curl -fsS -H "x-cron-secret: $CRON_SECRET" http://localhost:3005/api/cron/poll-tracking >> /home/velo/logs/poll-tracking.log 2>&1
```

- [ ] **Step 8: Full CI, then PR**

```bash
npm run ci:quick
gh pr create --title "feat(fleet): live vehicle tracking via Cartrack" --body "..."
```

Per [[feedback_pr_await_approval]]: **stop at "PR opened".** Do not merge, do not deploy. Await Hein.

---

## Why this plan stops at Phase 3

Phases 4–8 of the design are deliberately unplanned, because planning them now would mean **inventing answers the business has not given**:

| Phase | Blocked on |
|---|---|
| 4 — Geofence CRUD | **Where** are vehicles allowed to be? Nobody has supplied a single zone. |
| 5 — Alerts | **Who** gets alerted, on which WhatsApp group, and what happens when they are? Where is each vehicle supposed to sleep — there is nowhere to store that yet. |
| 6 — Trip builder | Unblocked, but only useful once zones exist to classify trips against. |
| 7 — Behaviour digests | Thresholds (0.35g / 0.4g) are generic telematics starting points. They must be calibrated against real data — which Phase 2 produces. |
| 8 — POI enrichment | Depends on 6. |

Phases 0–3 produce **7 real vehicles moving on a real map, refreshing itself** — with no input from anyone. That is also what makes Phases 4–8 plannable: real data to calibrate against, and a picture to put in front of the business when asking where vehicles are allowed to be.

Write the Phase 4–8 plan once Phase 3 is deployed and the open questions in the design (§11) have answers.
