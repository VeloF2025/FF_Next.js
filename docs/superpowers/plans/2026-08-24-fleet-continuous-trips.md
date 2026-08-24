# Fleet continuous trips — implementation plan

**Goal:** turn the position stream into a durable trip history, so utilisation, cost-per-km,
idling and after-hours use become derivable. Records ignition-on and ignition-off times and
locations as first-class fields.

**Status:** scoped, not started. Migration and cron installation each need their own approval.

## Why

317,762 positions have produced zero trips. The only `INSERT INTO fleet_gps_trips` in the
codebase is `pages/api/fleet/investigation/upload.ts`, which parses a **manually uploaded Excel
export** from the provider portal. Nothing reads `fleet_vehicle_positions` to build trips, so
there is no standing trip history and every trip-derived metric is unavailable:
utilisation, km/day, cost per km, idle time, after-hours movement, driver behaviour over time.
`fleet_driver_scores` has one row for the same reason.

## Verified facts this plan rests on

Measured against the live shared DB on 2026-08-23/24, not assumed:

| Fact | Value | Why it matters |
|---|---|---|
| `fleet_vehicle_positions.ignition` | `boolean`, **100%** populated for cartrack (315,536) and netstar (1,679), **94.1%** for ituran (515/547) | Segmentation is on true ignition state, not inferred from movement |
| Ignition transitions in 7 days | cartrack 701 on / 710 off · netstar 220/222 · ituran 45/45 | Both ends of a trip are observable; on/off pairs are balanced |
| Sampling interval | cartrack avg 1.7 min (5–30 s while running) · ituran avg 72 min · netstar avg 48.6 min | Cartrack is dense; ituran is sparse enough to need care |
| Largest gap between positions | **2,559 min (42.6 h)** | Trips WILL be left unterminated; see "Closing a trip" |
| Idling is visible | ignition true, speed 0, position static for minutes | Idle time is derivable without extra data |
| History depth | earliest position **2026-07-16**, 18 distinct vehicles | Backfill is ~5½ weeks — bounded and cheap, do it all |
| Tracker coverage | 23 active vehicles, **18 tracked**, 5 untracked | Trips will cover 18 vehicles; the 5 are a data-collection gap, not a code gap |
| Named-place reference data | `fleet_authorized_locations` **0** · `fleet_vehicle_parking_locations` 5 · `project_aois` 9 | Internal place-naming is thin; see "Locations" |
| Geocoder | Nominatim (OSM) via `pages/api/geocode.ts`, TTL cache + in-flight dedupe, shared with parking | Bulk querying breaches OSM policy and would break parking compliance |
| Next free migration | **526** — 525 was claimed by `525_stock_take_init_only_stocked_items.sql`, merged and applied mid-build on 2026-08-24. Re-verify against ALL remote branches, not just master and the DB. |

## Decisions taken

### A new table, not `fleet_gps_trips`

`fleet_gps_trips` is unsuitable for continuous trips:

- `job_id` is `NOT NULL` with `ON DELETE CASCADE` to `fleet_gps_jobs`. Deleting an investigation
  would silently delete continuous trips — permanent loss of the history everything depends on.
- `gps_points jsonb` inlines every point of the trip. Acceptable for a one-off investigation;
  continuously, for 18 vehicles at 1.7-minute sampling, it duplicates the whole position stream
  into JSONB forever.
- Its read APIs (`[jobId]/trips.ts`) are job-scoped and would not surface continuous trips anyway.

So: **`fleet_vehicle_trips`**, migration 526. The investigation table and flow are untouched.

### Closing a trip

A trip opens on a false→true ignition transition and closes on true→false. The failure that
matters is the trip that never sees its off-event, because a 42-hour phantom trip silently
poisons utilisation, average trip length and cost-per-km while looking plausible.

Rules:

- Close at the **last known position and timestamp** — never at `now()`. A trip must not grow
  because a tracker went quiet.
- Record **how** it ended: `ignition_off` | `timeout` | `open`.
- Staleness timeout starts at **120 minutes** (comfortably above ituran's 72-minute average
  sampling), stored in settings so it can be tuned per provider without a deploy.
- **Only `ignition_off` trips count toward utilisation and cost metrics by default.** `timeout`
  and `open` trips are retained and visible as a data-quality count, never silently averaged in.

A confidently wrong number is worse than a visibly missing one. This is the same failure shape as
the operational aggregates — see `.claude/modules/fleet-analytics-disclosure.md`.

### Locations

Every trip stores, for both ignition-on and ignition-off:

1. exact `lat` / `lon` — always available, free, exact;
2. `nearest_place_id` + `nearest_place_distance_m` against parking locations and project AOIs —
   cheap, internal, no external dependency;
3. `location_text` — the reverse-geocoded street address, **persisted**.

(3) is filled by a **throttled resolver**, not inline at trip creation: it walks trips with a null
`location_text` at ≤1 request/second through the existing cached endpoint. Trip creation never
blocks on geocoding, addresses land within minutes, and we never present Nominatim with a bulk
query pattern — which would take parking compliance down with us.

Populating `fleet_authorized_locations` (currently empty) would materially improve (2), and is the
table the existing `tripClassifier` already uses to judge authorised vs unauthorised use.

### Reuse

`extractTripsFromPoints()` in `src/modules/fleet/services/gpsParser.ts` already segments on
`IGNITION_ON` → `IGNITION_OFF` and is pure over a `GPSPoint[]`. Reuse the segmentation shape; write
an adapter from position rows (with an `ignition` boolean) to the event stream it expects. Do NOT
reuse the Excel parsing path.

`classifyTrips()` / `tripClassifier.ts` can label trips once `fleet_authorized_locations` has data.
Classification is a later task, not a blocker.

## Out of scope

- Changing anything in the investigation upload flow or `fleet_gps_trips`.
- Driver attribution. `fleet_operational_assignments` is empty, so trips cannot yet be tied to a
  driver. Trips are per-vehicle; driver linkage follows once the roster is configured.
- Trip classification (authorised / after-hours violations) — needs `fleet_authorized_locations`.
- A trips UI. This plan lands the data and one read API.
- Harsh-driving / driver scoring. `linear_g` and `lateral_g` exist on positions; scoring is its own
  piece of work once trips exist.

## Task DAG

```
1 migration 526 ─┬─> 2 segmentation (pure) ─> 3 repository ─┬─> 4 incremental job ─> 5 cron endpoint
                 │                                          │
                 └──────────────────────────────────────────┴─> 6 place resolver
                                                                7 backfill script  (after 4)
                                                                8 read API         (after 3)
```

| # | Task | Deliverable | Depends on |
|---|---|---|---|
| 1 | Schema | `526_fleet_vehicle_trips.sql` + rollback | — |
| 2 | Segmentation | `tripSegmenter.ts` — pure: positions → trips, with close reasons and idle seconds | — |
| 3 | Repository | `tripRepository.ts` — idempotent upsert on `(vehicle_id, ignition_on_at)`, watermark read/write | 1 |
| 4 | Incremental job | `tripBuildService.ts` — per vehicle, from watermark, reopens the last open trip | 2, 3 |
| 5 | Cron | `pages/api/cron/fleet-build-trips.ts` + wrapper, `*/15` | 4 |
| 6 | Place resolver | nearest-place + throttled geocode backfill | 1 |
| 7 | Backfill | one-off over 2026-07-16 → now, same code path as the job | 4 |
| 8 | Read API | `pages/api/fleet/trips.ts` — vehicle + date range, honest about close reasons | 3 |

## Table shape (migration 526)

```
fleet_vehicle_trips
  id, vehicle_id (NOT NULL, FK), tracker_id, provider
  ignition_on_at  timestamptz NOT NULL     ignition_off_at  timestamptz
  on_lat, on_lon                           off_lat, off_lon
  on_location_text, off_location_text      (nullable; filled by the resolver)
  on_nearest_place_id, on_nearest_place_distance_m
  off_nearest_place_id, off_nearest_place_distance_m
  duration_seconds, moving_seconds, idle_seconds
  distance_km, max_speed_kph, start_odometer_km, end_odometer_km
  position_count
  close_reason  text NOT NULL  CHECK (close_reason IN ('ignition_off','timeout','open'))
  counts_toward_metrics  boolean NOT NULL   -- generated: close_reason='ignition_off'
  created_at, updated_at
  UNIQUE (vehicle_id, ignition_on_at)       -- the idempotency key
```

Constraints to enforce in the schema, not in code:

- `ignition_off_at IS NULL` **iff** `close_reason = 'open'`
- `ignition_off_at >= ignition_on_at`
- every duration and distance `>= 0`
- `idle_seconds + moving_seconds <= duration_seconds`

Plus `fleet_trip_build_watermarks (vehicle_id PK, last_position_at, last_built_at)` so the job is
incremental rather than re-scanning 318k rows every run.

## Validation gates

- **Segmentation is pure and mutation-tested.** Every rule gets a test whose fixture distinguishes
  correct from broken: a trip with no off-event must not close at `now()`; a 42-hour gap must
  produce `timeout` at the last known position; consecutive ignition-on must close the previous
  trip; a single position must not become a zero-duration trip.
- **Idempotency proved, not assumed.** Running the job twice over the same window produces
  identical rows — asserted by re-running and comparing, not by inspecting the upsert.
- **Reconcile against the source.** For a sample vehicle-day, the sum of trip distances and the
  ignition-on count must match what the raw positions say. This is the check that catches a
  segmenter that silently drops trips.
- **Cross-check one vehicle against the provider portal.** The one external truth available; a
  segmenter that disagrees with Cartrack's own trip list is wrong regardless of green tests.
- `npm run ci:quick`, build, blind `/review` before merge. Migration tested against real Postgres
  and added to the vitest unit exclude list.

## Risks

| Risk | Mitigation |
|---|---|
| Phantom long trips corrupt every metric | `close_reason`, close at last known position, exclude non-`ignition_off` from metrics by default |
| Geocoding gets our IP blocked, breaking parking | Throttled resolver ≤1/s, never inline, reuse existing cache |
| ituran's 6% null ignition produces junk trips | Treat null ignition as "no transition"; never infer a boundary from a null |
| Backfill floods the geocoder | Backfill trips first, resolve addresses on the normal throttle afterwards |
| Migration on the shared prod DB | Additive only — new tables, no ALTER on anything existing. Rollback drops only what it created |
| Only 18 of 23 active vehicles tracked | Out of scope, but report coverage on the read API so gaps are visible rather than implied |

## Assumptions to confirm before task 1

- 120-minute staleness timeout is operationally right. If vehicles legitimately run unbroken for
  longer — night haulage, all-day on-site idling — the threshold needs raising or making
  per-provider. Stored in settings so this is tunable without a deploy.
- Nobody is depending on `fleet_gps_trips` staying the only trips table.
