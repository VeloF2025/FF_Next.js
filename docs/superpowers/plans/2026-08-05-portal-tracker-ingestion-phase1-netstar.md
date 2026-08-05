# Portal Tracker Ingestion — Phase 1 (Foundation + Netstar) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pull position history for Velocity's Netstar-tracked vehicles through the VigilCloud
report API and land it in `fleet_vehicle_positions`, with a discovery step that continuously
reconciles which vehicles are reachable and alerting when a pull fails or silently returns nothing.

**Architecture:** A `netstar` provider implementing the existing `TrackingProvider` interface,
so `ingestPositions()`, `fleet_tracking_watermarks`, and the live map need no changes. The
provider authenticates against the portal, requests an "All Activity" report in ≤31-day chunks,
downloads CSV, and parses it into `ProviderPosition[]`. A separate discovery service maps portal
vehicle IDs onto `fleet_vehicles` rows. A 2-hourly cron drives both.

**Tech Stack:** TypeScript, Next.js Pages Router API routes, `pg` via `@/lib/db-pool`, `papaparse`,
Vitest 0.34, `@/lib/logger`.

**Spec:** `docs/superpowers/specs/2026-08-05-portal-tracker-ingestion-design.md`

## Global Constraints

- **No credential values in any tracked file.** Read from `process.env` only. Follow the
  `CARTRACK_*` naming convention in `pages/api/cron/poll-tracking.ts:46`.
- **New files < 300 lines. New components < 200 lines.** CI ratchets this.
- **No `console.log`** — use `log` from `@/lib/logger`. No empty catch blocks. Changed code fully typed.
- **Netstar reports are capped at 31 days per request.** Exceeding it returns an error, not a short page.
- **`ProviderKey` already includes `'netstar'`** and the DB CHECK constraints already permit it.
  No migration is needed for provider values.
- **Fields a provider cannot supply are `null`** — never `0`, never invented (`types.ts:5-7`).
- **Conditional tagged-template SQL fragments are broken in this repo.** Use explicit query
  branches, never `${cond ? sql`AND x` : sql``}`.
- **All work on a non-master branch, PR required.** Branch: `feat/portal-tracker-netstar`.
- Run `npm run ci:quick` before any PR.

---

### Task 1: Capture a real Netstar CSV fixture

Every parser task downstream depends on the actual column names. We do not have them: the one
`POST /Reports/Export` attempt during recon returned 503. This task produces the ground truth.

**Files:**
- Create: `src/services/tracking/netstar/__tests__/fixtures/all-activity-sample.csv`
- Create: `src/services/tracking/netstar/__tests__/fixtures/README.md`

**Interfaces:**
- Consumes: nothing
- Produces: a committed CSV fixture whose header row is recorded verbatim in the README, used by Tasks 2 and 5.

- [ ] **Step 1: Log into VigilCloud manually and generate a report**

In a browser, at `https://profleet.netstar.co.za/VigilCloud4/Reports/`:
- Category `Individual`, group `Detailed`, type `All Activity`
- Filter the left tree to a single known vehicle, e.g. `LN40MGGP`, and select its radio button
- Start Date: yesterday 00:00, End Date: now (a 1–2 day window keeps the file small)
- Click **Generate**, wait for it to finish, then **Export → CSV**

- [ ] **Step 2: If Export returns 503, retry once after 60 seconds**

The 503 seen on 2026-08-05 was unexplained. If it persists across two attempts, stop and report
it — do not proceed on a guessed schema. Falling back to **Excel** export and converting to CSV
is acceptable; record in the README which format was actually used.

- [ ] **Step 3: Sanitise and commit the fixture**

Keep the header row and at most 50 data rows. The file describes vehicle movements, so scrub
nothing structural, but confirm it contains no driver personal data beyond a name already in
`staff`.

- [ ] **Step 4: Record the header row verbatim in the README**

```markdown
# Netstar All Activity export — fixture

Captured: <YYYY-MM-DD> from profleet.netstar.co.za, vehicle LN40MGGP, <N>-day window.
Export format used: CSV | Excel-converted

Header row, verbatim:

    <paste the exact first line of the file here>

Column semantics (fill in from the data):
| Column | Meaning | Maps to ProviderPosition field |
|---|---|---|
| ... | ... | ... |
```

The mapping table is this task's real deliverable — Task 2 codes directly against it.

- [ ] **Step 5: Commit**

```bash
git add src/services/tracking/netstar/__tests__/fixtures/
git commit -m "test(fleet): capture Netstar All Activity CSV fixture"
```

---

### Task 2: Netstar CSV parser

**Files:**
- Create: `src/services/tracking/netstar/parse.ts`
- Test: `src/services/tracking/netstar/__tests__/parse.test.ts`

**Interfaces:**
- Consumes: the fixture and column mapping from Task 1.
- Produces: `parseAllActivityCsv(csv: string): ProviderPosition[]` — used by Task 5.

- [ ] **Step 1: Write the failing test**

```typescript
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import { parseAllActivityCsv } from '../parse';

const fixture = readFileSync(
  join(__dirname, 'fixtures/all-activity-sample.csv'),
  'utf8'
);

describe('parseAllActivityCsv', () => {
  it('returns one position per data row', () => {
    const rows = parseAllActivityCsv(fixture);
    expect(rows.length).toBeGreaterThan(0);
  });

  it('produces coordinates inside South Africa', () => {
    for (const p of parseAllActivityCsv(fixture)) {
      expect(p.lat).toBeGreaterThan(-35);
      expect(p.lat).toBeLessThan(-22);
      expect(p.lon).toBeGreaterThan(16);
      expect(p.lon).toBeLessThan(33);
    }
  });

  it('parses timestamps as valid Dates', () => {
    for (const p of parseAllActivityCsv(fixture)) {
      expect(Number.isNaN(p.recordedAt.getTime())).toBe(false);
    }
  });

  it('leaves unsupplied fields null rather than zero', () => {
    const p = parseAllActivityCsv(fixture)[0];
    expect(p.linearG).toBeNull();
    expect(p.lateralG).toBeNull();
  });

  it('drops rows with no GPS fix instead of emitting 0,0', () => {
    const csv = fixture.split('\n').slice(0, 2).join('\n') + '\n' +
      fixture.split('\n')[1].replace(/-2[56]\.\d+/, '').replace(/2[78]\.\d+/, '');
    expect(parseAllActivityCsv(csv).length).toBeLessThanOrEqual(1);
  });

  it('returns an empty array for a header-only export', () => {
    expect(parseAllActivityCsv(fixture.split('\n')[0])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/tracking/netstar/__tests__/parse.test.ts`
Expected: FAIL — `Cannot find module '../parse'`

- [ ] **Step 3: Write the implementation**

Replace the `COLUMNS` values with the real header names recorded in Task 1's README.

```typescript
/**
 * Parses a Netstar VigilCloud "All Activity" CSV export into provider-blind
 * positions.
 *
 * Pure and network-free so it can be tested against a committed fixture. The
 * column names below are Netstar's, captured from a real export (see
 * __tests__/fixtures/README.md) — they are not guessable and must not be
 * "tidied" without re-capturing a fixture.
 *
 * A row with no usable GPS fix is dropped rather than emitted at 0,0: the map
 * would otherwise draw the vehicle off West Africa.
 */
import Papa from 'papaparse';
import type { ProviderPosition } from '../types';

/** Real header names from the Netstar export. See fixtures/README.md. */
const COLUMNS = {
  timestamp: 'Date Time',
  latitude: 'Latitude',
  longitude: 'Longitude',
  speed: 'Speed',
  ignition: 'Ignition',
  odometer: 'Odometer',
  heading: 'Heading',
  event: 'Event',
} as const;

/** Netstar renders local time; the request pins the zone to SAST (UTC+02:00). */
const SAST_OFFSET = '+02:00';

function num(v: string | undefined): number | null {
  if (v === undefined) return null;
  const t = v.trim().replace(/[^\d.\-]/g, '');
  if (t === '' || t === '-') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function bool(v: string | undefined): boolean | null {
  if (v === undefined) return null;
  const t = v.trim().toLowerCase();
  if (['on', 'true', 'yes', '1'].includes(t)) return true;
  if (['off', 'false', 'no', '0'].includes(t)) return false;
  return null;
}

/** `2026-08-05 14:35:31` with no zone — Netstar means SAST, so state it. */
export function parseNetstarTs(raw: string): Date | null {
  if (!raw) return null;
  const t = raw.trim().replace(' ', 'T');
  const iso = /[Zz]|[+-]\d{2}:?\d{2}$/.test(t) ? t : `${t}${SAST_OFFSET}`;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function parseAllActivityCsv(csv: string): ProviderPosition[] {
  const parsed = Papa.parse<Record<string, string>>(csv, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (h) => h.trim(),
  });

  const out: ProviderPosition[] = [];
  for (const row of parsed.data) {
    const lat = num(row[COLUMNS.latitude]);
    const lon = num(row[COLUMNS.longitude]);
    const recordedAt = parseNetstarTs(row[COLUMNS.timestamp] ?? '');
    if (lat === null || lon === null || recordedAt === null) continue;
    if (lat === 0 && lon === 0) continue;

    out.push({
      externalId: '',            // set by the provider, which knows the vehicle
      providerEventId: null,     // Netstar supplies none; ingest synthesises one
      recordedAt,
      lat,
      lon,
      speedKph: num(row[COLUMNS.speed]),
      roadSpeedKph: null,
      isSpeeding: null,
      ignition: bool(row[COLUMNS.ignition]),
      odometerKm: num(row[COLUMNS.odometer]),
      linearG: null,
      lateralG: null,
      bearing: num(row[COLUMNS.heading]),
      altitudeM: null,
      gpsFixType: null,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/tracking/netstar/__tests__/parse.test.ts`
Expected: PASS (6 tests)

If a test fails on a column name, fix `COLUMNS` to match the fixture — never loosen the test.

- [ ] **Step 5: Commit**

```bash
git add src/services/tracking/netstar/parse.ts src/services/tracking/netstar/__tests__/parse.test.ts
git commit -m "feat(fleet): parse Netstar All Activity CSV into provider positions"
```

---

### Task 3: Registration normalisation and matching

**Files:**
- Create: `src/services/tracking/portal/registration.ts`
- Test: `src/services/tracking/portal/__tests__/registration.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `normaliseRegistration(raw: string): string`
  - `matchVehicles(portal: PortalVehicle[], fleet: FleetVehicleRow[]): MatchResult`
  - `interface PortalVehicle { externalId: string; registration: string | null }`
  - `interface FleetVehicleRow { id: string; registration: string }`
  - `interface MatchResult { matched: Array<{ externalId: string; vehicleId: string; registration: string }>; portalOnly: PortalVehicle[]; fleetOnly: FleetVehicleRow[] }`

Used by Task 6.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { normaliseRegistration, matchVehicles } from '../registration';

describe('normaliseRegistration', () => {
  it('uppercases and strips spaces and hyphens', () => {
    expect(normaliseRegistration(' ln 40-mggp ')).toBe('LN40MGGP');
  });
  it('returns empty string for junk', () => {
    expect(normaliseRegistration('   ')).toBe('');
  });
});

describe('matchVehicles', () => {
  const fleet = [
    { id: 'v1', registration: 'LN40MGGP' },
    { id: 'v2', registration: 'LG94NLGP' },
  ];

  it('matches on normalised registration', () => {
    const r = matchVehicles([{ externalId: '1447952', registration: 'ln40 mggp' }], fleet);
    expect(r.matched).toEqual([
      { externalId: '1447952', vehicleId: 'v1', registration: 'LN40MGGP' },
    ]);
  });

  it('reports portal vehicles absent from the fleet', () => {
    const r = matchVehicles([{ externalId: '99', registration: 'ZZ99ZZGP' }], fleet);
    expect(r.portalOnly.map((p) => p.externalId)).toEqual(['99']);
  });

  it('reports fleet vehicles absent from the portal', () => {
    const r = matchVehicles([{ externalId: '1447952', registration: 'LN40MGGP' }], fleet);
    expect(r.fleetOnly.map((f) => f.id)).toEqual(['v2']);
  });

  it('treats a null portal registration as unmatchable, not as a wildcard', () => {
    const r = matchVehicles([{ externalId: '544524626', registration: null }], fleet);
    expect(r.matched).toEqual([]);
    expect(r.portalOnly).toHaveLength(1);
  });

  it('does not match two portal vehicles to the same fleet row', () => {
    const r = matchVehicles(
      [
        { externalId: 'a', registration: 'LN40MGGP' },
        { externalId: 'b', registration: 'LN40MGGP' },
      ],
      fleet
    );
    expect(r.matched).toHaveLength(1);
    expect(r.portalOnly.map((p) => p.externalId)).toContain('b');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/tracking/portal/__tests__/registration.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
/**
 * Matching portal vehicle lists onto fleet_vehicles by registration.
 *
 * Registration is the only identifier shared across four tracking platforms and
 * FibreFlow, and every platform formats it differently ("LN40MGGP", "ln 40 mggp",
 * "LN40-MGGP"). Normalising to bare alphanumerics is what makes them comparable.
 *
 * The reconciliation is deliberately bidirectional. A portal vehicle we cannot
 * place is as interesting as a fleet vehicle we cannot find: during recon, the
 * first case surfaced a live Cartrack subscription attached to no known vehicle,
 * and the second is the coverage gap this whole project exists to close.
 */

export interface PortalVehicle {
  externalId: string;
  registration: string | null;
}

export interface FleetVehicleRow {
  id: string;
  registration: string;
}

export interface MatchResult {
  matched: Array<{ externalId: string; vehicleId: string; registration: string }>;
  portalOnly: PortalVehicle[];
  fleetOnly: FleetVehicleRow[];
}

export function normaliseRegistration(raw: string): string {
  return (raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function matchVehicles(
  portal: PortalVehicle[],
  fleet: FleetVehicleRow[]
): MatchResult {
  const byReg = new Map<string, FleetVehicleRow>();
  for (const f of fleet) {
    const key = normaliseRegistration(f.registration);
    if (key) byReg.set(key, f);
  }

  const matched: MatchResult['matched'] = [];
  const portalOnly: PortalVehicle[] = [];
  // A fleet row may be claimed once only. Two portal entries carrying the same
  // plate means the account has a stale duplicate; silently mapping both would
  // make positions for one vehicle arrive under two tracker rows.
  const claimed = new Set<string>();

  for (const p of portal) {
    const key = p.registration ? normaliseRegistration(p.registration) : '';
    const hit = key ? byReg.get(key) : undefined;
    if (!hit || claimed.has(hit.id)) {
      portalOnly.push(p);
      continue;
    }
    claimed.add(hit.id);
    matched.push({
      externalId: p.externalId,
      vehicleId: hit.id,
      registration: normaliseRegistration(hit.registration),
    });
  }

  return {
    matched,
    portalOnly,
    fleetOnly: fleet.filter((f) => !claimed.has(f.id)),
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/tracking/portal/__tests__/registration.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/tracking/portal/registration.ts src/services/tracking/portal/__tests__/registration.test.ts
git commit -m "feat(fleet): match portal vehicle lists onto fleet_vehicles by registration"
```

---

### Task 4: Portal session helper

**Files:**
- Create: `src/services/tracking/portal/session.ts`
- Test: `src/services/tracking/portal/__tests__/session.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `class PortalSession` with `constructor(opts: PortalSessionOptions)`,
    `request(path: string, init?: RequestInit): Promise<Response>`, `reset(): void`
  - `interface PortalSessionOptions { baseUrl: string; login: (fetchImpl: typeof fetch, jar: CookieJar) => Promise<void>; isLoggedOut: (res: Response) => boolean; fetchImpl?: typeof fetch; timeoutMs?: number }`
  - `class CookieJar` with `header(): string`, `absorb(res: Response): void`

Used by Task 5.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { PortalSession, CookieJar } from '../session';

function res(status: number, body = '', headers: Record<string, string> = {}) {
  return new Response(body, { status, headers });
}

describe('CookieJar', () => {
  it('accumulates cookies and renders a header', () => {
    const jar = new CookieJar();
    jar.absorb(res(200, '', { 'set-cookie': 'a=1; Path=/; HttpOnly' }));
    expect(jar.header()).toContain('a=1');
  });
});

describe('PortalSession', () => {
  it('logs in once, then reuses the session', async () => {
    const login = vi.fn(async () => {});
    const fetchImpl = vi.fn(async () => res(200, 'ok'));
    const s = new PortalSession({
      baseUrl: 'https://x.test', login, isLoggedOut: () => false, fetchImpl,
    });
    await s.request('/a');
    await s.request('/b');
    expect(login).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('re-authenticates exactly once when the session is killed mid-run', async () => {
    const login = vi.fn(async () => {});
    let calls = 0;
    const fetchImpl = vi.fn(async () => (++calls === 1 ? res(302) : res(200, 'ok')));
    const s = new PortalSession({
      baseUrl: 'https://x.test', login,
      isLoggedOut: (r) => r.status === 302, fetchImpl,
    });
    const out = await s.request('/a');
    expect(out.status).toBe(200);
    expect(login).toHaveBeenCalledTimes(2);
  });

  it('gives up rather than looping when re-auth does not help', async () => {
    const login = vi.fn(async () => {});
    const fetchImpl = vi.fn(async () => res(302));
    const s = new PortalSession({
      baseUrl: 'https://x.test', login,
      isLoggedOut: () => true, fetchImpl,
    });
    await expect(s.request('/a')).rejects.toThrow(/still logged out/i);
    expect(login).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/tracking/portal/__tests__/session.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
/**
 * A cookie-backed portal session with bounded re-authentication.
 *
 * These are human web portals, not APIs: authentication is a form POST and a
 * session cookie, and the session can die underneath a long run. Netstar in
 * particular enforces a SINGLE session — a second login anywhere fires
 * `POST /Authentication/Account/LogOff` and invalidates the first — so a
 * colleague opening the portal mid-run will log this job out.
 *
 * Re-auth is therefore expected and handled, but capped at one retry per
 * request. Retrying without a cap against a portal that is rejecting us is how
 * an account gets locked.
 */
import { log } from '@/lib/logger';

const DEFAULT_TIMEOUT_MS = 60_000;

export class CookieJar {
  private readonly cookies = new Map<string, string>();

  absorb(res: Response): void {
    // Undici exposes multiple Set-Cookie headers via getSetCookie(); fall back
    // to the folded single header on runtimes that lack it.
    const raw =
      typeof (res.headers as unknown as { getSetCookie?: () => string[] }).getSetCookie === 'function'
        ? (res.headers as unknown as { getSetCookie: () => string[] }).getSetCookie()
        : [res.headers.get('set-cookie') ?? ''];
    for (const line of raw) {
      if (!line) continue;
      const [pair] = line.split(';');
      const idx = pair.indexOf('=');
      if (idx <= 0) continue;
      this.cookies.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
    }
  }

  header(): string {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  clear(): void {
    this.cookies.clear();
  }
}

export interface PortalSessionOptions {
  baseUrl: string;
  /** Performs the form login, absorbing cookies into the jar. */
  login: (fetchImpl: typeof fetch, jar: CookieJar) => Promise<void>;
  /** True when a response indicates the session is gone (302 to login, etc). */
  isLoggedOut: (res: Response) => boolean;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

export class PortalSession {
  private readonly jar = new CookieJar();
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private authed = false;

  constructor(private readonly opts: PortalSessionOptions) {
    this.fetchImpl = opts.fetchImpl ?? fetch;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  reset(): void {
    this.jar.clear();
    this.authed = false;
  }

  async request(path: string, init: RequestInit = {}): Promise<Response> {
    if (!this.authed) {
      await this.opts.login(this.fetchImpl, this.jar);
      this.authed = true;
    }

    let res = await this.send(path, init);
    if (!this.opts.isLoggedOut(res)) return res;

    log.warn('[portal-session] session lost mid-run — re-authenticating once', {
      baseUrl: this.opts.baseUrl,
      path,
    });
    this.reset();
    await this.opts.login(this.fetchImpl, this.jar);
    this.authed = true;

    res = await this.send(path, init);
    if (this.opts.isLoggedOut(res)) {
      // Deliberately not a loop: a portal that rejects us twice is a
      // credentials or entitlement problem, and hammering it risks a lockout.
      throw new Error(`[portal-session] still logged out after re-auth: ${path}`);
    }
    return res;
  }

  private async send(path: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const url = path.startsWith('http')
        ? path
        : `${this.opts.baseUrl.replace(/\/+$/, '')}${path}`;
      const res = await this.fetchImpl(url, {
        ...init,
        redirect: 'manual',
        headers: { ...(init.headers ?? {}), Cookie: this.jar.header() },
        signal: controller.signal,
      });
      this.jar.absorb(res);
      return res;
    } finally {
      clearTimeout(timer);
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/tracking/portal/__tests__/session.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add src/services/tracking/portal/session.ts src/services/tracking/portal/__tests__/session.test.ts
git commit -m "feat(fleet): cookie-backed portal session with bounded re-auth"
```

---

### Task 5: Netstar client and provider

**Files:**
- Create: `src/services/tracking/netstar/client.ts`
- Create: `src/services/tracking/netstar/provider.ts`
- Test: `src/services/tracking/netstar/__tests__/client.test.ts`
- Test: `src/services/tracking/netstar/__tests__/provider.test.ts`

**Interfaces:**
- Consumes: `parseAllActivityCsv` (Task 2), `PortalSession` (Task 4).
- Produces:
  - `netstarClient(opts: NetstarClientOptions): NetstarClient` with
    `listVehicles(): Promise<PortalVehicle[]>` and
    `fetchPositions(from: Date, to: Date, vehicles: PortalVehicle[]): Promise<ProviderPosition[]>`
  - `netstarProvider(opts: NetstarProviderOptions): TrackingProvider`
  - `chunkWindow(from: Date, to: Date, maxMs: number): Array<{ from: Date; to: Date }>`
  - `MAX_REPORT_MS: number` (31 days in ms)

Used by Tasks 6 and 9.

- [ ] **Step 1: Write the failing test for window chunking**

```typescript
import { describe, it, expect } from 'vitest';
import { chunkWindow, MAX_REPORT_MS } from '../client';

describe('chunkWindow', () => {
  it('returns a single chunk when inside the limit', () => {
    const from = new Date('2026-08-01T00:00:00Z');
    const to = new Date('2026-08-05T00:00:00Z');
    expect(chunkWindow(from, to, MAX_REPORT_MS)).toEqual([{ from, to }]);
  });

  it('splits a 90-day window into chunks no wider than the limit', () => {
    const from = new Date('2026-05-01T00:00:00Z');
    const to = new Date('2026-07-30T00:00:00Z');
    const chunks = chunkWindow(from, to, MAX_REPORT_MS);
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) {
      expect(c.to.getTime() - c.from.getTime()).toBeLessThanOrEqual(MAX_REPORT_MS);
    }
  });

  it('covers the window with no gaps', () => {
    const from = new Date('2026-05-01T00:00:00Z');
    const to = new Date('2026-07-30T00:00:00Z');
    const chunks = chunkWindow(from, to, MAX_REPORT_MS);
    expect(chunks[0].from).toEqual(from);
    expect(chunks[chunks.length - 1].to).toEqual(to);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].from.getTime()).toBe(chunks[i - 1].to.getTime());
    }
  });

  it('returns nothing for an inverted window', () => {
    expect(chunkWindow(new Date('2026-08-05'), new Date('2026-08-01'), MAX_REPORT_MS)).toEqual([]);
  });

  it('caps at 31 days, matching the portal limit', () => {
    expect(MAX_REPORT_MS).toBe(31 * 24 * 60 * 60 * 1000);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/tracking/netstar/__tests__/client.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the client**

```typescript
/**
 * Netstar VigilCloud portal client.
 *
 * VigilCloud is a human portal, but its report builder is backed by a JSON
 * endpoint, so this speaks HTTP rather than driving a browser. Contract
 * captured live on 2026-08-05:
 *
 *   POST /VigilCloud4/Reports/ReportRepo/GenerateReport/  -> "<jobId>"  (async)
 *   POST /VigilCloud4/Reports/Export                      -> CSV bytes
 *
 * Report generation is ASYNCHRONOUS: GenerateReport returns a job id, not data.
 *
 * The login form's inputs carry readonly="readonly" with an onmousedown handler
 * that clears it — an anti-autofill measure that only affects browser
 * automation. Posting the form directly sidesteps it entirely, which is a large
 * part of why this is an HTTP client and not Playwright.
 */
import { PortalSession, type CookieJar } from '../portal/session';
import { parseAllActivityCsv } from './parse';
import type { PortalVehicle } from '../portal/registration';
import type { ProviderPosition } from '../types';
import { log } from '@/lib/logger';

/** Portal-enforced: "This report is limited to 31 days". Verified 2026-08-05. */
export const MAX_REPORT_MS = 31 * 24 * 60 * 60 * 1000;

const REPORT_ID = 'Mobiles.IndividualReports.AllActivity';
const TIMEZONE = 'South Africa Standard Time';
/** Generation is async; poll the export until it stops reporting "not ready". */
const EXPORT_ATTEMPTS = 10;
const EXPORT_DELAY_MS = 3_000;

export interface NetstarClientOptions {
  baseUrl: string;
  username: string;
  password: string;
  fetchImpl?: typeof fetch;
  /** Injectable so tests do not sleep. */
  sleep?: (ms: number) => Promise<void>;
}

export interface NetstarClient {
  listVehicles(): Promise<PortalVehicle[]>;
  fetchPositions(from: Date, to: Date, vehicles: PortalVehicle[]): Promise<ProviderPosition[]>;
}

/** Split a window into contiguous chunks no wider than `maxMs`. */
export function chunkWindow(
  from: Date,
  to: Date,
  maxMs: number
): Array<{ from: Date; to: Date }> {
  const out: Array<{ from: Date; to: Date }> = [];
  let cursor = from.getTime();
  const end = to.getTime();
  if (!(cursor < end)) return out;
  while (cursor < end) {
    const next = Math.min(cursor + maxMs, end);
    out.push({ from: new Date(cursor), to: new Date(next) });
    cursor = next;
  }
  return out;
}

export function netstarClient(opts: NetstarClientOptions): NetstarClient {
  const sleep = opts.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));

  const session = new PortalSession({
    baseUrl: opts.baseUrl,
    fetchImpl: opts.fetchImpl,
    isLoggedOut: (res) =>
      res.status === 302 && /Account\/Login/i.test(res.headers.get('location') ?? ''),
    login: async (fetchImpl, jar: CookieJar) => {
      const url = `${opts.baseUrl.replace(/\/+$/, '')}/Authentication/Account/Login`;
      const body = new URLSearchParams({
        UserName: opts.username,
        Password: opts.password,
      });
      const res = await fetchImpl(url, {
        method: 'POST',
        body,
        redirect: 'manual',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Cookie: jar.header(),
        },
      });
      jar.absorb(res);
      if (res.status >= 400) {
        throw new Error(`[netstar] login failed: HTTP ${res.status}`);
      }
    },
  });

  async function listVehicles(): Promise<PortalVehicle[]> {
    const res = await session.request('/Reports/ReportRepo/GetReportTree', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ reportTree: 'Vehicles' }),
    });
    if (!res.ok) throw new Error(`[netstar] vehicle list: HTTP ${res.status}`);
    const body = (await res.json()) as Array<{ id?: number | string; name?: string }>;
    return (Array.isArray(body) ? body : [])
      .filter((v) => v.id !== undefined && v.id !== null)
      .map((v) => ({ externalId: String(v.id), registration: v.name ?? null }));
  }

  async function fetchChunk(
    from: Date,
    to: Date,
    vehicles: PortalVehicle[]
  ): Promise<ProviderPosition[]> {
    const payload = {
      reportId: REPORT_ID,
      reportName: 'All Activity',
      startTime: from.toISOString(),
      stopTime: to.toISOString(),
      scheduleForAllNew: false,
      sortAscending: true,
      embededMap: false,
      useVehicleTimeZone: false,
      selectedTimeZone: TIMEZONE,
      selectedIds: vehicles.map((v) => Number(v.externalId)),
      selectedNames: vehicles.map((v) => v.registration ?? ''),
      reportBy: 'Vehicle',
      reportTree: 'Vehicles',
      reportGroup: 'Detailed',
      customPanelName: '',
      category: 'Individual',
    };

    const gen = await session.request('/Reports/ReportRepo/GenerateReport/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!gen.ok) throw new Error(`[netstar] GenerateReport: HTTP ${gen.status}`);
    const jobId = (await gen.text()).replace(/^"|"$/g, '');
    if (!jobId) throw new Error('[netstar] GenerateReport returned no job id');

    // Generation is asynchronous. A 503 here was observed once during recon and
    // is treated as "not ready yet" rather than fatal — but only for a bounded
    // number of attempts, so a genuinely broken export still fails the run.
    for (let attempt = 1; attempt <= EXPORT_ATTEMPTS; attempt++) {
      const exp = await session.request('/Reports/Export', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/csv' },
        body: JSON.stringify({ reportId: jobId, outputFormat: 'CSV' }),
      });
      if (exp.ok) {
        const positions = parseAllActivityCsv(await exp.text());
        // Netstar reports one vehicle at a time in practice; stamp the id so
        // ingest can map it. When several are requested the CSV carries a
        // registration column and the provider re-splits on it.
        return positions.map((p) => ({
          ...p,
          externalId: p.externalId || (vehicles[0]?.externalId ?? ''),
        }));
      }
      if (exp.status !== 503 && exp.status !== 404) {
        throw new Error(`[netstar] Export: HTTP ${exp.status}`);
      }
      log.info('[netstar] export not ready, retrying', { jobId, attempt });
      await sleep(EXPORT_DELAY_MS);
    }
    throw new Error(`[netstar] export never became ready for job ${jobId}`);
  }

  return {
    listVehicles,
    async fetchPositions(from, to, vehicles) {
      const all: ProviderPosition[] = [];
      for (const chunk of chunkWindow(from, to, MAX_REPORT_MS)) {
        for (const v of vehicles) {
          all.push(...(await fetchChunk(chunk.from, chunk.to, [v])));
        }
      }
      return all;
    },
  };
}
```

- [ ] **Step 4: Run the chunking tests**

Run: `npx vitest run src/services/tracking/netstar/__tests__/client.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Write the provider test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { netstarProvider } from '../provider';

describe('netstarProvider', () => {
  it('declares itself as the netstar provider', () => {
    const p = netstarProvider({
      baseUrl: 'https://x.test', username: 'u', password: 'p',
      accountRef: 'europcar',
      client: { listVehicles: vi.fn(), fetchPositions: vi.fn(async () => []) },
    });
    expect(p.key).toBe('netstar');
    expect(p.accountRef).toBe('europcar');
  });

  it('asks the client only for vehicles mapped in fleet_vehicle_trackers', async () => {
    const fetchPositions = vi.fn(async () => []);
    const p = netstarProvider({
      baseUrl: 'https://x.test', username: 'u', password: 'p',
      accountRef: 'europcar',
      client: { listVehicles: vi.fn(), fetchPositions },
      loadMappedVehicles: async () => [{ externalId: '1447952', registration: 'LN40MGGP' }],
    });
    await p.fetchPositions(new Date('2026-08-01'), new Date('2026-08-02'));
    expect(fetchPositions).toHaveBeenCalledWith(
      new Date('2026-08-01'), new Date('2026-08-02'),
      [{ externalId: '1447952', registration: 'LN40MGGP' }]
    );
  });

  it('skips the request entirely when nothing is mapped', async () => {
    const fetchPositions = vi.fn(async () => []);
    const p = netstarProvider({
      baseUrl: 'https://x.test', username: 'u', password: 'p',
      accountRef: 'europcar',
      client: { listVehicles: vi.fn(), fetchPositions },
      loadMappedVehicles: async () => [],
    });
    expect(await p.fetchPositions(new Date('2026-08-01'), new Date('2026-08-02'))).toEqual([]);
    expect(fetchPositions).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Write the provider**

```typescript
/**
 * Netstar as a TrackingProvider.
 *
 * Only vehicles already mapped in fleet_vehicle_trackers are requested. The
 * Netstar login is a multi-client reseller account whose tree contains other
 * companies' fleets entirely — asking for the whole account would pull
 * thousands of foreign positions that ingest would then discard one by one.
 */
import { sql } from '@/lib/db-pool';
import { netstarClient, type NetstarClient } from './client';
import type { PortalVehicle } from '../portal/registration';
import type { ProviderPosition, TrackingProvider } from '../types';

export interface NetstarProviderOptions {
  baseUrl: string;
  username: string;
  password: string;
  accountRef: string;
  /** Injectable for tests. */
  client?: NetstarClient;
  loadMappedVehicles?: () => Promise<PortalVehicle[]>;
}

async function mappedVehicles(accountRef: string): Promise<PortalVehicle[]> {
  const rows = await sql<{ external_id: string; registration: string }>`
    SELECT t.external_id, v.registration
    FROM fleet_vehicle_trackers t
    JOIN fleet_vehicles v ON v.id = t.vehicle_id
    WHERE t.provider = 'netstar' AND t.account_ref = ${accountRef} AND t.is_active
    ORDER BY v.registration
  `;
  return rows.map((r) => ({ externalId: r.external_id, registration: r.registration }));
}

export function netstarProvider(opts: NetstarProviderOptions): TrackingProvider {
  const client = opts.client ?? netstarClient(opts);
  const load = opts.loadMappedVehicles ?? (() => mappedVehicles(opts.accountRef));

  return {
    key: 'netstar',
    accountRef: opts.accountRef,
    // The portal poller sizes its window by the 31-day report cap, not by an
    // event budget, so resolveWindow() is not used for this provider.
    maxEventsPerFetch: Number.MAX_SAFE_INTEGER,
    async fetchPositions(from: Date, to: Date): Promise<ProviderPosition[]> {
      const vehicles = await load();
      if (vehicles.length === 0) return [];
      return client.fetchPositions(from, to, vehicles);
    },
  };
}
```

- [ ] **Step 7: Run all Netstar tests**

Run: `npx vitest run src/services/tracking/netstar/`
Expected: PASS (all)

- [ ] **Step 8: Commit**

```bash
git add src/services/tracking/netstar/
git commit -m "feat(fleet): Netstar portal client and TrackingProvider"
```

---

### Task 6: Discovery — bidirectional tracker reconciliation

**Files:**
- Create: `src/services/tracking/discovery.ts`
- Test: `src/services/tracking/__tests__/discovery.test.ts`

**Interfaces:**
- Consumes: `matchVehicles` (Task 3), `NetstarClient.listVehicles` (Task 5).
- Produces: `reconcileTrackers(provider: ProviderKey, accountRef: string, portal: PortalVehicle[], deps?): Promise<ReconcileReport>` where
  `interface ReconcileReport { upserted: number; deactivated: number; portalOnly: PortalVehicle[]; fleetOnly: FleetVehicleRow[] }`

Used by Task 9.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi } from 'vitest';
import { reconcileTrackers } from '../discovery';

const fleet = [
  { id: 'v1', registration: 'LN40MGGP' },
  { id: 'v2', registration: 'LG94NLGP' },
];

function deps(overrides = {}) {
  return {
    loadActiveFleet: async () => fleet,
    deactivateOthersForVehicle: vi.fn(async () => {}),
    upsertTracker: vi.fn(async () => {}),
    deactivateMissing: vi.fn(async () => 0),
    ...overrides,
  };
}

describe('reconcileTrackers', () => {
  it('upserts a tracker row per matched vehicle', async () => {
    const d = deps();
    const r = await reconcileTrackers(
      'netstar', 'europcar',
      [{ externalId: '1447952', registration: 'LN40MGGP' }], d
    );
    expect(r.upserted).toBe(1);
    expect(d.upsertTracker).toHaveBeenCalledWith('netstar', 'europcar', '1447952', 'v1');
  });

  it('reports fleet vehicles the portal does not know about', async () => {
    const r = await reconcileTrackers(
      'netstar', 'europcar',
      [{ externalId: '1447952', registration: 'LN40MGGP' }], deps()
    );
    expect(r.fleetOnly.map((f) => f.registration)).toEqual(['LG94NLGP']);
  });

  it('reports portal vehicles absent from the fleet', async () => {
    const r = await reconcileTrackers(
      'netstar', 'europcar',
      [{ externalId: '999', registration: 'ZZ99ZZGP' }], deps()
    );
    expect(r.portalOnly.map((p) => p.externalId)).toEqual(['999']);
  });

  it('never writes a tracker row for an unmatched portal vehicle', async () => {
    const d = deps();
    await reconcileTrackers('netstar', 'europcar', [{ externalId: '999', registration: null }], d);
    expect(d.upsertTracker).not.toHaveBeenCalled();
  });

  it('deactivates a vehicle\'s other active tracker before activating this one', async () => {
    // uq_fleet_trackers_one_active_per_vehicle allows exactly one. Newest wins.
    const order: string[] = [];
    const d = deps({
      upsertTracker: vi.fn(async () => { order.push('upsert'); }),
      deactivateOthersForVehicle: vi.fn(async () => { order.push('deactivate'); }),
    });
    await reconcileTrackers(
      'netstar', 'europcar',
      [{ externalId: '1447952', registration: 'LN40MGGP' }], d
    );
    expect(d.deactivateOthersForVehicle)
      .toHaveBeenCalledWith('v1', 'netstar', 'europcar', '1447952');
    expect(order).toEqual(['deactivate', 'upsert']);
  });

  it('deactivates tracker rows the portal no longer lists', async () => {
    const d = deps({ deactivateMissing: vi.fn(async () => 2) });
    const r = await reconcileTrackers(
      'netstar', 'europcar',
      [{ externalId: '1447952', registration: 'LN40MGGP' }], d
    );
    expect(r.deactivated).toBe(2);
    expect(d.deactivateMissing).toHaveBeenCalledWith('netstar', 'europcar', ['1447952']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/tracking/__tests__/discovery.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
/**
 * Reconciles a portal's vehicle list against fleet_vehicles.
 *
 * This is what makes coverage a continuously verified property rather than a
 * number somebody counted once. It runs before every poll and answers, every
 * time: which of our vehicles is this portal not carrying, and which of its
 * vehicles do we not recognise?
 *
 * Both directions matter. During recon the reverse direction surfaced a live
 * Cartrack subscription attached to no identifiable vehicle, and two retired
 * vehicles still being tracked on a partner's account.
 *
 * A tracker row is written ONLY for a confident registration match. Guessing
 * would attribute one vehicle's movements to another, which is worse than
 * having no data at all.
 */
import { sql, query } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import {
  matchVehicles,
  type FleetVehicleRow,
  type PortalVehicle,
} from './portal/registration';
import type { ProviderKey } from './types';

export interface ReconcileReport {
  upserted: number;
  deactivated: number;
  portalOnly: PortalVehicle[];
  fleetOnly: FleetVehicleRow[];
}

export interface ReconcileDeps {
  loadActiveFleet: () => Promise<FleetVehicleRow[]>;
  /** Enforces one-active-tracker-per-vehicle. Must run before upsertTracker. */
  deactivateOthersForVehicle: (
    vehicleId: string, provider: ProviderKey, accountRef: string, externalId: string
  ) => Promise<void>;
  upsertTracker: (
    provider: ProviderKey, accountRef: string, externalId: string, vehicleId: string
  ) => Promise<void>;
  deactivateMissing: (
    provider: ProviderKey, accountRef: string, keepExternalIds: string[]
  ) => Promise<number>;
}

const dbDeps: ReconcileDeps = {
  loadActiveFleet: async () => {
    const rows = await sql<{ id: string; registration: string }>`
      SELECT id, registration FROM fleet_vehicles
      WHERE status = 'active' AND registration IS NOT NULL AND btrim(registration) <> ''
      ORDER BY registration
    `;
    return rows.map((r) => ({ id: r.id, registration: r.registration }));
  },

  /**
   * The DB enforces uq_fleet_trackers_one_active_per_vehicle — a UNIQUE index
   * on (vehicle_id) WHERE is_active. Activating a second tracker for a vehicle
   * that already has one violates it and throws, taking the whole poll down.
   *
   * Newest wins: a vehicle moving between rental partners gets a new device and
   * the old one stops reporting, so the freshly discovered tracker is the
   * truthful one. This must run BEFORE the upsert — the reverse order trips the
   * very index it exists to respect.
   */
  deactivateOthersForVehicle: async (vehicleId, provider, accountRef, externalId) => {
    await sql`
      UPDATE fleet_vehicle_trackers
      SET is_active = false, updated_at = now()
      WHERE vehicle_id = ${vehicleId}
        AND is_active
        AND NOT (provider = ${provider} AND account_ref = ${accountRef} AND external_id = ${externalId})
    `;
  },

  upsertTracker: async (provider, accountRef, externalId, vehicleId) => {
    await sql`
      INSERT INTO fleet_vehicle_trackers
        (vehicle_id, provider, account_ref, external_id, is_active, created_at, updated_at)
      VALUES (${vehicleId}, ${provider}, ${accountRef}, ${externalId}, true, now(), now())
      ON CONFLICT (provider, account_ref, external_id) DO UPDATE
        SET vehicle_id = EXCLUDED.vehicle_id, is_active = true, updated_at = now()
    `;
  },

  deactivateMissing: async (provider, accountRef, keep) => {
    // Raw query, not a tagged template: a conditional fragment for the empty
    // -array case breaks this repo's SQL tag (see CLAUDE.md), so the two cases
    // are separate statements.
    const text = keep.length
      ? `UPDATE fleet_vehicle_trackers SET is_active = false, updated_at = now()
         WHERE provider = $1 AND account_ref = $2 AND is_active AND NOT (external_id = ANY($3))
         RETURNING id`
      : `UPDATE fleet_vehicle_trackers SET is_active = false, updated_at = now()
         WHERE provider = $1 AND account_ref = $2 AND is_active
         RETURNING id`;
    const params = keep.length ? [provider, accountRef, keep] : [provider, accountRef];
    return (await query(text, params)).length;
  },
};

export async function reconcileTrackers(
  provider: ProviderKey,
  accountRef: string,
  portal: PortalVehicle[],
  deps: ReconcileDeps = dbDeps
): Promise<ReconcileReport> {
  const fleet = await deps.loadActiveFleet();
  const { matched, portalOnly, fleetOnly } = matchVehicles(portal, fleet);

  for (const m of matched) {
    // Order is load-bearing: see deactivateOthersForVehicle.
    await deps.deactivateOthersForVehicle(m.vehicleId, provider, accountRef, m.externalId);
    await deps.upsertTracker(provider, accountRef, m.externalId, m.vehicleId);
  }
  const deactivated = await deps.deactivateMissing(
    provider, accountRef, matched.map((m) => m.externalId)
  );

  if (fleetOnly.length > 0) {
    log.info('[tracking-discovery] active vehicles not on this portal', {
      provider, accountRef,
      registrations: fleetOnly.map((f) => f.registration),
    });
  }
  if (portalOnly.length > 0) {
    log.warn('[tracking-discovery] portal vehicles matching no active fleet vehicle', {
      provider, accountRef,
      externalIds: portalOnly.map((p) => p.externalId),
    });
  }

  return { upserted: matched.length, deactivated, portalOnly, fleetOnly };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/tracking/__tests__/discovery.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: Verify the unique constraint the upsert depends on exists**

Run:
```bash
ssh velocity "sudo docker exec -u postgres supabase-db psql -d fibreflow -c \
  \"SELECT indexdef FROM pg_indexes WHERE tablename='fleet_vehicle_trackers';\""
```
Expected: a UNIQUE index on `(provider, account_ref, external_id)`.

If it is absent, add migration `scripts/migrations/sql/<next>_tracker_unique.sql` creating it —
migrations are only picked up from `scripts/migrations/sql/`, never from `scripts/migrations/`.

- [ ] **Step 6: Commit**

```bash
git add src/services/tracking/discovery.ts src/services/tracking/__tests__/discovery.test.ts
git commit -m "feat(fleet): bidirectional tracker reconciliation for portal providers"
```

---

### Task 7: Notification event types

**Files:**
- Modify: `src/modules/notifications/constants/index.ts`
- Test: `src/modules/notifications/__tests__/tracking-events.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: event type keys `'fleet.tracking_pull_failed'` and `'fleet.tracking_data_gap'`,
  registered in every constant map. Used by Task 8.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_CHANNEL_PREFERENCES,
  NOTIFICATION_EVENT_LABELS,
  NOTIFICATION_EVENT_CATEGORIES,
  NOTIFICATION_EVENT_SEVERITY,
  NOTIFICATION_EVENT_ICONS,
} from '../constants';

const EVENTS = ['fleet.tracking_pull_failed', 'fleet.tracking_data_gap'] as const;

describe('tracking notification events', () => {
  it.each(EVENTS)('%s is registered in every constant map', (key) => {
    expect(DEFAULT_CHANNEL_PREFERENCES[key]).toBeDefined();
    expect(NOTIFICATION_EVENT_LABELS[key]).toBeTruthy();
    expect(NOTIFICATION_EVENT_CATEGORIES[key]).toBe('Fleet');
    expect(NOTIFICATION_EVENT_SEVERITY[key]).toBeTruthy();
    expect(NOTIFICATION_EVENT_ICONS[key]).toBeTruthy();
  });

  it('sends both to email and in-app', () => {
    for (const key of EVENTS) {
      expect(DEFAULT_CHANNEL_PREFERENCES[key].in_app).toBe(true);
      expect(DEFAULT_CHANNEL_PREFERENCES[key].email).toBe(true);
    }
  });

  it('keeps the data-gap event off WhatsApp', () => {
    expect(DEFAULT_CHANNEL_PREFERENCES['fleet.tracking_data_gap'].whatsapp).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/modules/notifications/__tests__/tracking-events.test.ts`
Expected: FAIL — entries undefined

- [ ] **Step 3: Add the entries**

In `src/modules/notifications/constants/index.ts`, beside the existing `fleet.*` lines in each
map (channel preferences ~line 47, icons ~line 95, severity ~line 138, labels ~line 181,
categories ~line 224):

```typescript
// DEFAULT_CHANNEL_PREFERENCES
'fleet.tracking_pull_failed':     { in_app: true, email: true,  whatsapp: true  },
'fleet.tracking_data_gap':        { in_app: true, email: true,  whatsapp: false },

// NOTIFICATION_EVENT_ICONS
'fleet.tracking_pull_failed':     'satellite-off',
'fleet.tracking_data_gap':        'chart-line-off',

// NOTIFICATION_EVENT_SEVERITY
'fleet.tracking_pull_failed':     'warning',
'fleet.tracking_data_gap':        'warning',

// NOTIFICATION_EVENT_LABELS
'fleet.tracking_pull_failed':     'Vehicle Tracking Pull Failed',
'fleet.tracking_data_gap':        'Vehicle Tracking Data Gap',

// NOTIFICATION_EVENT_CATEGORIES
'fleet.tracking_pull_failed':     'Fleet',
'fleet.tracking_data_gap':        'Fleet',
```

`whatsapp: true` on the pull-failure event is the *ceiling*; Task 8 decides per occurrence
whether WhatsApp actually fires.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/modules/notifications/__tests__/tracking-events.test.ts`
Expected: PASS (7 tests)

- [ ] **Step 5: Commit**

```bash
git add src/modules/notifications/
git commit -m "feat(fleet): register tracking pull-failure and data-gap notification events"
```

---

### Task 8: Alert policy

**Files:**
- Create: `src/services/tracking/alerts.ts`
- Test: `src/services/tracking/__tests__/alerts.test.ts`

**Interfaces:**
- Consumes: event keys from Task 7.
- Produces: `decideAlert(input: AlertInput): AlertDecision | null` where
  `interface AlertInput { kind: 'auth' | 'transient' | 'gap'; consecutiveFailures: number; nowSast: Date }`
  and `interface AlertDecision { event: 'fleet.tracking_pull_failed' | 'fleet.tracking_data_gap'; channels: { in_app: boolean; email: boolean; whatsapp: boolean }; deferWhatsappUntil: Date | null }`

Used by Task 9.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { decideAlert } from '../alerts';

const noon = new Date('2026-08-05T12:00:00+02:00');
const twoAm = new Date('2026-08-05T02:00:00+02:00');

describe('decideAlert', () => {
  it('alerts immediately on an auth failure', () => {
    const d = decideAlert({ kind: 'auth', consecutiveFailures: 1, nowSast: noon });
    expect(d?.event).toBe('fleet.tracking_pull_failed');
    expect(d?.channels.email).toBe(true);
    expect(d?.channels.whatsapp).toBe(true);
  });

  it('stays silent on the first two transient failures', () => {
    expect(decideAlert({ kind: 'transient', consecutiveFailures: 1, nowSast: noon })).toBeNull();
    expect(decideAlert({ kind: 'transient', consecutiveFailures: 2, nowSast: noon })).toBeNull();
  });

  it('alerts on the third consecutive transient failure, without WhatsApp', () => {
    const d = decideAlert({ kind: 'transient', consecutiveFailures: 3, nowSast: noon });
    expect(d?.channels.email).toBe(true);
    expect(d?.channels.whatsapp).toBe(false);
  });

  it('raises a data gap immediately and never on WhatsApp', () => {
    const d = decideAlert({ kind: 'gap', consecutiveFailures: 0, nowSast: noon });
    expect(d?.event).toBe('fleet.tracking_data_gap');
    expect(d?.channels.whatsapp).toBe(false);
  });

  it('defers an overnight WhatsApp to 07:00 but sends email immediately', () => {
    const d = decideAlert({ kind: 'auth', consecutiveFailures: 1, nowSast: twoAm });
    expect(d?.channels.email).toBe(true);
    expect(d?.deferWhatsappUntil?.toISOString()).toBe(
      new Date('2026-08-05T07:00:00+02:00').toISOString()
    );
  });

  it('does not defer WhatsApp during working hours', () => {
    expect(decideAlert({ kind: 'auth', consecutiveFailures: 1, nowSast: noon })?.deferWhatsappUntil)
      .toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/services/tracking/__tests__/alerts.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the implementation**

```typescript
/**
 * When a tracking pull failure is worth interrupting someone.
 *
 * The distinctions matter because this job runs twelve times a day, every day.
 * An auth failure will never fix itself and needs a human; a transient blip
 * usually resolves on the next tick and should not generate noise. A data gap —
 * the portal authenticating cleanly and returning nothing — is the dangerous
 * one, because it looks exactly like success.
 *
 * Pure function: no DB, no notification sending, so the policy is testable on
 * its own.
 */

export type AlertKind = 'auth' | 'transient' | 'gap';

export interface AlertInput {
  kind: AlertKind;
  consecutiveFailures: number;
  /** Current time expressed in SAST. South Africa has no DST. */
  nowSast: Date;
}

export interface AlertDecision {
  event: 'fleet.tracking_pull_failed' | 'fleet.tracking_data_gap';
  channels: { in_app: boolean; email: boolean; whatsapp: boolean };
  /** Non-null when WhatsApp is warranted but should wait until working hours. */
  deferWhatsappUntil: Date | null;
}

/** Transient errors must repeat this many times before anyone is told. */
const TRANSIENT_THRESHOLD = 3;
const QUIET_UNTIL_HOUR = 7;
const QUIET_FROM_HOUR = 20;
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000;

function sastHour(d: Date): number {
  return new Date(d.getTime() + SAST_OFFSET_MS).getUTCHours();
}

/** 07:00 SAST on the next calendar day that has not passed it yet. */
function nextSevenAm(d: Date): Date {
  const sast = new Date(d.getTime() + SAST_OFFSET_MS);
  const target = new Date(sast);
  target.setUTCHours(QUIET_UNTIL_HOUR, 0, 0, 0);
  if (target <= sast) target.setUTCDate(target.getUTCDate() + 1);
  return new Date(target.getTime() - SAST_OFFSET_MS);
}

export function decideAlert(input: AlertInput): AlertDecision | null {
  if (input.kind === 'gap') {
    return {
      event: 'fleet.tracking_data_gap',
      channels: { in_app: true, email: true, whatsapp: false },
      deferWhatsappUntil: null,
    };
  }

  if (input.kind === 'transient') {
    if (input.consecutiveFailures < TRANSIENT_THRESHOLD) return null;
    return {
      event: 'fleet.tracking_pull_failed',
      channels: { in_app: true, email: true, whatsapp: false },
      deferWhatsappUntil: null,
    };
  }

  // Auth failure: will not self-heal, so WhatsApp is warranted — but a 02:00
  // failure cannot be acted on until morning, so the message waits.
  const hour = sastHour(input.nowSast);
  const overnight = hour < QUIET_UNTIL_HOUR || hour >= QUIET_FROM_HOUR;
  return {
    event: 'fleet.tracking_pull_failed',
    channels: { in_app: true, email: true, whatsapp: true },
    deferWhatsappUntil: overnight ? nextSevenAm(input.nowSast) : null,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/services/tracking/__tests__/alerts.test.ts`
Expected: PASS (6 tests)

- [ ] **Step 5: Write the failing test for the dispatcher**

Deciding to alert is useless unless something sends it. `notify()` in
`src/modules/notifications/services/notificationBus.ts` is this repo's dispatcher; its signature
is `notify(payload: NotifyPayload): Promise<void>` and it requires `recipient_user_ids`.

```typescript
import { describe, it, expect, vi } from 'vitest';
import { raiseTrackingAlert } from '../alerts';

describe('raiseTrackingAlert', () => {
  const base = {
    provider: 'netstar' as const,
    accountRef: 'europcar',
    detail: 'HTTP 401',
    nowSast: new Date('2026-08-05T12:00:00+02:00'),
  };

  it('does not notify when the policy says stay silent', async () => {
    const notify = vi.fn();
    await raiseTrackingAlert(
      { ...base, kind: 'transient', consecutiveFailures: 1 },
      { notify, recipients: async () => ['u1'] }
    );
    expect(notify).not.toHaveBeenCalled();
  });

  it('notifies the configured recipients on an auth failure', async () => {
    const notify = vi.fn();
    await raiseTrackingAlert(
      { ...base, kind: 'auth', consecutiveFailures: 1 },
      { notify, recipients: async () => ['u1', 'u2'] }
    );
    expect(notify).toHaveBeenCalledTimes(1);
    const payload = notify.mock.calls[0][0];
    expect(payload.event_type).toBe('fleet.tracking_pull_failed');
    expect(payload.recipient_user_ids).toEqual(['u1', 'u2']);
    expect(payload.source_module).toBe('fleet');
    expect(payload.title).toContain('netstar');
  });

  it('does not throw when no recipients are configured', async () => {
    const notify = vi.fn();
    await expect(raiseTrackingAlert(
      { ...base, kind: 'auth', consecutiveFailures: 1 },
      { notify, recipients: async () => [] }
    )).resolves.toBeUndefined();
    expect(notify).not.toHaveBeenCalled();
  });

  it('never lets a notification failure break the poll', async () => {
    const notify = vi.fn(async () => { throw new Error('smtp down'); });
    await expect(raiseTrackingAlert(
      { ...base, kind: 'auth', consecutiveFailures: 1 },
      { notify, recipients: async () => ['u1'] }
    )).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 6: Run test to verify it fails**

Run: `npx vitest run src/services/tracking/__tests__/alerts.test.ts`
Expected: FAIL — `raiseTrackingAlert` is not exported

- [ ] **Step 7: Add the dispatcher to `alerts.ts`**

```typescript
import { notify as busNotify } from '@/modules/notifications/services/notificationBus';
import { log } from '@/lib/logger';
import type { ProviderKey } from './types';

export interface RaiseAlertInput extends AlertInput {
  provider: ProviderKey;
  accountRef: string;
  detail: string;
}

export interface RaiseAlertDeps {
  notify: (payload: {
    event_type: string;
    title: string;
    body: string;
    source_module: string;
    source_id?: string;
    recipient_user_ids: string[];
    metadata?: Record<string, unknown>;
  }) => Promise<void>;
  recipients: () => Promise<string[]>;
}

/**
 * Who hears about fleet tracking failures.
 *
 * Configured by id rather than resolved from a role: the fleet manager's
 * staff.position currently reads "Staff", so a role lookup would find nobody —
 * and an alerting system that silently addresses no one is worse than none.
 * An env var keeps it changeable without a deploy touching code.
 */
async function configuredRecipients(): Promise<string[]> {
  return (process.env.FLEET_ALERT_USER_IDS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export async function raiseTrackingAlert(
  input: RaiseAlertInput,
  deps: RaiseAlertDeps = { notify: busNotify, recipients: configuredRecipients }
): Promise<void> {
  const decision = decideAlert(input);
  if (!decision) return;

  const recipients = await deps.recipients();
  if (recipients.length === 0) {
    log.warn('[tracking-alerts] alert raised but no recipients configured', {
      event: decision.event, provider: input.provider,
      hint: 'set FLEET_ALERT_USER_IDS',
    });
    return;
  }

  const title =
    decision.event === 'fleet.tracking_data_gap'
      ? `No tracking data from ${input.provider}`
      : `Tracking pull failed: ${input.provider}`;

  try {
    await deps.notify({
      event_type: decision.event,
      title,
      body: `${input.provider}/${input.accountRef}: ${input.detail}`,
      source_module: 'fleet',
      source_id: `${input.provider}:${input.accountRef}`,
      recipient_user_ids: recipients,
      metadata: {
        provider: input.provider,
        accountRef: input.accountRef,
        consecutiveFailures: input.consecutiveFailures,
        deferWhatsappUntil: decision.deferWhatsappUntil?.toISOString() ?? null,
      },
    });
  } catch (err) {
    // A broken mail server must never take the ingestion run down with it —
    // the positions are the point, the alert is the courtesy.
    log.error('[tracking-alerts] failed to dispatch alert', {
      event: decision.event, provider: input.provider,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
```

- [ ] **Step 8: Run tests to verify they pass**

Run: `npx vitest run src/services/tracking/__tests__/alerts.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 9: Commit**

```bash
git add src/services/tracking/alerts.ts src/services/tracking/__tests__/alerts.test.ts
git commit -m "feat(fleet): alert policy and dispatcher for tracking failures and data gaps"
```

---

### Task 9: The 2-hourly cron endpoint

**Files:**
- Create: `pages/api/cron/poll-portal-tracking.ts`
- Test: `pages/api/cron/__tests__/poll-portal-tracking.test.ts`

**Interfaces:**
- Consumes: `netstarProvider` (Task 5), `reconcileTrackers` (Task 6), `decideAlert` (Task 8),
  `ingestPositions` (existing).
- Produces: `GET|POST /api/cron/poll-portal-tracking`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@/lib/db-pool', () => ({
  sql: vi.fn(async () => []),
  query: vi.fn(async () => []),
  pool: { connect: vi.fn(async () => ({
    query: vi.fn(async () => ({ rows: [{ locked: true }] })),
    release: vi.fn(),
  })) },
}));

import handler from '../poll-portal-tracking';

function mockRes() {
  const res: Record<string, unknown> = {};
  res.status = vi.fn(() => res);
  res.json = vi.fn(() => res);
  return res;
}

describe('poll-portal-tracking', () => {
  beforeEach(() => { process.env.CRON_SECRET = 'secret'; });

  it('rejects a request without the cron secret', async () => {
    const res = mockRes();
    await handler({ method: 'GET', headers: {} } as never, res as never);
    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('rejects when CRON_SECRET is not configured, rather than running open', async () => {
    delete process.env.CRON_SECRET;
    const res = mockRes();
    await handler({ method: 'GET', headers: {} } as never, res as never);
    expect(res.status).not.toHaveBeenCalledWith(200);
  });

  it('rejects methods other than GET and POST', async () => {
    const res = mockRes();
    await handler(
      { method: 'DELETE', headers: { 'x-cron-secret': 'secret' } } as never,
      res as never
    );
    expect(res.status).toHaveBeenCalledWith(405);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run pages/api/cron/__tests__/poll-portal-tracking.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the endpoint**

Model it closely on `pages/api/cron/poll-tracking.ts` — same cron-secret check, same pinned-client
advisory lock, same watermark handling. Differences: a distinct `LOCK_KEY`, discovery before
polling, and no `resolveWindow` (portal windows are bounded by the 31-day report cap instead).

```typescript
/**
 * Polls the partner tracking portals and stores new positions.
 *
 * Runs every 2 hours (crontab on Velocity — Vercel crons do not fire for this
 * systemd-hosted app):
 *
 *   0 *\/2 * * * curl -fsS -H "x-cron-secret: $CRON_SECRET" \
 *     http://localhost:3005/api/cron/poll-portal-tracking \
 *     >> /home/velo/logs/poll-portal-tracking.log 2>&1
 *
 * Separate from poll-tracking.ts, which polls the Cartrack REST API every 2
 * minutes for the vehicles that support it. These are portal scrapes: slower,
 * heavier, and explicitly hours behind, so they get their own cadence and their
 * own advisory lock.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { sql, pool } from '@/lib/db-pool';
import { netstarProvider } from '@/services/tracking/netstar/provider';
import { netstarClient } from '@/services/tracking/netstar/client';
import { reconcileTrackers } from '@/services/tracking/discovery';
import { ingestPositions } from '@/services/tracking/ingest';
import { raiseTrackingAlert } from '@/services/tracking/alerts';
import type { TrackingProvider } from '@/services/tracking/types';

/** Distinct from poll-tracking's 4417301 so the two never block each other. */
const LOCK_KEY = 4417302;
/** No watermark yet: how far back the first tick reaches. */
const COLD_START_MS = 24 * 60 * 60 * 1000;
/** Re-poll this far behind the watermark; dedup absorbs the overlap. */
const OVERLAP_MS = 60 * 60 * 1000;

interface ConfiguredProvider {
  provider: TrackingProvider;
  listVehicles: () => Promise<Array<{ externalId: string; registration: string | null }>>;
}

function configured(): ConfiguredProvider[] {
  const out: ConfiguredProvider[] = [];
  const { NETSTAR_PORTAL_URL, NETSTAR_PORTAL_USER, NETSTAR_PORTAL_PASS } = process.env;
  if (NETSTAR_PORTAL_URL && NETSTAR_PORTAL_USER && NETSTAR_PORTAL_PASS) {
    const opts = {
      baseUrl: NETSTAR_PORTAL_URL,
      username: NETSTAR_PORTAL_USER,
      password: NETSTAR_PORTAL_PASS,
      accountRef: process.env.NETSTAR_ACCOUNT_REF ?? 'europcar',
    };
    const client = netstarClient(opts);
    out.push({
      provider: netstarProvider({ ...opts, client }),
      listVehicles: () => client.listVehicles(),
    });
  }
  return out;
}

function isAuthFailure(message: string): boolean {
  return /login failed|still logged out|HTTP 401\b|HTTP 403\b/i.test(message);
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
  }
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    log.error('[poll-portal-tracking] CRON_SECRET not configured — rejecting');
    return apiResponse.error(res, ErrorCode.SERVICE_UNAVAILABLE, 'Cron endpoint misconfigured');
  }
  if (req.headers['x-cron-secret'] !== expected) {
    return apiResponse.unauthorized(res, 'Invalid cron secret');
  }

  const client = await pool.connect();
  let lockHeld = false;
  try {
    const { rows } = await client.query<{ locked: boolean }>(
      'SELECT pg_try_advisory_lock($1) AS locked', [LOCK_KEY]);
    lockHeld = rows[0]?.locked ?? false;
    if (!lockHeld) {
      log.info('[poll-portal-tracking] previous run still in progress — skipping tick');
      return apiResponse.success(res, { skipped: 'already-running' });
    }

    const results: unknown[] = [];
    for (const { provider, listVehicles } of configured()) {
      try {
        const portalVehicles = await listVehicles();
        const recon = await reconcileTrackers(
          provider.key, provider.accountRef, portalVehicles);

        const wm = await sql<{ last_event_ts: Date | null; consecutive_failures: number }>`
          SELECT last_event_ts, consecutive_failures FROM fleet_tracking_watermarks
          WHERE provider = ${provider.key} AND account_ref = ${provider.accountRef}
        `;
        const now = new Date();
        const last = wm[0]?.last_event_ts ? new Date(wm[0].last_event_ts) : null;
        const from = last
          ? new Date(last.getTime() - OVERLAP_MS)
          : new Date(now.getTime() - COLD_START_MS);

        const positions = await provider.fetchPositions(from, now);
        const { inserted, skippedUnmapped, maxIngestedAt } = await ingestPositions(
          provider.key, provider.accountRef, positions);

        await sql`
          INSERT INTO fleet_tracking_watermarks
            (provider, account_ref, last_event_ts, last_run_at, last_error, consecutive_failures)
          VALUES (${provider.key}, ${provider.accountRef}, ${maxIngestedAt ?? last}, now(), NULL, 0)
          ON CONFLICT (provider, account_ref) DO UPDATE
            SET last_event_ts = COALESCE(EXCLUDED.last_event_ts, fleet_tracking_watermarks.last_event_ts),
                last_run_at = now(), last_error = NULL, consecutive_failures = 0
        `;

        // Authenticating cleanly and returning nothing is the failure mode that
        // otherwise hides for weeks — it looks exactly like a healthy tick.
        if (positions.length === 0 && recon.upserted > 0) {
          log.warn('[poll-portal-tracking] no positions returned for mapped vehicles', {
            provider: provider.key, accountRef: provider.accountRef,
            mappedVehicles: recon.upserted });
          await raiseTrackingAlert({
            kind: 'gap',
            consecutiveFailures: 0,
            nowSast: now,
            provider: provider.key,
            accountRef: provider.accountRef,
            detail: `${recon.upserted} vehicles mapped but the report returned no positions`,
          });
        }

        log.info('[poll-portal-tracking] polled', {
          provider: provider.key, accountRef: provider.accountRef,
          fetched: positions.length, inserted, skippedUnmapped,
          mapped: recon.upserted, deactivated: recon.deactivated,
          fleetOnly: recon.fleetOnly.length, portalOnly: recon.portalOnly.length });

        results.push({
          provider: provider.key, accountRef: provider.accountRef,
          inserted, skippedUnmapped,
          coverage: {
            mapped: recon.upserted,
            notOnPortal: recon.fleetOnly.map((f) => f.registration),
            unknownOnPortal: recon.portalOnly.map((p) => p.externalId),
          },
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        const auth = isAuthFailure(message);
        const updated = await sql<{ consecutive_failures: number }>`
          INSERT INTO fleet_tracking_watermarks
            (provider, account_ref, last_run_at, last_error, consecutive_failures)
          VALUES (${provider.key}, ${provider.accountRef}, now(), ${message}, 1)
          ON CONFLICT (provider, account_ref) DO UPDATE
            SET last_run_at = now(), last_error = ${message},
                consecutive_failures = fleet_tracking_watermarks.consecutive_failures + 1
          RETURNING consecutive_failures
        `;
        log.error('[poll-portal-tracking] provider failed', {
          provider: provider.key, accountRef: provider.accountRef,
          error: message, authFailure: auth });
        await raiseTrackingAlert({
          kind: auth ? 'auth' : 'transient',
          consecutiveFailures: updated[0]?.consecutive_failures ?? 1,
          nowSast: new Date(),
          provider: provider.key,
          accountRef: provider.accountRef,
          detail: message,
        });
        results.push({
          provider: provider.key, accountRef: provider.accountRef,
          error: message, authFailure: auth });
      }
    }
    return apiResponse.success(res, { results });
  } finally {
    let unlockFailed = false;
    if (lockHeld) {
      try {
        await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]);
      } catch (err) {
        unlockFailed = true;
        log.error('[poll-portal-tracking] advisory unlock failed', {
          error: err instanceof Error ? err.message : String(err) });
      }
    }
    client.release(unlockFailed);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run pages/api/cron/__tests__/poll-portal-tracking.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: Commit**

```bash
git add pages/api/cron/poll-portal-tracking.ts pages/api/cron/__tests__/
git commit -m "feat(fleet): 2-hourly portal tracking poll endpoint"
```

---

### Task 10: Backfill script

**Files:**
- Create: `scripts/backfill-tracking.ts`

**Interfaces:**
- Consumes: `netstarProvider` (Task 5), `ingestPositions` (existing), `chunkWindow` (Task 5).
- Produces: a CLI, not imported by application code.

- [ ] **Step 1: Write the script**

```typescript
/**
 * One-off historical backfill for a portal tracking provider.
 *
 *   npx tsx scripts/backfill-tracking.ts --provider=netstar --floor=2024-08-01
 *
 * Walks BACKWARDS from now in provider-max chunks. Portals cap how much history
 * a single report may cover (Netstar: 31 days) and none of them documents how
 * far back the data actually goes — so retention is discovered by walking until
 * two consecutive chunks come back empty, rather than assumed.
 *
 * Safe to interrupt and re-run: every write goes through ingestPositions, which
 * is idempotent on (provider, account_ref, provider_event_id). It may also run
 * while the 2-hourly poll is active, for the same reason.
 *
 * Sequential and paced on purpose. These are partner-owned accounts and a
 * backfill that looks like an attack gets an account suspended.
 */
import { netstarClient, netstarProvider, MAX_REPORT_MS } from '@/services/tracking/netstar';
import { ingestPositions } from '@/services/tracking/ingest';
import { log } from '@/lib/logger';

const PAUSE_MS = 5_000;
const DRY_CHUNKS_BEFORE_STOP = 2;

function arg(name: string, fallback?: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  const value = hit?.split('=')[1] ?? fallback;
  if (!value) throw new Error(`--${name}= is required`);
  return value;
}

async function main(): Promise<void> {
  const providerKey = arg('provider');
  if (providerKey !== 'netstar') {
    throw new Error(`unsupported provider "${providerKey}" — phase 1 covers netstar only`);
  }
  const floor = new Date(arg('floor', '2024-08-01'));
  const { NETSTAR_PORTAL_URL, NETSTAR_PORTAL_USER, NETSTAR_PORTAL_PASS } = process.env;
  if (!NETSTAR_PORTAL_URL || !NETSTAR_PORTAL_USER || !NETSTAR_PORTAL_PASS) {
    throw new Error('NETSTAR_PORTAL_URL, NETSTAR_PORTAL_USER and NETSTAR_PORTAL_PASS must be set');
  }
  const accountRef = process.env.NETSTAR_ACCOUNT_REF ?? 'europcar';
  const opts = {
    baseUrl: NETSTAR_PORTAL_URL,
    username: NETSTAR_PORTAL_USER,
    password: NETSTAR_PORTAL_PASS,
    accountRef,
  };
  const provider = netstarProvider({ ...opts, client: netstarClient(opts) });

  let to = new Date();
  let dryChunks = 0;
  let totalInserted = 0;

  while (to > floor && dryChunks < DRY_CHUNKS_BEFORE_STOP) {
    const from = new Date(Math.max(to.getTime() - MAX_REPORT_MS, floor.getTime()));
    const positions = await provider.fetchPositions(from, to);
    const { inserted, skippedUnmapped } = await ingestPositions(
      'netstar', accountRef, positions);
    totalInserted += inserted;

    log.info('[backfill-tracking] chunk complete', {
      provider: providerKey, accountRef,
      from: from.toISOString(), to: to.toISOString(),
      fetched: positions.length, inserted, skippedUnmapped, totalInserted });

    dryChunks = positions.length === 0 ? dryChunks + 1 : 0;
    to = from;
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }

  if (dryChunks >= DRY_CHUNKS_BEFORE_STOP) {
    log.info('[backfill-tracking] stopped at retention edge', {
      provider: providerKey, accountRef,
      reachedBack: to.toISOString(), totalInserted });
  } else {
    log.info('[backfill-tracking] reached configured floor', {
      provider: providerKey, floor: floor.toISOString(), totalInserted });
  }
}

main().catch((err) => {
  log.error('[backfill-tracking] failed', {
    error: err instanceof Error ? err.message : String(err) });
  process.exitCode = 1;
});
```

- [ ] **Step 2: Add the barrel export the script imports**

Create `src/services/tracking/netstar/index.ts`:

```typescript
export { netstarClient, chunkWindow, MAX_REPORT_MS } from './client';
export { netstarProvider } from './provider';
export { parseAllActivityCsv, parseNetstarTs } from './parse';
```

- [ ] **Step 3: Verify it type-checks**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: no errors in the files added by this plan.

- [ ] **Step 4: Dry-run against a single day**

```bash
npx tsx scripts/backfill-tracking.ts --provider=netstar --floor=$(date -d '1 day ago' +%F)
```
Expected: one chunk, non-zero `fetched`, `inserted` matching or lower on a re-run (dedup).

- [ ] **Step 5: Run it twice and confirm the second run inserts nothing new**

This is the real proof that idempotency works. If the second run inserts rows, stop — the
dedup key is wrong and a backfill would duplicate history.

- [ ] **Step 6: Commit**

```bash
git add scripts/backfill-tracking.ts src/services/tracking/netstar/index.ts
git commit -m "feat(fleet): resumable historical backfill for portal tracking"
```

---

### Task 11: Documentation and cron registration

**Files:**
- Modify: `.claude/modules/fleet.md`
- Create: `src/services/tracking/.claude.md`
- Modify: `.env.local.example`

**Interfaces:**
- Consumes: everything above.
- Produces: no code.

- [ ] **Step 1: Add the env var names to `.env.local.example`**

Names only, never values.

```bash
# Netstar VigilCloud portal (fleet position ingestion)
NETSTAR_PORTAL_URL=
NETSTAR_PORTAL_USER=
NETSTAR_PORTAL_PASS=
NETSTAR_ACCOUNT_REF=europcar

# Who receives fleet tracking failure alerts (comma-separated user ids).
# Seeded with the fleet manager; configurable so alerts survive a role change.
FLEET_ALERT_USER_IDS=
```

- [ ] **Step 1b: Resolve the fleet manager's user id**

`notify()` addresses `user_notifications.user_id`, not `staff.id`. Resolve it once:

```bash
ssh velocity "sudo docker exec -u postgres supabase-db psql -d fibreflow -c \
  \"SELECT id, email FROM users WHERE email = 'lizelle@velocityfibre.co.za';\""
```

Put the returned id in `FLEET_ALERT_USER_IDS` in the Velocity env file. If the query returns no
row, she has a `staff` record but no login — raise it with Hein rather than guessing a mapping.

- [ ] **Step 2: Create the path-scoped quick reference**

`src/services/tracking/.claude.md`, target ≤50 lines:

```markdown
# Vehicle tracking services

Two ingestion paths, both landing in `fleet_vehicle_positions` via `ingest.ts`:

| Path | Cadence | Endpoint | Providers |
|---|---|---|---|
| REST API | 2 min | `/api/cron/poll-tracking` | Cartrack (Velocity account) |
| Portal scrape | 2 hours | `/api/cron/poll-portal-tracking` | Netstar |

## Gotchas

- **`ingest.ts` is provider-blind.** Never add provider-specific logic to it.
- **Positions for unmapped trackers are silently dropped** (`skippedUnmapped`). A vehicle with
  no `fleet_vehicle_trackers` row can never receive data — run discovery first.
- **Netstar caps reports at 31 days.** `chunkWindow()` in `netstar/client.ts` enforces it.
- **Netstar enforces a single session.** A human logging into the portal logs this job out;
  `PortalSession` re-authenticates once, then gives up rather than looping.
- **Netstar's account is a multi-client reseller tree.** Only request mapped vehicles.
- Full reference: `.claude/modules/fleet.md`, spec in `docs/superpowers/specs/2026-08-05-portal-tracker-ingestion-design.md`.
```

- [ ] **Step 3: Add a Tracking section to `.claude/modules/fleet.md`**

Document the two ingestion paths, the tables (`fleet_vehicle_trackers`,
`fleet_vehicle_positions`, `fleet_tracking_watermarks`), the discovery step, and the backfill
script. The existing module doc predates live tracking entirely and does not mention any of
these tables.

- [ ] **Step 4: Mirror the agent docs**

Run: `npm run agents:mirror && npm run agents:check`
Expected: pass. Never hand-edit an `AGENTS.md` mirror.

- [ ] **Step 5: Document the cron entry for Hein — do NOT register it**

Registering the cron is Hein's action, not a subagent's. Put the exact command in the PR
description so it is a copy-paste, and state plainly that the feature does nothing until it runs:

```
0 */2 * * * curl -fsS -H "x-cron-secret: $CRON_SECRET" \
  http://localhost:3005/api/cron/poll-portal-tracking \
  >> /home/velo/logs/poll-portal-tracking.log 2>&1
```

Verify afterwards with `crontab -l | grep poll-portal`. This step exists because the fleet
reminder cron once shipped complete, correct, reviewed — and never ran, because nobody
registered it.

Also list in the PR description the env vars that must be set before the first tick:
`NETSTAR_PORTAL_URL`, `NETSTAR_PORTAL_USER`, `NETSTAR_PORTAL_PASS`, `NETSTAR_ACCOUNT_REF`,
`FLEET_ALERT_USER_IDS`. Names only — never values.

- [ ] **Step 6: Run the full local CI gate**

Run: `npm run ci:quick`
Expected: PASS. Fix anything it flags; never `--no-verify`.

- [ ] **Step 7: Commit and open the PR**

```bash
git add .claude/modules/fleet.md src/services/tracking/.claude.md .env.local.example AGENTS.md
git commit -m "docs(fleet): document portal tracking ingestion and register the cron"
gh pr create --title "feat(fleet): Netstar portal tracking ingestion" --body "..."
```

Stop at "PR opened". Do not merge; do not deploy.

---

## Verification — what "done" means

1. `npm run ci:quick` passes.
2. `/api/cron/poll-portal-tracking` returns 200 with a non-zero `inserted` on a real tick.
3. The response's `coverage.notOnPortal` lists exactly the vehicles genuinely absent from
   Netstar — this is the standing answer to "have we got all of them?".
4. `/fleet/map` shows more than 7 vehicles.
5. Running the backfill twice inserts nothing the second time.
6. `SELECT provider, count(*) FROM fleet_vehicle_positions GROUP BY provider` shows a
   `netstar` row.

## Out of scope for this plan

- **Cartrack portal adapter** — login mode (Admin vs Sub-user tab) unconfirmed; writing tasks
  now would mean inventing the contract.
- **Ituran adapter** — needs a browser transport to satisfy Reblaze, and its export endpoint
  was never captured.
- **`KR27FNGP`** — no tracker fitted; excluded by agreement.

Both remaining adapters implement the same `TrackingProvider` interface against the same
`PortalSession` and discovery code, so each is a follow-up plan of roughly Tasks 2, 5 and a
config line.
