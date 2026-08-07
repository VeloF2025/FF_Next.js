# Fleet Parking Compliance — PR 2 (Driver PWA) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give a driver in the `/my` PWA a way to declare — and request a change to — the address where their assigned vehicle is parked overnight, so the already-merged 20:00 SAST compliance cron has something to check against.

**Architecture:** One API route (`/api/my/vehicle/parking`, GET/POST/DELETE) wrapped in `withMySession`, backed by a driver-side query module that sits beside the existing nightly-check query module. The vehicle is resolved **server-side** from the session; a `vehicleId` in the request body is ignored. Validation lives in a pure module so the accuracy gate and coordinate checks are testable without a request. One page at `/my/vehicle/parking` with four states, plus a hub tile rendered under the same condition as the existing `VehicleTile`.

**Tech Stack:** TypeScript, Next.js 14.2 Pages Router, `sql` tagged template from `@/lib/db-pool`, Vitest, Tailwind (dark theme), `lucide-react`, `notify()` from the notification bus.

**Spec:** `docs/superpowers/specs/2026-08-04-fleet-parking-compliance-design.md` §6, §8, §10, §11, §12

**Depends on:** PR 1 (merged — migration `483_fleet_parking_compliance.sql`, `src/modules/fleet/parking/{types,classifyParkingCompliance,parkingQueries,runParkingCheck}.ts`, cron endpoint, and all three `fleet.parking_*` notification event types already registered in all five maps in `src/modules/notifications/constants/index.ts`).

## Global Constraints

- **Branch off fresh `origin/master`.** Never commit to master. Branch: `feat/fleet-parking-driver-pwa`. All changes go through a PR.
- **No credential values in any tracked file.**
- **New files < 300 lines. New components < 200 lines.** CI ratchets this.
- **No `console.log`** — use `log` from `@/lib/logger`. No empty catch blocks. Changed code fully typed.
- **Conditional tagged-template SQL fragments are broken in this repo.** Never write ``${cond ? sql`AND x` : sql``}``. Use explicit query branches.
- **`notify()` is fire-and-forget**: `notify({...}).catch(...)` — never `await` it in a request handler. Callers resolve `recipient_user_ids`; the bus does not look them up.
- **`vehicle_assignments` stores a registration string, not a vehicle FK.** The join to `fleet_vehicles` is `ON v.registration = va.vehicle_registration` (precedent: `pages/api/my/fleet-handoff.ts`).
- **node-postgres returns `NUMERIC` as a string.** Cast to text in SQL and parse in TypeScript, as `parkingQueries.ts` already does.
- Use `apiResponse` helpers from `@/lib/apiResponse` for every response.
- Run `npm run ci:quick` before the PR.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/modules/fleet/parking/types.ts` (modify) | Add driver-side types alongside the existing nightly-check types |
| `src/modules/fleet/parking/declarationRules.ts` (create) | Pure validation: accuracy gate, coordinate range, label/note normalisation |
| `src/modules/fleet/parking/driverParkingQueries.ts` (create) | All driver-side SQL: resolve vehicle, load state, insert pending, withdraw |
| `src/modules/fleet/parking/parkingNotifications.ts` (create) | Resolve approver user ids + fire `fleet.parking_change_requested` |
| `pages/api/my/vehicle/parking.ts` (create) | GET/POST/DELETE, session-scoped, thin |
| `src/modules/fleet/parking/client/parkingApi.ts` (create) | Typed client wrapper over the route |
| `src/modules/fleet/parking/client/ParkingStates.tsx` (create) | Presentational views for the four states |
| `src/modules/fleet/parking/client/ParkingCapture.tsx` (create) | GPS capture + submit form |
| `pages/my/vehicle/parking.tsx` (create) | Page shell: load state, choose view |
| `src/modules/attendance/portal/client/tiles.tsx` (modify) | Add `ParkingTile` |
| `src/modules/attendance/portal/client/MyHub.tsx` (modify) | Render `ParkingTile` under `profile.hasAssignedVehicle` |

---

### Task 1: Pure declaration rules

The accuracy gate is the single most consequential rule on the driver side: storing a fix with 500 m of error guarantees false violations for the life of that address (spec §8). It belongs outside the route handler so it can be tested without a request.

**Files:**
- Modify: `src/modules/fleet/parking/types.ts`
- Create: `src/modules/fleet/parking/declarationRules.ts`
- Test: `src/modules/fleet/parking/__tests__/declarationRules.test.ts`

**Interfaces:**
- Consumes: `isValidLatLon` from `@/lib/geo`
- Produces: `MAX_CAPTURE_ACCURACY_M`, `validateDeclaration(input: DeclarationInput): ValidationResult`, and the types `ParkingDeclarationStatus`, `ParkingDeclaration`, `DriverParkingState`, `DeclarationInput`

- [ ] **Step 1: Add the driver-side types**

Append to `src/modules/fleet/parking/types.ts` (leave the existing nightly-check types untouched):

```typescript
/** Lifecycle of a declared parking address (migration 483). */
export type ParkingDeclarationStatus =
  | 'pending'
  | 'active'
  | 'superseded'
  | 'rejected'
  | 'withdrawn';

/** One row of fleet_vehicle_parking_locations, as the driver sees it. */
export interface ParkingDeclaration {
  id: string;
  status: ParkingDeclarationStatus;
  lat: number;
  lon: number;
  accuracyM: number | null;
  radiusM: number;
  label: string | null;
  addressText: string | null;
  requestNote: string | null;
  decisionNote: string | null;
  effectiveFrom: string | null;
  decidedAt: string | null;
  createdAt: string;
}

/** Everything /my/vehicle/parking needs in one round-trip. */
export interface DriverParkingState {
  vehicle: { id: string; registration: string };
  active: ParkingDeclaration | null;
  pending: ParkingDeclaration | null;
  /** Most recent decided rows, newest first. Excludes active and pending. */
  history: ParkingDeclaration[];
}

/** Raw, untrusted body of a POST from the capture flow. */
export interface DeclarationInput {
  lat: unknown;
  lon: unknown;
  accuracyM: unknown;
  label?: unknown;
  requestNote?: unknown;
}
```

- [ ] **Step 2: Write the failing test**

Create `src/modules/fleet/parking/__tests__/declarationRules.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { validateDeclaration, MAX_CAPTURE_ACCURACY_M } from '../declarationRules';

const GOOD = { lat: -26.2041, lon: 28.0473, accuracyM: 12 };

describe('validateDeclaration', () => {
  it('accepts a well-formed capture', () => {
    const r = validateDeclaration(GOOD);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toEqual({
      lat: -26.2041,
      lon: 28.0473,
      accuracyM: 12,
      label: null,
      requestNote: null,
    });
  });

  it('trims a label and a note, and nulls them when blank', () => {
    const r = validateDeclaration({ ...GOOD, label: '  My yard  ', requestNote: '   ' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.label).toBe('My yard');
    expect(r.value.requestNote).toBeNull();
  });

  // The gate exists because a 500m-error fix guarantees false violations
  // for the life of the address. Boundary is inclusive: exactly 100m passes.
  it(`accepts accuracy of exactly ${MAX_CAPTURE_ACCURACY_M}m`, () => {
    expect(validateDeclaration({ ...GOOD, accuracyM: MAX_CAPTURE_ACCURACY_M }).ok).toBe(true);
  });

  it('rejects accuracy one metre beyond the gate', () => {
    const r = validateDeclaration({ ...GOOD, accuracyM: MAX_CAPTURE_ACCURACY_M + 1 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/accurate/i);
  });

  it.each([
    ['a missing lat', { ...GOOD, lat: undefined }],
    ['a non-numeric lat', { ...GOOD, lat: 'here' }],
    ['NaN', { ...GOOD, lat: NaN }],
    ['an out-of-range lat', { ...GOOD, lat: 91 }],
    ['an out-of-range lon', { ...GOOD, lon: 181 }],
  ])('rejects %s', (_label, input) => {
    expect(validateDeclaration(input).ok).toBe(false);
  });

  // A missing accuracy is not the same as a good one: the browser always
  // supplies it, so absence means something is wrong with the capture.
  it('rejects a missing accuracy', () => {
    expect(validateDeclaration({ ...GOOD, accuracyM: undefined }).ok).toBe(false);
  });

  it('rejects a negative accuracy', () => {
    expect(validateDeclaration({ ...GOOD, accuracyM: -1 }).ok).toBe(false);
  });

  // label is VARCHAR(120): a longer value is a 22001 from Postgres, which
  // would surface as a 500. Reject it here as a 400 instead.
  it('rejects a label longer than 120 characters', () => {
    expect(validateDeclaration({ ...GOOD, label: 'x'.repeat(121) }).ok).toBe(false);
  });

  it('accepts a label of exactly 120 characters', () => {
    expect(validateDeclaration({ ...GOOD, label: 'x'.repeat(120) }).ok).toBe(true);
  });

  it('rejects a note longer than 1000 characters', () => {
    expect(validateDeclaration({ ...GOOD, requestNote: 'x'.repeat(1001) }).ok).toBe(false);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run src/modules/fleet/parking/__tests__/declarationRules.test.ts`
Expected: FAIL — cannot resolve `../declarationRules`.

- [ ] **Step 4: Write the implementation**

Create `src/modules/fleet/parking/declarationRules.ts`:

```typescript
/**
 * Pure validation for a driver's parking-address capture.
 *
 * Kept outside the route handler for the reason given in the design spec
 * §12: the rules are the part worth testing, and they need no infrastructure.
 *
 * The accuracy gate is the rule that matters. A capture with 500m of error
 * sits inside a 200m compliance radius by luck alone, and every nightly
 * check against that address for the rest of its life inherits the error.
 * Rejecting the capture and asking the driver to step into the open is far
 * cheaper than a disputed violation months later.
 */
import { isValidLatLon } from '@/lib/geo';
import type { DeclarationInput } from './types';

/** Inclusive ceiling, in metres, on the GPS accuracy of a capture. */
export const MAX_CAPTURE_ACCURACY_M = 100;

/** label is VARCHAR(120) in migration 483. */
const MAX_LABEL_LENGTH = 120;
/** request_note is TEXT; this bound is a sanity limit, not a schema one. */
const MAX_NOTE_LENGTH = 1000;

export interface ValidDeclaration {
  lat: number;
  lon: number;
  accuracyM: number;
  label: string | null;
  requestNote: string | null;
}

export type ValidationResult =
  | { ok: true; value: ValidDeclaration }
  | { ok: false; error: string };

function cleanText(value: unknown, max: number, field: string): { ok: true; value: string | null } | { ok: false; error: string } {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (typeof value !== 'string') return { ok: false, error: `${field} must be text` };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { ok: true, value: null };
  if (trimmed.length > max) return { ok: false, error: `${field} must be ${max} characters or fewer` };
  return { ok: true, value: trimmed };
}

export function validateDeclaration(input: DeclarationInput): ValidationResult {
  const lat = Number(input.lat);
  const lon = Number(input.lon);
  // Number(undefined) is NaN and Number(null) is 0 — isValidLatLon rejects
  // the first, so guard null explicitly rather than storing 0,0.
  if (input.lat === null || input.lon === null || !isValidLatLon({ lat, lon })) {
    return { ok: false, error: 'A valid latitude and longitude are required' };
  }

  if (input.accuracyM === undefined || input.accuracyM === null) {
    return { ok: false, error: 'GPS accuracy is required' };
  }
  const accuracyM = Number(input.accuracyM);
  if (!Number.isFinite(accuracyM) || accuracyM < 0) {
    return { ok: false, error: 'GPS accuracy is required' };
  }
  if (accuracyM > MAX_CAPTURE_ACCURACY_M) {
    return {
      ok: false,
      error: `Your location is only accurate to ${Math.round(accuracyM)}m. Move into the open, away from buildings, and try again.`,
    };
  }

  const label = cleanText(input.label, MAX_LABEL_LENGTH, 'Label');
  if (!label.ok) return label;
  const requestNote = cleanText(input.requestNote, MAX_NOTE_LENGTH, 'Note');
  if (!requestNote.ok) return requestNote;

  return {
    ok: true,
    value: { lat, lon, accuracyM, label: label.value, requestNote: requestNote.value },
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run src/modules/fleet/parking/__tests__/declarationRules.test.ts`
Expected: PASS, all cases.

- [ ] **Step 6: Commit**

```bash
git add src/modules/fleet/parking/types.ts src/modules/fleet/parking/declarationRules.ts src/modules/fleet/parking/__tests__/declarationRules.test.ts
git commit -m "feat(fleet): validation rules for a driver parking declaration"
```

---

### Task 2: Driver-side query layer

**Files:**
- Create: `src/modules/fleet/parking/driverParkingQueries.ts`
- Test: `src/modules/fleet/parking/__tests__/driverParkingQueries.test.ts`

**Interfaces:**
- Consumes: `sql` from `@/lib/db-pool`; types from `./types`
- Produces:
  - `resolveDriverVehicle(staffId: string): Promise<{ vehicleId: string; registration: string } | null>`
  - `loadDriverParkingState(vehicleId: string): Promise<{ active: ParkingDeclaration | null; pending: ParkingDeclaration | null; history: ParkingDeclaration[] }>`
  - `insertPendingDeclaration(args: InsertDeclarationArgs): Promise<ParkingDeclaration>`
  - `withdrawPendingDeclaration(vehicleId: string, staffId: string): Promise<boolean>`
  - `PENDING_CONFLICT` (the `ux_parking_pending_per_vehicle` index name, exported so the route can recognise a 23505 without string-literal duplication)

- [ ] **Step 1: Write the failing test**

Create `src/modules/fleet/parking/__tests__/driverParkingQueries.test.ts`. The `sql` tag is mocked, so these tests assert the *shape* the module maps into — the parsing of `NUMERIC`-as-string is the part that silently breaks:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
vi.mock('@/lib/db-pool', () => ({
  sql: (...args: unknown[]) => sqlMock(...args),
}));

import { loadDriverParkingState, resolveDriverVehicle } from '../driverParkingQueries';

beforeEach(() => {
  sqlMock.mockReset();
});

describe('resolveDriverVehicle', () => {
  it('returns null when the driver has no active assignment', async () => {
    sqlMock.mockResolvedValue([]);
    expect(await resolveDriverVehicle('staff-1')).toBeNull();
  });

  it('maps the joined row', async () => {
    sqlMock.mockResolvedValue([{ vehicle_id: 'veh-1', registration: 'LN40MGGP' }]);
    expect(await resolveDriverVehicle('staff-1')).toEqual({
      vehicleId: 'veh-1',
      registration: 'LN40MGGP',
    });
  });
});

describe('loadDriverParkingState', () => {
  // node-postgres hands back NUMERIC as a string. A declaration whose lat
  // stayed "-26.2041000" would render fine and compare wrong.
  it('parses numeric columns into numbers', async () => {
    sqlMock.mockResolvedValue([
      {
        id: 'loc-1',
        status: 'active',
        lat: '-26.2041000',
        lon: '28.0473000',
        accuracy_m: '11.5',
        radius_m: 200,
        label: 'My yard',
        address_text: 'Braamfontein, Johannesburg',
        request_note: null,
        decision_note: null,
        effective_from: '2026-08-01T10:00:00.000Z',
        decided_at: '2026-08-01T10:00:00.000Z',
        created_at: '2026-07-31T18:00:00.000Z',
      },
    ]);

    const state = await loadDriverParkingState('veh-1');

    expect(state.active).toMatchObject({
      id: 'loc-1',
      lat: -26.2041,
      lon: 28.0473,
      accuracyM: 11.5,
      radiusM: 200,
    });
    expect(state.pending).toBeNull();
    expect(state.history).toEqual([]);
  });

  it('splits active, pending and history out of one result set', async () => {
    const base = {
      lat: '-26.2', lon: '28.0', accuracy_m: '10', radius_m: 200,
      label: null, address_text: null, request_note: null, decision_note: null,
      effective_from: null, decided_at: null, created_at: '2026-08-01T00:00:00.000Z',
    };
    sqlMock.mockResolvedValue([
      { ...base, id: 'p', status: 'pending' },
      { ...base, id: 'a', status: 'active' },
      { ...base, id: 'r', status: 'rejected' },
      { ...base, id: 's', status: 'superseded' },
    ]);

    const state = await loadDriverParkingState('veh-1');

    expect(state.active?.id).toBe('a');
    expect(state.pending?.id).toBe('p');
    expect(state.history.map((h) => h.id)).toEqual(['r', 's']);
  });

  it('returns nulls when the vehicle has no declarations at all', async () => {
    sqlMock.mockResolvedValue([]);
    const state = await loadDriverParkingState('veh-1');
    expect(state).toEqual({ active: null, pending: null, history: [] });
  });

  // accuracy_m is nullable in migration 483; Number(null) is 0, which would
  // silently claim a perfect fix.
  it('keeps a null accuracy as null rather than coercing it to zero', async () => {
    sqlMock.mockResolvedValue([
      {
        id: 'loc-1', status: 'active', lat: '-26.2', lon: '28.0', accuracy_m: null,
        radius_m: 200, label: null, address_text: null, request_note: null,
        decision_note: null, effective_from: null, decided_at: null,
        created_at: '2026-08-01T00:00:00.000Z',
      },
    ]);
    const state = await loadDriverParkingState('veh-1');
    expect(state.active?.accuracyM).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/modules/fleet/parking/__tests__/driverParkingQueries.test.ts`
Expected: FAIL — cannot resolve `../driverParkingQueries`.

- [ ] **Step 3: Write the implementation**

Create `src/modules/fleet/parking/driverParkingQueries.ts`:

```typescript
/**
 * All SQL for the driver side of overnight parking compliance.
 *
 * Separate from parkingQueries.ts, which serves the nightly job: that module
 * reads every active vehicle at once, this one reads and writes exactly one
 * vehicle's declarations on behalf of the signed-in driver.
 *
 * Numerics are cast to text and parsed in TypeScript for the reason given in
 * parkingQueries.ts: node-postgres returns NUMERIC as a string.
 */
import { sql } from '@/lib/db-pool';
import type { ParkingDeclaration, ParkingDeclarationStatus } from './types';

/**
 * Name of the partial unique index that enforces "one open request per
 * vehicle" (migration 483). Exported so the route can recognise the 23505 it
 * raises without duplicating the string.
 */
export const PENDING_CONFLICT = 'ux_parking_pending_per_vehicle';

interface DeclarationRow extends Record<string, unknown> {
  id: string;
  status: ParkingDeclarationStatus;
  lat: string;
  lon: string;
  accuracy_m: string | null;
  radius_m: number;
  label: string | null;
  address_text: string | null;
  request_note: string | null;
  decision_note: string | null;
  effective_from: string | Date | null;
  decided_at: string | Date | null;
  created_at: string | Date;
}

function toIso(value: string | Date | null): string | null {
  if (value === null) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function mapDeclaration(r: DeclarationRow): ParkingDeclaration {
  return {
    id: r.id,
    status: r.status,
    lat: Number(r.lat),
    lon: Number(r.lon),
    accuracyM: r.accuracy_m === null ? null : Number(r.accuracy_m),
    radiusM: Number(r.radius_m),
    label: r.label,
    addressText: r.address_text,
    requestNote: r.request_note,
    decisionNote: r.decision_note,
    effectiveFrom: toIso(r.effective_from),
    decidedAt: toIso(r.decided_at),
    createdAt: toIso(r.created_at) as string,
  };
}

/**
 * Resolve the signed-in driver's vehicle.
 *
 * vehicle_assignments stores the registration string rather than a vehicle
 * FK, so the join is on registration — the same shape as
 * pages/api/my/fleet-handoff.ts. is_active is filtered here because
 * assignments are ended by flag, not by deletion.
 */
export async function resolveDriverVehicle(
  staffId: string
): Promise<{ vehicleId: string; registration: string } | null> {
  const rows = await sql<{ vehicle_id: string; registration: string }>`
    SELECT v.id AS vehicle_id, v.registration
    FROM vehicle_assignments va
    JOIN fleet_vehicles v ON v.registration = va.vehicle_registration
    WHERE va.staff_id = ${staffId}
      AND va.is_active = true
    ORDER BY va.assignment_start DESC
    LIMIT 1
  `;
  const row = rows[0];
  return row ? { vehicleId: row.vehicle_id, registration: row.registration } : null;
}

/**
 * Every declaration for one vehicle, split by status.
 *
 * One query rather than three: at most a handful of rows exist per vehicle,
 * and the partial unique indexes guarantee at most one active and one
 * pending among them.
 */
export async function loadDriverParkingState(vehicleId: string): Promise<{
  active: ParkingDeclaration | null;
  pending: ParkingDeclaration | null;
  history: ParkingDeclaration[];
}> {
  const rows = await sql<DeclarationRow>`
    SELECT id, status, lat::text AS lat, lon::text AS lon,
           accuracy_m::text AS accuracy_m, radius_m,
           label, address_text, request_note, decision_note,
           effective_from, decided_at, created_at
    FROM fleet_vehicle_parking_locations
    WHERE vehicle_id = ${vehicleId}
    ORDER BY created_at DESC
    LIMIT 20
  `;

  const all = rows.map(mapDeclaration);
  return {
    active: all.find((d) => d.status === 'active') ?? null,
    pending: all.find((d) => d.status === 'pending') ?? null,
    history: all.filter((d) => d.status !== 'active' && d.status !== 'pending'),
  };
}

export interface InsertDeclarationArgs {
  vehicleId: string;
  staffId: string;
  lat: number;
  lon: number;
  accuracyM: number;
  label: string | null;
  addressText: string | null;
  requestNote: string | null;
}

/**
 * Insert a submission as `pending` (spec §6.1 — even a first declaration is
 * approved, not auto-activated). A second open request raises 23505 on
 * ux_parking_pending_per_vehicle; the caller turns that into a 409 rather
 * than pre-checking, so two rapid taps cannot both pass a check and then
 * both insert.
 */
export async function insertPendingDeclaration(
  args: InsertDeclarationArgs
): Promise<ParkingDeclaration> {
  const rows = await sql<DeclarationRow>`
    INSERT INTO fleet_vehicle_parking_locations (
      vehicle_id, declared_by_staff_id, lat, lon, accuracy_m,
      label, address_text, status, request_note
    ) VALUES (
      ${args.vehicleId}, ${args.staffId}, ${args.lat}, ${args.lon}, ${args.accuracyM},
      ${args.label}, ${args.addressText}, 'pending', ${args.requestNote}
    )
    RETURNING id, status, lat::text AS lat, lon::text AS lon,
              accuracy_m::text AS accuracy_m, radius_m,
              label, address_text, request_note, decision_note,
              effective_from, decided_at, created_at
  `;
  return mapDeclaration(rows[0]!);
}

/**
 * Withdraw the driver's own open request.
 *
 * Scoped by declared_by_staff_id as well as vehicle_id: the vehicle already
 * comes from the session, and this keeps a re-assigned vehicle's previous
 * driver from withdrawing the current driver's request. Returns whether a
 * row was actually withdrawn.
 */
export async function withdrawPendingDeclaration(
  vehicleId: string,
  staffId: string
): Promise<boolean> {
  const rows = await sql<{ id: string }>`
    UPDATE fleet_vehicle_parking_locations
       SET status = 'withdrawn', updated_at = now()
     WHERE vehicle_id = ${vehicleId}
       AND declared_by_staff_id = ${staffId}
       AND status = 'pending'
    RETURNING id
  `;
  return rows.length > 0;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/modules/fleet/parking/__tests__/driverParkingQueries.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/fleet/parking/driverParkingQueries.ts src/modules/fleet/parking/__tests__/driverParkingQueries.test.ts
git commit -m "feat(fleet): driver-side query layer for parking declarations"
```

---

### Task 3: Approver notification

The fleet module's first `notify()` call. All three `fleet.parking_*` event types are already registered in all five maps in `src/modules/notifications/constants/index.ts` (PR 1) — do not add them again.

**Files:**
- Create: `src/modules/fleet/parking/parkingNotifications.ts`
- Test: `src/modules/fleet/parking/__tests__/parkingNotifications.test.ts`

**Interfaces:**
- Consumes: `notify` from `@/modules/notifications/services/notificationBus`; `sql` from `@/lib/db-pool`; `log` from `@/lib/logger`
- Produces: `notifyParkingChangeRequested(args: { registration: string; driverName: string | null; declarationId: string }): Promise<void>`

- [ ] **Step 1: Write the failing test**

Create `src/modules/fleet/parking/__tests__/parkingNotifications.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const sqlMock = vi.fn();
const notifyMock = vi.fn();
vi.mock('@/lib/db-pool', () => ({ sql: (...a: unknown[]) => sqlMock(...a) }));
vi.mock('@/modules/notifications/services/notificationBus', () => ({
  notify: (...a: unknown[]) => notifyMock(...a),
}));

import { notifyParkingChangeRequested } from '../parkingNotifications';

const ARGS = { registration: 'LN40MGGP', driverName: 'Thabo M', declarationId: 'loc-1' };

beforeEach(() => {
  sqlMock.mockReset();
  notifyMock.mockReset();
  notifyMock.mockResolvedValue(undefined);
});

describe('notifyParkingChangeRequested', () => {
  it('notifies every user whose role can approve', async () => {
    sqlMock.mockResolvedValue([{ id: 'user-1' }, { id: 'user-2' }]);

    await notifyParkingChangeRequested(ARGS);

    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock.mock.calls[0][0]).toMatchObject({
      event_type: 'fleet.parking_change_requested',
      source_module: 'fleet',
      source_id: 'loc-1',
      action_url: '/fleet/parking/requests',
      recipient_user_ids: ['user-1', 'user-2'],
    });
  });

  // The bus warns and no-ops on an empty recipient list; calling it with one
  // buys nothing and hides the real problem, which is that nobody holds the
  // permission.
  it('does not call the bus when no approver exists', async () => {
    sqlMock.mockResolvedValue([]);
    await notifyParkingChangeRequested(ARGS);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  // A parking request that succeeded must not 500 because the bell is down.
  it('swallows a bus failure', async () => {
    sqlMock.mockResolvedValue([{ id: 'user-1' }]);
    notifyMock.mockRejectedValue(new Error('bus down'));
    await expect(notifyParkingChangeRequested(ARGS)).resolves.toBeUndefined();
  });

  it('swallows a recipient-lookup failure', async () => {
    sqlMock.mockRejectedValue(new Error('db down'));
    await expect(notifyParkingChangeRequested(ARGS)).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/modules/fleet/parking/__tests__/parkingNotifications.test.ts`
Expected: FAIL — cannot resolve `../parkingNotifications`.

- [ ] **Step 3: Write the implementation**

Create `src/modules/fleet/parking/parkingNotifications.ts`:

```typescript
/**
 * Telling the approvers that a driver wants an address changed.
 *
 * "Approver" is not a role in this codebase — authorization is page-based
 * (design spec §9.1). It means anyone whose role holds view on
 * fleet.parking-requests, which migration 483 seeds for super_admin, admin
 * and manager.
 *
 * Known limitation, recorded deliberately: this resolves recipients from
 * role_permissions only. A user granted the page through
 * user_permission_overrides is not notified, and one revoked through an
 * override still is. Folding overrides in means per-user evaluation
 * (src/lib/permissions/index.ts works one user at a time) for a set that is
 * currently three roles wide; when the approval queue in PR 3 needs the same
 * list, the two should share one resolver and that is the point to revisit it.
 */
import { sql } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import { notify } from '@/modules/notifications/services/notificationBus';

const APPROVER_PERMISSION = 'fleet.parking-requests';

async function findApproverUserIds(): Promise<string[]> {
  const rows = await sql<{ id: string }>`
    SELECT u.id
    FROM users u
    JOIN role_permissions rp ON rp.role = u.role
    WHERE u.is_active = true
      AND rp.permission_key = ${APPROVER_PERMISSION}
      AND rp.actions->>'view' = 'true'
  `;
  return rows.map((r) => r.id);
}

export async function notifyParkingChangeRequested(args: {
  registration: string;
  driverName: string | null;
  declarationId: string;
}): Promise<void> {
  try {
    const recipients = await findApproverUserIds();
    if (recipients.length === 0) {
      log.warn(
        '[fleet/parking] change requested but no user holds the approval permission',
        { permission: APPROVER_PERMISSION, declarationId: args.declarationId },
        'fleet'
      );
      return;
    }

    const who = args.driverName ?? 'A driver';
    await notify({
      event_type: 'fleet.parking_change_requested',
      title: `Parking address request for ${args.registration}`,
      body: `${who} submitted an overnight parking address for ${args.registration} and is waiting for approval.`,
      action_url: '/fleet/parking/requests',
      source_module: 'fleet',
      source_id: args.declarationId,
      recipient_user_ids: recipients,
    });
  } catch (err) {
    // The declaration is already stored. A notification failure must not
    // turn a successful submission into a 500 the driver retries.
    log.error(
      '[fleet/parking] failed to notify approvers of a change request',
      { error: err, declarationId: args.declarationId },
      'fleet'
    );
  }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/modules/fleet/parking/__tests__/parkingNotifications.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/fleet/parking/parkingNotifications.ts src/modules/fleet/parking/__tests__/parkingNotifications.test.ts
git commit -m "feat(fleet): notify approvers when a driver requests a parking address"
```

---

### Task 4: The API route

**Files:**
- Create: `pages/api/my/vehicle/parking.ts`
- Test: `pages/api/my/vehicle/__tests__/parking.test.ts`

**Interfaces:**
- Consumes: `withMySession`; `validateDeclaration`; `resolveDriverVehicle`, `loadDriverParkingState`, `insertPendingDeclaration`, `withdrawPendingDeclaration`, `PENDING_CONFLICT`; `notifyParkingChangeRequested`; `reverseGeocode` from `@/utils/geoLocation`
- Produces: the HTTP contract consumed by Task 5 —
  - `GET` → `200 { vehicle, active, pending, history }` (a `DriverParkingState`), `404` when the caller has no active vehicle assignment
  - `POST { lat, lon, accuracyM, label?, requestNote? }` → `201 { declaration }`, `400` on validation, `409` when a request is already open
  - `DELETE` → `200 { withdrawn: true }`, `404` when nothing is open

- [ ] **Step 1: Write the failing test**

Create `pages/api/my/vehicle/__tests__/parking.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { NextApiRequest, NextApiResponse } from 'next';

const SESSION = { staffId: 'staff-1', staffName: 'Thabo M' };

vi.mock('@/modules/attendance/portal/authMiddleware', () => ({
  withMySession:
    (handler: (req: NextApiRequest, res: NextApiResponse, s: unknown) => unknown) =>
    (req: NextApiRequest, res: NextApiResponse) =>
      handler(req, res, SESSION),
}));

const resolveDriverVehicle = vi.fn();
const loadDriverParkingState = vi.fn();
const insertPendingDeclaration = vi.fn();
const withdrawPendingDeclaration = vi.fn();
vi.mock('@/modules/fleet/parking/driverParkingQueries', () => ({
  PENDING_CONFLICT: 'ux_parking_pending_per_vehicle',
  resolveDriverVehicle: (...a: unknown[]) => resolveDriverVehicle(...a),
  loadDriverParkingState: (...a: unknown[]) => loadDriverParkingState(...a),
  insertPendingDeclaration: (...a: unknown[]) => insertPendingDeclaration(...a),
  withdrawPendingDeclaration: (...a: unknown[]) => withdrawPendingDeclaration(...a),
}));

const notifyParkingChangeRequested = vi.fn();
vi.mock('@/modules/fleet/parking/parkingNotifications', () => ({
  notifyParkingChangeRequested: (...a: unknown[]) => notifyParkingChangeRequested(...a),
}));

const reverseGeocode = vi.fn();
vi.mock('@/utils/geoLocation', () => ({
  reverseGeocode: (...a: unknown[]) => reverseGeocode(...a),
}));

import handler from '../parking';

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
  return Promise.resolve(handler(req as NextApiRequest, res)).then(() => res);
}

const VEHICLE = { vehicleId: 'veh-1', registration: 'LN40MGGP' };
const GOOD_BODY = { lat: -26.2041, lon: 28.0473, accuracyM: 12 };
const DECLARATION = { id: 'loc-1', status: 'pending' };

beforeEach(() => {
  resolveDriverVehicle.mockReset().mockResolvedValue(VEHICLE);
  loadDriverParkingState.mockReset().mockResolvedValue({ active: null, pending: null, history: [] });
  insertPendingDeclaration.mockReset().mockResolvedValue(DECLARATION);
  withdrawPendingDeclaration.mockReset().mockResolvedValue(true);
  notifyParkingChangeRequested.mockReset().mockResolvedValue(undefined);
  reverseGeocode.mockReset().mockResolvedValue({ city: 'Johannesburg', province: 'Gauteng' });
});

describe('GET /api/my/vehicle/parking', () => {
  it('returns the vehicle and its declarations', async () => {
    loadDriverParkingState.mockResolvedValue({
      active: { id: 'a' }, pending: null, history: [],
    });
    const res = await call({ method: 'GET' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      data: { vehicle: { id: 'veh-1', registration: 'LN40MGGP' }, active: { id: 'a' } },
    });
  });

  it('404s when the caller has no active vehicle', async () => {
    resolveDriverVehicle.mockResolvedValue(null);
    const res = await call({ method: 'GET' });
    expect(res.statusCode).toBe(404);
    expect(loadDriverParkingState).not.toHaveBeenCalled();
  });
});

describe('POST /api/my/vehicle/parking', () => {
  it('stores a valid capture as pending and notifies approvers', async () => {
    const res = await call({ method: 'POST', body: GOOD_BODY });
    expect(res.statusCode).toBe(201);
    expect(insertPendingDeclaration).toHaveBeenCalledTimes(1);
    expect(insertPendingDeclaration.mock.calls[0][0]).toMatchObject({
      vehicleId: 'veh-1',
      staffId: 'staff-1',
      lat: -26.2041,
      lon: 28.0473,
    });
    expect(notifyParkingChangeRequested).toHaveBeenCalledTimes(1);
  });

  /**
   * The security property of the whole route. A driver must not be able to
   * declare a parking address for someone else's vehicle by naming it in the
   * body — the same hole closed for the fleet portal on 2026-07-30.
   */
  it('ignores a vehicleId supplied in the body', async () => {
    const res = await call({
      method: 'POST',
      body: { ...GOOD_BODY, vehicleId: 'someone-elses-vehicle' },
    });
    expect(res.statusCode).toBe(201);
    expect(insertPendingDeclaration.mock.calls[0][0].vehicleId).toBe('veh-1');
  });

  it('ignores a staffId supplied in the body', async () => {
    await call({ method: 'POST', body: { ...GOOD_BODY, staffId: 'someone-else' } });
    expect(insertPendingDeclaration.mock.calls[0][0].staffId).toBe('staff-1');
  });

  it('rejects a capture that is too inaccurate', async () => {
    const res = await call({ method: 'POST', body: { ...GOOD_BODY, accuracyM: 250 } });
    expect(res.statusCode).toBe(400);
    expect(insertPendingDeclaration).not.toHaveBeenCalled();
  });

  it('rejects invalid coordinates', async () => {
    const res = await call({ method: 'POST', body: { ...GOOD_BODY, lat: 'somewhere' } });
    expect(res.statusCode).toBe(400);
    expect(insertPendingDeclaration).not.toHaveBeenCalled();
  });

  it('404s when the caller has no active vehicle', async () => {
    resolveDriverVehicle.mockResolvedValue(null);
    const res = await call({ method: 'POST', body: GOOD_BODY });
    expect(res.statusCode).toBe(404);
    expect(insertPendingDeclaration).not.toHaveBeenCalled();
  });

  // The partial unique index is the authority on "one open request", not an
  // application pre-check that two rapid taps can both pass.
  it('turns the pending-conflict 23505 into a 409', async () => {
    insertPendingDeclaration.mockRejectedValue(
      Object.assign(new Error('duplicate key'), {
        code: '23505',
        constraint: 'ux_parking_pending_per_vehicle',
      })
    );
    const res = await call({ method: 'POST', body: GOOD_BODY });
    expect(res.statusCode).toBe(409);
  });

  it('still 500s on an unrelated database error', async () => {
    insertPendingDeclaration.mockRejectedValue(new Error('connection reset'));
    const res = await call({ method: 'POST', body: GOOD_BODY });
    expect(res.statusCode).toBe(500);
  });

  // Spec §11: a failed reverse geocode stores coordinates anyway.
  it('stores the declaration when reverse geocoding fails', async () => {
    reverseGeocode.mockResolvedValue(null);
    const res = await call({ method: 'POST', body: GOOD_BODY });
    expect(res.statusCode).toBe(201);
    expect(insertPendingDeclaration.mock.calls[0][0].addressText).toBeNull();
  });

  it('stores the declaration when reverse geocoding throws', async () => {
    reverseGeocode.mockRejectedValue(new Error('nominatim down'));
    const res = await call({ method: 'POST', body: GOOD_BODY });
    expect(res.statusCode).toBe(201);
    expect(insertPendingDeclaration.mock.calls[0][0].addressText).toBeNull();
  });
});

describe('DELETE /api/my/vehicle/parking', () => {
  it('withdraws the open request', async () => {
    const res = await call({ method: 'DELETE' });
    expect(res.statusCode).toBe(200);
    expect(withdrawPendingDeclaration).toHaveBeenCalledWith('veh-1', 'staff-1');
  });

  it('404s when there is nothing to withdraw', async () => {
    withdrawPendingDeclaration.mockResolvedValue(false);
    const res = await call({ method: 'DELETE' });
    expect(res.statusCode).toBe(404);
  });
});

describe('method handling', () => {
  it('rejects an unsupported method', async () => {
    const res = await call({ method: 'PUT', body: {} });
    expect(res.statusCode).toBe(405);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run pages/api/my/vehicle/__tests__/parking.test.ts`
Expected: FAIL — cannot resolve `../parking`.

- [ ] **Step 3: Write the implementation**

Create `pages/api/my/vehicle/parking.ts`:

```typescript
/**
 * /api/my/vehicle/parking — the driver's overnight parking address.
 *
 *   GET    → the caller's vehicle plus its active, pending and past declarations
 *   POST   → submit a declaration or a change request (stored as `pending`)
 *   DELETE → withdraw the caller's own open request
 *
 * The vehicle is resolved server-side from the session on every method. A
 * `vehicleId` in the body is ignored, which is the point: it mirrors the
 * portal-auth hardening of 2026-07-30 (canAccessPortalVehicle) that closed
 * exactly this class of hole.
 *
 * Design: docs/superpowers/specs/2026-08-04-fleet-parking-compliance-design.md §8
 */
import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import { validateDeclaration } from '@/modules/fleet/parking/declarationRules';
import {
  PENDING_CONFLICT,
  insertPendingDeclaration,
  loadDriverParkingState,
  resolveDriverVehicle,
  withdrawPendingDeclaration,
} from '@/modules/fleet/parking/driverParkingQueries';
import { notifyParkingChangeRequested } from '@/modules/fleet/parking/parkingNotifications';
import { reverseGeocode } from '@/utils/geoLocation';

export const config = {
  api: { bodyParser: { sizeLimit: '8kb' } },
};

/** Postgres unique-violation carrying the constraint that was hit. */
function isPendingConflict(err: unknown): boolean {
  const e = err as { code?: string; constraint?: string };
  return e?.code === '23505' && e?.constraint === PENDING_CONFLICT;
}

/**
 * A human-readable label for the capture. Resolved server-side rather than
 * taken from the body — the client has already asked /api/my/geocode for the
 * same coordinates, so this normally lands on that route's TTL cache instead
 * of a second Nominatim call, and an untrusted address never reaches the row.
 *
 * Spec §11: a failure here stores coordinates with no label. Never fatal.
 */
async function resolveAddressText(lat: number, lon: number): Promise<string | null> {
  try {
    const geo = await reverseGeocode(lat, lon);
    if (!geo) return null;
    const parts = [geo.city, geo.municipalDistrict, geo.province].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : null;
  } catch (err) {
    log.warn('[my/vehicle/parking] reverse geocode failed', { error: err }, 'fleet');
    return null;
  }
}

export default withMySession(async (req, res, session) => {
  const method = req.method ?? 'UNKNOWN';
  if (method !== 'GET' && method !== 'POST' && method !== 'DELETE') {
    return apiResponse.methodNotAllowed(res, method, ['GET', 'POST', 'DELETE']);
  }

  try {
    const vehicle = await resolveDriverVehicle(session.staffId);
    if (!vehicle) {
      return apiResponse.notFound(res, 'Active vehicle assignment', session.staffId);
    }

    if (method === 'GET') {
      const state = await loadDriverParkingState(vehicle.vehicleId);
      return apiResponse.success(res, {
        vehicle: { id: vehicle.vehicleId, registration: vehicle.registration },
        ...state,
      });
    }

    if (method === 'DELETE') {
      const withdrawn = await withdrawPendingDeclaration(vehicle.vehicleId, session.staffId);
      if (!withdrawn) {
        return apiResponse.notFound(res, 'Open parking request', vehicle.registration);
      }
      return apiResponse.success(res, { withdrawn: true });
    }

    const parsed = validateDeclaration((req.body ?? {}) as Record<string, unknown>);
    if (!parsed.ok) {
      return apiResponse.badRequest(res, parsed.error);
    }

    const addressText = await resolveAddressText(parsed.value.lat, parsed.value.lon);
    const declaration = await insertPendingDeclaration({
      vehicleId: vehicle.vehicleId,
      staffId: session.staffId,
      lat: parsed.value.lat,
      lon: parsed.value.lon,
      accuracyM: parsed.value.accuracyM,
      label: parsed.value.label,
      addressText,
      requestNote: parsed.value.requestNote,
    });

    // Fire-and-forget: the declaration is stored, and the module's own
    // helper already swallows and logs its failures.
    void notifyParkingChangeRequested({
      registration: vehicle.registration,
      driverName: session.staffName ?? null,
      declarationId: declaration.id,
    });

    res.status(201);
    return apiResponse.success(res, { declaration });
  } catch (err) {
    if (isPendingConflict(err)) {
      return apiResponse.conflict(
        res,
        'You already have a parking address request waiting for approval. Withdraw it before submitting another.'
      );
    }
    log.error('[my/vehicle/parking] request failed', { error: err, method }, 'fleet');
    return apiResponse.internalError(res, err);
  }
});
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run pages/api/my/vehicle/__tests__/parking.test.ts`
Expected: PASS.

If `apiResponse.success` overrides the 201 set beforehand, set the status inside the helper call instead — check `src/lib/apiResponse.ts:123` for whether `success` calls `res.status(200)` unconditionally, and if it does, use the helper's status argument rather than a pre-set `res.status(201)`. Adjust the test's expectation only if the helper genuinely cannot express 201; a created row should not report 200.

- [ ] **Step 5: Verify the session field name**

`session.staffName` is used for the notification body. Confirm the field exists on `AttendanceSession`:

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "my/vehicle/parking" || echo "no type errors in the route"`

If `staffName` is not on the type, read `src/modules/attendance/portal/types.ts` and use the field that carries the staff's display name, or pass `null` and let the notification read "A driver".

- [ ] **Step 6: Commit**

```bash
git add pages/api/my/vehicle/parking.ts pages/api/my/vehicle/__tests__/parking.test.ts
git commit -m "feat(my-portal): parking declaration API scoped to the session's vehicle"
```

---

### Task 5: Client API wrapper

**Files:**
- Create: `src/modules/fleet/parking/client/parkingApi.ts`

**Interfaces:**
- Consumes: the HTTP contract from Task 4; types from `../types`
- Produces: `fetchParkingState()`, `submitDeclaration(body)`, `withdrawDeclaration()`, `fetchGeocodeLabel(lat, lon)`, and `ParkingApiError` (carrying `status` so the page can distinguish 404-no-vehicle from a real failure)

- [ ] **Step 1: Write the implementation**

No test for this task: it is a thin `fetch` wrapper with no branching worth pinning, and the behaviour that matters is covered by the route tests above and the browser verification in Task 8.

Create `src/modules/fleet/parking/client/parkingApi.ts`:

```typescript
/**
 * Typed client wrapper over /api/my/vehicle/parking.
 *
 * Kept out of the page so the page file stays a view. Every function throws
 * ParkingApiError with the HTTP status attached — the page distinguishes a
 * 404 (no vehicle assigned) from a genuine failure.
 */
import type { DriverParkingState, ParkingDeclaration } from '../types';

export class ParkingApiError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ParkingApiError';
    this.status = status;
  }
}

interface Envelope<T> {
  success: boolean;
  data?: T;
  error?: { message?: string };
}

async function request<T>(init: RequestInit & { url: string }): Promise<T> {
  const { url, ...rest } = init;
  const res = await fetch(url, {
    credentials: 'same-origin',
    ...rest,
  });
  let payload: Envelope<T> | null = null;
  try {
    payload = (await res.json()) as Envelope<T>;
  } catch {
    // A non-JSON body (a proxy error page, say) is a failure with no message.
    payload = null;
  }
  if (!res.ok || !payload?.success || payload.data === undefined) {
    throw new ParkingApiError(
      payload?.error?.message ?? 'Something went wrong. Please try again.',
      res.status
    );
  }
  return payload.data;
}

export function fetchParkingState(): Promise<DriverParkingState> {
  return request<DriverParkingState>({ url: '/api/my/vehicle/parking', method: 'GET' });
}

export interface DeclarationBody {
  lat: number;
  lon: number;
  accuracyM: number;
  label?: string;
  requestNote?: string;
}

export function submitDeclaration(body: DeclarationBody): Promise<{ declaration: ParkingDeclaration }> {
  return request<{ declaration: ParkingDeclaration }>({
    url: '/api/my/vehicle/parking',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export function withdrawDeclaration(): Promise<{ withdrawn: boolean }> {
  return request<{ withdrawn: boolean }>({ url: '/api/my/vehicle/parking', method: 'DELETE' });
}

/**
 * Display-only label for a freshly captured point. The route never throws and
 * always answers `{ geocode: … | null }`, so a failure here is silent and the
 * UI falls back to "Unnamed location" (spec §11).
 */
export async function fetchGeocodeLabel(lat: number, lon: number): Promise<string | null> {
  try {
    const res = await fetch(`/api/my/geocode?lat=${lat}&lon=${lon}`, { credentials: 'same-origin' });
    if (!res.ok) return null;
    const payload = (await res.json()) as {
      data?: { geocode?: { city?: string; municipalDistrict?: string; province?: string } | null };
    };
    const geo = payload.data?.geocode;
    if (!geo) return null;
    const parts = [geo.city, geo.municipalDistrict, geo.province].filter(Boolean);
    return parts.length > 0 ? parts.join(', ') : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep "parkingApi" || echo "clean"`
Expected: `clean`.

- [ ] **Step 3: Commit**

```bash
git add src/modules/fleet/parking/client/parkingApi.ts
git commit -m "feat(fleet): client wrapper for the driver parking API"
```

---

### Task 6: Capture component

**Files:**
- Create: `src/modules/fleet/parking/client/ParkingCapture.tsx`

**Interfaces:**
- Consumes: `captureGPSWithFallback`, `queryGeolocationPermission` from `@/modules/fleet/offline/gpsCapture`; `MAX_CAPTURE_ACCURACY_M` from `../declarationRules`; `fetchGeocodeLabel`, `submitDeclaration` from `./parkingApi`
- Produces: `<ParkingCapture registration={string} isChange={boolean} onDone={() => void} onCancel={() => void} />`

- [ ] **Step 1: Write the implementation**

Reuse the existing capture helper rather than calling `navigator.geolocation` directly — it already carries the iOS watchdog and the low-accuracy fallback added in PR #1448.

Create `src/modules/fleet/parking/client/ParkingCapture.tsx`:

```tsx
/**
 * Capture the point where a vehicle is parked overnight.
 *
 * Two decisions worth knowing about:
 *
 *   - The accuracy gate is enforced here as well as on the server. The server
 *     is the authority; doing it in the browser too means the driver learns to
 *     step into the open before they have typed a label, not after.
 *   - There is no map picker and no address search. The driver is standing at
 *     the spot — that is the whole reason on-site capture was chosen over
 *     forward geocoding (design §2).
 */
import React from 'react';
import { MapPin, LocateFixed, AlertTriangle } from 'lucide-react';

import { captureGPSWithFallback } from '@/modules/fleet/offline/gpsCapture';
import { MAX_CAPTURE_ACCURACY_M } from '../declarationRules';
import { fetchGeocodeLabel, submitDeclaration, ParkingApiError } from './parkingApi';

interface Fix {
  lat: number;
  lon: number;
  accuracyM: number;
  addressLabel: string | null;
}

const inputCls =
  'w-full px-3 py-2.5 bg-neutral-950 border border-neutral-700 rounded-lg text-neutral-100 focus:outline-none focus:ring-2 focus:ring-emerald-500';

export function ParkingCapture({
  registration,
  isChange,
  onDone,
  onCancel,
}: {
  registration: string;
  isChange: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [fix, setFix] = React.useState<Fix | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [label, setLabel] = React.useState('');
  const [note, setNote] = React.useState('');

  const capture = async () => {
    setBusy(true);
    setError(null);
    const result = await captureGPSWithFallback();
    if (!result.success || !result.coordinates) {
      setError(
        result.errorKind === 'denied'
          ? 'Location permission is off. Turn it on for this site in your browser settings, then reload this page.'
          : (result.error ?? 'Could not read your location. Try again in the open.')
      );
      setBusy(false);
      return;
    }
    const { latitude, longitude, accuracy } = result.coordinates;
    if (accuracy > MAX_CAPTURE_ACCURACY_M) {
      setError(
        `Your location is only accurate to ${Math.round(accuracy)}m. Move into the open, away from buildings and roofs, then try again.`
      );
      setBusy(false);
      return;
    }
    const addressLabel = await fetchGeocodeLabel(latitude, longitude);
    setFix({ lat: latitude, lon: longitude, accuracyM: accuracy, addressLabel });
    setBusy(false);
  };

  const submit = async () => {
    if (!fix) return;
    setBusy(true);
    setError(null);
    try {
      await submitDeclaration({
        lat: fix.lat,
        lon: fix.lon,
        accuracyM: fix.accuracyM,
        label: label.trim() || undefined,
        requestNote: note.trim() || undefined,
      });
      onDone();
    } catch (err) {
      setError(
        err instanceof ParkingApiError ? err.message : 'Could not submit. Please try again.'
      );
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
        <h2 className="text-sm font-semibold text-neutral-100">
          {isChange ? `Change where ${registration} parks` : `Where is ${registration} parked overnight?`}
        </h2>
        <p className="text-xs text-neutral-400 mt-1">
          Stand where you park the vehicle at night and tap the button below. Your manager
          approves the address before it takes effect.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 flex gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-300 shrink-0 mt-0.5" />
          <p className="text-xs text-amber-100">{error}</p>
        </div>
      )}

      {!fix ? (
        <button
          type="button"
          onClick={capture}
          disabled={busy}
          className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-medium rounded-lg flex items-center justify-center gap-2"
        >
          <LocateFixed className="w-4 h-4" />
          {busy ? 'Finding your location…' : 'Use my current location'}
        </button>
      ) : (
        <div className="space-y-4">
          <div className="rounded-2xl border border-neutral-800 bg-neutral-900 p-4">
            <div className="flex items-start gap-2">
              <MapPin className="w-4 h-4 text-emerald-300 shrink-0 mt-0.5" />
              <div>
                <div className="text-sm text-neutral-100">
                  {fix.addressLabel ?? 'Unnamed location'}
                </div>
                <div className="text-xs text-neutral-400 mt-0.5">
                  {fix.lat.toFixed(6)}, {fix.lon.toFixed(6)} · accurate to {Math.round(fix.accuracyM)}m
                </div>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setFix(null)}
              className="text-xs text-neutral-400 underline mt-3"
            >
              Capture again
            </button>
          </div>

          <div>
            <label htmlFor="parking-label" className="block text-sm font-medium text-neutral-200 mb-2">
              Name this place <span className="text-neutral-500">(optional)</span>
            </label>
            <input
              id="parking-label"
              className={inputCls}
              maxLength={120}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="My yard"
            />
          </div>

          <div>
            <label htmlFor="parking-note" className="block text-sm font-medium text-neutral-200 mb-2">
              {isChange ? 'Why are you changing it?' : 'Anything your manager should know?'}{' '}
              <span className="text-neutral-500">(optional)</span>
            </label>
            <textarea
              id="parking-note"
              className={inputCls}
              rows={3}
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </div>

          <button
            type="button"
            onClick={submit}
            disabled={busy}
            className="w-full px-4 py-3 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-medium rounded-lg"
          >
            {busy ? 'Sending…' : 'Send for approval'}
          </button>
        </div>
      )}

      <button type="button" onClick={onCancel} className="w-full text-xs text-neutral-400 underline">
        Cancel
      </button>
    </div>
  );
}
```

- [ ] **Step 2: Check the file is under the component limit**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep ParkingCapture || echo "clean"`
Then: `wc -l src/modules/fleet/parking/client/ParkingCapture.tsx`
Expected: clean, and under 200 lines. If it is over, move the label/note fields into a small sibling component rather than trimming the comments.

- [ ] **Step 3: Commit**

```bash
git add src/modules/fleet/parking/client/ParkingCapture.tsx
git commit -m "feat(fleet): on-site GPS capture for a parking declaration"
```

---

### Task 7: State views and the page

**Files:**
- Create: `src/modules/fleet/parking/client/ParkingStates.tsx`
- Create: `pages/my/vehicle/parking.tsx`

**Interfaces:**
- Consumes: `DriverParkingState`, `ParkingDeclaration`; `ParkingCapture`; `fetchParkingState`, `withdrawDeclaration`, `ParkingApiError`; `MyPortalShell` from `@/modules/attendance/portal/client/MyPortalShell`
- Produces: the route `/my/vehicle/parking`

- [ ] **Step 1: Write the state views**

Create `src/modules/fleet/parking/client/ParkingStates.tsx`:

```tsx
/**
 * The four states of a driver's parking address: none, pending, active,
 * rejected. Presentational only — the page owns loading and mutations.
 */
import React from 'react';
import { MapPin, Clock, CheckCircle2, XCircle } from 'lucide-react';

import type { ParkingDeclaration } from '../types';

const CARD = 'rounded-2xl border border-neutral-800 bg-neutral-900 p-4';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Intl.DateTimeFormat('en-ZA', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Africa/Johannesburg',
  }).format(new Date(iso));
}

function Where({ declaration }: { declaration: ParkingDeclaration }) {
  return (
    <div className="flex items-start gap-2">
      <MapPin className="w-4 h-4 text-neutral-400 shrink-0 mt-0.5" />
      <div>
        <div className="text-sm text-neutral-100">
          {declaration.label ?? declaration.addressText ?? 'Unnamed location'}
        </div>
        {declaration.label && declaration.addressText && (
          <div className="text-xs text-neutral-400 mt-0.5">{declaration.addressText}</div>
        )}
        <div className="text-xs text-neutral-500 mt-0.5">
          {declaration.lat.toFixed(5)}, {declaration.lon.toFixed(5)} · {declaration.radiusM}m radius
        </div>
      </div>
    </div>
  );
}

export function NoAddressState({ registration, onStart }: { registration: string; onStart: () => void }) {
  return (
    <div className={CARD}>
      <h2 className="text-sm font-semibold text-neutral-100">
        Register where {registration} is parked overnight
      </h2>
      <p className="text-xs text-neutral-400 mt-1">
        Your vehicle is checked every night at 20:00 against the address you register here.
        Until you register one, those checks record that no address is on file.
      </p>
      <button
        type="button"
        onClick={onStart}
        className="w-full mt-4 px-4 py-3 bg-emerald-600 hover:bg-emerald-500 text-white font-medium rounded-lg"
      >
        Register an address
      </button>
    </div>
  );
}

export function ActiveState({
  declaration,
  onChange,
}: {
  declaration: ParkingDeclaration;
  onChange: () => void;
}) {
  return (
    <div className={CARD}>
      <div className="flex items-center gap-2 mb-3">
        <CheckCircle2 className="w-4 h-4 text-emerald-300" />
        <span className="text-xs uppercase tracking-wide text-emerald-300 font-semibold">
          Approved
        </span>
      </div>
      <Where declaration={declaration} />
      <div className="text-xs text-neutral-500 mt-3">
        In effect since {formatDate(declaration.effectiveFrom ?? declaration.createdAt)}
      </div>
      <button
        type="button"
        onClick={onChange}
        className="w-full mt-4 px-4 py-2.5 border border-neutral-700 hover:bg-neutral-800 text-neutral-100 rounded-lg text-sm"
      >
        Request a change
      </button>
    </div>
  );
}

export function PendingState({
  declaration,
  onWithdraw,
  withdrawing,
}: {
  declaration: ParkingDeclaration;
  onWithdraw: () => void;
  withdrawing: boolean;
}) {
  return (
    <div className={CARD}>
      <div className="flex items-center gap-2 mb-3">
        <Clock className="w-4 h-4 text-amber-300" />
        <span className="text-xs uppercase tracking-wide text-amber-300 font-semibold">
          Waiting for approval
        </span>
      </div>
      <Where declaration={declaration} />
      {declaration.requestNote && (
        <p className="text-xs text-neutral-400 mt-3">Your note: {declaration.requestNote}</p>
      )}
      <div className="text-xs text-neutral-500 mt-3">Sent {formatDate(declaration.createdAt)}</div>
      <button
        type="button"
        onClick={onWithdraw}
        disabled={withdrawing}
        className="w-full mt-4 px-4 py-2.5 border border-neutral-700 hover:bg-neutral-800 disabled:opacity-60 text-neutral-100 rounded-lg text-sm"
      >
        {withdrawing ? 'Withdrawing…' : 'Withdraw this request'}
      </button>
    </div>
  );
}

export function RejectedNotice({ declaration }: { declaration: ParkingDeclaration }) {
  return (
    <div className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4">
      <div className="flex items-center gap-2 mb-2">
        <XCircle className="w-4 h-4 text-red-300" />
        <span className="text-xs uppercase tracking-wide text-red-300 font-semibold">
          Last request declined
        </span>
      </div>
      <p className="text-xs text-red-100">
        {declaration.decisionNote ?? 'No reason was given. Ask your manager before resubmitting.'}
      </p>
      <div className="text-xs text-red-200/70 mt-2">{formatDate(declaration.decidedAt)}</div>
    </div>
  );
}
```

- [ ] **Step 2: Write the page**

Create `pages/my/vehicle/parking.tsx`:

```tsx
/**
 * /my/vehicle/parking — the driver's overnight parking address.
 *
 * Four states, one at a time: no address, pending request, approved address,
 * and the capture flow that produces a request. A rejection notice rides above
 * whichever state applies, because the manager's reason is the thing the
 * driver needs before they resubmit.
 *
 * Design: docs/superpowers/specs/2026-08-04-fleet-parking-compliance-design.md §8
 */
import type { NextPage } from 'next';
import React from 'react';
import { useRouter } from 'next/router';

import { MyPortalShell } from '@/modules/attendance/portal/client/MyPortalShell';
import { ParkingCapture } from '@/modules/fleet/parking/client/ParkingCapture';
import {
  ActiveState,
  NoAddressState,
  PendingState,
  RejectedNotice,
} from '@/modules/fleet/parking/client/ParkingStates';
import {
  ParkingApiError,
  fetchParkingState,
  withdrawDeclaration,
} from '@/modules/fleet/parking/client/parkingApi';
import type { DriverParkingState } from '@/modules/fleet/parking/types';

const ParkingPage: NextPage & { getLayout?: (p: React.ReactElement) => React.ReactElement } = () => {
  const router = useRouter();
  const [state, setState] = React.useState<DriverParkingState | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [capturing, setCapturing] = React.useState(false);
  const [withdrawing, setWithdrawing] = React.useState(false);

  const load = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setState(await fetchParkingState());
    } catch (err) {
      setError(
        err instanceof ParkingApiError && err.status === 404
          ? 'You do not have a vehicle assigned, so there is nothing to register here.'
          : 'Could not load your parking address. Pull down to try again.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    void load();
  }, [load]);

  const withdraw = async () => {
    setWithdrawing(true);
    try {
      await withdrawDeclaration();
      await load();
    } catch (err) {
      setError(err instanceof ParkingApiError ? err.message : 'Could not withdraw the request.');
    } finally {
      setWithdrawing(false);
    }
  };

  // Only surface a rejection that is still the newest thing that happened:
  // once a request is approved or a new one is open, the old refusal is noise.
  const lastRejection =
    state && !state.pending && !state.active
      ? (state.history.find((h) => h.status === 'rejected') ?? null)
      : null;

  return (
    <MyPortalShell title="Vehicle parking" onBack={() => router.push('/my')}>
      <div className="space-y-4">
        {loading && <p className="text-sm text-neutral-400">Loading…</p>}

        {error && !loading && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 p-3">
            <p className="text-xs text-red-100">{error}</p>
          </div>
        )}

        {state && !loading && (
          <>
            {lastRejection && <RejectedNotice declaration={lastRejection} />}

            {capturing ? (
              <ParkingCapture
                registration={state.vehicle.registration}
                isChange={state.active !== null}
                onDone={() => {
                  setCapturing(false);
                  void load();
                }}
                onCancel={() => setCapturing(false)}
              />
            ) : state.pending ? (
              <PendingState
                declaration={state.pending}
                onWithdraw={withdraw}
                withdrawing={withdrawing}
              />
            ) : state.active ? (
              <ActiveState declaration={state.active} onChange={() => setCapturing(true)} />
            ) : (
              <NoAddressState
                registration={state.vehicle.registration}
                onStart={() => setCapturing(true)}
              />
            )}
          </>
        )}
      </div>
    </MyPortalShell>
  );
};

ParkingPage.getLayout = (page: React.ReactElement) => page;

export const getServerSideProps = async () => ({ props: {} });

export default ParkingPage;
```

- [ ] **Step 3: Verify the shell's props**

`MyPortalShell` is used here with `title` and `onBack`. Confirm those are its actual props:

Run: `grep -n "interface\|Props\|title\|onBack" src/modules/attendance/portal/client/MyPortalShell.tsx | head -20`

If the prop names differ, match the existing usage in `pages/my/hs-checkin.tsx` exactly rather than inventing props.

- [ ] **Step 4: Type-check and check file sizes**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "parking|Parking" || echo "clean"`
Run: `wc -l pages/my/vehicle/parking.tsx src/modules/fleet/parking/client/ParkingStates.tsx`
Expected: clean; both files under 200 lines.

- [ ] **Step 5: Commit**

```bash
git add src/modules/fleet/parking/client/ParkingStates.tsx pages/my/vehicle/parking.tsx
git commit -m "feat(my-portal): /my/vehicle/parking page for declaring an overnight address"
```

---

### Task 8: Hub tile

**Files:**
- Modify: `src/modules/attendance/portal/client/tiles.tsx`
- Modify: `src/modules/attendance/portal/client/MyHub.tsx`

**Interfaces:**
- Consumes: the `Tile` primitive at the bottom of `tiles.tsx`
- Produces: `ParkingTile`, rendered on the hub under the same `profile.hasAssignedVehicle` condition as `VehicleTile`

- [ ] **Step 1: Add the tile**

In `src/modules/attendance/portal/client/tiles.tsx`, add `MapPin` to the existing `lucide-react` import and append this export beside `VehicleTile`:

```tsx
/**
 * Overnight parking address. Rendered on the same condition as VehicleTile —
 * a driver with no vehicle has nothing to declare — so the hub does not grow
 * a dead tile for office staff.
 */
export function ParkingTile({ hasVehicle, onClick }: { hasVehicle: boolean; onClick: () => void }) {
  if (!hasVehicle) return null;
  return (
    <Tile
      onClick={onClick}
      icon={<MapPin className="w-5 h-5" />}
      iconClass="bg-indigo-500/15 text-indigo-300"
      title="Vehicle parking"
      subtitle="Where you park overnight"
    />
  );
}
```

- [ ] **Step 2: Render it on the hub**

In `src/modules/attendance/portal/client/MyHub.tsx`, add `ParkingTile` to the import list from `./tiles`, and render it immediately after the existing `<VehicleTile … />` inside the same conditional block:

```tsx
<ParkingTile
  hasVehicle={profile.hasAssignedVehicle}
  onClick={() => router.push('/my/vehicle/parking')}
/>
```

- [ ] **Step 3: Type-check**

Run: `npx tsc --noEmit -p tsconfig.json 2>&1 | grep -E "tiles|MyHub" || echo "clean"`
Expected: `clean`.

- [ ] **Step 4: Commit**

```bash
git add src/modules/attendance/portal/client/tiles.tsx src/modules/attendance/portal/client/MyHub.tsx
git commit -m "feat(my-portal): vehicle parking tile on the hub"
```

---

### Task 9: Docs, CI, and the PR

**Files:**
- Modify: `src/modules/fleet/.claude.md`
- Modify: `.claude/modules/fleet.md`

- [ ] **Step 1: Record the driver flow in the fleet module docs**

Add to `.claude/modules/fleet.md`, under a new `## Overnight Parking Compliance` heading (the file's existing "Recent Changes" sections stop at Feb 2026 — do not rewrite them, just append the new section):

```markdown
## Overnight Parking Compliance

Drivers declare where their assigned vehicle parks overnight; a 20:00 SAST cron
checks the last known position against it.

| Piece | Where |
|---|---|
| Schema | migration `483_fleet_parking_compliance.sql` |
| Classifier (pure) | `src/modules/fleet/parking/classifyParkingCompliance.ts` |
| Nightly job | `pages/api/cron/fleet-parking-check.ts` + `scripts/cron-fleet-parking-check.sh` |
| Driver API | `pages/api/my/vehicle/parking.ts` (GET/POST/DELETE) |
| Driver page | `/my/vehicle/parking` |

**The vehicle is always resolved from the session.** A `vehicleId` in the request
body is ignored — see the test `ignores a vehicleId supplied in the body`.

**A submission is always `pending`.** Even a driver's first address needs approval;
the partial unique indexes `ux_parking_active_per_vehicle` and
`ux_parking_pending_per_vehicle` enforce one of each per vehicle in the database
rather than in application code.

**Accuracy gate: 100 m** (`MAX_CAPTURE_ACCURACY_M`). A wider fix is rejected at
capture — a 500 m error inside a 200 m radius poisons every future check on that
address.

Still to build (PR 3): the fleet-side approval queue at `/fleet/parking/requests`
and the compliance dashboard at `/fleet/parking`. Both permission keys are already
seeded by migration 483.
```

Add the same table, trimmed to the file/route list, to `src/modules/fleet/.claude.md` — keep that file's ≤50-line target in mind, so add only the five-row table and the two bold rules.

- [ ] **Step 2: Mirror the agent docs**

Run: `npm run agents:mirror && npm run agents:check`
Expected: `agents:check` passes. Never hand-edit `AGENTS.md`.

- [ ] **Step 3: Run the full parking test suite**

Run: `npx vitest run src/modules/fleet/parking pages/api/my/vehicle`
Expected: PASS — including the PR 1 tests, which must not have regressed.

- [ ] **Step 4: Run CI**

Run: `npm run ci:quick`
Expected: PASS. If the lint warning budget is exceeded, fix the warnings rather than raising the budget.

- [ ] **Step 5: Commit and open the PR**

```bash
git add .claude/modules/fleet.md src/modules/fleet/.claude.md src/modules/fleet/AGENTS.md
git commit -m "docs(fleet): record the driver parking declaration flow"
git push -u origin feat/fleet-parking-driver-pwa
gh pr create --title "feat(fleet): overnight parking compliance — PR 2 of 3 (driver PWA)" --body "..."
```

**Stop at "PR opened".** Do not merge and do not deploy — that is Hein's call.

---

### Task 10: Browser verification (blocked on this workstation — hand off)

Spec §12 states plainly that the capture flow must be checked in a real browser and that it cannot be done from the current workstation (no browser extension). Do not claim the feature works without this.

- [ ] **Step 1: Write the verification script into the PR body**

The PR description must list what a person with a phone or browser automation has to confirm on dev:

1. `/my` shows the **Vehicle parking** tile for a driver with an assigned vehicle, and does **not** show it for office staff with none.
2. Tapping it opens `/my/vehicle/parking` in the "no address" state naming the correct registration.
3. "Use my current location" prompts for GPS, and denying it produces the permission guidance rather than a spinner that never ends.
4. A successful capture shows coordinates, an accuracy figure, and either a geocoded label or "Unnamed location".
5. Submitting moves the page to "Waiting for approval", and the row lands in
   `fleet_vehicle_parking_locations` with `status = 'pending'`.
6. A second submission attempt returns the 409 message rather than a 500.
7. "Withdraw this request" returns the page to the "no address" state.
8. An approver receives the in-app notification.

- [ ] **Step 2: Flag the open ops items in the PR body**

None of these are code, and all three gate the feature actually working on dev:

- Migration **483** must be applied to the shared database.
- The **20:00 SAST crontab entry** for `scripts/cron-fleet-parking-check.sh` must be registered in velo's crontab.
- Until PR 3 ships there is **no approval UI**, so a pending request can only be approved directly in the database. Say so explicitly — otherwise the first driver to submit one waits forever.

---

## Self-Review

**Spec coverage (§8, §8.1, §10, §11):**

| Spec requirement | Task |
|---|---|
| "Vehicle parking" tile on `/my` hub, same condition as `VehicleTile` | Task 8 |
| Page `/my/vehicle/parking` | Task 7 |
| State: no address | Task 7 (`NoAddressState`) |
| State: active | Task 7 (`ActiveState`) |
| State: pending, with withdraw | Task 7 (`PendingState`) + Task 4 (DELETE) |
| State: rejected, showing `decision_note` | Task 7 (`RejectedNotice`) |
| Capture flow: geolocation → coordinates + accuracy → geocode label | Task 6 |
| Accuracy gate at 100 m | Task 1 (server) + Task 6 (client) |
| `GET /api/my/vehicle/parking` | Task 4 |
| `POST /api/my/vehicle/parking` with `{lat, lon, accuracyM, label?, requestNote?}` | Task 4 |
| Both wrapped in `withMySession` | Task 4 |
| Vehicle resolved server-side; body `vehicleId` ignored | Task 4 (test: "ignores a vehicleId supplied in the body") |
| `fleet.parking_change_requested` to approvers | Task 3 |
| Reverse geocode failure → store coordinates, label falls back | Task 4 + Task 6 |
| GPS denied → explicit guidance, never silent | Task 6 |
| No empty catch blocks; `log` from `@/lib/logger` | Tasks 3, 4 |
| Offline not supported in v1 | Not built — correct, no task |

**Deliberately not in this PR** (they belong to PR 3, per the spec's own split): the approval queue at `/fleet/parking/requests`, the compliance dashboard at `/fleet/parking`, the `fleet.parking_change_decided` notification fired on approval, and the `fleetNavConfig.ts` navigation entries.

**Known limitation, stated rather than hidden:** approver resolution reads `role_permissions` only, ignoring `user_permission_overrides`. Recorded in the file header of Task 3 with the condition for revisiting it (when PR 3 needs the same list).

**Type consistency check:** `ParkingDeclaration` / `DriverParkingState` / `DeclarationInput` defined in Task 1; consumed unchanged in Tasks 2, 4, 5, 7. `resolveDriverVehicle` returns `{ vehicleId, registration }` in Task 2 and is destructured that way in Task 4. `MAX_CAPTURE_ACCURACY_M` defined in Task 1, imported in Task 6. `PENDING_CONFLICT` exported in Task 2, imported in Task 4. `ParkingApiError` defined in Task 5, caught in Tasks 6 and 7.
