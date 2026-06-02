# SiteCam GPS-Geofence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show planned GPS / PON / zone on the SiteCam site card, capture the technician's device GPS at Start Capture (and re-stamp at submit), and warn + allow + flag for QA when >25 m from planned or location can't be verified — never block.

**Architecture:** A pure `geofence` module (haversine + 4-state classifier + param codec + device-GPS reader) is the single source of truth. The entry page reads GPS on Start Capture, classifies, optionally warns, then carries the reading to the wizard route via a query param. The wizard threads it into the capture hook, which re-reads GPS at submit and posts a `geofence` object to the upload endpoint, which persists it to `dr_photo_unified_reviews` (activations) / `pole_install_sessions` (civils). A migration adds the nullable columns.

**Tech Stack:** Next.js Pages Router, React (named imports only — no default React import), TypeScript, vitest + @testing-library/react, `pg.Pool` via `@/lib/db`, `navigator.geolocation`.

**Conventions baked in:**
- Files <300 lines, components <200 lines → meta grid and Start-Capture flow are extracted into their own units.
- Client components import named hooks from `react`, never a default `React`.
- Logging via `log` from `@/lib/logger`, never `console.log`.
- Migration version = `MAX(DB max 393, ls max 399) + 1` = **400**.
- Migrations are **controller-owned**: a worker writes the SQL file; the orchestrator applies and registers it (Task 9).
- Run a single test file with: `npx vitest run <path>`.

---

## File Structure

**Create:**
- `src/modules/sitecam/lib/geofence.ts` — types, `GEOFENCE_THRESHOLD_M`, `haversineMeters`, `classifyGeofence`, `buildReading`, `encodeGeofenceParam` / `decodeGeofenceParam`, `readDeviceLocation`.
- `src/modules/sitecam/lib/__tests__/geofence.test.ts`
- `src/modules/sitecam/components/SiteMetaGrid.tsx` — presentational PON/zone/coords grid.
- `src/modules/sitecam/components/__tests__/SiteMetaGrid.test.tsx`
- `src/modules/sitecam/hooks/useStartCaptureGeofence.ts` — Start-Capture GPS flow (check → warn → navigate).
- `scripts/migrations/sql/400_sitecam_geofence.sql`

**Modify:**
- `pages/api/sitecam/site/[id].ts` — select + return planned coords/PON/zone (via pure `toSiteGeo` mapper).
- `src/modules/sitecam/hooks/useSiteCamCapture.ts` — `SiteInfo` fields; accept `entryGeofence`; submit-time GPS read; `geofence` in upload payload.
- `src/modules/sitecam/components/SiteCamEntry.tsx` — render `SiteMetaGrid`; use `useStartCaptureGeofence`; warning banner.
- `pages/my/sitecam/[siteId].tsx` — decode the geofence query param; pass to wizard.
- `src/modules/sitecam/components/SiteCamWizard.tsx` — thread `entryGeofence` prop into the hook.
- `pages/api/sitecam/upload.ts` — accept + persist `geofence` (both job types) via pure `geofenceColumns` helper.
- `src/modules/sitecam/hooks/__tests__/useSiteCamCapture.test.ts` — update `SITE_INFO` fixture for new fields.

---

## Task 1: Geofence pure module

**Files:**
- Create: `src/modules/sitecam/lib/geofence.ts`
- Test: `src/modules/sitecam/lib/__tests__/geofence.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// src/modules/sitecam/lib/__tests__/geofence.test.ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  haversineMeters,
  classifyGeofence,
  buildReading,
  encodeGeofenceParam,
  decodeGeofenceParam,
  readDeviceLocation,
  GEOFENCE_THRESHOLD_M,
} from '../geofence';

describe('haversineMeters', () => {
  it('returns ~0 for identical points', () => {
    expect(haversineMeters(-26.1, 27.5, -26.1, 27.5)).toBeLessThan(0.5);
  });

  it('computes a known short distance (~111 m per 0.001° latitude)', () => {
    const d = haversineMeters(-26.100, 27.500, -26.101, 27.500);
    expect(d).toBeGreaterThan(105);
    expect(d).toBeLessThan(118);
  });
});

describe('classifyGeofence precedence + accuracy slack', () => {
  const planned = { plannedLat: -26.1, plannedLon: 27.5 };

  it('no_planned_coords when planned missing (even if device present)', () => {
    const r = classifyGeofence({ plannedLat: null, plannedLon: null, deviceLat: -26.1, deviceLon: 27.5, accuracyM: 5 });
    expect(r.status).toBe('no_planned_coords');
    expect(r.distanceM).toBeNull();
  });

  it('device_gps_off when device missing but planned present', () => {
    const r = classifyGeofence({ ...planned, deviceLat: null, deviceLon: null, accuracyM: null });
    expect(r.status).toBe('device_gps_off');
    expect(r.distanceM).toBeNull();
  });

  it('on_site when within threshold', () => {
    const r = classifyGeofence({ ...planned, deviceLat: -26.1, deviceLon: 27.5, accuracyM: 5 });
    expect(r.status).toBe('on_site');
    expect(r.distanceM).not.toBeNull();
  });

  it('out_of_range only when distance - accuracy exceeds threshold', () => {
    // ~111 m away, accuracy 5 → 106 > 25 → out_of_range
    const far = classifyGeofence({ ...planned, deviceLat: -26.101, deviceLon: 27.5, accuracyM: 5 });
    expect(far.status).toBe('out_of_range');
    // same distance but huge accuracy uncertainty → not flagged
    const fuzzy = classifyGeofence({ ...planned, deviceLat: -26.101, deviceLon: 27.5, accuracyM: 200 });
    expect(fuzzy.status).toBe('on_site');
  });

  it('treats null accuracy as 0 (strict threshold)', () => {
    const r = classifyGeofence({ ...planned, deviceLat: -26.1003, deviceLon: 27.5, accuracyM: null });
    // ~33 m away, no slack → out_of_range
    expect(r.status).toBe('out_of_range');
  });
});

describe('encode/decode round-trip', () => {
  it('round-trips a reading', () => {
    const reading = buildReading({ plannedLat: -26.1, plannedLon: 27.5, deviceLat: -26.101, deviceLon: 27.5, accuracyM: 5 });
    const decoded = decodeGeofenceParam(encodeGeofenceParam(reading));
    expect(decoded).toEqual(reading);
  });

  it('returns null for malformed param', () => {
    expect(decodeGeofenceParam('not-json')).toBeNull();
    expect(decodeGeofenceParam(undefined)).toBeNull();
  });
});

describe('readDeviceLocation', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('resolves coords on success', async () => {
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: (ok: PositionCallback) =>
          ok({ coords: { latitude: -26.1, longitude: 27.5, accuracy: 8 } } as GeolocationPosition),
      },
    });
    await expect(readDeviceLocation(1000)).resolves.toEqual({ lat: -26.1, lon: 27.5, accuracy: 8 });
  });

  it('resolves null when geolocation is unavailable', async () => {
    vi.stubGlobal('navigator', {});
    await expect(readDeviceLocation(1000)).resolves.toBeNull();
  });

  it('resolves null on error/denied', async () => {
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: (_ok: PositionCallback, err: PositionErrorCallback) =>
          err({ code: 1, message: 'denied' } as GeolocationPositionError),
      },
    });
    await expect(readDeviceLocation(1000)).resolves.toBeNull();
  });
});

describe('GEOFENCE_THRESHOLD_M', () => {
  it('is 25', () => expect(GEOFENCE_THRESHOLD_M).toBe(25));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/sitecam/lib/__tests__/geofence.test.ts`
Expected: FAIL — cannot resolve `../geofence`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/modules/sitecam/lib/geofence.ts

/** Distance (m) beyond which a capture is flagged out-of-range for QA. */
export const GEOFENCE_THRESHOLD_M = 25;

export type GeofenceStatus =
  | 'on_site'
  | 'out_of_range'
  | 'device_gps_off'
  | 'no_planned_coords';

/** Inputs to the classifier. All coords nullable. */
export interface GeofenceInput {
  plannedLat: number | null;
  plannedLon: number | null;
  deviceLat: number | null;
  deviceLon: number | null;
  accuracyM: number | null;
}

/** Classification result carried from entry → wizard → upload. */
export interface GeofenceReading extends GeofenceInput {
  status: GeofenceStatus;
  distanceM: number | null;
}

/** Reading plus the submit-time second GPS stamp — the persisted shape. */
export interface GeofencePayload extends GeofenceReading {
  submitLat: number | null;
  submitLon: number | null;
}

const EARTH_RADIUS_M = 6_371_000;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance between two lat/lon points, in metres. */
export function haversineMeters(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Classify a device position against planned coords. Precedence:
 *  1. planned missing            → no_planned_coords (nothing to compare)
 *  2. device missing             → device_gps_off
 *  3. distance - accuracy > 25 m → out_of_range (accuracy slack absorbs GPS jitter)
 *  4. otherwise                  → on_site
 */
export function classifyGeofence(
  input: GeofenceInput,
): { status: GeofenceStatus; distanceM: number | null } {
  const { plannedLat, plannedLon, deviceLat, deviceLon, accuracyM } = input;
  if (plannedLat === null || plannedLon === null) {
    return { status: 'no_planned_coords', distanceM: null };
  }
  if (deviceLat === null || deviceLon === null) {
    return { status: 'device_gps_off', distanceM: null };
  }
  const distanceM = haversineMeters(plannedLat, plannedLon, deviceLat, deviceLon);
  const slack = accuracyM ?? 0;
  const status: GeofenceStatus =
    distanceM - slack > GEOFENCE_THRESHOLD_M ? 'out_of_range' : 'on_site';
  return { status, distanceM };
}

/** Build the full reading (input + classification) in one call. */
export function buildReading(input: GeofenceInput): GeofenceReading {
  return { ...input, ...classifyGeofence(input) };
}

/** Encode a reading for a URL query param. */
export function encodeGeofenceParam(reading: GeofenceReading): string {
  return encodeURIComponent(JSON.stringify(reading));
}

/** Decode the query param back into a reading; null when absent/malformed. */
export function decodeGeofenceParam(
  raw: string | string[] | undefined,
): GeofenceReading | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  try {
    return JSON.parse(decodeURIComponent(raw)) as GeofenceReading;
  } catch {
    return null;
  }
}

/**
 * Read the device location once. Resolves null (never rejects) when geolocation
 * is unavailable, denied, or times out — the caller treats null as device_gps_off.
 */
export function readDeviceLocation(
  timeoutMs: number,
): Promise<{ lat: number; lon: number; accuracy: number | null } | null> {
  return new Promise((resolve) => {
    const geo =
      typeof navigator !== 'undefined' ? navigator.geolocation : undefined;
    if (!geo) {
      resolve(null);
      return;
    }
    geo.getCurrentPosition(
      (pos) =>
        resolve({
          lat: pos.coords.latitude,
          lon: pos.coords.longitude,
          accuracy: typeof pos.coords.accuracy === 'number' ? pos.coords.accuracy : null,
        }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 0 },
    );
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/sitecam/lib/__tests__/geofence.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/modules/sitecam/lib/geofence.ts src/modules/sitecam/lib/__tests__/geofence.test.ts
git commit -m "feat(sitecam): pure geofence module (haversine, 4-state classifier, param codec)"
```

---

## Task 2: Site API returns planned coords / PON / zone

**Files:**
- Modify: `pages/api/sitecam/site/[id].ts`
- Test: `pages/api/sitecam/site/__tests__/dropNumberCandidates.test.ts` (add a `toSiteGeo` describe block to the existing file)

- [ ] **Step 1: Write the failing test** — append to the existing test file:

```ts
// add to pages/api/sitecam/site/__tests__/dropNumberCandidates.test.ts
import { toSiteGeo } from '../[id]';

describe('toSiteGeo', () => {
  it('coerces numeric strings (pg numeric) to numbers', () => {
    expect(toSiteGeo({ latitude: '-26.12345', longitude: '27.56789', pon_no: 12, zone_no: 4 }))
      .toEqual({ plannedLat: -26.12345, plannedLon: 27.56789, pon: 12, zone: 4 });
  });

  it('maps nulls through as null', () => {
    expect(toSiteGeo({ latitude: null, longitude: null, pon_no: null, zone_no: null }))
      .toEqual({ plannedLat: null, plannedLon: null, pon: null, zone: null });
  });

  it('treats NaN / undefined as null', () => {
    expect(toSiteGeo({ latitude: 'x', longitude: undefined, pon_no: undefined, zone_no: 'y' }))
      .toEqual({ plannedLat: null, plannedLon: null, pon: null, zone: null });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run pages/api/sitecam/site/__tests__/dropNumberCandidates.test.ts`
Expected: FAIL — `toSiteGeo` is not exported.

- [ ] **Step 3: Write minimal implementation**

In `pages/api/sitecam/site/[id].ts`, add the exported mapper near `toDrSiteId`:

```ts
/** Coerce a possibly-string/null numeric DB value to number|null (NaN → null). */
function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export interface SiteGeo {
  plannedLat: number | null;
  plannedLon: number | null;
  pon: number | null;
  zone: number | null;
}

/** Map a drops/poles row's geo columns into the SiteInfo geo fields. */
export function toSiteGeo(row: {
  latitude?: unknown;
  longitude?: unknown;
  pon_no?: unknown;
  zone_no?: unknown;
}): SiteGeo {
  return {
    plannedLat: num(row.latitude),
    plannedLon: num(row.longitude),
    pon: num(row.pon_no),
    zone: num(row.zone_no),
  };
}
```

Extend the **DR query** SELECT and row type to include the geo columns, and spread `toSiteGeo(r)` into the response:

```ts
    const { rows } = await pool.query<{
      drop_number: string;
      customer_name: string | null;
      address: string | null;
      project_name: string | null;
      latitude: string | null;
      longitude: string | null;
      pon_no: number | null;
      zone_no: number | null;
    }>(
      `SELECT d.drop_number,
              d.customer_name,
              d.address,
              d.latitude,
              d.longitude,
              d.pon_no,
              d.zone_no,
              p.project_name
       FROM drops d
       LEFT JOIN projects p ON p.id = d.project_id
       WHERE d.drop_number = ANY($1)
       LIMIT 1`,
      [dropNumberCandidates(normalized)]
    );
    if (!rows[0]) return apiResponse.notFound(res, 'DR', normalized);
    const r = rows[0];
    return apiResponse.success(res, {
      jobType: 'activations',
      siteId: toDrSiteId(r.drop_number),
      customerName: r.customer_name ?? null,
      address: r.address ?? null,
      projectName: r.project_name ?? null,
      ...toSiteGeo(r),
    });
```

Extend the **pole query** the same way:

```ts
  const { rows } = await pool.query<{
    pole_number: string;
    project_name: string | null;
    latitude: string | null;
    longitude: string | null;
    pon_no: number | null;
    zone_no: number | null;
  }>(
    `SELECT po.pole_number,
            po.latitude,
            po.longitude,
            po.pon_no,
            po.zone_no,
            p.project_name
     FROM poles po
     LEFT JOIN projects p ON p.id = po.project_id
     WHERE po.pole_number = $1
     LIMIT 1`,
    [normalized]
  );
  if (!rows[0]) return apiResponse.notFound(res, 'Pole', normalized);
  const r = rows[0];
  return apiResponse.success(res, {
    jobType: 'civils',
    siteId: r.pole_number,
    customerName: null,
    address: null,
    projectName: r.project_name ?? null,
    ...toSiteGeo(r),
  });
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run pages/api/sitecam/site/__tests__/dropNumberCandidates.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add pages/api/sitecam/site/[id].ts pages/api/sitecam/site/__tests__/dropNumberCandidates.test.ts
git commit -m "feat(sitecam): site API returns planned coords, PON, zone"
```

---

## Task 3: Extend `SiteInfo` type + keep existing tests green

**Files:**
- Modify: `src/modules/sitecam/hooks/useSiteCamCapture.ts:26-32` (the `SiteInfo` interface)
- Modify: `src/modules/sitecam/hooks/__tests__/useSiteCamCapture.test.ts:34-40` (the `SITE_INFO` fixture)

- [ ] **Step 1: Extend the interface**

Replace the `SiteInfo` interface with:

```ts
export interface SiteInfo {
  jobType: SiteCamJobType;
  siteId: string;
  customerName: string | null;
  address: string | null;
  projectName: string | null;
  plannedLat: number | null;
  plannedLon: number | null;
  pon: number | null;
  zone: number | null;
}
```

- [ ] **Step 2: Update the existing test fixture**

In `useSiteCamCapture.test.ts`, replace the `SITE_INFO` literal so it satisfies the new type:

```ts
const SITE_INFO: SiteInfo = {
  jobType: 'civils',
  siteId: 'POLE-1',
  customerName: null,
  address: null,
  projectName: null,
  plannedLat: null,
  plannedLon: null,
  pon: null,
  zone: null,
};
```

- [ ] **Step 3: Run the existing hook tests to verify they still pass**

Run: `npx vitest run src/modules/sitecam/hooks/__tests__/useSiteCamCapture.test.ts`
Expected: PASS (no behavioural change yet — fixture only).

- [ ] **Step 4: Type-check**

Run: `npx tsc --noEmit`
Expected: no new errors. (vitest does not type-check — `tsc --noEmit` is required to catch type breakage.)

- [ ] **Step 5: Commit**

```bash
git add src/modules/sitecam/hooks/useSiteCamCapture.ts src/modules/sitecam/hooks/__tests__/useSiteCamCapture.test.ts
git commit -m "feat(sitecam): add planned geo fields to SiteInfo"
```

---

## Task 4: `SiteMetaGrid` component (2-column PON/zone/coords)

**Files:**
- Create: `src/modules/sitecam/components/SiteMetaGrid.tsx`
- Test: `src/modules/sitecam/components/__tests__/SiteMetaGrid.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// src/modules/sitecam/components/__tests__/SiteMetaGrid.test.tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SiteMetaGrid } from '../SiteMetaGrid';

describe('SiteMetaGrid', () => {
  it('renders PON, zone and planned coords when all present', () => {
    render(<SiteMetaGrid pon={12} zone={4} plannedLat={-26.123456} plannedLon={27.567890} />);
    expect(screen.getByText(/PON/)).toBeTruthy();
    expect(screen.getByText('12')).toBeTruthy();
    expect(screen.getByText(/Zone/)).toBeTruthy();
    expect(screen.getByText('4')).toBeTruthy();
    expect(screen.getByText(/-26\.12346, 27\.56789/)).toBeTruthy(); // 5dp
  });

  it('hides the coord row when coords are null', () => {
    render(<SiteMetaGrid pon={12} zone={4} plannedLat={null} plannedLon={null} />);
    expect(screen.queryByText(/,/)).toBeNull();
    expect(screen.getByText('12')).toBeTruthy();
  });

  it('renders nothing when every field is null', () => {
    const { container } = render(
      <SiteMetaGrid pon={null} zone={null} plannedLat={null} plannedLon={null} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/sitecam/components/__tests__/SiteMetaGrid.test.tsx`
Expected: FAIL — cannot resolve `../SiteMetaGrid`.

- [ ] **Step 3: Write minimal implementation**

```tsx
// src/modules/sitecam/components/SiteMetaGrid.tsx
import { MapPin } from 'lucide-react';

interface Props {
  pon: number | null;
  zone: number | null;
  plannedLat: number | null;
  plannedLon: number | null;
}

/** Compact 2-column meta grid: PON | Zone, with planned coords spanning below. */
export function SiteMetaGrid({ pon, zone, plannedLat, plannedLon }: Props) {
  const hasPonZone = pon !== null || zone !== null;
  const hasCoords = plannedLat !== null && plannedLon !== null;
  if (!hasPonZone && !hasCoords) return null;

  return (
    <div className="rounded-lg border border-neutral-800 overflow-hidden text-sm">
      {hasPonZone && (
        <div className="grid grid-cols-2 divide-x divide-neutral-800">
          <div className="px-3 py-2">
            <span className="text-neutral-500">PON </span>
            <span className="text-neutral-200">{pon ?? '—'}</span>
          </div>
          <div className="px-3 py-2">
            <span className="text-neutral-500">Zone </span>
            <span className="text-neutral-200">{zone ?? '—'}</span>
          </div>
        </div>
      )}
      {hasCoords && (
        <div
          className={`flex items-center gap-2 px-3 py-2 text-neutral-400 ${
            hasPonZone ? 'border-t border-neutral-800' : ''
          }`}
        >
          <MapPin className="h-4 w-4 shrink-0 text-neutral-500" />
          <span>
            {plannedLat!.toFixed(5)}, {plannedLon!.toFixed(5)}
          </span>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/sitecam/components/__tests__/SiteMetaGrid.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/sitecam/components/SiteMetaGrid.tsx src/modules/sitecam/components/__tests__/SiteMetaGrid.test.tsx
git commit -m "feat(sitecam): SiteMetaGrid component for PON/zone/coords"
```

---

## Task 5: `useStartCaptureGeofence` hook (check → warn → navigate)

**Files:**
- Create: `src/modules/sitecam/hooks/useStartCaptureGeofence.ts`
- Test: `src/modules/sitecam/hooks/__tests__/useStartCaptureGeofence.test.ts`

This hook owns the Start-Capture flow so `SiteCamEntry` stays under 200 lines. It reads GPS, builds a reading, and either navigates immediately (`on_site` / `no_planned_coords`) or surfaces a `pendingWarning` (`out_of_range` / `device_gps_off`) that the caller renders as a banner; confirming navigates.

- [ ] **Step 1: Write the failing test**

```ts
// src/modules/sitecam/hooks/__tests__/useStartCaptureGeofence.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const pushMock = vi.fn();
vi.mock('next/router', () => ({ useRouter: () => ({ push: pushMock }) }));
vi.mock('@/lib/logger', () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));

import { useStartCaptureGeofence } from '../useStartCaptureGeofence';
import { encodeGeofenceParam, buildReading } from '../../lib/geofence';

function stubGeo(pos: { latitude: number; longitude: number; accuracy: number } | null) {
  vi.stubGlobal('navigator', {
    geolocation: {
      getCurrentPosition: (ok: PositionCallback, err: PositionErrorCallback) =>
        pos ? ok({ coords: pos } as GeolocationPosition) : err({ code: 1 } as GeolocationPositionError),
    },
  });
}

beforeEach(() => pushMock.mockReset());
afterEach(() => vi.unstubAllGlobals());

const site = { siteId: 'DR1', plannedLat: -26.1, plannedLon: 27.5 };

describe('useStartCaptureGeofence', () => {
  it('navigates immediately when on_site (no warning)', async () => {
    stubGeo({ latitude: -26.1, longitude: 27.5, accuracy: 5 });
    const { result } = renderHook(() => useStartCaptureGeofence(site));
    await act(async () => { await result.current.beginCapture(); });
    expect(result.current.pendingWarning).toBeNull();
    expect(pushMock).toHaveBeenCalledTimes(1);
    const [arg] = pushMock.mock.calls[0];
    expect(arg.pathname).toContain('/my/sitecam/');
    expect(arg.query.gf).toBe(
      encodeGeofenceParam(buildReading({ plannedLat: -26.1, plannedLon: 27.5, deviceLat: -26.1, deviceLon: 27.5, accuracyM: 5 })),
    );
  });

  it('surfaces a warning and defers navigation when out_of_range', async () => {
    stubGeo({ latitude: -26.101, longitude: 27.5, accuracy: 5 }); // ~111 m
    const { result } = renderHook(() => useStartCaptureGeofence(site));
    await act(async () => { await result.current.beginCapture(); });
    expect(result.current.pendingWarning?.status).toBe('out_of_range');
    expect(pushMock).not.toHaveBeenCalled();
    act(() => result.current.confirmContinue());
    expect(pushMock).toHaveBeenCalledTimes(1);
  });

  it('warns device_gps_off when GPS denied but planned present', async () => {
    stubGeo(null);
    const { result } = renderHook(() => useStartCaptureGeofence(site));
    await act(async () => { await result.current.beginCapture(); });
    expect(result.current.pendingWarning?.status).toBe('device_gps_off');
    expect(pushMock).not.toHaveBeenCalled();
  });

  it('navigates silently when planned coords missing (no_planned_coords)', async () => {
    stubGeo(null);
    const { result } = renderHook(() =>
      useStartCaptureGeofence({ siteId: 'DR1', plannedLat: null, plannedLon: null }),
    );
    await act(async () => { await result.current.beginCapture(); });
    expect(result.current.pendingWarning).toBeNull();
    expect(pushMock).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/sitecam/hooks/__tests__/useStartCaptureGeofence.test.ts`
Expected: FAIL — cannot resolve `../useStartCaptureGeofence`.

- [ ] **Step 3: Write minimal implementation**

```ts
// src/modules/sitecam/hooks/useStartCaptureGeofence.ts
import { useCallback, useState } from 'react';
import { useRouter } from 'next/router';
import {
  buildReading,
  encodeGeofenceParam,
  readDeviceLocation,
  type GeofenceReading,
} from '../lib/geofence';

const GPS_TIMEOUT_MS = 10_000;

interface SiteGeoTarget {
  siteId: string;
  plannedLat: number | null;
  plannedLon: number | null;
}

/** Statuses that require a technician-facing warning before navigation. */
function needsWarning(r: GeofenceReading): boolean {
  return r.status === 'out_of_range' || r.status === 'device_gps_off';
}

export function useStartCaptureGeofence(site: SiteGeoTarget) {
  const router = useRouter();
  const [checking, setChecking] = useState(false);
  const [pendingWarning, setPendingWarning] = useState<GeofenceReading | null>(null);

  const navigate = useCallback(
    (reading: GeofenceReading) => {
      void router.push({
        pathname: '/my/sitecam/[siteId]',
        query: { siteId: site.siteId, gf: encodeGeofenceParam(reading) },
      });
    },
    [router, site.siteId],
  );

  const beginCapture = useCallback(async () => {
    setChecking(true);
    setPendingWarning(null);
    try {
      const pos = await readDeviceLocation(GPS_TIMEOUT_MS);
      const reading = buildReading({
        plannedLat: site.plannedLat,
        plannedLon: site.plannedLon,
        deviceLat: pos?.lat ?? null,
        deviceLon: pos?.lon ?? null,
        accuracyM: pos?.accuracy ?? null,
      });
      if (needsWarning(reading)) {
        setPendingWarning(reading);
      } else {
        navigate(reading);
      }
    } finally {
      setChecking(false);
    }
  }, [site.plannedLat, site.plannedLon, navigate]);

  const confirmContinue = useCallback(() => {
    if (pendingWarning) navigate(pendingWarning);
  }, [pendingWarning, navigate]);

  const dismiss = useCallback(() => setPendingWarning(null), []);

  return { checking, pendingWarning, beginCapture, confirmContinue, dismiss };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/modules/sitecam/hooks/__tests__/useStartCaptureGeofence.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/modules/sitecam/hooks/useStartCaptureGeofence.ts src/modules/sitecam/hooks/__tests__/useStartCaptureGeofence.test.ts
git commit -m "feat(sitecam): useStartCaptureGeofence — check, warn, navigate"
```

---

## Task 6: Wire the entry card — meta grid + Start-Capture geofence + warning banner

**Files:**
- Modify: `src/modules/sitecam/components/SiteCamEntry.tsx`
- Test: `src/modules/sitecam/components/__tests__/SiteCamEntry.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

```tsx
// src/modules/sitecam/components/__tests__/SiteCamEntry.test.tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

vi.mock('next/router', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/logger', () => ({ log: { warn: vi.fn(), error: vi.fn(), info: vi.fn() } }));
vi.mock('@/modules/attendance/portal/client/MyPortalShell', () => ({
  MyPortalShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

import { SiteCamEntry } from '../SiteCamEntry';

const profile = { name: 'Tech', profilePhotoUrl: null } as never;

function mockSiteFetch(data: Record<string, unknown>) {
  vi.stubGlobal('fetch', vi.fn(() =>
    Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ data }) }),
  ));
}

beforeEach(() => {
  vi.stubGlobal('navigator', {
    geolocation: {
      getCurrentPosition: (_ok: PositionCallback, err: PositionErrorCallback) =>
        err({ code: 1 } as GeolocationPositionError),
    },
  });
});
afterEach(() => vi.unstubAllGlobals());

describe('SiteCamEntry meta grid + geofence warning', () => {
  it('shows PON/zone/coords after a successful lookup', async () => {
    mockSiteFetch({
      jobType: 'activations', siteId: 'DR1854086', customerName: 'John', address: '1 Main Rd',
      projectName: 'Mohadin', plannedLat: -26.12345, plannedLon: 27.56789, pon: 12, zone: 4,
    });
    render(<SiteCamEntry profile={profile} />);
    fireEvent.change(screen.getByLabelText(/DR \/ Pole Number/i), { target: { value: 'DR1854086' } });
    fireEvent.click(screen.getByText('Find'));
    await waitFor(() => expect(screen.getByText('12')).toBeTruthy());
    expect(screen.getByText(/-26\.12345, 27\.56789/)).toBeTruthy();
  });

  it('shows a device-GPS warning banner when Start Capture is tapped with GPS denied', async () => {
    mockSiteFetch({
      jobType: 'activations', siteId: 'DR1', customerName: null, address: null,
      projectName: null, plannedLat: -26.1, plannedLon: 27.5, pon: 1, zone: 1,
    });
    render(<SiteCamEntry profile={profile} />);
    fireEvent.change(screen.getByLabelText(/DR \/ Pole Number/i), { target: { value: 'DR1' } });
    fireEvent.click(screen.getByText('Find'));
    await waitFor(() => screen.getByText('Start Capture'));
    fireEvent.click(screen.getByText('Start Capture'));
    await waitFor(() => expect(screen.getByText(/location/i)).toBeTruthy());
    expect(screen.getByText(/Continue anyway/i)).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/sitecam/components/__tests__/SiteCamEntry.test.tsx`
Expected: FAIL — no meta grid / no warning banner yet.

- [ ] **Step 3: Implement** — update `SiteCamEntry.tsx`:

Replace the imports block (lines 1-8) with:

```tsx
import { useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import { MapPin, AlertTriangle } from 'lucide-react';
import { MyPortalShell } from '@/modules/attendance/portal/client/MyPortalShell';
import type { AttendanceProfile } from '@/modules/attendance/portal/client/api';
import { log } from '@/lib/logger';
import type { SiteInfo } from '../hooks/useSiteCamCapture';
import { useStartCaptureGeofence } from '../hooks/useStartCaptureGeofence';
import { SiteMetaGrid } from './SiteMetaGrid';
```

Remove the now-unused `useRouter` usage. Inside the component, replace the `router` + `handleStart` (lines 17, 62-65) with the geofence hook. Because the hook needs the looked-up site, instantiate it from `siteInfo` once available — keep the hook call unconditional (Rules of Hooks) by passing safe fallbacks:

```tsx
export function SiteCamEntry({ profile }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [siteInfo, setSiteInfo] = useState<SiteInfo | null>(null);

  const { checking, pendingWarning, beginCapture, confirmContinue, dismiss } =
    useStartCaptureGeofence({
      siteId: siteInfo?.siteId ?? '',
      plannedLat: siteInfo?.plannedLat ?? null,
      plannedLon: siteInfo?.plannedLon ?? null,
    });
```

`handleFind` and `handleKeyDown` are unchanged. Replace the detail section + Start Capture button (lines 138-163) so the grid renders and the button calls `beginCapture`, with the warning banner shown when `pendingWarning` is set:

```tsx
            <div className="px-4 py-3 space-y-2">
              {siteInfo.customerName && (
                <div className="text-sm font-medium text-neutral-100">{siteInfo.customerName}</div>
              )}
              {siteInfo.address && (
                <div className="flex items-start gap-2 text-sm text-neutral-400">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-neutral-500" />
                  <span>{siteInfo.address}</span>
                </div>
              )}
              <SiteMetaGrid
                pon={siteInfo.pon}
                zone={siteInfo.zone}
                plannedLat={siteInfo.plannedLat}
                plannedLon={siteInfo.plannedLon}
              />
              {siteInfo.projectName && (
                <div className="text-xs text-neutral-500">{siteInfo.projectName}</div>
              )}
            </div>

            <div className="px-4 pb-4 space-y-3">
              {pendingWarning && (
                <div className="rounded-lg border border-amber-800 bg-amber-950/50 px-3 py-3 text-sm text-amber-200">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>
                      {pendingWarning.status === 'out_of_range'
                        ? `You appear to be about ${Math.round(pendingWarning.distanceM ?? 0)} m from the planned location. You can continue — this visit will be flagged for QA review.`
                        : `Location access is off, so your visit can't be GPS-verified. You can continue — this visit will be flagged for QA review.`}
                    </span>
                  </div>
                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={confirmContinue}
                      className="flex-1 rounded-lg bg-amber-600 py-2 text-sm font-semibold text-white hover:bg-amber-500"
                    >
                      Continue anyway
                    </button>
                    <button
                      type="button"
                      onClick={dismiss}
                      className="rounded-lg border border-neutral-700 px-4 py-2 text-sm text-neutral-300 hover:bg-neutral-800"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
              {!pendingWarning && (
                <button
                  type="button"
                  onClick={() => void beginCapture()}
                  disabled={checking}
                  className="w-full rounded-lg bg-sky-600 py-3 text-sm font-semibold text-white hover:bg-sky-500 disabled:opacity-50 active:bg-sky-700"
                >
                  {checking ? 'Checking location…' : 'Start Capture'}
                </button>
              )}
            </div>
```

- [ ] **Step 4: Run test + type-check**

Run: `npx vitest run src/modules/sitecam/components/__tests__/SiteCamEntry.test.tsx`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: no new errors. Confirm `SiteCamEntry.tsx` is < 200 lines (`wc -l`).

- [ ] **Step 5: Commit**

```bash
git add src/modules/sitecam/components/SiteCamEntry.tsx src/modules/sitecam/components/__tests__/SiteCamEntry.test.tsx
git commit -m "feat(sitecam): entry card meta grid + Start-Capture geofence warning"
```

---

## Task 7: Carry the reading through the wizard + submit-time stamp + payload

**Files:**
- Modify: `pages/my/sitecam/[siteId].tsx` (decode `gf` param, pass to wizard)
- Modify: `src/modules/sitecam/components/SiteCamWizard.tsx` (thread prop)
- Modify: `src/modules/sitecam/hooks/useSiteCamCapture.ts` (accept reading, submit GPS read, payload)
- Test: `src/modules/sitecam/hooks/__tests__/useSiteCamCapture.test.ts` (add a geofence-payload test)

- [ ] **Step 1: Write the failing test** — add to `useSiteCamCapture.test.ts`:

```ts
import { buildReading } from '../../lib/geofence';

describe('useSiteCamCapture geofence payload', () => {
  it('includes the entry reading + submit-time stamp in the upload body', async () => {
    // submit-time GPS read resolves to a known position
    vi.stubGlobal('navigator', {
      geolocation: {
        getCurrentPosition: (ok: PositionCallback) =>
          ok({ coords: { latitude: -26.2, longitude: 27.6, accuracy: 9 } } as GeolocationPosition),
      },
    });

    let uploadBody: Record<string, unknown> = {};
    fetchMock.mockImplementation((url: string, opts: { body: string }) => {
      if (url === '/api/sitecam/validate') {
        return jsonOk({ data: { pass: true, reasons: [], corrections: [], maxAttempts: 3 } });
      }
      if (url === '/api/sitecam/upload') {
        uploadBody = JSON.parse(opts.body);
        return jsonOk({ data: { uploadedCount: 1 } });
      }
      return Promise.reject(new Error(`unexpected ${url}`));
    });

    const entryReading = buildReading({
      plannedLat: -26.1, plannedLon: 27.5, deviceLat: -26.101, deviceLon: 27.5, accuracyM: 5,
    });

    const { result } = renderHook(() => useSiteCamCapture(STEPS, SITE_INFO, entryReading));
    await act(async () => { await result.current.captureAndValidate(file()); });
    await act(async () => { await vi.runAllTimersAsync(); });
    await act(async () => { await result.current.submitAll(); });

    expect(uploadBody.geofence).toMatchObject({
      status: 'out_of_range',
      deviceLat: -26.101,
      submitLat: -26.2,
      submitLon: 27.6,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/sitecam/hooks/__tests__/useSiteCamCapture.test.ts -t "geofence payload"`
Expected: FAIL — hook takes 2 args, no `geofence` in body.

- [ ] **Step 3: Implement the hook changes** in `useSiteCamCapture.ts`:

Add to the imports at the top:

```ts
import { readDeviceLocation, type GeofenceReading, type GeofencePayload } from '../lib/geofence';
```

Change the hook signature (line 62) to accept the optional entry reading:

```ts
export function useSiteCamCapture(
  steps: readonly SiteCamStep[],
  siteInfo: SiteInfo,
  entryGeofence: GeofenceReading | null = null,
) {
```

In `submitAll`, after building `photos` and before the `fetch`, build the geofence payload (best-effort submit GPS read — never blocks):

```ts
    let geofence: GeofencePayload | null = null;
    if (entryGeofence) {
      const submitPos = await readDeviceLocation(10_000);
      geofence = {
        ...entryGeofence,
        submitLat: submitPos?.lat ?? null,
        submitLon: submitPos?.lon ?? null,
      };
    }
```

Add `geofence` to the upload request body:

```ts
        body: JSON.stringify({
          jobType: siteInfo.jobType,
          siteId: siteInfo.siteId,
          photos,
          geofence,
        }),
```

Add `entryGeofence` to the `submitAll` `useCallback` dependency array (currently `[stepStates, siteInfo]` → `[stepStates, siteInfo, entryGeofence]`).

- [ ] **Step 4: Thread the prop through the wizard component** — `SiteCamWizard.tsx`:

```tsx
import { useSiteCamCapture, type SiteInfo } from '../hooks/useSiteCamCapture';
import type { GeofenceReading } from '../lib/geofence';

interface Props {
  profile: AttendanceProfile;
  siteInfo: SiteInfo;
  entryGeofence?: GeofenceReading | null;
}

export function SiteCamWizard({ profile, siteInfo, entryGeofence = null }: Props) {
  const steps = getStepsForJobType(siteInfo.jobType);
  const {
    stepStates, currentStep, allDone, captureAndValidate, submitAll,
    uploading, uploadError, uploadResult,
  } = useSiteCamCapture(steps, siteInfo, entryGeofence);
```

- [ ] **Step 5: Decode the query param in the page** — `pages/my/sitecam/[siteId].tsx`:

Add the import:

```tsx
import { decodeGeofenceParam } from '@/modules/sitecam/lib/geofence';
```

Pull `gf` from the router query and pass it down. Replace the final render line (`return <SiteCamWizard profile={profile!} siteInfo={siteInfo} />;`) with:

```tsx
  const entryGeofence = decodeGeofenceParam(router.query.gf);
  return <SiteCamWizard profile={profile!} siteInfo={siteInfo} entryGeofence={entryGeofence} />;
```

- [ ] **Step 6: Run tests + type-check**

Run: `npx vitest run src/modules/sitecam/hooks/__tests__/useSiteCamCapture.test.ts`
Expected: PASS (existing + new geofence-payload test).
Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 7: Commit**

```bash
git add src/modules/sitecam/hooks/useSiteCamCapture.ts src/modules/sitecam/components/SiteCamWizard.tsx pages/my/sitecam/[siteId].tsx src/modules/sitecam/hooks/__tests__/useSiteCamCapture.test.ts
git commit -m "feat(sitecam): carry geofence reading to wizard + stamp submit GPS"
```

---

## Task 8: Persist geofence in the upload endpoint

**Files:**
- Modify: `pages/api/sitecam/upload.ts`
- Test: `pages/api/sitecam/__tests__/geofenceColumns.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
// pages/api/sitecam/__tests__/geofenceColumns.test.ts
import { describe, it, expect } from 'vitest';
import { geofenceColumns } from '../upload';

describe('geofenceColumns', () => {
  it('returns nine ordered values from a payload', () => {
    expect(geofenceColumns({
      status: 'out_of_range', distanceM: 140.4,
      plannedLat: -26.1, plannedLon: 27.5,
      deviceLat: -26.101, deviceLon: 27.5, accuracyM: 5,
      submitLat: -26.2, submitLon: 27.6,
    })).toEqual(['out_of_range', 140.4, -26.101, 27.5, -26.1, 27.5, 5, -26.2, 27.6]);
  });

  it('returns nine nulls when payload is null/undefined', () => {
    expect(geofenceColumns(null)).toEqual([null, null, null, null, null, null, null, null, null]);
    expect(geofenceColumns(undefined)).toEqual([null, null, null, null, null, null, null, null, null]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run pages/api/sitecam/__tests__/geofenceColumns.test.ts`
Expected: FAIL — `geofenceColumns` not exported.

- [ ] **Step 3: Implement** in `upload.ts`:

Add the import and the helper near the top (after the existing imports):

```ts
import type { GeofencePayload } from '@/modules/sitecam/lib/geofence';

/**
 * Flatten a geofence payload into the ordered column values for the UPDATE.
 * Order: status, distance_m, device_lat, device_lon, planned_lat, planned_lon,
 *        accuracy_m, submit_lat, submit_lon. All-null when no payload.
 */
export function geofenceColumns(
  g: GeofencePayload | null | undefined,
): Array<string | number | null> {
  if (!g) return [null, null, null, null, null, null, null, null, null];
  return [
    g.status, g.distanceM, g.deviceLat, g.deviceLon,
    g.plannedLat, g.plannedLon, g.accuracyM, g.submitLat, g.submitLon,
  ];
}
```

Add `geofence` to `UploadBody`:

```ts
interface UploadBody {
  jobType: SiteCamJobType;
  siteId: string;
  photos: PhotoRecord[];
  geofence?: GeofencePayload | null;
}
```

Destructure it in the handler (line 57):

```ts
  const { jobType, siteId, photos, geofence } = (req.body ?? {}) as Partial<UploadBody>;
```

Compute the column values once before the branches:

```ts
  const gf = geofenceColumns(geofence);
```

Extend the **activations** UPDATE to append the geofence columns. Replace that query with:

```ts
    await pool.query(
      `UPDATE dr_photo_unified_reviews
       SET pwa_submission_at        = NOW(),
           pwa_tech_id              = $1,
           pwa_photo_count          = $2,
           pwa_completed_at         = NOW(),
           pwa_photo_urls           = $3,
           pwa_vlm_unavailable_steps = $4,
           geofence_status          = $6,
           geofence_distance_m      = $7,
           device_lat               = $8,
           device_lon               = $9,
           planned_lat              = $10,
           planned_lon              = $11,
           gps_accuracy_m           = $12,
           submit_lat               = $13,
           submit_lon               = $14
       WHERE drop_number = $5`,
      [techId, Object.keys(uploadedUrls).length, JSON.stringify(uploadedUrls), vlmUnavailableSteps, drNum, ...gf]
    );
```

Extend the **civils** UPDATE similarly:

```ts
    await pool.query(
      `UPDATE pole_install_sessions
       SET pwa_submission_at        = NOW(),
           pwa_tech_id              = $1,
           pwa_completed_at         = NOW(),
           pwa_vlm_unavailable_steps = $2,
           geofence_status          = $4,
           geofence_distance_m      = $5,
           device_lat               = $6,
           device_lon               = $7,
           planned_lat              = $8,
           planned_lon              = $9,
           gps_accuracy_m           = $10,
           submit_lat               = $11,
           submit_lon               = $12
       WHERE pole_number = $3`,
      [techId, vlmUnavailableSteps, siteId, ...gf]
    );
```

> Note the param numbering: activations uses `$1–$5` for the existing values, `$6–$14` for the nine geofence values (so `gf[0]` = `$6`). Civils uses `$1–$3`, then `$4–$12` for the nine geofence values. Keep the order in `gf` aligned with the column order above.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run pages/api/sitecam/__tests__/geofenceColumns.test.ts`
Expected: PASS.
Run: `npx tsc --noEmit`
Expected: no new errors.

- [ ] **Step 5: Commit**

```bash
git add pages/api/sitecam/upload.ts pages/api/sitecam/__tests__/geofenceColumns.test.ts
git commit -m "feat(sitecam): persist geofence columns on upload (both job types)"
```

---

## Task 9: Migration 400 — geofence columns  *(CONTROLLER-OWNED)*

**Files:**
- Create: `scripts/migrations/sql/400_sitecam_geofence.sql`

> The worker writes this SQL file only. **The orchestrator** (main session) applies it to the shared Supabase DB and registers it in the `migrations` table — workers do not run DB mutations.

- [ ] **Step 1: Write the migration SQL**

```sql
-- Migration 400: SiteCam GPS-geofence capture
-- Purpose: record where the technician actually was relative to the planned
--          drop/pole location at capture time. Warn+allow+flag model — these
--          columns drive QA review, never block capture. All nullable; safe to re-run.
-- Applies to both submission tables (activations + civils).

ALTER TABLE dr_photo_unified_reviews
  ADD COLUMN IF NOT EXISTS geofence_status     TEXT,
  ADD COLUMN IF NOT EXISTS geofence_distance_m NUMERIC,
  ADD COLUMN IF NOT EXISTS device_lat          NUMERIC,
  ADD COLUMN IF NOT EXISTS device_lon          NUMERIC,
  ADD COLUMN IF NOT EXISTS planned_lat         NUMERIC,
  ADD COLUMN IF NOT EXISTS planned_lon         NUMERIC,
  ADD COLUMN IF NOT EXISTS gps_accuracy_m      NUMERIC,
  ADD COLUMN IF NOT EXISTS submit_lat          NUMERIC,
  ADD COLUMN IF NOT EXISTS submit_lon          NUMERIC;

ALTER TABLE pole_install_sessions
  ADD COLUMN IF NOT EXISTS geofence_status     TEXT,
  ADD COLUMN IF NOT EXISTS geofence_distance_m NUMERIC,
  ADD COLUMN IF NOT EXISTS device_lat          NUMERIC,
  ADD COLUMN IF NOT EXISTS device_lon          NUMERIC,
  ADD COLUMN IF NOT EXISTS planned_lat         NUMERIC,
  ADD COLUMN IF NOT EXISTS planned_lon         NUMERIC,
  ADD COLUMN IF NOT EXISTS gps_accuracy_m      NUMERIC,
  ADD COLUMN IF NOT EXISTS submit_lat          NUMERIC,
  ADD COLUMN IF NOT EXISTS submit_lon          NUMERIC;
```

- [ ] **Step 2: (Controller) verify live schema before applying**

Run: `\d dr_photo_unified_reviews` and `\d pole_install_sessions` against the live DB; confirm none of the nine columns already exist with a conflicting type.

- [ ] **Step 3: (Controller) apply the migration**

```bash
PGPASSWORD=<postgres pw from .claude/credentials.local.md> \
  psql -h 100.96.203.105 -p 5437 -U postgres -d fibreflow \
  -f scripts/migrations/sql/400_sitecam_geofence.sql
```

- [ ] **Step 4: (Controller) register it in the migrations table**

```bash
PGPASSWORD=<pw> psql -h 100.96.203.105 -p 5437 -U postgres -d fibreflow \
  -c "INSERT INTO migrations (version, executed_at) VALUES ('400', NOW()) ON CONFLICT DO NOTHING;"
```

- [ ] **Step 5: Commit**

```bash
git add scripts/migrations/sql/400_sitecam_geofence.sql
git commit -m "feat(sitecam): migration 400 — geofence columns on submission tables"
```

---

## Task 10: Full local CI gate

**Files:** none (verification only)

- [ ] **Step 1: Type-check the whole project**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 2: Run the SiteCam test suite**

Run: `npx vitest run src/modules/sitecam pages/api/sitecam`
Expected: all PASS.

- [ ] **Step 3: Run the lint ratchet gate**

Run: `npm run ci:quick`
Expected: 0 errors; warnings ≤ the committed baseline (185). If a new warning appears, fix it (no `--no-verify`).

- [ ] **Step 4: Commit any lint fixes (if needed)**

```bash
git add -A
git commit -m "chore(sitecam): satisfy lint ratchet for geofence feature"
```

---

## Browser verification (post-merge, manual — see spec §6)

Not a code task. After merge + deploy to dev, use playwriter against `dev.fibreflow.app/my/sitecam`, mocking `navigator.geolocation.getCurrentPosition`, to drive each of the four states (`on_site` silent, `out_of_range` banner, `device_gps_off` banner, `no_planned_coords` silent) and confirm the `geofence` object reaches `/api/sitecam/upload`. Then spot-check a real DR row in the DB shows the geofence columns populated.

---

## Self-Review

**Spec coverage:**
- §1 Data layer → Task 2 (API) + Task 3 (SiteInfo). ✓
- §2 Card UI (2-col grid) → Task 4 (component) + Task 6 (wired in). ✓
- §3 4-state outcome + accuracy slack + precedence + inline warning → Task 1 (classifier) + Task 5 (flow) + Task 6 (banner). ✓
- §4 Persistence (payload + submit stamp + both tables + migration) → Task 7 + Task 8 + Task 9. ✓
- §5 Edge cases (both missing, timeout, submit-fail null, accuracy 0) → covered by Task 1 classifier tests + `readDeviceLocation` null-on-fail + Task 7 best-effort submit read. ✓
- §6 Testing (unit/component/browser) → Tasks 1–8 tests + browser section. ✓

**Type consistency:** `GeofenceStatus`, `GeofenceReading`, `GeofencePayload`, `buildReading`, `classifyGeofence`, `encode/decodeGeofenceParam`, `readDeviceLocation`, `toSiteGeo`, `geofenceColumns` are defined once (Tasks 1/2/8) and referenced with the same names/signatures throughout. `SiteInfo` gains exactly `plannedLat/plannedLon/pon/zone` (Task 3) and those names are used in Tasks 4/6. Hook arg order `(steps, siteInfo, entryGeofence)` is consistent across Tasks 5/7 and the wizard.

**Placeholder scan:** No TBD/TODO; every code step shows complete code; the only `<...>` placeholders are the DB password in the controller-run psql commands (intentionally not hardcoded — read from `.claude/credentials.local.md` at run time).
