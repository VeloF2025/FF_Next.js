# Fleet Vehicle-Day Stats + Telematics Incident Detectors — Implementation Plan

**Date:** 2026-08-25 · **Repo:** `/home/hein/Workspace/FF_Next.js` (`origin/master`) · **Module:** `src/modules/fleet/`

---

## 1. What already exists (verified on `origin/master`)

| Thing | Where | Relevance |
|---|---|---|
| Position store | `fleet_vehicle_positions` (mig 441): `recorded_at`, `received_at`, `ignition`, `lat/lon`, `speed_kph`, `road_speed_kph`, `is_speeding`, `odometer_km`, `linear_g`, `lateral_g`, `provider`, `account_ref` | The only raw input. **No SOS/impact/alarm column exists.** |
| Continuous trips | `fleet_vehicle_trips` + `fleet_trip_build_watermarks` (mig 526), `src/modules/fleet/trips/*` | The watermark/batch/replace-window pattern to copy verbatim. Also the ignition-boundary truth. |
| Incident producer | `src/modules/fleet/incidents/incidentProducer.ts` → `produceSourceEventIncident` | Accepts `producerKind: 'source_event'`, dedups on `(incident_type, source_event_id)`, resolves its own rule via `loadEffectiveIncidentRule`, writes an observation with `computeObservationFingerprint`. Already whitelists all six telematics types in `SOURCE_EVENT_TYPES`. **Nothing calls it today.** |
| Incident rules | `fleet_operational_incident_rules` (mig 510) seeds **all six telematics types at `severity='critical'`, `whatsapp_enabled=true`, `immediate_notification=true`, `include_in_morning_summary=false`** | Conflicts with the fixed decision (WA only for `accident_sos` + `theft_after_hours_movement`). Must be re-versioned — see §3.2. |
| Mandatory-WA predicate | `requiresMandatoryIncidentWhatsApp(severity, producerKind)` in `incidents/types.ts` = `severity==='critical' && producerKind==='source_event'` | This is the **only** lever. Any telematics type that must not blast WhatsApp has to be a non-`critical` severity. |
| Versioned rules pattern | `fleet_operational_status_rules` (mig 498) + `operations/ruleQueries.ts` + `operations/web/StatusRulesDialog.tsx` | Model for the new vehicle rule: `version UNIQUE`, gist no-overlap on `tstzrange(effective_from, coalesce(effective_to,'infinity'))`, one-open partial unique index, `createRuleVersion` closes the current row and inserts `version+1` in one transaction. |
| 5-min cron | `pages/api/cron/fleet-operational-monitor.ts` + `incidents/cronLock.ts` (`runWithCronLock`) + `scripts/cron-fleet-operational-monitor.sh` | Auth is `x-cron-secret` (Fleet convention). Reuse. |
| 08:15 summary | `incidents/incidentSummaryPhase.ts` (driven by `actionRunner.ts` / `cron-fleet-incident-actions.sh`) | Roster-derived only; buckets by project; sends per recipient via `sendMorningSummaryNotification`. Needs a vehicle contribution. |
| WA group posting | `sendWhatsAppGroup(groupJid, message)` and `sendWhatsAppGroupDocument` in `src/modules/notifications/services/whatsappDelivery.ts`; group-JID-from-env precedent in `src/lib/group-nonactivation/delivery.ts` (`OPS_REVIEW_WA_GROUP_JID`) | `deliverWhatsApp(userId, payload, …)` routes to a group when `payload.wa_group_jid` is set, else DM via phone lookup. Both legs already exist — this is wiring, not new transport. |
| SAST date helpers | `incidents/analytics/sastDates.ts` (`toWorkDate`, `sastMonthStart`, `endOfWorkDate`), `parking/sastDate.ts` (`sastDateString`) | Reuse. Do **not** write a third. |
| Public holidays | `public_holidays` table (mig 310), seeded 2026–2028 with s1(3) Sunday→Monday rollover | The after-hours calendar already exists. |
| Known sites | `fleet_vehicle_parking_locations` + `project_aois`, resolved by `trips/placeResolver.ts` `findNearestPlace()` (PostGIS, `NEAREST_PLACE_MAX_M = 500`) | Reuse for `prolonged_unauthorized_stop` and for project attribution. **No dangerous-area table exists.** |
| Max migration | `527_fleet_aggregates_published_view.sql` | Next free = **528**. Re-check `git ls-tree -r --name-only origin/master scripts/migrations/sql \| ... \| tail` immediately before committing — the fleet CHANGELOG records this number churning 490→496→499→503→506→507→510→511 while master moved. |
| Vehicle detail page | `pages/fleet/vehicles/[id].tsx` — **4,494 lines** | Do not touch it beyond adding one link. `pages/fleet/vehicles/[id]/check-in-history.tsx` proves the `[id].tsx` + `[id]/` sibling-route shape works here. New page goes at `pages/fleet/vehicles/[id]/stats.tsx`. |

---

## 2. Slice 0 — unknowns to investigate BEFORE writing code

**RESOLVED by PR0 on 2026-08-25.** These no longer gate the work. Full evidence — every query,
distribution and field enumeration — lives in `.claude/modules/fleet.md` §"Vehicle-first spike
findings (PR0, 2026-08-25)". The seeded numbers are in §"Threshold defaults from PR0" at the foot of
this document. Summaries below; do not re-litigate them from the pre-spike text, which was wrong in
several places.

**U1 — Provider SOS / impact / panic fields. → RESOLVED: none exist. `accident_sos` ships as a
documented stub.** Cartrack `GET /vehicles/events` returns **57** fields, not 44; all 43 discarded
ones were enumerated and cleared (`event_description`, `terminal_event_type_id`, `input_state{,2,3}`,
`output_state`, `dynamic1-4`, `driver_id`, `x/y/z_accel` among them). Netstar's *live* path
(`netstar/tree.ts`) carries no status field at all — only `IgnitionOn`; the `Status` column in
`netstar/parse.ts` belongs to the backfill-only CSV path and its 8 observed values are alarm-free.
Ituran's `Statuses[].StatName` set is alarm-free. Neither portal's raw payload is retained anywhere.
The one open lead is Cartrack's undocumented `input_state` bitfield — a vendor question, recorded in
the CHANGELOG as the reopening condition. Do not synthesise SOS from g-force.

**But U1 did find something that changes the schema:** `event_description` carries a 14-value event
vocabulary — including `HARSH_BRAKING`, `HARSH_CORNERING`, `IDLING_START/END` and `MOTION_START/END` —
and `provider.ts` throws it away on every ingest. **528 therefore adds
`fleet_vehicle_positions.provider_event_type TEXT` (nullable, additive) plus the Cartrack mapper**
(§3.1, PR1 scope). `HARSH_ACCELERATION` was **not** observed in 55,009 events over 7 days; the
detector accepts it if it ever appears but nothing may assume it exists.

**U2 — g-force units and availability. → RESOLVED: units are g; the feed is far narrower than
assumed.** `linear_g` is signed (negative = braking, min −0.74); `lateral_g` is already an unsigned
magnitude (min 0.000 over 237,419 rows), so `abs()` on it is a no-op. Two findings bind the design:

1. **Six of the seven `cartrack/velocity` vehicles report constant zero, not null** — one distinct
   value across 22k–60k rows each. `linear_g IS NOT NULL` passes for all seven, so `coverage_gforce`
   **must** be `EXISTS(linear_g <> 0 OR lateral_g <> 0)` per vehicle-day, never per provider.
2. **The one vehicle that does report g reports it wrong** — 19 of its 20 braking events ≥ 0.35 g are
   at ≤ 10 km/h, and every live `HARSH_BRAKING` sample carries `speed=6`. A device artefact, which is
   why 529 gains `harsh_min_speed_kph`.

So the g path is a fallback, not the primary: Cartrack's own firmware already computes harshness and
fires it on the vehicles whose g columns are structurally zero, including `HARSH_CORNERING` at
95–129 km/h with `lin=0, lat=0`.

**U3 — what "idle" looks like per feed. → RESOLVED, and the pre-spike table below was wrong in three
places.** Measured over 30 days:

| account | vehicles | granularity | measured cadence | ignition non-null | odometer | idle computable? |
|---|---|---|---|---|---|---|
| `cartrack/velocity` | 7 | history | **8 s median gap, ~1,169 fixes/day** | 100 % | yes | **yes** |
| `cartrack/urent` | 3 | history | 1,797 s median gap, 15 fixes/day | 100 % | yes | coarsely |
| `netstar/europcar` | 6 | snapshot | 637 s median gap, 10 fixes/day | **100 %** | **none** | coarsely |
| `ituran/avis` | 2 | snapshot | 2,095 s median gap, 11 fixes/day | **94.5 %** | yes | coarsely |

Corrections: `cartrack/velocity` is **event-driven at a median 8-second gap**, not a 2-minute feed —
size every batch constant and fixture for ~1,200 fixes/vehicle/day. Netstar asserts ignition on
**100 %** of fixes (the live `tree.ts` `IgnitionOn` boolean, not the CSV `Status`) and supplies **no
odometer at all**, so its distance must be haversine. Ituran asserts ignition on **94.5 %**. Idle is
therefore computable on all four feeds (`ignition=true AND speed_kph=0` fires on 12–23 % of fixes
everywhere) — just at wildly different resolution, which the `coverage_*` flags carry. Coverage
denominators start at each vehicle's **first position**, never at 30 days: every `netstar`, `ituran`
and two `urent` vehicles have exactly 19 of 30 possible days because those feeds went live
2026-08-06/07.

**U4 — is migration 510 applied? → RESOLVED: yes.** `fleet_operational_incident_rules` holds 14 open
rows, all `version 1`; all six telematics types are `severity='critical'`, `whatsapp_enabled=true`,
`immediate_notification=true`. Risk R5 stands in full: PR3 strictly precedes PR4.

---

## 3. Migrations

Shared dev+prod database. Every migration here is **expand-only** (new tables, new nullable column, new rule versions, new permission rows) — no drops, no type changes, no rewrites of an existing column. Contract steps: none required by this work; if any appear, they ship in a later, separate migration after the code is deployed to both environments.

Each forward file gets a matching `rollback_<n>_<name>.sql`. Rollback filenames must be unique across the whole directory (a `rollback_` collision silently rolls back the wrong thing).

### 3.1 `528_fleet_vehicle_daily_stats.sql`

```
fleet_vehicle_daily_stats
  vehicle_id UUID NOT NULL REFERENCES fleet_vehicles(id) ON DELETE CASCADE
  work_date  DATE NOT NULL                       -- SAST calendar day
  PRIMARY KEY (vehicle_id, work_date)            -- the idempotency key

  ignition_seconds BIGINT NOT NULL DEFAULT 0
  moving_seconds   BIGINT NOT NULL DEFAULT 0
  idle_seconds     BIGINT NOT NULL DEFAULT 0     -- ignition on & speed 0
  unattributed_seconds BIGINT GENERATED ALWAYS AS (
    GREATEST(ignition_seconds - moving_seconds - idle_seconds, 0)) STORED
  distance_km NUMERIC(10,2) NOT NULL DEFAULT 0
  max_speed_kph NUMERIC(6,2)
  speeding_events INTEGER NOT NULL DEFAULT 0
  speeding_seconds BIGINT NOT NULL DEFAULT 0
  harsh_brake_events INTEGER NOT NULL DEFAULT 0
  harsh_accel_events INTEGER NOT NULL DEFAULT 0
  harsh_corner_events INTEGER NOT NULL DEFAULT 0
  first_ignition_at TIMESTAMPTZ
  last_ignition_at  TIMESTAMPTZ
  position_count INTEGER NOT NULL DEFAULT 0
  tracker_silence_seconds BIGINT NOT NULL DEFAULT 0   -- LARGEST gap, not the sum
  provider VARCHAR(20)                                -- dominant provider for the day
  account_ref VARCHAR(50)
  coverage_granularity TEXT NOT NULL                  -- 'history' | 'snapshot' | 'mixed' | 'none'
  coverage_ignition BOOLEAN NOT NULL                  -- feed asserts ignition per fix
  coverage_gforce   BOOLEAN NOT NULL                  -- THIS vehicle-day carried a non-zero g reading
  coverage_complete BOOLEAN NOT NULL                  -- count AND largest-gap both within the feed's budget
  source_watermark TIMESTAMPTZ                        -- newest recorded_at folded into this row
  computed_at TIMESTAMPTZ NOT NULL DEFAULT now()
```

Constraints, all of them stating a fact the code must not be able to violate:
- `ignition_seconds/moving_seconds/idle_seconds/distance_km/speeding_seconds/tracker_silence_seconds >= 0`, `position_count >= 0`, all event counts `>= 0`.
- `CHECK (moving_seconds + idle_seconds <= ignition_seconds)` — catches a fold that double-counts a sample into both buckets. Same reasoning as `fleet_vehicle_trips_parts_within_whole`.
- `CHECK (last_ignition_at IS NULL OR first_ignition_at IS NULL OR last_ignition_at >= first_ignition_at)`.
- `CHECK ((first_ignition_at IS NULL) = (last_ignition_at IS NULL))`.
- `CHECK (coverage_granularity IN ('history','snapshot','mixed','none'))`.
- `CHECK (NOT coverage_gforce OR harsh_brake_events + harsh_accel_events + harsh_corner_events >= 0)` — trivially true; instead assert the useful direction: `CHECK (coverage_gforce OR (harsh_brake_events = 0 AND harsh_accel_events = 0 AND harsh_corner_events = 0))`. A feed that cannot report g **must not** be able to store a harsh-event count.
- Likewise `CHECK (coverage_ignition OR (ignition_seconds = 0 AND idle_seconds = 0))` — a snapshot feed cannot claim ignition or idle time. `distance_km` and `max_speed_kph` remain allowed, because those come from odometer/speed which snapshot feeds do supply.
- `CHECK (position_count = 0 OR source_watermark IS NOT NULL)`.

**`coverage_gforce` is per vehicle-day and observation-derived (PR0/U2):**

```
coverage_gforce = EXISTS (a fix in this vehicle-day with linear_g <> 0 OR lateral_g <> 0)
```

Not `provider = 'cartrack'`, and not a null check. Six of the seven `cartrack/velocity` vehicles report
`linear_g`/`lateral_g` as **constant zero, not null**, so both of those tests pass for a vehicle whose
harsh counts are structurally zero. A test must assert that an all-zero-g vehicle-day yields
`coverage_gforce = false`.

**`coverage_complete` is a count AND a gap** — a count alone marks a legitimately parked snapshot day
incomplete:

```
coverage_complete = position_count >= expected_min_fixes
                 AND tracker_silence_seconds <= max_allowed_gap_seconds
```

Per-feed thresholds are seeded from PR0's measured distributions; the table is in
§"Threshold defaults from PR0" and the evidence in `.claude/modules/fleet.md`.

Indexes: `(work_date DESC)` for the fleet overview; `(vehicle_id, work_date DESC)` is the PK order already.

```
fleet_daily_stats_watermarks
  vehicle_id UUID PRIMARY KEY REFERENCES fleet_vehicles(id) ON DELETE CASCADE
  last_position_at TIMESTAMPTZ
  last_built_at TIMESTAMPTZ NOT NULL DEFAULT now()
  positions_processed BIGINT NOT NULL DEFAULT 0 CHECK (positions_processed >= 0)
```
Separate from `fleet_trip_build_watermarks` — sharing it would couple two jobs whose backfill and failure modes differ.

Grants: `GRANT SELECT, INSERT, UPDATE, DELETE ON <both> TO fibreflow_user;` (mirrors 518/526). **Migration tests run as superuser and hide a missing grant** — assert the grants explicitly in the migration test by `SET ROLE fibreflow_user`.

**Also in 528 — one additive column on the position store (decided by PR0/U1):**

```sql
ALTER TABLE fleet_vehicle_positions ADD COLUMN IF NOT EXISTS provider_event_type TEXT;
```

Nullable, no default, no backfill — additive and safe against the running production code, which never
names its columns exhaustively. It carries Cartrack's `event_description` verbatim
(`HARSH_BRAKING`, `HARSH_CORNERING`, `IDLING_START/END`, `MOTION_START/END`, `IGNITION_ON/OFF`,
`SPEEDING_START/END`, `GPS_LOCK/LOST`, `PERIODIC_EVENT`, `IDLING_CONTINUE`); Netstar and Ituran map
`null` today. Two reasons it lands now rather than churning a later migration number:

1. **Cartrack's firmware already computes harshness**, and it fires on the six vehicles whose
   `linear_g`/`lateral_g` are structurally zero — including `HARSH_CORNERING` at 95–129 km/h with
   `lin=0, lat=0`. Those are real events the g columns **cannot see at all**.
2. `IDLING_START/END` and `MOTION_START/END` are exact boundary events, which makes `idle_seconds`
   and `moving_seconds` measured rather than inferred from sampled speed.

**No index yet.** The only reader is `severeDrivingDetector` (PR4), which already scans a bounded
per-vehicle time window that `fleet_vehicle_positions`'s existing `(vehicle_id, recorded_at)` ordering
serves. Add `(vehicle_id, recorded_at) WHERE provider_event_type IS NOT NULL` **only if** PR4's dry run
shows the detector's scan is the hot path — a partial index on a column with one non-null provider is
otherwise dead weight on every ingest write. State the decision either way in PR4.

Rollback: `DROP TABLE IF EXISTS` both, `ALTER TABLE fleet_vehicle_positions DROP COLUMN IF EXISTS provider_event_type;`, plus the permission rows added below if they land here.

### 3.2 `529_fleet_vehicle_operational_rules.sql`

```
fleet_vehicle_operational_rules            -- modelled 1:1 on fleet_operational_status_rules
  id UUID PK, version INTEGER NOT NULL UNIQUE, timezone TEXT NOT NULL,
  effective_from TIMESTAMPTZ NOT NULL, effective_to TIMESTAMPTZ,
  after_hours_start_time TIME NOT NULL DEFAULT '18:00',
  after_hours_end_time   TIME NOT NULL DEFAULT '06:00',
  weekends_are_after_hours BOOLEAN NOT NULL DEFAULT true,
  public_holidays_are_after_hours BOOLEAN NOT NULL DEFAULT true,
  theft_displacement_meters INTEGER NOT NULL DEFAULT 500,
  theft_min_positions INTEGER NOT NULL DEFAULT 2,          -- "a single blip never fires"
  harsh_linear_g NUMERIC(5,3) NOT NULL DEFAULT 0.350,      -- PR0/U2 measured, not guessed
  harsh_lateral_g NUMERIC(5,3) NOT NULL DEFAULT 0.350,     -- lateral_g is already unsigned; abs() is a no-op
  harsh_min_speed_kph NUMERIC(6,2) NOT NULL DEFAULT 20,    -- without it the detector reports one broken device
  speed_over_limit_kph NUMERIC(6,2) NOT NULL DEFAULT 15,
  unauthorized_stop_minutes INTEGER NOT NULL DEFAULT 45,
  lost_contact_minutes INTEGER NOT NULL DEFAULT 30,        -- a FLOOR; scaled per feed by cadence, see PR4
  idle_alert_minutes INTEGER NOT NULL DEFAULT 20,
  known_site_radius_meters INTEGER NOT NULL DEFAULT 500,
  change_reason TEXT, created_by UUID REFERENCES users(id), created_at TIMESTAMPTZ NOT NULL DEFAULT now()
```
Plus, copied from 498: `version > 0`; `btrim(timezone) <> ''`; `effective_to IS NULL OR effective_to > effective_from`; all thresholds non-negative; `change_reason IS NULL OR btrim(change_reason) <> ''`; `EXCLUDE USING gist (tstzrange(effective_from, COALESCE(effective_to,'infinity'),'[)') WITH &&)`; `CREATE UNIQUE INDEX … ON (( true )) WHERE effective_to IS NULL`. Seed `version 1` with `now()`.

Also in 529:
- `ALTER TABLE fleet_vehicles ADD COLUMN IF NOT EXISTS after_hours_exempt BOOLEAN NOT NULL DEFAULT false;` (additive, defaulted, safe against running prod code).
- **Re-version the four non-critical telematics incident rules IN PLACE, behind a guard.** `severity='high'`, `whatsapp_enabled=false`, `immediate_notification=false`, `include_in_morning_summary=true` for `severe_driving`, `prolonged_unauthorized_stop`, `lost_contact_moving`, `dangerous_area_entry`. Severity is the *only* lever that stops `requiresMandatoryIncidentWhatsApp` blasting WhatsApp for them. `accident_sos` and `theft_after_hours_movement` are untouched (`critical`, WA on).

  **REVISED 2026-08-25 after six review rounds.** The close-and-insert shape this section originally specified does not survive contact with the table. Five successive versions of it were each defeated by a state the previous one had not enumerated: an operator's own version 2; a closed version 2 in the history; a **pending** open row, which cannot be closed at all because `effective_to = now()` is earlier than its own `effective_from` and fails `fleet_operational_incident_rules_range_order`; a row that activates between two statements' clock reads under `psql -f`; and a **closed-but-still-effective** predecessor left behind by `versionIncidentRule`. "Which row is the current rule" has more states than a migration can enumerate — that is a design problem, not five bugs.

  The shipped shape has no state machine:

  ```sql
  DO $$
  BEGIN
    IF EXISTS (SELECT 1 FROM fleet_operational_incidents
                WHERE incident_type = ANY(the four)) THEN
      RAISE EXCEPTION '529: operational incidents already exist ...';
    END IF;

    UPDATE fleet_operational_incident_rules
       SET severity = 'high', whatsapp_enabled = false, immediate_notification = false,
           include_in_morning_summary = true,
           change_reason = <prose, prior marker stripped> || ' | 529:reversioned{wa=..,imm=..,morn=..}'
     WHERE severity = 'critical' AND incident_type = ANY(the four);
  END $$;
  ```

  Every row of those four types — open, pending, closed, historical. No version arithmetic, no close/insert, no clock read, no constraint interaction, identical in every execution mode. Idempotent by the `severity = 'critical'` filter, which also leaves an operator's deliberate non-critical row alone.

  **Why rewriting in place is legitimate here:** versioning exists so an incident can say which rule judged it, and these four rules have never judged anything — nothing calls the telematics detectors until PR4, strictly after this migration. Rows that never governed an incident carry no history worth preserving; editing them corrects a seed that was wrong the day 510 wrote it. The guard **proves** that at apply time rather than asserting it, and it is the **first statement in the file**, above every `CREATE`, so a fired guard leaves nothing behind. It sits inside the same `DO` block as the `UPDATE` because as two statements it would only stop the `UPDATE` under `ON_ERROR_STOP` — which `scripts/run-pending-migrations.sh:127` passes but a hand-run `psql -f` does not.

  The marker carries the row's **prior** flag values, because the filter constrains severity and nothing else: an operator may hold a critical row with WhatsApp deliberately off, and restoring 510's seed shape on rollback would silently re-arm it. Any marker already present is stripped before a new one is appended, so a re-run never accumulates two.
- `access_permissions` + `role_permissions` rows for `fleet.vehicle-stats` (`/fleet/vehicles/[id]/stats`, view for viewer/manager/PM/admin/super_admin) and `fleet.vehicle-rules` (view+create+edit for admin/super_admin only), `ON CONFLICT DO NOTHING` — same shape as 498.

Rollback 529 (**REVISED** with the above): 529 inserts no rows and closes none, so there is nothing to delete and nothing to reopen — only the flags to put back. It restores rows that are **still `high`** and whose `change_reason` **ends with** the marker, parsing the prior `whatsapp_enabled` / `immediate_notification` / `include_in_morning_summary` back out of it with `regexp_match`, then strips the marker (which is what makes a second rollback a no-op). Severity is the one value the filter pins, so it alone comes from a constant. The `WHERE severity = 'high'` is load-bearing: a row an operator has taken back to `critical` is theirs, marker or not. The `$` anchor is load-bearing too — prose that merely *contains* the marker must not be rewritten; prose that *ends* with the exact literal is an accepted, documented residual risk. Then it drops the table, the column and both permission keys, all inside one `BEGIN/COMMIT` because `psql -f` autocommits statement by statement.

---

## 4. Module shape

All new files ≤300 lines; components ≤200. Two new subtrees, both siblings of `trips/` and `incidents/`.

**Two fold rules settled by PR0, both of which the pure fold must encode:**
- **Prefer the provider's boundary events over sampled speed.** Where the day carries
  `IDLING_START`/`IDLING_END` and `MOTION_START`/`MOTION_END` in `provider_event_type`, derive
  `idle_seconds` and `moving_seconds` from those instants. Fall back to the sampled predicate
  (`ignition===true && speed_kph===0` for idle) only for the fixes not covered by a boundary pair, and
  for feeds that carry no events at all. A vehicle-day must record which rule produced its seconds so a
  reader can tell measured from inferred.
- **`netstar/europcar` supplies no odometer.** Its `distance_km` is haversine over consecutive fixes,
  full stop — an odometer-delta path that silently yields 0 for six vehicles is the failure mode here.
  The other three feeds use odometer deltas with haversine as the fallback.

```
src/modules/fleet/dailyStats/
  types.ts                    ~90   VehicleDayStats, CoverageFlags, DayFold, DailyStatsBuildResult
  dayFold.ts                  ~260  PURE. positions[] (+ trips[]) → VehicleDayStats. No DB import.
                                    Prefers IDLING_/MOTION_ boundary events over sampled speed; haversine when odometer absent.
  coverage.ts                 ~110  PURE. provider/account + the day's fixes → granularity, coverage_* flags,
                                    expected_min_fixes / max_allowed_gap_seconds. coverage_gforce is observed, not assumed.
  dailyStatsRepository.ts     ~230  loadPositionsForDays, loadTripsForDays, upsertDayStats, read/writeWatermark
  dailyStatsBuildService.ts   ~260  watermark → batch loop → fold → upsert → advance. Mirrors tripBuildService.
  statsQueries.ts             ~180  read path: last-30-day series per vehicle, fleet overview for a date
  __tests__/                        dayFold, coverage, batchInvariance, sqlLiterals, dailyStatsBuildService

src/modules/fleet/vehicleDetectors/
  types.ts                    ~110  VehicleDetectorContext, DetectedVehicleEvent, DetectorId
  vehicleRuleQueries.ts       ~200  loadEffectiveVehicleRule / listVersions / createVehicleRuleVersion (copy 498 pattern)
  afterHours.ts               ~130  PURE. isAfterHours(instant, rule, holidaySet) — SAST, weekends, holidays
  holidayQueries.ts           ~60   loadHolidays(fromDate, toDate) → Set<'YYYY-MM-DD'>
  theftDetector.ts            ~150  ignition-on + cumulative displacement > rule.theft_displacement_meters
  severeDrivingDetector.ts    ~160  provider_event_type HARSH_* primary; signed-g + speed-gate fallback under coverage_gforce
  unauthorizedStopDetector.ts ~150  ignition on, stationary > N min, findNearestPlace() > radius
  lostContactDetector.ts      ~130  last fix was moving, no fix for > N min
  accidentSosDetector.ts      ~70   STUB until U1 resolves; documents exactly what was checked and when
  sourceEventId.ts            ~70   deterministic id: `${detectorId}:${vehicleId}:${bucketStartIso}`
  vehicleProjectResolver.ts   ~110  last known site/project from findNearestPlace, else null
  vehicleDetectorService.ts   ~280  orchestration: load rule + vehicles + window, run detectors, produceIncident
  __tests__/                        one file per detector + afterHours + sourceEventId + service

src/modules/fleet/incidents/
  vehicleSummaryPhase.ts      ~180  NEW. yesterday's vehicle incidents → group + per-recipient summary
  incidentGroupDelivery.ts    ~140  NEW. post to FLEET_ALERTS_WA_GROUP_JID, fall back to per-user DM

src/modules/fleet/dailyStats/web/
  VehicleStatsTable.tsx       ~180  last-30-day table
  VehicleStatsCards.tsx       ~160  sparkline cards + coverage "days with data / days expected"
  VehicleDayRouteMap.tsx      ~190  one day's trips (+ positions on demand) on the existing FleetMap
  FleetStatsOverview.tsx      ~190  all tracked vehicles, yesterday
  vehicleStatsApi.ts          ~90   typed fetch wrappers
  __tests__/                        one per component

pages/api/cron/fleet-daily-stats.ts        ~70  x-cron-secret + runWithCronLock('fleet-daily-stats')
pages/api/fleet/vehicles/[id]/daily-stats.ts ~120
pages/api/fleet/daily-stats/overview.ts      ~110
pages/api/fleet/vehicles/[id]/day-route.ts   ~120
pages/api/fleet/vehicle-rules/index.ts       ~110  GET list / POST new version
pages/fleet/vehicles/[id]/stats.tsx          ~190
scripts/cron-fleet-daily-stats.sh            ~60   copy of cron-fleet-build-trips.sh
scripts/fleet-daily-stats-backfill.ts        ~120  same code path, run repeatedly
```

**Rule editing UI:** a sibling dialog `operations/web/VehicleRulesDialog.tsx` next to `StatusRulesDialog.tsx`, not an extension of it. The two rules have disjoint fields and disjoint permissions (`fleet.operations-rules` vs `fleet.vehicle-rules`); merging them would put a vehicle threshold behind a staff-rule permission.

---

## 5. Task DAG — PR-sized slices

Each PR is independently mergeable, independently revertable, and ships its own tests. Order is a DAG, not a chain: PR2/PR3 and PR5 can proceed in parallel once PR1 lands.

```
PR0 (spike, no merge) ──> PR1 (mig 528 + fold) ──> PR2 (build service + cron)
                                │                        │
                                │                        ├──> PR6 (read API + stats page)
                                │                        └──> PR7 (fleet overview)
                                └──> PR3 (mig 529 + rule queries + rules dialog)
                                            │
                                            ├──> PR4 (detectors, wired to producer)
                                            │        │
                                            │        └──> PR5 (WA group delivery + fallback)
                                            │                  │
                                            │                  └──> PR8 (08:15 vehicle summary)
                                            └──> PR9 (backfill script + docs + CHANGELOG)
```

---

### PR0 — Provider field spike (no merge)
Answers U1/U2/U3/U4. Deliverable is a section appended to `.claude/modules/fleet.md` in PR1's diff, plus concrete threshold defaults for migration 529. No production code. If U1 finds an SOS field, it adds one file to PR4's scope (`ALTER TABLE fleet_vehicle_positions ADD COLUMN provider_alarm TEXT` in 528 + parser change) — decide before PR1 so the column number does not churn.

---

### PR1 — Migration 528 + the pure day-fold
**Ships:** `528_*.sql` + rollback (both tables **and** `fleet_vehicle_positions.provider_event_type`), the Cartrack mapper line, `dailyStats/types.ts`, `coverage.ts`, `dayFold.ts`, tests. No cron, no DB writes, no UI.

The mapper is two lines, not a refactor: `providerEventType` added to `ProviderPosition`
(`src/services/tracking/types.ts`), `providerEventType: typeof r.event_description === 'string' ? r.event_description : null`
in `cartrack/provider.ts`'s row mapping, `null` in `netstar/parse.ts`, `netstar/tree.ts` and
`ituran/parse.ts`, and the column carried through `ingest.ts`'s insert.

**TDD order:** write `dayFold.test.ts` first, from a fixture built out of **measured** position shapes (PR0/U3): a `cartrack/velocity` day at ~1,200 fixes with a median 8-second gap, a `netstar/europcar` day at ~10 fixes with **no odometer**, an `ituran/avis` day with a 27-hour silence — all three exist in production data. Do **not** build the Cartrack fixture at a 2-minute cadence; that was the pre-spike assumption and is off by ~15×.

**Tests that prove it:**
1. `dayFold.test.ts` — fold correctness: distance from odometer deltas with a fallback to haversine; `idle_seconds` only when `ignition===true && speed_kph===0`; `tracker_silence_seconds` is the **largest** gap, not the sum; `max_speed_kph` null when no fix carries a speed.
2. **`batchInvariance.test.ts` (mandatory, not optional).** Fold the *same* day's positions at batch sizes 1, 2, 3, 7, 100, 5000 and assert every produced `VehicleDayStats` is **byte-identical by row hash** (`sha256` of the canonically-ordered field tuple). This is the exact class of bug that six code reviewers read past on the trips builder and only a run caught (`feedback_reading_code_cannot_find_loop_and_pipeline_bugs`). Also assert idempotence: folding twice over an overlapping window yields the same hash.
3. `coverage.test.ts` — a non-Cartrack account can never yield `coverage_gforce=true`; **a `cartrack/velocity` vehicle-day whose every fix carries `linear_g = 0` and `lateral_g = 0` also yields `coverage_gforce=false`** (this is the six-of-seven case, and a null check passes it); `coverage_ignition=true` is legal for `netstar` and `ituran` because both assert ignition per fix (100 % / 94.5 % of fixes measured); `coverage_complete` is false when the count clears but the largest gap does not, and vice versa.
   `parse.test.ts` additions (Cartrack + Netstar + Ituran) — `event_description` maps to `providerEventType` verbatim on Cartrack, including `HARSH_BRAKING`; an absent or non-string `event_description` maps to `null`, never `String(undefined)`; Netstar and Ituran map `null`.
4. `dayEdges.test.ts` — a position at `2026-08-01T21:59:59Z` belongs to `2026-08-01`, one at `22:00:00Z` to `2026-08-02`. A trip that straddles midnight SAST splits its seconds across two rows and the two rows sum to the trip. `toWorkDate` is used; `toISOString().slice(0,10)` appears nowhere.
5. `tests/migrations/528_fleet_vehicle_daily_stats.test.ts` — real Postgres, disposable schema, apply forward, exercise every CHECK (including `coverage_gforce=false` + harsh count > 0 rejected, and `moving+idle > ignition` rejected), `SET ROLE fibreflow_user` and prove the grants, then apply rollback and assert the tables are gone. Mirrors `tests/migrations/518_*.test.ts`.
6. `migrationContract.test.ts` (no DB) — the `coverage_granularity` CHECK list and the TS union are the same closed set.

**Mutation targets** (change the source, prove a test goes red):
- flip `>` to `>=` in the idle-speed predicate;
- replace `Math.max` with `+=` in the silence-gap accumulator;
- swap `toWorkDate` for `toISOString().slice(0,10)`;
- drop the `coverage_gforce` gate in `coverage.ts`;
- change `coverage_gforce` from `EXISTS(g <> 0)` back to `linear_g IS NOT NULL` (test 3 must catch it);
- drop the `event_description` mapper line (the parser test must catch it);
- change one batch-size constant in the fold loop.
Each must fail at least one named test. Mutate the **new guard**, never the test's own copy of the rule.

**Gates:** `npm run ci:quick`; `npx vitest run src/modules/fleet/dailyStats`; migration test with `TEST_DATABASE_URL`; blind `/review` (single reviewer, one domain).

**Rollback:** `psql -f scripts/migrations/sql/rollback_528_fleet_vehicle_daily_stats.sql`. Nothing reads the tables yet, so the revert is a pure table drop.

---

### PR2 — Incremental build service + 15-min cron
**Ships:** `dailyStatsRepository.ts`, `dailyStatsBuildService.ts`, `pages/api/cron/fleet-daily-stats.ts`, `scripts/cron-fleet-daily-stats.sh`, tests.

**Shape (copy `tripBuildService.ts` exactly):** per-vehicle watermark; `POSITION_BATCH_SIZE` / `MAX_BATCHES_PER_VEHICLE` **sized against the measured ~1,200 fixes/vehicle/day on `cartrack/velocity` (max 3,047), not the pre-spike 2-minute assumption** — a batch under ~1,500 splits a single vehicle-day, which is exactly where the trips builder's straddler bug lived; a lookback floor (`LATE_ARRIVAL_LOOKBACK_MINUTES`, 6 h — trackers buffer and flush late, and `received_at` can trail `recorded_at`); **windows always open at a SAST day boundary**, which is this job's analogue of the trip-boundary anchor — a window that opens mid-day would rewrite a partial day over a complete one; per-vehicle try/catch so one bad tracker cannot freeze the fleet, run reported `partial`; watermark untouched on failure. Each tick recomputes **today and yesterday** unconditionally, then walks any backlog.

`upsertDayStats` is `INSERT … ON CONFLICT (vehicle_id, work_date) DO UPDATE SET <every metric column> = EXCLUDED.…` — a full row replacement, never an accumulate. `ON CONFLICT DO NOTHING` would silently freeze the first partial day computed and is wrong for a mutable row.

**Tests:**
1. `dailyStatsBuildService.test.ts` — resume from watermark; a failing vehicle leaves its watermark unchanged and the run reports `partial`; a run over an already-built window changes no row hash; backlog ceiling sets `moreRemaining`.
2. Batch-size-variation + row-hash test at the **service** level, not just the fold: run the whole build at `POSITION_BATCH_SIZE` 1/50/5000 against the same fixture DB state and compare `md5(row::text)` per `(vehicle_id, work_date)`.
3. `sqlLiterals.test.ts` — copy `trips/__tests__/sqlLiterals.test.ts`: scan the repository file's source for a conditional inside a tagged template. **Conditional tagged-template SQL is broken in this repo**; `loadPositions` in `tripRepository.ts` shows the required shape — two whole explicit query branches.
4. Cron route test: wrong/absent `x-cron-secret` → 401; unset `CRON_SECRET` → 500; lock held → `{skipped:true}`.

**Mutation targets:** delete the "recompute yesterday too" branch; change `ON CONFLICT DO UPDATE` to `DO NOTHING`; remove the day-boundary window alignment; move the watermark write before the upsert; remove the per-vehicle try/catch.

**Gates:** `ci:quick`; full `vitest run src/modules/fleet/dailyStats`; blind `/review`; a manual `curl -H 'x-cron-secret: …' localhost:3004/api/cron/fleet-daily-stats` on local dev, then `SELECT * FROM fleet_vehicle_daily_stats ORDER BY work_date DESC LIMIT 20` compared by hand against one vehicle's provider portal for one day (this is acceptance criterion 1's first half).

**Rollback:** remove the crontab line; the endpoint is inert without it. Revert the PR. Data left in `fleet_vehicle_daily_stats` is harmless because nothing reads it until PR6.

---

### PR3 — Migration 529 + vehicle rule queries + rules dialog
**Ships:** `529_*.sql` + rollback, `vehicleDetectors/vehicleRuleQueries.ts`, `afterHours.ts`, `holidayQueries.ts`, `pages/api/fleet/vehicle-rules/index.ts`, `operations/web/VehicleRulesDialog.tsx`, tests.

**Tests:**
1. `vehicleRuleQueries.test.ts` — a new version closes the current one in the same transaction; `effectiveFrom` in the past is refused; the next version number comes from the open row (v1→v2, v2→v3, v7→v8), not a constant; two concurrent version creations do not both succeed (the one-open partial unique index and the gist exclusion are the enforcement, not the code).
2. `afterHours.test.ts` — 17:59/18:00/05:59/06:00 SAST boundaries; a Saturday 10:00 is after-hours; 2026-04-27 (Freedom Day) from `public_holidays` is after-hours; the window **wraps midnight** (18:00→06:00 is one window spanning two calendar days, not two windows). Fixture holidays come from the real seeded table, not a hand-written list.
3. `tests/migrations/529_*.test.ts` — real Postgres, as a **7-state × 2-mode matrix**. States: the 510 seed; an operator's active version 2 still critical; an operator's active version 2 deliberately not critical; a closed version 2 in the history; a pending open version 2 still critical; a pending open version 2 already lowered; a closed-but-still-effective predecessor with a future successor. Modes: the runner (one query, `psql -1`) and `psql -f` statement by statement.

   Every assertion goes through the predicate `loadEffectiveIncidentRule` actually uses — `effective_from <= now() AND (effective_to IS NULL OR effective_to > now())` — **not** "the open row". Those differ, and the difference is the state that survived five rounds. Per state and mode: all four types end effectively `high`; the two emergency types stay `critical` + WA; exactly 14 open rules with no type at zero or two; a second run is a no-op; the rollback puts everything back `critical`.

   Plus: guard tests in both modes (an incident of a telematics type ⇒ `P0001` and **nothing** applied — no rules, no table, no column, no permission rows; an unrelated type passes through); marker tests (prior flags recorded with `wa ≠ imm`, restored exactly rather than as the seed shape, `NULL` prose round-trips to `NULL`, prose containing the marker mid-string untouched, no double marker after a manual re-critical and a re-run); and the vehicle rules table's own constraints (gist rejects an overlap, the one-open index rejects a second open row with the gist dropped, concurrent creation leaves one winner, `after_hours_exempt` defaults false on a pre-existing row, grants hold under `SET ROLE fibreflow_user`).
4. `migrationContract.test.ts` — the incident-type list is exactly the four the plan names, checked against a TS constant; the guard precedes every `CREATE`; the marker constants and the timezone the API validates against are shared with the seed.
5. API tests — `withPermission('fleet.vehicle-rules', 'create')` on POST and `'view'` on GET; every refusal names its field.
6. Dialog tests — opening the dialog is gated on `view`, the version-creating editor on `create`; a future-dated open version reads "Pending from …", not "Current".

**Mutation targets:** change the after-hours window to a non-wrapping comparison; drop the holiday lookup; set the re-versioned rules to `critical` (must be caught, because that silently arms WhatsApp); remove the guard; split the guard and the `UPDATE` into two statements; drop the `$` anchor from the rollback's marker match; restore 510's seed constants instead of the marker values; drop the rollback's `WHERE severity = 'high'`; drop the marker-strip so a re-run doubles it.

**Gates:** `ci:quick`; migration test; blind `/review`; browser check of the rules dialog in **both themes** (a `getByText()` assertion passes on invisible text — this repo has been bitten).

**Rollback:** `rollback_529_*.sql`, which restores the incident rules as described in §3.2. Verify by re-running test 3's effective-rule assertion against the live DB after rollback.

---

### PR4 — The five live detectors, wired to `produceIncident`
**Ships:** the detector modules, `sourceEventId.ts`, `vehicleProjectResolver.ts`, `vehicleDetectorService.ts`, the `accidentSosDetector` stub, and the call into the existing `fleet-operational-monitor` tick.

**Wiring decision:** run inside `pages/api/cron/fleet-operational-monitor.ts`'s 5-minute tick, as a **separate phase** after `runOperationalMonitor` returns, under the same `runWithCronLock`. Rationale: one lock, one cron entry to approve, and the two phases share nothing. It must be a distinct function with its own try/catch and its own counters — a vehicle-detector failure must never mark the roster monitor failed.

**Contract with the producer** (already exists, do not change it): build an `IncidentSourceEvent` with `producerKind:'source_event'`, `staffId: null`, `vehicleId`, `projectId` from `vehicleProjectResolver` or `null`, `occurredAt` = the event instant, `sourceEventId` from `sourceEventId.ts`, and a `metadata` object of `Record<string, string|number|boolean|null>` only (`SanitizedIncidentMetadata`). Dedup and recurrence come free: `findIncidentBySourceEvent` returns `unchanged` on a repeat, and the observation fingerprint is computed by `computeObservationFingerprint` inside the producer.

`sourceEventId` must be **deterministic and bucketed**, e.g. `theft_after_hours_movement:${vehicleId}:${afterHoursWindowStartIso}` — not `Date.now()`, not a UUID. A non-deterministic id turns every 5-minute tick into a fresh incident. Bucket granularity per detector: theft = the after-hours window; severe_driving = the fix's `provider_event_id` (naturally unique); unauthorized_stop = the stop's start instant; lost_contact = the last-known-fix instant.

**Detector rules:**
- `theft_after_hours_movement` — `isAfterHours(t)` AND vehicle not `after_hours_exempt` AND cumulative displacement from the window's first fix `> rule.theft_displacement_meters` AND at least `theft_min_positions` fixes. The min-positions clause is what makes a single GPS blip unable to fire it.
- `severe_driving` — **primary path is the provider's own event**: `provider_event_type IN ('HARSH_BRAKING', 'HARSH_CORNERING')`. `HARSH_ACCELERATION` was **not** observed in 55,009 events over 7 days — accept it in the set if it ever appears, but nothing may assume it exists, and no test may assert it does.
  **Fallback path, only where `coverage_gforce` is true for that vehicle-day**: `-linear_g > harsh_linear_g` (braking; `linear_g` is signed, negative = braking) or `lateral_g > harsh_lateral_g` (`lateral_g` is already unsigned — `abs()` is a no-op, and treating a negative as possible is a bug), **and** `speed_kph >= harsh_min_speed_kph`. Without that speed gate the detector is a report on one broken device: 19 of 20 braking events ≥ 0.35 g are at ≤ 10 km/h on a single vehicle.
  The two paths are a union, not an either/or: the firmware fires `HARSH_CORNERING` at 95–129 km/h on vehicles whose `linear_g`/`lateral_g` are structurally zero, which the g path cannot see, and the g path covers the one vehicle whose device reports g but whose `event_description` may lag. Dedup is free — `sourceEventId` buckets on the fix's `provider_event_id`.
- `prolonged_unauthorized_stop` — `ignition===true`, displacement under 50 m for `> unauthorized_stop_minutes`, and `findNearestPlace(lat, lon)` returns null or `distanceM > known_site_radius_meters`. Requires `coverage_ignition`, so it will not fire for the 8 snapshot vehicles — state that in the module header rather than letting it look broken.
- `lost_contact_moving` — the last fix had `speed_kph > 0` (or `ignition===true`) and `now - recorded_at > effective_lost_contact_minutes`. **Scaled per feed from measured cadence** (PR0/U3 settled this):
  ```
  effective_lost_contact_minutes(provider, account_ref) =
      max(rule.lost_contact_minutes, 3 × observed_p90_gap_minutes)
  ```
  With `lost_contact_minutes = 30` that resolves to 30 min for `cartrack/velocity` (p90 gap 30 s) and 374–481 min for the other three feeds, where it is not a useful signal. **In practice this is a 7-vehicle detector** — say so in the module header rather than letting the other eleven look broken. Do **not** restrict it to `coverage_granularity='history'`: `cartrack/urent` is `history` and is one of the eleven. The per-feed p90 gap table is in `.claude/modules/fleet.md`.
- `dangerous_area_entry` — **deferred, not stubbed.** There is no dangerous-area geofence table and authoring one is explicitly out of scope. Its `fleet_operational_incident_rules` row stays present and enabled=false is *not* set (leave it as 529 leaves it); no code path references it. Record the deferral in the CHANGELOG.
- `accident_sos` — stub or live per U1.

**Tests:**
1. One `__tests__` file per detector, with fixtures built from real position shapes. Assert the negative case explicitly: a single after-hours blip 600 m from the last fix does **not** fire (`theft_min_positions`). Do not write a test that re-implements the threshold arithmetic — assert against literal expected outputs.
2. `sourceEventId.test.ts` — the same condition observed at three consecutive ticks yields one id; two different vehicles yield different ids; two different windows yield different ids.
3. `vehicleDetectorService.test.ts` — the producer is called with `staffId: null` and a non-null `vehicleId`; a second tick over the same data produces `outcome:'unchanged'` and zero new incidents; a detector that throws is isolated and the phase reports partial.
4. An end-to-end test at the producer boundary (mocked DB, real `produceIncident` contract shape) proving `metadata` contains only `string|number|boolean|null` — a nested object silently violates `SanitizedIncidentMetadata`.

**Mutation targets:** make `sourceEventId` include `Date.now()`; drop `theft_min_positions`; remove the `coverage_gforce` gate; remove the `after_hours_exempt` check; return `staffId: vehicleId` (the producer would then take the scheduled path and throw).

**Gates:** `ci:quick`; `vitest run src/modules/fleet/vehicleDetectors`; blind `/review` (this is the safety-relevant PR — use the review-team workflow if the diff exceeds 500 lines); a dry run against production data with the producer replaced by a logger, counting how many incidents each detector *would* have opened over the last 7 days. If any non-critical detector exceeds ~5/day fleet-wide, tune the rule version before merging, not after.

**Rollback:** revert the PR. The detectors are additive; incidents already opened stay and are resolvable through the existing queue. No data cleanup needed.

---

### PR5 — WhatsApp group delivery + DM fallback
**Ships:** `incidents/incidentGroupDelivery.ts`, its test, and the call site in `incidentNotifications.ts`.

**Design:** `postToFleetAlertsGroup(message)` reads `FLEET_ALERTS_WA_GROUP_JID` from env (precedent: `OPS_REVIEW_WA_GROUP_JID` in `src/lib/group-nonactivation/delivery.ts`) and calls `sendWhatsAppGroup(jid, message)`. On throw or on an unset JID it falls back to the **existing** per-user path — `deliverWhatsApp(userId, payload, null)` for each recipient from `resolveIncidentRecipients` — and counts failures into `NotifyResult.failed`. It never throws at its caller; that is `incidentNotifications.ts`'s established contract.

**Idempotency:** the group post needs its own claim namespace, e.g. `${eventType}:wa_group`, so it cannot collide with the per-user `${eventType}:whatsapp` claim `sendMandatoryWhatsApp` already takes. Reusing the per-user triple would suppress the group post entirely. Claims are fail-open here for the same reason the existing code documents: for a critical incident, delivering twice beats not delivering.

Only `accident_sos` and `theft_after_hours_movement` reach this path, and they reach it because they are the only telematics types left at `severity='critical'` after 529.

**Tests:** group send happens once per incident; a second call for the same incident is suppressed; a throwing `sendWhatsAppGroup` falls back to DMs and returns `failed>0` without throwing; an unset env var takes the fallback and logs a warning; a `severity='high'` incident never reaches the group.

**Mutation targets:** reuse the `:whatsapp` claim namespace; remove the fallback; let the group send throw; widen the predicate to all source events.

**Gates:** `ci:quick`; blind `/review`; a live send of one test message to the Fleet Alerts group from dev, confirmed visually in WhatsApp. Do not put the JID in any tracked file other than as an env var name.

**Rollback:** unset `FLEET_ALERTS_WA_GROUP_JID` — the code then takes the DM fallback, which is today's behaviour. No revert required.

---

### PR6 — Per-vehicle stats read API + stats page
**Ships:** `statsQueries.ts`, the three read APIs, `pages/fleet/vehicles/[id]/stats.tsx`, the four web components, one `<Link>` added to `pages/fleet/vehicles/[id].tsx`.

Route map for a selected day is drawn from `fleet_vehicle_trips` for that vehicle and SAST day, with `fleet_vehicle_positions` fetched only on demand for detail, reusing `components/FleetMap.tsx`. A day whose trips are all `close_reason='timeout'` must say so on the map — `counts_toward_metrics` is `GENERATED` precisely so a phantom trip is visible rather than plausible.

Coverage display: "days with data / days expected" where *expected* is days since the vehicle's first position, and a day with `coverage_complete=false` renders as a distinct state, never as zero.

**Tests:** component tests for each of the four components including the empty and the partial-coverage state; API tests for auth (`withAuth` + `fleet.vehicle-stats`), a 404 for an unknown vehicle, and a date-range clamp; a query test asserting the 30-day window is computed in SAST.

**Mutation targets:** render `coverage_complete=false` as 0; drop the permission check; compute the 30-day window in UTC.

**Gates:** `ci:quick`; `vitest run`; **browser check** of `/fleet/vehicles/<id>/stats` in both light and dark themes for a Cartrack vehicle and a Netstar vehicle (the second is the interesting one — it must look sparse-but-honest, not broken); blind `/review`. Acceptance criterion 1 is signed off here: the page renders for all 18 tracked vehicles, and one vehicle's day is within 5% of the provider portal on km.

**Rollback:** revert; the page is additive and the only edit to the 4,494-line detail page is one link.

---

### PR7 — Fleet overview table
`pages/fleet/vehicles/index.tsx` gains a "Yesterday" view (or a sibling `/fleet/daily-stats`) listing all tracked vehicles with yesterday's row and anomaly counts. Small, isolated, depends only on PR6's query layer. Tests: sort stability, empty state, a vehicle with no row yesterday shows "no data", not 0. Browser check both themes.

---

### PR8 — 08:15 vehicle summary, to the group
**Ships:** `incidents/vehicleSummaryPhase.ts`, called from `actionRunner.ts` alongside the existing `incidentSummaryPhase`.

Reuses that module's proven shape: a `MORNING_SUMMARY_MINUTE_OF_DAY` gate, a "did a `morning_summary` run already succeed for this SAST work date" check via `findLatestMonitorRun`, and `delivery.delivered > 0` (not attempts) incrementing `summaries_sent_count`. Counts yesterday's vehicle incidents by type, posts one message to the Fleet Alerts group through PR5's helper, and sends the existing per-recipient summary in parallel.

**Tests:** fires once per day and is a no-op on later ticks; a failed group post still sends the per-recipient summaries; a day with zero vehicle incidents still posts an "all clear" line (silence is indistinguishable from a broken cron otherwise); the SAST 08:15 gate is correct across a UTC day boundary.

**Mutation targets:** count attempts instead of deliveries; remove the already-succeeded guard; skip the zero-incident post.

---

### PR9 — Backfill script, docs, CHANGELOG
`scripts/fleet-daily-stats-backfill.ts` is the same `buildDailyStatsForVehicle` code path run repeatedly with a lower ceiling — never a second implementation (that is exactly how the trips backfill grew a divergent bug). Plus: `.claude/modules/fleet.md` section (data model, coverage matrix from U3, detector table, deferrals), `src/modules/fleet/.claude.md` critical-rules additions, `src/modules/fleet/CHANGELOG.md` entry naming the deferred `dangerous_area_entry` and the `accident_sos` status, and `npm run agents:mirror` + `npm run agents:check`.

---

## 6. Cron install (production only — ONE environment)

Per the tracking coverage note, Cartrack REST polls **from dev (:3005)** and the portals **from prod (:3000)**, one shared DB. The daily-stats job must run on **exactly one** of them or two instances will fight over the same watermark rows. Choose **production (:3000)**, matching where `fleet-operational-monitor` and `fleet-build-trips` already run.

`scripts/cron-fleet-daily-stats.sh` is a copy of `scripts/cron-fleet-build-trips.sh` with the URL changed. That script's shape is load-bearing and must be preserved verbatim:
- `set -euo pipefail`; `SCRIPT_DIR`/`PROJECT_DIR` derived from `$0`;
- `env_value()` with the `|| true` guard (a no-match `grep` under `set -e` aborts the assignment before the fallback runs);
- `CRON_SECRET` read from env → `.env.local` → `.env`, never hardcoded, never on the command line (so it stays out of `ps` and the crontab);
- `PORT` resolved the same way, defaulting 3000;
- `curl -sS -f -m 300 -X POST -H "x-cron-secret: …"`;
- `if ! RESPONSE=$(…)` rather than capturing `$?` (under `set -e` the assignment aborts first);
- `. "$SCRIPT_DIR/lib/cron-run-status.sh"` and `report_run_status`, because the endpoint answers 200 even when the run failed.

Crontab lines for `velo` (SAST — velo cron runs in local time):
```
*/15 * * * * /home/velo/fibreflow-production/scripts/cron-fleet-daily-stats.sh >> /home/velo/logs/fleet-daily-stats.log 2>&1
```
The detectors need **no new crontab entry** — they ride the existing `*/5` `cron-fleet-operational-monitor.sh`, and the 08:15 summary rides the existing `cron-fleet-incident-actions.sh`. Confirm both are actually installed before relying on them; the fleet CHANGELOG records them as "unscheduled pending deployment approval".

Registering any crontab line is a deployment action requiring separate approval. The script exists so that approval has something correct to install.

**Rollback for the cron:** comment out the line and `systemctl` nothing — the endpoint is inert unless called.

---

## 7. Risks

**R1 — Pipeline/loop bugs are invisible to reading.** The trips builder shipped a straddler bug that six reviewers read past; it understated fleet distance 1.6% at one batch size and 4.4% at another, with every row passing every constraint. The same shape is present here: a batched fold with a watermark and a lookback. **Mitigation is mechanical, not editorial** — every batch-processing PR (PR1, PR2, PR9) carries a batch-size-variation test that compares row hashes across at least four batch sizes including 1 and the production constant, plus an idempotence test over an overlapping window. A PR in this set without that test does not merge.

**R2 — DATE / timezone.** node-postgres parses a `DATE` (OID 1082) into a JS `Date` at *local* midnight; `toISOString()` on it shifts backwards across the date line in SAST and reports the 1st as the last day of the previous month. `work_date` is a `DATE`, so every read path must go through `toWorkDate`. Every write path must derive the day through `sastDateString`/`toWorkDate`, never `date_trunc` (which uses the session timezone) and never UTC arithmetic. The 18:00→06:00 after-hours window **wraps midnight** and spans two `work_date` values — the naive `start <= t && t <= end` comparison is always false and would silently disable the theft detector entirely.

**R3 — Conditional tagged-template SQL is broken in this repo.** `${cond ? sql\`AND x\` : sql\`\`}` produces a malformed query through both the webpack shim and the `@/lib/db-pool` tag. Every optional filter is two whole explicit query branches (`loadPositions` in `tripRepository.ts` is the reference). Pinned by a `sqlLiterals.test.ts` copied from `trips/__tests__/`.

**R4 — Feed heterogeneity is the dominant correctness risk.** Eleven of eighteen tracked vehicles are on 2-hour snapshot or 2-hour history feeds; two report no g-force; two assert ignition only on transition rows. A detector or a statistic that is honest for the seven `cartrack/velocity` vehicles is a fabrication for the rest. The coverage flags are CHECK-enforced in the schema (§3.1) specifically so a snapshot vehicle *cannot* store an ignition-derived number, and `lost_contact_moving` must be cadence-scaled or it fires on eight vehicles every tick forever.

**R5 — WhatsApp blast.** Migration 510 seeds all six telematics types `critical` + `whatsapp_enabled=true`. Wiring the detectors *before* landing 529's re-versioning would send a WhatsApp for every `severe_driving` and every `prolonged_unauthorized_stop`. PR3 strictly precedes PR4 in the DAG for this reason, and PR3's migration test asserts the four types are `high`.

**R6 — Shared dev+prod DB.** Every migration here runs against both at once. All are additive; the only mutation of existing data is 529's incident-rule re-versioning, which is transactional, reversible, and asserted in both directions by the migration test.

**R7 — Migration number churn.** 528/529 are correct as of this writing (max = 527). Re-check `MAX+1` immediately before the commit; renaming an already-applied migration causes it to re-run.

**R8 — `accident_sos` may have no source at all.** If U1 finds nothing, the highest-severity incident type in the system has no producer. That is an honest gap and must be stated in the CHANGELOG and in the module doc — not papered over by deriving SOS from a harsh-braking threshold.

---

## 8. Acceptance (restated as verifiable steps)

1. `/fleet/vehicles/<id>/stats` renders for all 18 tracked vehicles; for one Cartrack vehicle, one day's `distance_km` is within 5% of the Cartrack portal's own figure for that vehicle/day. Verified in browser, both themes, with the portal figure recorded in the PR description.
2. A staged after-hours drive (>500 m, ≥2 fixes, after 18:00 SAST, on a non-exempt vehicle) opens a `theft_after_hours_movement` incident and posts to the Fleet Alerts group within 10 minutes (two 5-minute ticks). Verified end to end on production after the cron is approved.
3. After one week of tuning, ≤5 non-critical vehicle incidents per day fleet-wide, and the 08:15 summary appears in the group every day including days with zero incidents.

---

## Threshold defaults from PR0

Measured 2026-08-25 against the live Cartrack REST API and the shared DB (30 days of
`fleet_vehicle_positions`; 55,009 Cartrack events over 7 days). Full evidence, queries and
distributions: `.claude/modules/fleet.md` § "Vehicle-first spike findings (PR0, 2026-08-25)".
These are the numbers migration 529 seeds as `version 1`.

### 529 — harsh-driving thresholds

| Column | Default | Why |
|---|---|---|
| `harsh_linear_g` | `0.350` | p99 of `abs(linear_g)` is 0.090, p99.9 is 0.140. 0.35 sits ~2.5× above p99.9 and matches the level Cartrack's own firmware fires `HARSH_BRAKING` at (observed −0.42 … −0.68 g). |
| `harsh_lateral_g` | `0.350` | `lateral_g` is already an unsigned magnitude (min 0.000 over 237,419 rows) — `abs()` is a no-op, do not treat a negative as possible. p99 0.110, p99.9 0.220, observed `HARSH_CORNERING` at 0.42–0.50. |
| `harsh_min_speed_kph` | `20` | **New column, not in §3.2.** Without it the detector is a report on one broken device: 19 of 20 braking events ≥ 0.35 g are at ≤ 10 km/h on a single vehicle, and every live `HARSH_BRAKING` sample carries `speed=6`. |

**Expected daily volume at these defaults**, 30 days, 7 `cartrack/velocity` vehicles:

| Gate | Braking | Accel | Cornering | Total/day |
|---|---|---|---|---|
| 0.35 g, no speed gate | 20 | 0 | 23 | **1.43** |
| **0.35 g + speed ≥ 20 km/h** | **1** | **0** | **23** | **0.80** |

0.80/day is comfortably inside acceptance criterion 3's ≤5/day. All 24 come from one vehicle
(`af119f11`); see the coverage caveat below before reading that as a driver-behaviour signal.

### 529 — `lost_contact_minutes`, derived per feed

A single global value cannot work: measured p90 inter-fix gaps span 30 s to 160 min. Take the
plan's preferred option — derive from the feed's own cadence — and keep the rule column as a floor:

```
effective_lost_contact_minutes(provider, account_ref) =
    max(rule.lost_contact_minutes, 3 × observed_p90_gap_minutes)
```

`lost_contact_minutes` seeds at **30**. Resulting effective thresholds:

| feed | gap p90 | ingest lag p99 | effective threshold | detector useful? |
|---|---|---|---|---|
| `cartrack/velocity` | 30 s | 7.0 min | **30 min** | **yes** — the only feed where it means anything |
| `cartrack/urent` | 126 min | 99 min | 379 min | no |
| `netstar/europcar` | 160 min | 90 min | 481 min | no |
| `ituran/avis` | 125 min | 91 min | 374 min | no |

So `lost_contact_moving` is, in practice, a 7-vehicle detector. Say so in the module header rather
than letting the other eleven look broken. Do **not** restrict it to `granularity='history'` —
`cartrack/urent` is `history` and is one of the eleven.

### 528 — `coverage_complete` thresholds

Two conditions, both required — a count alone marks a legitimately parked snapshot day incomplete:

```
coverage_complete = position_count >= expected_min_fixes
                 AND tracker_silence_seconds <= max_allowed_gap_seconds
```

| feed | `expected_min_fixes` | `max_allowed_gap_seconds` | evidence |
|---|---|---|---|
| `cartrack/velocity` | 200 | 3,600 | fixes/day p10 = 386, median 1,169; gap p99 = 298 s |
| `cartrack/urent` | 4 | 14,400 | p10 = 5, median 15; gap p90 = 7,581 s |
| `netstar/europcar` | 2 | 14,400 | p10 = 2, median 10; gap p90 = 9,618 s |
| `ituran/avis` | 4 | 14,400 | p10 = 6, median 11; gap p90 = 7,472 s |

`coverage_granularity` stays as specified. Three corrections to §2's U3 table, all measured:

- `cartrack/velocity` is **event-driven at a median 8-second gap**, ~1,169 fixes/vehicle-day —
  not 2 minutes. Size every batch constant and every fixture against 1,169/day, not ~700/day.
- `netstar/europcar` asserts ignition on **100 %** of fixes (the live path is `tree.ts`'s
  `IgnitionOn` boolean, not the CSV `Status`), and supplies **no odometer at all** — its distance
  must be haversine. `coverage_ignition = true` for it.
- `ituran/avis` asserts ignition on **94.5 %** of fixes. `coverage_ignition = true`.

Idle is therefore computable on all four feeds (`ignition=true AND speed_kph=0` fires on 12–23 % of
fixes everywhere), at medians of 1,872 / 11 / 6 / 3 idle-feasible fixes per day. The §3.1 CHECK
`coverage_ignition OR (ignition_seconds = 0 AND idle_seconds = 0)` stays — it is just no longer the
binding constraint it was designed to be. Coverage denominators must start at each vehicle's first
position: every `netstar`, `ituran` and two `urent` vehicles have exactly 19 of 30 possible days
because those feeds only went live 2026-08-06/07.

### 528 — `coverage_gforce` must be per vehicle-day, never per provider

**Six of the seven `cartrack/velocity` vehicles report `linear_g`/`lateral_g` as constant zero** —
one distinct value across 22k–60k rows each — while the seventh has 32. `linear_g IS NOT NULL`
passes for all seven. Deriving `coverage_gforce` from `provider = 'cartrack'` (or from a null check)
is wrong for six of seven vehicles and would let the §3.1 CHECK pass while the harsh counts are
structurally zero.

```
coverage_gforce = EXISTS (a fix in this vehicle-day with linear_g <> 0 OR lateral_g <> 0)
```

Add a test asserting a vehicle-day of all-zero g yields `coverage_gforce = false`.

### `accident_sos` — **stub**, decided

No SOS, panic, impact, crash, tow or jam field exists on any of the three feeds. Fields checked on
2026-08-25, named for the `accidentSosDetector.ts` header:

- **Cartrack `GET /vehicles/events`** — all **57** fields enumerated (the plan's "44" is stale);
  43 are discarded by `provider.ts`. Specifically checked and cleared: `event_description`,
  `terminal_event_type_id`, `input_state`, `input_state2`, `input_state3`, `output_state`,
  `dynamic1`–`dynamic4`, `driver_id`, `battery_percentage_left`, `x_accel`, `y_accel`, `z_accel`,
  `linear_g`, `lateral_g`. The `event_description` vocabulary over 55,009 events / 8 vehicles /
  7 days is 14 values, none of them an alarm class: `PERIODIC_EVENT`, `IDLING_START/CONTINUE/END`,
  `MOTION_START/END`, `IGNITION_ON/OFF`, `GPS_LOCK/LOST`, `SPEEDING_START/END`, `HARSH_BRAKING`,
  `HARSH_CORNERING`.
- **Netstar** — the live `tree.ts` path carries no status or alarm field at all, only `IgnitionOn`.
  The CSV `Status` column (backfill-only, `UNVERIFIED` path) has 8 observed values:
  `Timed Event`, `Stopped`, `Moving`, `Ignition on`, `Ignition off`, `Speeding`, `Idling`,
  `HeadingChange`. Raw exports are not retained anywhere.
- **Ituran** — `Statuses[].StatName` observed: `Ignition On`, `Ignition Off`, `Engine On`,
  `Engine Off`, `Vehicle Stopped`. Raw payloads are not retained.

The one unresolved lead is Cartrack's `input_state` bitfield (24 distinct signed values over 24 h,
undocumented on our side) — a panic button is normally a digital input. That is a question for
Cartrack, not something to infer. Record it in the CHANGELOG as the reopening condition; do not
synthesise SOS from g-force.

### Consequence for PR1's scope: one column added to 528 — DECIDED 2026-08-25

`event_description` is decision-grade and currently discarded, and it is the forward-compatible
landing spot if the `input_state` question ever yields a panic bit. Two independent reasons to
capture it now rather than churn the migration number later:

1. **Cartrack's firmware already computes harshness.** It emits `HARSH_BRAKING` / `HARSH_CORNERING`
   directly. Consuming those is strictly better than our own g threshold, because the harsh events
   fire on the firmware family whose `linear_g`/`lateral_g` are constant zero — including
   `HARSH_CORNERING` at 95–129 km/h with `lin=0, lat=0` and only `x/y/z_accel` populated. Those are
   real events our g columns **cannot see at all**, on six of seven vehicles.
2. `IDLING_START` / `IDLING_END` / `MOTION_START` / `MOTION_END` are exact boundary events, which
   makes `idle_seconds` and `moving_seconds` measured rather than inferred from sampled speed.

**Decision (coordinator, 2026-08-25): yes.** 528 adds `ALTER TABLE fleet_vehicle_positions ADD COLUMN IF NOT EXISTS provider_event_type TEXT;` (nullable,
additive, safe against running prod code), plus `providerEventType` on `ProviderPosition` and
`event_description` in `cartrack/provider.ts`'s row mapping. Netstar and Ituran map their own
vocabulary or `null`. `severe_driving` then reads `provider_event_type IN ('HARSH_BRAKING',
'HARSH_CORNERING')` **or** the g thresholds above, whichever the vehicle-day supports — and
`coverage_gforce` gates only the g branch. This is one column and one mapper, decided before PR1 so
the migration number does not churn.
