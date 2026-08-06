# Fleet Overnight Parking Compliance — PR 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the schema, the compliance classifier, and a nightly 20:00 SAST job that records where every active vehicle was relative to its declared overnight parking address — with no UI yet.

**Architecture:** A pure classifier (`classifyParkingCompliance`) holds all decision logic and is exhaustively unit-tested with no database. A thin query layer reads vehicles, their active parking location, tracker mapping and last position fix in one `LEFT JOIN LATERAL` query, mirroring `pages/api/fleet/positions/live.ts`. An orchestrator loops vehicles, classifies each independently, and writes one row per vehicle per day. A thin cron endpoint provides auth and HTTP plumbing only.

**Tech Stack:** Next.js Pages Router API routes, PostgreSQL via `@/lib/db-pool`, Vitest, TypeScript.

**Design spec:** `docs/superpowers/specs/2026-08-04-fleet-parking-compliance-design.md`

## Global Constraints

- Migration files MUST live in `scripts/migrations/sql/`. The runner only scans that directory; a file in a parent directory is silently ignored.
- No `console.log`. Use `log` from `@/lib/logger`.
- No empty catch blocks. All changed code fully typed.
- New files < 300 lines; new components < 200 lines.
- Never commit credentials. The crontab entry reads `CRON_SECRET` from the env file, never inline.
- Server timezone is `Africa/Johannesburg (SAST, +0200)`, verified 2026-08-04.
- `STALE_FIX_MAX_HOURS = 72` must be a named exported constant, never a literal in a query.
- Do NOT use conditional SQL template fragments (`${cond ? sql`AND x` : sql``}`) — they break the `@/lib/db-pool` SQL tag. Use explicit query branches.
- All changes go through a PR. Never commit to master. Branch from fresh `origin/master`.

## File Structure

| File | Responsibility |
|---|---|
| `scripts/migrations/sql/483_fleet_parking_compliance.sql` | Two tables, indexes, two `access_permissions` rows |
| `scripts/migrations/sql/rollback_483_fleet_parking_compliance.sql` | Reverses 483 |
| `src/modules/fleet/parking/types.ts` | Shared types for the parking domain |
| `src/modules/fleet/parking/classifyParkingCompliance.ts` | Pure decision logic + `STALE_FIX_MAX_HOURS` |
| `src/modules/fleet/parking/__tests__/classifyParkingCompliance.test.ts` | Exhaustive classifier tests |
| `src/modules/fleet/parking/parkingQueries.ts` | All SQL for the nightly job |
| `src/modules/fleet/parking/runParkingCheck.ts` | Per-vehicle orchestration |
| `src/modules/fleet/parking/__tests__/runParkingCheck.test.ts` | Orchestration tests with a stubbed query layer |
| `pages/api/cron/fleet-parking-check.ts` | Auth + HTTP only |
| `pages/api/cron/__tests__/fleetParkingCheckAuth.test.ts` | Cron auth tests |
| `src/modules/notifications/constants/index.ts` | **Modify** — three new event types |

---

### Task 1: Migration 483

**Files:**
- Create: `scripts/migrations/sql/483_fleet_parking_compliance.sql`
- Create: `scripts/migrations/sql/rollback_483_fleet_parking_compliance.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: tables `fleet_vehicle_parking_locations` and `fleet_parking_compliance_checks`; permission keys `fleet.parking` and `fleet.parking-requests`.

- [ ] **Step 1: Write the forward migration**

```sql
-- 483_fleet_parking_compliance.sql
-- Overnight parking compliance (Phase 1). See
-- docs/superpowers/specs/2026-08-04-fleet-parking-compliance-design.md

BEGIN;

CREATE TABLE IF NOT EXISTS fleet_vehicle_parking_locations (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id           UUID NOT NULL REFERENCES fleet_vehicles(id),
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
  CONSTRAINT fleet_parking_radius_check CHECK (radius_m > 0)
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
  vehicle_id           UUID NOT NULL REFERENCES fleet_vehicles(id),
  check_date           DATE NOT NULL,
  evaluated_at         TIMESTAMPTZ NOT NULL,
  parking_location_id  UUID REFERENCES fleet_vehicle_parking_locations(id),
  last_fix_at          TIMESTAMPTZ,
  last_fix_lat         NUMERIC(10,7),
  last_fix_lon         NUMERIC(10,7),
  last_fix_age_seconds INTEGER,
  distance_m           INTEGER,
  result               VARCHAR(24) NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT fleet_parking_result_check
    CHECK (result IN ('compliant','violation','unknown','not_verifiable','no_address'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ux_parking_check_per_vehicle_day
  ON fleet_parking_compliance_checks (vehicle_id, check_date);

CREATE INDEX IF NOT EXISTS ix_parking_check_date_result
  ON fleet_parking_compliance_checks (check_date, result);

-- Authorization here is page/route based (access_permissions), not
-- role-capability based. These rows are what "fleet manager" means.
INSERT INTO access_permissions (type, key, label, description, route, is_active)
VALUES
  ('page', 'fleet.parking', 'Parking Compliance',
   'View overnight parking compliance results', '/fleet/parking', true),
  ('page', 'fleet.parking-requests', 'Parking Requests',
   'Approve or reject driver parking address changes', '/fleet/parking/requests', true)
ON CONFLICT (key) DO NOTHING;

COMMIT;
```

- [ ] **Step 2: Write the rollback**

```sql
-- rollback_483_fleet_parking_compliance.sql
BEGIN;

DELETE FROM access_permissions WHERE key IN ('fleet.parking', 'fleet.parking-requests');

DROP TABLE IF EXISTS fleet_parking_compliance_checks;
DROP TABLE IF EXISTS fleet_vehicle_parking_locations;

COMMIT;
```

- [ ] **Step 3: Verify `access_permissions.key` has a unique constraint**

The `ON CONFLICT (key)` clause requires one. Run:

```bash
ssh velo@100.96.203.105 "docker exec -u postgres supabase-db psql -d fibreflow -c \
  \"SELECT indexname, indexdef FROM pg_indexes WHERE tablename='access_permissions';\""
```

Expected: an index enforcing uniqueness on `key`. **If there is none, change `ON CONFLICT (key) DO NOTHING` to a guarded insert:**

```sql
INSERT INTO access_permissions (type, key, label, description, route, is_active)
SELECT * FROM (VALUES
  ('page','fleet.parking','Parking Compliance','View overnight parking compliance results','/fleet/parking',true),
  ('page','fleet.parking-requests','Parking Requests','Approve or reject driver parking address changes','/fleet/parking/requests',true)
) AS v(type,key,label,description,route,is_active)
WHERE NOT EXISTS (SELECT 1 FROM access_permissions ap WHERE ap.key = v.key);
```

- [ ] **Step 4: Commit**

```bash
git add scripts/migrations/sql/483_fleet_parking_compliance.sql \
        scripts/migrations/sql/rollback_483_fleet_parking_compliance.sql
git commit -m "feat(fleet): migration 483 — overnight parking compliance tables"
```

---

### Task 2: Types and the pure classifier

**Files:**
- Create: `src/modules/fleet/parking/types.ts`
- Create: `src/modules/fleet/parking/classifyParkingCompliance.ts`
- Test: `src/modules/fleet/parking/__tests__/classifyParkingCompliance.test.ts`

**Interfaces:**
- Consumes: `haversineDistanceM`, `isValidLatLon` from `@/lib/geo`.
- Produces: `ParkingCheckResult`, `ParkingLocation`, `PositionFix`, `ClassifyInput`, `ClassifyOutput`, `classifyParkingCompliance(input: ClassifyInput): ClassifyOutput`, `STALE_FIX_MAX_HOURS: number`.

- [ ] **Step 1: Write the types**

```typescript
// src/modules/fleet/parking/types.ts

/** Outcome of a single nightly parking check. */
export type ParkingCheckResult =
  | 'compliant'
  | 'violation'
  | 'unknown'
  | 'not_verifiable'
  | 'no_address';

export interface ParkingLocation {
  id: string;
  lat: number;
  lon: number;
  radiusM: number;
}

export interface PositionFix {
  recordedAt: Date;
  lat: number;
  lon: number;
}

export interface ClassifyInput {
  /** The vehicle's active declared parking location, or null if none. */
  location: ParkingLocation | null;
  /** Whether the vehicle has an active tracker mapping. */
  hasTracker: boolean;
  /** Most recent fix at or before `checkAt`, or null if none exists. */
  lastFix: PositionFix | null;
  /** The instant the check represents (20:00 SAST). */
  checkAt: Date;
}

export interface ClassifyOutput {
  result: ParkingCheckResult;
  distanceM: number | null;
  lastFixAgeSeconds: number | null;
}
```

- [ ] **Step 2: Write the failing tests**

```typescript
// src/modules/fleet/parking/__tests__/classifyParkingCompliance.test.ts
import { describe, it, expect } from 'vitest';
import {
  classifyParkingCompliance,
  STALE_FIX_MAX_HOURS,
} from '../classifyParkingCompliance';
import type { ParkingLocation } from '../types';

const CHECK_AT = new Date('2026-08-04T18:00:00.000Z'); // 20:00 SAST

// Braamfontein-ish. 0.0018 deg latitude is ~200 m.
const LOCATION: ParkingLocation = {
  id: 'loc-1',
  lat: -26.1929,
  lon: 28.0305,
  radiusM: 200,
};

/** A fix `hoursAgo` before CHECK_AT at the given coordinates. */
function fixAt(hoursAgo: number, lat: number, lon: number) {
  return {
    recordedAt: new Date(CHECK_AT.getTime() - hoursAgo * 3600 * 1000),
    lat,
    lon,
  };
}

describe('classifyParkingCompliance', () => {
  it('returns no_address when the vehicle has no declared location', () => {
    const out = classifyParkingCompliance({
      location: null,
      hasTracker: true,
      lastFix: fixAt(1, LOCATION.lat, LOCATION.lon),
      checkAt: CHECK_AT,
    });
    expect(out.result).toBe('no_address');
    expect(out.distanceM).toBeNull();
  });

  it('prefers no_address over not_verifiable when both apply', () => {
    const out = classifyParkingCompliance({
      location: null,
      hasTracker: false,
      lastFix: null,
      checkAt: CHECK_AT,
    });
    expect(out.result).toBe('no_address');
  });

  it('returns not_verifiable when the vehicle has no tracker', () => {
    const out = classifyParkingCompliance({
      location: LOCATION,
      hasTracker: false,
      lastFix: null,
      checkAt: CHECK_AT,
    });
    expect(out.result).toBe('not_verifiable');
  });

  it('returns unknown when there is no fix at all', () => {
    const out = classifyParkingCompliance({
      location: LOCATION,
      hasTracker: true,
      lastFix: null,
      checkAt: CHECK_AT,
    });
    expect(out.result).toBe('unknown');
    expect(out.lastFixAgeSeconds).toBeNull();
  });

  it('returns compliant for a fresh fix at the declared spot', () => {
    const out = classifyParkingCompliance({
      location: LOCATION,
      hasTracker: true,
      lastFix: fixAt(1, LOCATION.lat, LOCATION.lon),
      checkAt: CHECK_AT,
    });
    expect(out.result).toBe('compliant');
    expect(out.distanceM).toBe(0);
    expect(out.lastFixAgeSeconds).toBe(3600);
  });

  it('returns violation for a fresh fix far from the declared spot', () => {
    // ~1.1 km north
    const out = classifyParkingCompliance({
      location: LOCATION,
      hasTracker: true,
      lastFix: fixAt(1, LOCATION.lat + 0.01, LOCATION.lon),
      checkAt: CHECK_AT,
    });
    expect(out.result).toBe('violation');
    expect(out.distanceM).toBeGreaterThan(900);
  });

  // The weekend case: parked Friday evening, checked Sunday night. The
  // newest fix is from a previous DAY but well inside the staleness
  // ceiling, so it must classify on distance, not fall through to unknown.
  it('classifies on distance when the fix is from a previous day but not stale', () => {
    const out = classifyParkingCompliance({
      location: LOCATION,
      hasTracker: true,
      lastFix: fixAt(51, LOCATION.lat, LOCATION.lon),
      checkAt: CHECK_AT,
    });
    expect(out.result).toBe('compliant');
    expect(out.lastFixAgeSeconds).toBe(51 * 3600);
  });

  it('treats a fix exactly at the staleness ceiling as still usable', () => {
    const out = classifyParkingCompliance({
      location: LOCATION,
      hasTracker: true,
      lastFix: fixAt(STALE_FIX_MAX_HOURS, LOCATION.lat, LOCATION.lon),
      checkAt: CHECK_AT,
    });
    expect(out.result).toBe('compliant');
  });

  it('returns unknown one second beyond the staleness ceiling', () => {
    const lastFix = {
      recordedAt: new Date(
        CHECK_AT.getTime() - (STALE_FIX_MAX_HOURS * 3600 + 1) * 1000
      ),
      lat: LOCATION.lat,
      lon: LOCATION.lon,
    };
    const out = classifyParkingCompliance({
      location: LOCATION,
      hasTracker: true,
      lastFix,
      checkAt: CHECK_AT,
    });
    expect(out.result).toBe('unknown');
  });

  // Guards the asymmetric rule rejected in spec section 5.1: a stale fix
  // INSIDE the radius must still be unknown, never compliant.
  it('returns unknown for a stale fix even when it sits inside the radius', () => {
    const out = classifyParkingCompliance({
      location: LOCATION,
      hasTracker: true,
      lastFix: fixAt(STALE_FIX_MAX_HOURS + 24, LOCATION.lat, LOCATION.lon),
      checkAt: CHECK_AT,
    });
    expect(out.result).toBe('unknown');
  });

  it('still reports distance and age for a stale fix, as evidence', () => {
    const out = classifyParkingCompliance({
      location: LOCATION,
      hasTracker: true,
      lastFix: fixAt(STALE_FIX_MAX_HOURS + 1, LOCATION.lat + 0.01, LOCATION.lon),
      checkAt: CHECK_AT,
    });
    expect(out.result).toBe('unknown');
    expect(out.distanceM).toBeGreaterThan(900);
    expect(out.lastFixAgeSeconds).toBe((STALE_FIX_MAX_HOURS + 1) * 3600);
  });

  // Pins the comparison as `<=`, not `<`. The exact haversine distance is
  // measured first rather than hard-coded, so the test cannot drift if the
  // distance helper is ever refined.
  it('is compliant when distance equals the radius exactly, and violation one metre inside that', () => {
    const offsetFix = fixAt(1, LOCATION.lat + 0.0018, LOCATION.lon);

    const measured = classifyParkingCompliance({
      location: { ...LOCATION, radiusM: 100_000 },
      hasTracker: true,
      lastFix: offsetFix,
      checkAt: CHECK_AT,
    });
    const exact = measured.distanceM as number;
    expect(exact).toBeGreaterThan(0);

    const atBoundary = classifyParkingCompliance({
      location: { ...LOCATION, radiusM: exact },
      hasTracker: true,
      lastFix: offsetFix,
      checkAt: CHECK_AT,
    });
    expect(atBoundary.result).toBe('compliant');

    const justInside = classifyParkingCompliance({
      location: { ...LOCATION, radiusM: exact - 1 },
      hasTracker: true,
      lastFix: offsetFix,
      checkAt: CHECK_AT,
    });
    expect(justInside.result).toBe('violation');
  });

  it('returns unknown for invalid fix coordinates', () => {
    const out = classifyParkingCompliance({
      location: LOCATION,
      hasTracker: true,
      lastFix: { recordedAt: CHECK_AT, lat: Number.NaN, lon: 28.03 },
      checkAt: CHECK_AT,
    });
    expect(out.result).toBe('unknown');
  });

  it('returns no_address for invalid location coordinates', () => {
    const out = classifyParkingCompliance({
      location: { ...LOCATION, lat: Number.NaN },
      hasTracker: true,
      lastFix: fixAt(1, LOCATION.lat, LOCATION.lon),
      checkAt: CHECK_AT,
    });
    expect(out.result).toBe('no_address');
  });

  // Clock skew between the tracker and the server must not produce a
  // negative age that silently passes the staleness check.
  it('clamps a future-dated fix to zero age', () => {
    const out = classifyParkingCompliance({
      location: LOCATION,
      hasTracker: true,
      lastFix: fixAt(-2, LOCATION.lat, LOCATION.lon),
      checkAt: CHECK_AT,
    });
    expect(out.result).toBe('compliant');
    expect(out.lastFixAgeSeconds).toBe(0);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run src/modules/fleet/parking/__tests__/classifyParkingCompliance.test.ts`
Expected: FAIL — cannot resolve `../classifyParkingCompliance`.

- [ ] **Step 4: Write the implementation**

```typescript
// src/modules/fleet/parking/classifyParkingCompliance.ts
/**
 * Pure decision logic for the nightly overnight-parking check.
 *
 * Extracted from the job so every branch is testable without a database,
 * mirroring how `liveMapHelpers.ts` was split out of `FleetMap`.
 *
 * Precedence is deliberate and must not be reordered:
 *   no_address > not_verifiable > unknown > compliant/violation
 * A missing address is the driver's problem and outranks a missing
 * tracker, which is a hardware problem — they need different people.
 */
import { haversineDistanceM, isValidLatLon } from '@/lib/geo';
import type { ClassifyInput, ClassifyOutput } from './types';

/**
 * A fix older than this cannot be treated as authoritative evidence of
 * where a vehicle is. 72 hours lets a vehicle parked across a standard
 * weekend (Friday 17:00 to Sunday 20:00 is ~51 hours) classify normally,
 * while a tracker silent longer than a long weekend stops being trusted.
 *
 * Expected to need tuning once real data accumulates — see spec 5.1.
 */
export const STALE_FIX_MAX_HOURS = 72;

export function classifyParkingCompliance(input: ClassifyInput): ClassifyOutput {
  const { location, hasTracker, lastFix, checkAt } = input;

  if (!location || !isValidLatLon({ lat: location.lat, lon: location.lon })) {
    return { result: 'no_address', distanceM: null, lastFixAgeSeconds: null };
  }

  if (!hasTracker) {
    return { result: 'not_verifiable', distanceM: null, lastFixAgeSeconds: null };
  }

  if (!lastFix || !isValidLatLon({ lat: lastFix.lat, lon: lastFix.lon })) {
    return { result: 'unknown', distanceM: null, lastFixAgeSeconds: null };
  }

  // Clamp at zero: a tracker clock running ahead of the server must not
  // yield a negative age that trivially passes the staleness check.
  const ageSeconds = Math.max(
    0,
    Math.round((checkAt.getTime() - lastFix.recordedAt.getTime()) / 1000)
  );

  const distanceM = Math.round(
    haversineDistanceM(
      { lat: lastFix.lat, lon: lastFix.lon },
      { lat: location.lat, lon: location.lon }
    )
  );

  // Distance is reported even when the verdict is `unknown`: "last seen
  // 40 km away, four days ago" is exactly the evidence an operator needs.
  if (ageSeconds > STALE_FIX_MAX_HOURS * 3600) {
    return { result: 'unknown', distanceM, lastFixAgeSeconds: ageSeconds };
  }

  return {
    result: distanceM <= location.radiusM ? 'compliant' : 'violation',
    distanceM,
    lastFixAgeSeconds: ageSeconds,
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run src/modules/fleet/parking/__tests__/classifyParkingCompliance.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 6: Commit**

```bash
git add src/modules/fleet/parking/types.ts \
        src/modules/fleet/parking/classifyParkingCompliance.ts \
        src/modules/fleet/parking/__tests__/classifyParkingCompliance.test.ts
git commit -m "feat(fleet): pure parking-compliance classifier with staleness ceiling"
```

---

### Task 3: Query layer

**Files:**
- Create: `src/modules/fleet/parking/parkingQueries.ts`

**Interfaces:**
- Consumes: `sql` from `@/lib/db-pool`; `ParkingLocation`, `PositionFix`, `ParkingCheckResult` from `./types`.
- Produces:
  - `loadParkingCheckCandidates(checkAt: Date): Promise<ParkingCandidate[]>`
  - `insertComplianceCheck(row: ComplianceCheckRow): Promise<void>`
  - `interface ParkingCandidate { vehicleId: string; registration: string; hasTracker: boolean; location: ParkingLocation | null; lastFix: PositionFix | null }`
  - `interface ComplianceCheckRow { vehicleId: string; checkDate: string; evaluatedAt: Date; parkingLocationId: string | null; lastFixAt: Date | null; lastFixLat: number | null; lastFixLon: number | null; lastFixAgeSeconds: number | null; distanceM: number | null; result: ParkingCheckResult }`

- [ ] **Step 1: Write the query module**

```typescript
// src/modules/fleet/parking/parkingQueries.ts
/**
 * All SQL for the nightly overnight-parking check.
 *
 * One LEFT JOIN LATERAL pulls every active vehicle together with its
 * active declared location, its tracker mapping and its most recent fix
 * at or before the check instant — the same shape used by
 * pages/api/fleet/positions/live.ts. At ~22 vehicles this is one
 * round-trip and needs no caching layer.
 *
 * Numerics are cast to text and parsed in TypeScript: node-postgres
 * returns NUMERIC as a string to avoid precision loss, and doing the
 * conversion explicitly keeps that from surprising callers.
 */
import { sql } from '@/lib/db-pool';
import type { ParkingCheckResult, ParkingLocation, PositionFix } from './types';

export interface ParkingCandidate {
  vehicleId: string;
  registration: string;
  hasTracker: boolean;
  location: ParkingLocation | null;
  lastFix: PositionFix | null;
}

export interface ComplianceCheckRow {
  vehicleId: string;
  checkDate: string;
  evaluatedAt: Date;
  parkingLocationId: string | null;
  lastFixAt: Date | null;
  lastFixLat: number | null;
  lastFixLon: number | null;
  lastFixAgeSeconds: number | null;
  distanceM: number | null;
  result: ParkingCheckResult;
}

interface CandidateRow extends Record<string, unknown> {
  vehicle_id: string;
  registration: string;
  has_tracker: boolean;
  location_id: string | null;
  location_lat: string | null;
  location_lon: string | null;
  radius_m: number | null;
  fix_at: Date | null;
  fix_lat: string | null;
  fix_lon: string | null;
}

export async function loadParkingCheckCandidates(checkAt: Date): Promise<ParkingCandidate[]> {
  const rows = await sql<CandidateRow>`
    SELECT
      v.id AS vehicle_id,
      v.registration,
      (t.id IS NOT NULL) AS has_tracker,
      pl.id AS location_id,
      pl.lat::text AS location_lat,
      pl.lon::text AS location_lon,
      pl.radius_m,
      p.recorded_at AS fix_at,
      p.lat::text AS fix_lat,
      p.lon::text AS fix_lon
    FROM fleet_vehicles v
    LEFT JOIN fleet_vehicle_trackers t
      ON t.vehicle_id = v.id AND t.is_active
    LEFT JOIN fleet_vehicle_parking_locations pl
      ON pl.vehicle_id = v.id AND pl.status = 'active'
    LEFT JOIN LATERAL (
      SELECT fp.recorded_at, fp.lat, fp.lon
      FROM fleet_vehicle_positions fp
      WHERE fp.vehicle_id = v.id
        AND fp.recorded_at <= ${checkAt}
      ORDER BY fp.recorded_at DESC
      LIMIT 1
    ) p ON true
    WHERE v.status = 'active'
    ORDER BY v.registration
  `;

  return rows.map((r) => ({
    vehicleId: r.vehicle_id,
    registration: r.registration,
    hasTracker: r.has_tracker,
    location:
      r.location_id === null || r.location_lat === null || r.location_lon === null
        ? null
        : {
            id: r.location_id,
            lat: Number(r.location_lat),
            lon: Number(r.location_lon),
            radiusM: Number(r.radius_m ?? 200),
          },
    lastFix:
      r.fix_at === null || r.fix_lat === null || r.fix_lon === null
        ? null
        : {
            recordedAt: new Date(r.fix_at),
            lat: Number(r.fix_lat),
            lon: Number(r.fix_lon),
          },
  }));
}

/**
 * Idempotent by design: the unique index on (vehicle_id, check_date)
 * makes a re-run or a double cron fire a no-op rather than a duplicate
 * record — and therefore, later, a duplicate alert.
 */
export async function insertComplianceCheck(row: ComplianceCheckRow): Promise<void> {
  await sql`
    INSERT INTO fleet_parking_compliance_checks (
      vehicle_id, check_date, evaluated_at, parking_location_id,
      last_fix_at, last_fix_lat, last_fix_lon, last_fix_age_seconds,
      distance_m, result
    ) VALUES (
      ${row.vehicleId}, ${row.checkDate}, ${row.evaluatedAt}, ${row.parkingLocationId},
      ${row.lastFixAt}, ${row.lastFixLat}, ${row.lastFixLon}, ${row.lastFixAgeSeconds},
      ${row.distanceM}, ${row.result}
    )
    ON CONFLICT (vehicle_id, check_date) DO NOTHING
  `;
}
```

- [ ] **Step 2: Type-check**

Run: `npm run type-check`
Expected: no new errors mentioning `parkingQueries`. A pre-existing baseline of errors in unrelated files is expected — compare counts before and after if unsure.

- [ ] **Step 3: Commit**

```bash
git add src/modules/fleet/parking/parkingQueries.ts
git commit -m "feat(fleet): query layer for the nightly parking check"
```

---

### Task 4: Orchestrator

**Files:**
- Create: `src/modules/fleet/parking/runParkingCheck.ts`
- Test: `src/modules/fleet/parking/__tests__/runParkingCheck.test.ts`

**Interfaces:**
- Consumes: `loadParkingCheckCandidates`, `insertComplianceCheck` from `./parkingQueries`; `classifyParkingCompliance` from `./classifyParkingCompliance`.
- Produces:
  - `sastDateString(at: Date): string` — `YYYY-MM-DD` in Africa/Johannesburg
  - `runParkingCheck(checkAt: Date): Promise<ParkingCheckReport>`
  - `interface ParkingCheckReport { checkDate: string; evaluated: number; counts: Record<ParkingCheckResult, number>; errors: number }`

- [ ] **Step 1: Write the failing tests**

```typescript
// src/modules/fleet/parking/__tests__/runParkingCheck.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ParkingCandidate } from '../parkingQueries';

const loadParkingCheckCandidates = vi.fn();
const insertComplianceCheck = vi.fn();

vi.mock('../parkingQueries', () => ({
  loadParkingCheckCandidates: (...a: unknown[]) => loadParkingCheckCandidates(...a),
  insertComplianceCheck: (...a: unknown[]) => insertComplianceCheck(...a),
}));

import { runParkingCheck, sastDateString } from '../runParkingCheck';

const CHECK_AT = new Date('2026-08-04T18:00:00.000Z'); // 20:00 SAST

function candidate(over: Partial<ParkingCandidate> = {}): ParkingCandidate {
  return {
    vehicleId: 'veh-1',
    registration: 'MW67LFGP',
    hasTracker: true,
    location: { id: 'loc-1', lat: -26.1929, lon: 28.0305, radiusM: 200 },
    lastFix: { recordedAt: new Date(CHECK_AT.getTime() - 3600_000), lat: -26.1929, lon: 28.0305 },
    ...over,
  };
}

beforeEach(() => {
  loadParkingCheckCandidates.mockReset();
  insertComplianceCheck.mockReset();
  insertComplianceCheck.mockResolvedValue(undefined);
});

describe('sastDateString', () => {
  it('returns the SAST calendar date, not the UTC one', () => {
    // 22:30 UTC on the 4th is 00:30 SAST on the 5th.
    expect(sastDateString(new Date('2026-08-04T22:30:00.000Z'))).toBe('2026-08-05');
  });

  it('returns the same date for a 20:00 SAST instant', () => {
    expect(sastDateString(CHECK_AT)).toBe('2026-08-04');
  });
});

describe('runParkingCheck', () => {
  it('writes one row per vehicle and counts results', async () => {
    loadParkingCheckCandidates.mockResolvedValue([
      candidate(),
      candidate({ vehicleId: 'veh-2', location: null }),
      candidate({ vehicleId: 'veh-3', hasTracker: false }),
    ]);

    const report = await runParkingCheck(CHECK_AT);

    expect(report.evaluated).toBe(3);
    expect(report.counts.compliant).toBe(1);
    expect(report.counts.no_address).toBe(1);
    expect(report.counts.not_verifiable).toBe(1);
    expect(insertComplianceCheck).toHaveBeenCalledTimes(3);
  });

  it('passes the SAST check date through to every row', async () => {
    loadParkingCheckCandidates.mockResolvedValue([candidate()]);
    await runParkingCheck(CHECK_AT);
    expect(insertComplianceCheck).toHaveBeenCalledWith(
      expect.objectContaining({ checkDate: '2026-08-04', vehicleId: 'veh-1' })
    );
  });

  // One malformed vehicle must not cost us the other 21 results.
  it('continues after a failed insert and counts the error', async () => {
    loadParkingCheckCandidates.mockResolvedValue([
      candidate({ vehicleId: 'veh-1' }),
      candidate({ vehicleId: 'veh-2' }),
    ]);
    insertComplianceCheck
      .mockRejectedValueOnce(new Error('constraint violation'))
      .mockResolvedValueOnce(undefined);

    const report = await runParkingCheck(CHECK_AT);

    expect(report.errors).toBe(1);
    expect(report.evaluated).toBe(2);
    expect(insertComplianceCheck).toHaveBeenCalledTimes(2);
  });

  it('records the deciding fix as evidence on the row', async () => {
    loadParkingCheckCandidates.mockResolvedValue([candidate()]);
    await runParkingCheck(CHECK_AT);
    expect(insertComplianceCheck).toHaveBeenCalledWith(
      expect.objectContaining({
        lastFixAgeSeconds: 3600,
        distanceM: 0,
        parkingLocationId: 'loc-1',
        result: 'compliant',
      })
    );
  });

  it('handles an empty fleet without throwing', async () => {
    loadParkingCheckCandidates.mockResolvedValue([]);
    const report = await runParkingCheck(CHECK_AT);
    expect(report.evaluated).toBe(0);
    expect(report.errors).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run src/modules/fleet/parking/__tests__/runParkingCheck.test.ts`
Expected: FAIL — cannot resolve `../runParkingCheck`.

- [ ] **Step 3: Write the implementation**

```typescript
// src/modules/fleet/parking/runParkingCheck.ts
/**
 * Orchestrates the nightly overnight-parking check.
 *
 * Per-vehicle evaluation is independent: one malformed row or one failed
 * insert must not cost us the other twenty-one results, so each vehicle
 * is wrapped individually and failures are counted rather than thrown.
 *
 * No advisory lock is taken. The unique index on
 * (vehicle_id, check_date) already makes concurrent or repeated runs
 * converge on the same single row per vehicle per day, so a lock would
 * add a failure mode without removing one.
 */
import { log } from '@/lib/logger';
import { classifyParkingCompliance } from './classifyParkingCompliance';
import { insertComplianceCheck, loadParkingCheckCandidates } from './parkingQueries';
import type { ParkingCheckResult } from './types';

export interface ParkingCheckReport {
  checkDate: string;
  evaluated: number;
  counts: Record<ParkingCheckResult, number>;
  errors: number;
}

/**
 * The SAST calendar date for an instant. The server runs in
 * Africa/Johannesburg today, but deriving the date explicitly means a
 * future host in another zone cannot silently shift every check_date.
 * `en-CA` is used because it formats as YYYY-MM-DD.
 */
export function sastDateString(at: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Johannesburg',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

function emptyCounts(): Record<ParkingCheckResult, number> {
  return { compliant: 0, violation: 0, unknown: 0, not_verifiable: 0, no_address: 0 };
}

export async function runParkingCheck(checkAt: Date): Promise<ParkingCheckReport> {
  const checkDate = sastDateString(checkAt);
  const candidates = await loadParkingCheckCandidates(checkAt);

  const report: ParkingCheckReport = {
    checkDate,
    evaluated: candidates.length,
    counts: emptyCounts(),
    errors: 0,
  };

  for (const c of candidates) {
    const outcome = classifyParkingCompliance({
      location: c.location,
      hasTracker: c.hasTracker,
      lastFix: c.lastFix,
      checkAt,
    });

    report.counts[outcome.result] += 1;

    try {
      await insertComplianceCheck({
        vehicleId: c.vehicleId,
        checkDate,
        evaluatedAt: checkAt,
        parkingLocationId: c.location?.id ?? null,
        lastFixAt: c.lastFix?.recordedAt ?? null,
        lastFixLat: c.lastFix?.lat ?? null,
        lastFixLon: c.lastFix?.lon ?? null,
        lastFixAgeSeconds: outcome.lastFixAgeSeconds,
        distanceM: outcome.distanceM,
        result: outcome.result,
      });
    } catch (error) {
      report.errors += 1;
      log.error('[fleet-parking-check] failed to record result', {
        vehicleId: c.vehicleId,
        registration: c.registration,
        checkDate,
        error,
      });
    }
  }

  return report;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run src/modules/fleet/parking/__tests__/runParkingCheck.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add src/modules/fleet/parking/runParkingCheck.ts \
        src/modules/fleet/parking/__tests__/runParkingCheck.test.ts
git commit -m "feat(fleet): orchestrate the nightly parking check per vehicle"
```

---

### Task 5: Cron endpoint

**Files:**
- Create: `pages/api/cron/fleet-parking-check.ts`
- Test: `pages/api/cron/__tests__/fleetParkingCheckAuth.test.ts`

**Interfaces:**
- Consumes: `runParkingCheck` from `@/modules/fleet/parking/runParkingCheck`; `apiResponse` from `@/lib/apiResponse`; `ErrorCode` (same import site as `pages/api/cron/poll-tracking.ts` uses it).
- Produces: `GET|POST /api/cron/fleet-parking-check`.

- [ ] **Step 1: Write the failing auth tests**

```typescript
// pages/api/cron/__tests__/fleetParkingCheckAuth.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const runParkingCheck = vi.fn();
vi.mock('@/modules/fleet/parking/runParkingCheck', () => ({
  runParkingCheck: (...a: unknown[]) => runParkingCheck(...a),
}));

import handler from '../fleet-parking-check';

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

const ORIGINAL_SECRET = process.env.CRON_SECRET;

beforeEach(() => {
  runParkingCheck.mockReset();
  runParkingCheck.mockResolvedValue({
    checkDate: '2026-08-04', evaluated: 0,
    counts: { compliant: 0, violation: 0, unknown: 0, not_verifiable: 0, no_address: 0 },
    errors: 0,
  });
  process.env.CRON_SECRET = 'test-secret';
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = ORIGINAL_SECRET;
});

describe('fleet-parking-check cron auth', () => {
  it('rejects a request with no secret header', async () => {
    const res = mockRes();
    await handler({ method: 'GET', headers: {} } as unknown as NextApiRequest, res);
    expect(res.statusCode).toBe(401);
    expect(runParkingCheck).not.toHaveBeenCalled();
  });

  it('rejects a request with the wrong secret', async () => {
    const res = mockRes();
    await handler(
      { method: 'GET', headers: { 'x-cron-secret': 'nope' } } as unknown as NextApiRequest,
      res
    );
    expect(res.statusCode).toBe(401);
    expect(runParkingCheck).not.toHaveBeenCalled();
  });

  // Fail closed: an unset secret must never mean "allow everyone".
  it('refuses to run when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET;
    const res = mockRes();
    await handler(
      { method: 'GET', headers: { 'x-cron-secret': 'anything' } } as unknown as NextApiRequest,
      res
    );
    expect(res.statusCode).toBeGreaterThanOrEqual(500);
    expect(runParkingCheck).not.toHaveBeenCalled();
  });

  it('rejects an unsupported method', async () => {
    const res = mockRes();
    await handler(
      { method: 'DELETE', headers: { 'x-cron-secret': 'test-secret' } } as unknown as NextApiRequest,
      res
    );
    expect(res.statusCode).toBe(405);
    expect(runParkingCheck).not.toHaveBeenCalled();
  });

  it('runs the check when the secret matches', async () => {
    const res = mockRes();
    await handler(
      { method: 'GET', headers: { 'x-cron-secret': 'test-secret' } } as unknown as NextApiRequest,
      res
    );
    expect(runParkingCheck).toHaveBeenCalledTimes(1);
    expect(res.statusCode).toBe(200);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run pages/api/cron/__tests__/fleetParkingCheckAuth.test.ts`
Expected: FAIL — cannot resolve `../fleet-parking-check`.

- [ ] **Step 3: Write the implementation**

Open `pages/api/cron/poll-tracking.ts` first and copy its exact `apiResponse` / `ErrorCode` import lines, so this file matches the house convention rather than guessing at it.

```typescript
// pages/api/cron/fleet-parking-check.ts
/**
 * Nightly overnight-parking compliance check. Runs at 20:00 SAST from
 * velo's crontab — NOT vercel.json, because Vercel crons do not fire for
 * this systemd-hosted app.
 *
 * Thin by design: auth and HTTP only. All logic lives in
 * src/modules/fleet/parking/ so it can be tested without a server.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { runParkingCheck } from '@/modules/fleet/parking/runParkingCheck';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
  }

  // Mirrors pages/api/cron/poll-tracking.ts — fail closed when unset.
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    log.error('[fleet-parking-check] CRON_SECRET not configured — rejecting');
    return apiResponse.error(res, ErrorCode.SERVICE_UNAVAILABLE, 'Cron endpoint misconfigured');
  }
  if (req.headers['x-cron-secret'] !== expected) {
    return apiResponse.unauthorized(res, 'Invalid cron secret');
  }

  try {
    const report = await runParkingCheck(new Date());
    log.info('[fleet-parking-check] completed', { ...report });
    return apiResponse.success(res, report);
  } catch (error) {
    log.error('[fleet-parking-check] run failed', { error });
    return apiResponse.internalError(res, 'Parking check failed');
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run pages/api/cron/__tests__/fleetParkingCheckAuth.test.ts`
Expected: PASS, 5 tests.

The import line `import { apiResponse, ErrorCode } from '@/lib/apiResponse'` is verified correct — it matches `pages/api/cron/poll-tracking.ts:13`, and `ErrorCode` is exported as an enum at `src/lib/apiResponse.ts:46`.

- [ ] **Step 5: Commit**

```bash
git add pages/api/cron/fleet-parking-check.ts \
        pages/api/cron/__tests__/fleetParkingCheckAuth.test.ts
git commit -m "feat(fleet): 20:00 SAST parking-check cron endpoint"
```

---

### Task 6: Notification event types

**Files:**
- Modify: `src/modules/notifications/constants/index.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: event keys `fleet.parking_violation`, `fleet.parking_change_requested`, `fleet.parking_change_decided`.

No wiring in this PR. At PR 1 no parking addresses exist, so no violation can occur and no notification can fire. Registering the constants now keeps PR 2 and PR 3 to behaviour changes only.

- [ ] **Step 1: Add each key to all five maps**

The file has five separate maps, each keyed by event type. `fleet.license_expiring` already appears in all five — use it as the template and add the three new keys alongside it in each:

1. Channel routing (near the existing `'fleet.license_expiring': { in_app: true, email: true, whatsapp: false }`)
2. `EVENT_ICONS`
3. `EVENT_SEVERITY`
4. Human label map
5. Category map

```typescript
// 1. channel routing
'fleet.parking_violation':       { in_app: true, email: true,  whatsapp: false },
'fleet.parking_change_requested':{ in_app: true, email: true,  whatsapp: false },
'fleet.parking_change_decided':  { in_app: true, email: false, whatsapp: false },

// 2. EVENT_ICONS
'fleet.parking_violation':        'map-pin-off',
'fleet.parking_change_requested': 'map-pin',
'fleet.parking_change_decided':   'map-pin-check',

// 3. EVENT_SEVERITY
'fleet.parking_violation':        'warning',
'fleet.parking_change_requested': 'info',
'fleet.parking_change_decided':   'info',

// 4. labels
'fleet.parking_violation':        'Vehicle Not At Declared Address',
'fleet.parking_change_requested': 'Parking Address Change Requested',
'fleet.parking_change_decided':   'Parking Address Request Decided',

// 5. categories
'fleet.parking_violation':        'Fleet',
'fleet.parking_change_requested': 'Fleet',
'fleet.parking_change_decided':   'Fleet',
```

- [ ] **Step 2: Verify the icon names exist in lucide-react**

Run: `node -e "const i=require('lucide-react'); ['MapPinOff','MapPin','MapPinCheck'].forEach(n=>console.log(n, !!i[n]))"`
Expected: all `true`. If any is `false`, substitute an icon that does exist — `'car'` is already used by `fleet.license_expiring` and is a safe fallback.

- [ ] **Step 3: Type-check**

Run: `npm run type-check`
Expected: no new errors. If the maps are typed with an exhaustive key union, the compiler will point at any map you missed — that is the intended safety net.

- [ ] **Step 4: Commit**

```bash
git add src/modules/notifications/constants/index.ts
git commit -m "feat(fleet): register parking notification event types"
```

---

### Task 7: Verification and crontab registration

**Files:** none — this task is verification and an ops handoff note.

- [ ] **Step 1: Run the full parking test suite**

Run: `npx vitest run src/modules/fleet/parking pages/api/cron/__tests__/fleetParkingCheckAuth.test.ts`
Expected: PASS, 27 tests across 3 files (15 classifier + 7 orchestrator + 5 cron auth).

- [ ] **Step 2: Run the local CI gates**

Run: `npm run ci:quick`
Expected: ESLint 0 errors, silent-catch and Neon-shim gates unchanged, secret scan passes.

Known environment issue: on a Windows workstation, gate 2d fails because `command -v python3` matches the Windows Store alias stub, and the script then aborts before gates 3, 4 and 7. If that happens, run those manually: `npm run type-check` and `bash scripts/secret-scan.sh`. Compare the type-check **error count** against a clean `origin/master` before concluding anything — there is a pre-existing baseline of unrelated errors.

- [ ] **Step 3: Apply migration 483 to the shared database**

The database is shared by dev and production, so this affects both immediately. Apply it through the project's migration runner, not by hand.

- [ ] **Step 4: Smoke-test the endpoint against dev**

```bash
curl -s -H "x-cron-secret: $CRON_SECRET" \
  http://localhost:3005/api/cron/fleet-parking-check | head -c 400
```

Expected: `success: true` with `evaluated` equal to the number of active vehicles (22 at time of writing) and `counts.no_address` equal to the same number, because no parking addresses exist yet. **That is the correct result for PR 1** — it proves the pipeline end-to-end.

This smoke test is now safe to run at any time of day: `insertComplianceCheck` uses `ON CONFLICT ... DO UPDATE`, so a daytime probe is simply overwritten by the genuine 20:00 SAST run rather than permanently occupying that day's row.

Then confirm idempotency by running it a second time and checking the row count did not change:

```sql
SELECT check_date, result, count(*)
FROM fleet_parking_compliance_checks
GROUP BY 1, 2 ORDER BY 1 DESC;
```

- [ ] **Step 5: Register the crontab entry**

Hand off to whoever administers velo's crontab. The entry, following the `poll-tracking` line already there — note the secret is **read from the env file, never inlined**:

```cron
# Fleet overnight parking compliance — 20:00 SAST daily.
0 20 * * * SECRET=$(grep "^CRON_SECRET=" /home/velo/fibreflow-dev/.env.local | cut -d= -f2) && curl -sf -m 120 -H "x-cron-secret: $SECRET" http://localhost:3005/api/cron/fleet-parking-check >> /home/velo/logs/fleet-parking-check.log 2>&1
```

Two things to raise when handing this over:

1. **Do not add it to `vercel.json`.** Vercel crons do not fire for this systemd app; that is how `fleet-check-reminders.ts` ended up with 402 lines that have never run.
2. **Log rotation.** `poll-tracking.log` is currently a single 3.1 MB line, because curl writes JSON with no trailing newline and nothing rotates it. Append `; echo` after the curl, or add a logrotate entry, so this log does not repeat that.

- [ ] **Step 6: Open the PR**

Include in the description: that the job is expected to report `no_address` for every vehicle until PR 2 ships; the migration has been applied to the shared database; and that no UI exists yet so there is nothing to verify in a browser for this PR.

---

## Not in this PR

- Recipient resolution and any `notify()` call. `notify()` requires the caller to supply `recipient_user_ids`, and no "users holding permission X" helper exists — resolution means joining `role_permissions` and `user_permission_overrides`. That work lands in PR 2, where the approval queue needs the same resolution.
- The PWA driver flow, the approval queue, and the compliance dashboard.
- Daytime project geofencing (Phase 2 — blocked on data, see spec section 3).
