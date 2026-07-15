# Fleet Live Tracking — Design

**Date:** 2026-07-15
**Status:** Design — approved scope, not yet built
**Branch:** `feat/fleet-live-tracking`
**Scope:** The 7 Velocity-owned Cartrack vehicles. Other providers deliberately deferred.

---

## 1. Problem

Velocity cannot manage how technicians drive company vehicles. Crashes, drunk driving, and
vehicles left where they should not be. The fleet module was built to address this and was never
connected to any data.

**What we are solving:** make every Cartrack-tracked vehicle continuously visible in the fleet
module, detect when a vehicle is somewhere or doing something it should not be, and alert someone
who can act.

**What makes this tractable:** the tracking already works. The Velocity-owned Cartrack account
returns live positions today — verified 2026-07-15, 653 events in a 6-hour window, 100% with a GPS
fix, all inside Gauteng. Nothing here requires new hardware, a new subscription, or anyone's
permission. (Account references and credentials: `.claude/credentials.local.md`, gitignored.)

## 2. Goals

1. All 7 Cartrack vehicles on a live map, refreshing without user action.
2. Geofence zones can be created, edited and deleted through the UI.
3. Alerts fire — via existing WhatsApp — when a vehicle stops outside an authorised area, moves
   after hours, or is not parked where it should be overnight.
4. Trips are detected automatically from ignition, not uploaded by hand.
5. Speeding and harsh-driving events are captured (both are already in the feed, unread).
6. The existing, fully-built `patternDetector` is fed real data for the first time.
7. The architecture accepts Urent / Netstar / Ituran later **without redesign**.

## 3. Non-goals

Explicitly out of scope. Each is a separate piece of work.

| Not doing | Why |
|---|---|
| Netstar / Ituran adapters | No credentials. Blocked on commercial asks. |
| Driver identity at check-in | Real problem ([[project_fleet_module_dead_wires]]) but a separate project. |
| Incident / accident register | Same. Needed, but not this. |
| Replacing fuel capture | Fuel is **not** in the tracker feed. Stays with the dashboard photo. |
| Detecting intoxication | No software can. Requires a breathalyser interlock. |
| Refactoring the 4,493-line vehicle detail page | Real debt, unrelated to this goal. |

## 4. Evidence this design rests on

Everything below was verified against the live system on 2026-07-15, not inferred.

| Claim | How verified |
|---|---|
| Cartrack API is live | `GET /vehicles` → 200, 8 vehicles; 653 events in 6h |
| Positions are trustworthy | All within SA bounds (lat −26.4..−25.7, lon 27.8..28.4 = Gauteng); 0 null-island; 0 missing fixes; 982/1000 with 3D fix |
| Odometer is accurate | Cross-checked vs check-in VLM readings — 4 of 5 agree within ~1% |
| The feed carries 44 fields | Enumerated from a live response; client maps only 3 |
| `road_speeding` is pre-computed | 12 speeding events in a 90-minute sample |
| **Query timestamps are SAST, not UTC** | Sent UTC → events 2h stale. Sent SAST → events current. Both directions tested. |
| 0/37 vehicles mapped | `SELECT count(cartrack_vehicle_id) FROM fleet_vehicles` = 0 |
| Geofence table empty | `fleet_authorized_locations` = 0 rows |
| Locations UI is dead | `pages/fleet/locations.tsx` — 6 buttons, 0 `onClick` |

## 5. Architecture

```
Cartrack API ──► Adapter ──► Poller ──► fleet_vehicle_positions ──┬──► Live map
(and later:      (normalise)  (every    (one table, one format)   ├──► Geofence eval ──► Alerts
 Netstar,                      2 min)                             ├──► Trip builder ──► patternDetector
 Ituran)                                                          └──► Driver scorecards
```

**The invariant:** everything downstream of `fleet_vehicle_positions` is provider-blind. Adding a
provider means writing one adapter and changing nothing else. This is what makes the deferred
providers cheap later.

---

## 6. Components

### 6.1 Timezone fix — P0, ships first, standalone

**The bug.** `cartrackTsFormat()` in `src/services/tracking/cartrack/client.ts` formats query
windows with `getUTC*`. The comment says *"interpreted as UTC per the docs' examples"*. The live
API interprets them as **SAST**. Every window is therefore 2 hours in the past.

**Why it matters now.** `fetchPositionAt` requests `[at−5min, at+5min]`, actually receives events
from `at−2h`, then filters them out for exceeding the 5-minute tolerance — returning `no_data`.
So **fixing the vehicle mapping alone would not fix the attendance reconcile**: it would trade
100% `vehicle_not_mapped` for 100% `no_data`. Both must ship together.

**Mercy:** it fails safe. It returns nothing rather than placing a vehicle where it was 2h ago.

**Fix.** Format in `Africa/Johannesburg`. South Africa has no DST, so the offset is a constant
+02:00 — no DST-transition edge cases.

**Test that would have caught it:** assert `cartrackTsFormat(new Date('2026-07-15T08:00:00Z'))`
returns `'2026-07-15 10:00:00'`, not `'2026-07-15 08:00:00'`.

**Ships as its own commit** so it can be reasoned about and reverted independently.

### 6.2 Tracker mapping — migration 441

`fleet_vehicles.cartrack_vehicle_id` is a single column hardcoded to one vendor. There is nowhere
to record *"this vehicle is on Netstar, ID 12345"*.

Replace with `fleet_vehicle_trackers`. **This becomes the single source of truth** — attendance's
`cartrackReconcile` must be updated to read it in the same change. We are not creating a second
copy of the same fact; that is precisely the split-brain bug this module already suffers from
between `vehicle_assignments` and `fleet_vehicles.assigned_driver_id`.

`fleet_vehicles.cartrack_vehicle_id` is dropped in the same migration. It holds 0 rows, so there
is no data to migrate and no reason to keep a deprecated shadow column.

### 6.3 Position store — migration 441

One table, `fleet_vehicle_positions`, holding every position from every provider.

**Field selection.** The feed has 44 fields. We store the 14 that carry meaning for our use cases
and drop the rest (`temp1..4`, `analog_*`, `adc*`, `dynamic1..4`, `vext`, `vgsm`, `input_state*`,
`output_state`, `rpm` — all either constant-zero or irrelevant to fleet safety).

**No raw JSONB blob.** Tempting for future-proofing, but at ~190k rows/month across a full fleet
it is hundreds of MB/month for no proven need. Noted risk: Cartrack's events endpoint caps at a
24-hour window, so a field we omit today **cannot be backfilled beyond 24h**. Accepted — the
dropped fields are demonstrably inert.

**Volume.** ~1 event/1–4 min while moving. Roughly 9k rows/vehicle/month → ~63k/month for 7
vehicles, ~190k/month at full fleet, ~2.3M/year. Trivial for Postgres with the right indexes. No
partitioning initially; revisit past ~5M rows.

**Idempotency.** `UNIQUE (provider, provider_event_id)`. Polling windows overlap by design, so
re-ingesting the same event must be a no-op, not a duplicate.

### 6.4 Provider interface

```ts
interface TrackingProvider {
  readonly key: 'cartrack' | 'netstar' | 'ituran';
  listVehicles(): Promise<ProviderVehicle[]>;          // for the mapping UI
  fetchPositions(from: Date, to: Date): Promise<ProviderPosition[]>;
}
```

`ProviderPosition` is the normalised shape — the only thing the poller understands.

**We do not disturb the existing `CartrackClient`.** Attendance depends on `fetchPositionAt` and
that path is live. We add `fetchPositions` alongside it and have the new `TrackingProvider`
implementation wrap the same HTTP client. Fields a provider cannot supply are `null`, never
faked — a Netstar adapter with no g-force data returns `null`, and the UI shows "not available"
rather than implying zero.

### 6.5 Polling job

**Shape:** an API route (`/api/cron/poll-tracking`) hit by system cron, matching the existing
convention in `pages/api/cron/fleet-check-reminders.ts` — `x-cron-secret` compared against
`CRON_SECRET`, **fail-closed if unset**. This reuses the running Next.js process rather than
paying node startup every 2 minutes.

Registered in the Velocity crontab (the proven path — Vercel crons do not fire for a
systemd-hosted app):

```
*/2 * * * *  curl -fsS -H "x-cron-secret: $CRON_SECRET" http://localhost:3005/api/cron/poll-tracking
```

**Watermark per provider+account.** Fetch from `last_event_ts − 2 min` (overlap for safety;
dedup handles the rest) to now. On first run, backfill the last 6 hours.

**Overlap guard.** A Postgres advisory lock. A slow run must not be re-entered by the next tick.

**Isolation.** One provider failing must not block the others — each is polled independently and
its failure logged, not thrown.

**Frequency rationale.** Devices report every 1–4 minutes. Polling faster than they transmit gains
nothing. 2 minutes is comfortably under the device interval without wasting calls. Cartrack
returns all vehicles in one call, so cost is one request per tick regardless of fleet size.

### 6.6 Trip builder

Segment positions on `ignition` transitions: `false→true` starts a trip, `true→false` ends it.

**Distance from odometer delta, not summed GPS points.** The odometer is authoritative and
verified accurate; summing haversine over noisy points over-counts.

**Schema change to `fleet_gps_trips`:**
- Add `vehicle_id UUID REFERENCES fleet_vehicles(id)`
- Make `job_id` nullable (live trips have no upload job)

This is not incidental. `driverScoreService.calculateAuthorizationScore` **already queries
`fleet_gps_trips.vehicle_id`** — a column that does not exist. The query throws, is swallowed by a
catch, and returns null forever. It was written against the schema someone *intended*. Adding the
column fixes that bug and serves live trips with one change.

**Casing.** The writer and schema comment use `'AUTHORIZED'`/`'UNAUTHORIZED'`; the scorecard query
filters lowercase. Standardise on **uppercase** (matches schema + existing writer) and fix the
scorecard query. Its `'home_commute'`/`'suspicious'` values do not exist anywhere and are removed.

### 6.7 Geofence CRUD

Wire the four dead buttons in `pages/fleet/locations.tsx`. The backend (`pages/api/fleet/locations.ts`)
already implements full validated CRUD and is reachable by nothing.

Form: name, latitude, longitude, radius (km), type, global-vs-vehicle. A map picker would be nicer
but is deferred — the goal is to make zones *possible*, not elegant.

**Free side effect:** attendance's `matchGeofence()` reads the same table. It currently matches
against zero rows, which is why 0 of 1,607 attendance entries have a location. Creating zones
repairs attendance at no extra cost.

### 6.8 Geofence evaluation and alerting

**The naive rule is wrong.** "Alert when outside an authorised zone" fires constantly — vehicles
legitimately drive between sites, and the road in between is in no zone.

**The rule we use: stopped, outside every authorised zone, for more than 15 minutes.**
Transit is ignored; *stopping* somewhere it shouldn't be is the signal. This is also exactly what
distinguishes driving past a tavern from parking at one.

Alert types (each via `notify()`, routed in-app + WhatsApp):

| Alert | Condition | Cadence |
|---|---|---|
| Unauthorised stop | Stationary >15 min outside all active zones | Once per stop |
| After-hours movement | Ignition on outside working hours | Once per trip |
| Overnight parking violation | At 21:00, not within its permitted overnight zone | Once nightly |
| Speeding | `road_speeding = true` | **Daily digest, not instant** |
| Harsh driving | `abs(linear_g) > 0.35` or `lateral_g > 0.4` | **Daily digest** |

**Why digests for speeding/harsh:** 12 speeding events in 90 minutes across 6 vehicles. Instant
alerts would be ignored within a day, and an ignored alert is worse than none. Thresholds go in
config, not code — they will need tuning against real data.

**Dedup/debounce is mandatory.** An alert that fires every poll cycle for the same condition
trains people to mute the group.

### 6.9 POI enrichment — the tavern detector

`fleet_trip_poi` already exists with `category` documented as *"bar, restaurant, casino, nightclub"*,
plus `is_suspicious` and `risk_level` (LOW/MEDIUM/HIGH/CRITICAL). `patternDetector` already consumes
POIs and counts `suspicious_poi_visits`. **The enrichment service was never written**, so `pois: []`
is passed every time.

When a vehicle stops outside an authorised zone, reverse-geocode the stop and classify what is
there. `pages/api/geocode.ts` already exists.

**Rate limits matter.** Public Nominatim permits ~1 req/sec and prohibits systematic bulk querying.
We enrich **stops only** (a few dozen a day), never positions. If volume grows, self-host or move to
a paid geocoder. Flagged as a real constraint, not an afterthought.

**Honest framing:** this detects *a vehicle stopped near a licensed venue*. It does not detect
drinking, and a stop near a bar may be a stop at the shop next door. It is a **flag for a human to
look at**, never an accusation. This must be reflected in the UI wording.

### 6.10 Live map

New page `/fleet/map`. `react-leaflet` and `leaflet` are already dependencies, and
`src/modules/fno-atlas/components/FnoInteractiveMap.tsx` is a working in-repo precedent to follow.

- Loaded via `dynamic(..., { ssr: false })` — Leaflet touches `window` and breaks SSR.
- Browser polls `/api/fleet/positions/live` every 30s.
- Marker per vehicle: plate, driver, last-seen age, speed, ignition state, **provider badge**.
- **Untracked and awaiting-access vehicles are listed explicitly as such** — never silently omitted.
  A map showing 7 of 22 vehicles with no explanation is a lie by omission.
- Stale positions (>15 min) are visually distinct. A stale marker must not look live.

### 6.11 Partner provenance

`fleet_vehicles.owner_name` currently records both Avis vehicles and 6 Europcar vehicles as `HSP`,
and files 2 Urent vehicles as company-owned. Correct it from the partner list (now in
`.claude/credentials.local.md`), and badge each vehicle by platform + rental partner — the
distinction originally asked for.

---

## 7. Data model

Migration `441_fleet_live_tracking.sql` (canonical dir: `scripts/migrations/sql/` — the runner
ignores anything else, see [[project_migrations_must_live_in_sql_dir]]), with matching
`rollback_441_...`.

```sql
CREATE TABLE fleet_vehicle_trackers (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id    UUID NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
  provider      VARCHAR(20) NOT NULL CHECK (provider IN ('cartrack','netstar','ituran')),
  account_ref   VARCHAR(50) NOT NULL,            -- which tenant, e.g. the Velocity account
  external_id   VARCHAR(64) NOT NULL CHECK (btrim(external_id) <> ''),
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- One tracker identity may map to exactly one vehicle.
CREATE UNIQUE INDEX ON fleet_vehicle_trackers (provider, account_ref, external_id);
-- A vehicle has at most one ACTIVE tracker (history preserved via is_active=false).
CREATE UNIQUE INDEX ON fleet_vehicle_trackers (vehicle_id) WHERE is_active;

CREATE TABLE fleet_vehicle_positions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id        UUID NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE,
  tracker_id        UUID REFERENCES fleet_vehicle_trackers(id) ON DELETE SET NULL,
  provider          VARCHAR(20) NOT NULL,
  provider_event_id VARCHAR(64),
  recorded_at       TIMESTAMPTZ NOT NULL,        -- event_ts from the device
  received_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  lat               NUMERIC(10,7) NOT NULL,
  lon               NUMERIC(10,7) NOT NULL,
  speed_kph         NUMERIC(6,2),
  road_speed_kph    NUMERIC(6,2),                -- legal limit of the road
  is_speeding       BOOLEAN,
  ignition          BOOLEAN,
  odometer_km       NUMERIC(12,2),               -- metres/1000 at ingest
  linear_g          NUMERIC(5,3),                -- braking / acceleration
  lateral_g         NUMERIC(5,3),                -- cornering
  bearing           NUMERIC(5,2),
  altitude_m        NUMERIC(7,2),
  gps_fix_type      SMALLINT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX ON fleet_vehicle_positions (provider, provider_event_id)
  WHERE provider_event_id IS NOT NULL;
CREATE INDEX ON fleet_vehicle_positions (vehicle_id, recorded_at DESC);
CREATE INDEX ON fleet_vehicle_positions (recorded_at);
CREATE INDEX ON fleet_vehicle_positions (vehicle_id, recorded_at DESC) WHERE is_speeding;

CREATE TABLE fleet_tracking_watermarks (
  provider        VARCHAR(20) NOT NULL,
  account_ref     VARCHAR(50) NOT NULL,
  last_event_ts   TIMESTAMPTZ,
  last_run_at     TIMESTAMPTZ,
  last_error      TEXT,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (provider, account_ref)
);

ALTER TABLE fleet_gps_trips ADD COLUMN vehicle_id UUID REFERENCES fleet_vehicles(id);
ALTER TABLE fleet_gps_trips ALTER COLUMN job_id DROP NOT NULL;
ALTER TABLE fleet_vehicles DROP COLUMN cartrack_vehicle_id;  -- 0 rows; superseded
```

**Last-known position** is a `DISTINCT ON (vehicle_id) … ORDER BY vehicle_id, recorded_at DESC`
query against the `(vehicle_id, recorded_at DESC)` index — not a separate cache table. At 22
vehicles that is instant, and a second table is a second thing to get out of sync.

**Conventions:** `pg.Pool` via `@/lib/db` (never the Neon shim — conditional SQL through it is
broken, see CLAUDE.md); `apiResponse` helpers; files <300 lines; `log` from `@/lib/logger`.

## 8. Failure handling

| Failure | Behaviour |
|---|---|
| Cartrack down / 5xx | Log, increment `consecutive_failures`, leave watermark untouched. Next tick retries from the same point. No data loss. |
| Cartrack 401 | Distinct from 5xx — credentials/entitlement problem. Alert ops; retrying will not help. |
| Poll overruns 2 min | Advisory lock makes the next tick a no-op. |
| Duplicate events | Unique index; insert is a no-op. Overlapping windows are by design. |
| Event with no GPS fix | Stored with the fix type recorded; excluded from map and geofence eval. **Not** silently dropped — a device losing fix is itself a signal. |
| Provider returns unmapped vehicle | Ignored with a counter. Expected steady state (e.g. the plateless unit 544524626). |
| Clock skew / future timestamps | Reject `recorded_at` more than 5 min in the future. |
| Positions stop arriving | If a mapped vehicle reports nothing for >6h during working hours, alert — a dead tracker is invisible otherwise, and silence must never read as "parked". |

## 9. Testing

Per DGTS — no tautological tests, no mocks pretending to be implementations.

- **Pure functions, unit-tested:** `cartrackTsFormat` (the SAST regression test above), trip
  segmentation from an ignition sequence, geofence containment, the stopped-outside-zone rule,
  alert debounce.
- **Adapter:** fetch injected (the existing client already does this) — normalisation tested
  against a **real recorded Cartrack payload** fixture, not a hand-invented one.
- **Ingest:** idempotency — same batch twice yields one row set.
- **Integration:** against the live Cartrack account, in the nightly suite, asserting shape not
  content (content moves).
- **Verification before "done":** drive the real flow — poll a real window, see 7 real vehicles on
  the real map. `npm run ci:quick` before every PR. Per CLAUDE.md rule 4, code review is not
  verification.

## 10. Phasing

Each phase is independently shippable and independently useful.

| Phase | Delivers | Depends on |
|---|---|---|
| **0** | Timezone fix + regression test | Nothing |
| **1** | Migration 441; map the 7 vehicles; attendance reconcile reads the new table | 0 |
| **2** | Provider interface + Cartrack adapter + poller + position store filling | 1 |
| **3** | Live map at `/fleet/map`, provider badges, honest coverage | 2 |
| **4** | Geofence CRUD (buttons wired) + seed real zones | Business supplying zone locations |
| **5** | Geofence eval + alerts (unauthorised stop, after-hours, overnight parking) | 3, 4 |
| **6** | Trip builder + `fleet_gps_trips.vehicle_id` + scorecard query fix + pattern detector fed | 2 |
| **7** | Speeding + harsh-driving digests | 2 |
| **8** | POI enrichment — the tavern detector | 6 |

Phases 0–3 need **nothing from anyone**. Phase 4 needs the business to say where vehicles are
allowed to be. Phase 5 needs to know who gets alerted and what happens next.

## 11. Open questions

1. **Retention.** How long do we keep raw positions? Proposal: 12 months raw, then downsample to
   trips. An accident enquiry six months later argues for keeping more. Cheap either way.
2. **Working hours.** What counts as after-hours? Proposal: outside 06:00–18:00 Mon–Sat, and all
   day Sunday. Must be configurable.
3. **Overnight parking.** Where is each vehicle *supposed* to sleep — a depot, or the driver's
   home? This needs a per-vehicle answer and there is nowhere to store it yet. **Likely a schema
   addition in Phase 5.**
4. **Who gets alerted?** Which WhatsApp group, and what is the consequence of a breach? An alert
   nobody acts on changes nothing.
5. **The plateless tracker** `544524626` — what vehicle is it on? Ask Cartrack.
6. **Harsh-driving thresholds.** 0.35g / 0.4g are starting points from general telematics practice,
   not tuned to these vehicles. Expect to calibrate against real data before alerting on them.

## 12. Risks

| Risk | Mitigation |
|---|---|
| Alert fatigue kills the whole thing | Digests over instant alerts; debounce; tune thresholds before enabling |
| Dropping `cartrack_vehicle_id` breaks attendance | Same migration updates `cartrackReconcile`; 0 rows to lose; rollback provided |
| Geofences never get created | Phase 4 is blocked on the business; chase zone locations early |
| POI enrichment reads as an accusation | UI wording: a flag for review, never a verdict |
| Nominatim rate limits / usage policy | Enrich stops only; self-host if volume grows |
| Position table growth | ~2.3M rows/year at full fleet — fine; revisit partitioning past ~5M |
