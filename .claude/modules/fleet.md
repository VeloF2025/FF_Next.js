# Fleet Module

## Overview
Vehicle fleet management with driver check-ins, fuel tracking, GPS investigation, and VLM-powered dashboard reading.

## Key Features
- **Vehicle Portal**: Plate scan verification with VLM
- **Check-In System**: Daily/Weekly inspections with photo capture
- **First-Time Calibration**: Mandatory setup for new vehicles
- **Fuel Management**: Transaction tracking with receipt scanning
- **GPS Investigation**: Trip analysis from uploaded CSVs
- **Driver Scorecards**: Performance tracking and leaderboards

## Directory Structure
```
src/modules/fleet/
├── check-in/
│   ├── components/
│   │   ├── CheckInForm.tsx         # Main check-in form
│   │   ├── VehicleCalibrationModal.tsx  # First-time setup
│   │   └── VlmResultCard.tsx       # VLM extraction display
│   ├── hooks/
│   │   └── useCheckIn.ts           # Check-in logic hook
│   └── types/
│       └── check-in.types.ts       # Type definitions
├── services/
│   ├── checkInService.ts           # Check-in business logic
│   └── fleetVlmService.ts          # VLM integration for dashboard reading
└── types/
    └── fleet.types.ts              # Shared fleet types
```

## Database Tables
| Table | Purpose |
|-------|---------|
| `fleet_vehicles` | Vehicle registry |
| `fleet_check_records` | Check-in records |
| `fleet_check_photos` | Photos from check-ins |
| `fleet_check_responses` | Checklist responses |
| `fleet_vehicle_calibration` | First-time calibration data |
| `fleet_fuel_history` | Fuel level tracking |
| `fleet_fuel_transactions` | Fuel purchase records |
| `fleet_odometer_history` | Odometer readings |
| `fleet_gps_jobs` | GPS investigation jobs |
| `fleet_gps_trips` | Analyzed GPS trips |

## Tracking (Live GPS)

Vehicle position history lands in `fleet_vehicle_positions` via two provider-blind ingestion
paths, both funneling through `src/services/tracking/ingest.ts`:

| Path | Cadence | Endpoint | Providers |
|---|---|---|---|
| REST API | 2 min | `/api/cron/poll-tracking` | Cartrack (Velocity account) |
| Portal API | 2 hours | `/api/cron/poll-portal-tracking` | Netstar |

Full reference for the tracking services: `src/services/tracking/.claude.md`. Design spec:
`docs/superpowers/specs/2026-08-05-portal-tracker-ingestion-design.md`.

### Tracking Tables
| Table | Purpose |
|-------|---------|
| `fleet_vehicle_trackers` | Which tracker (provider + account_ref + external_id) reports for which vehicle. One active row per vehicle. |
| `fleet_vehicle_positions` | Position history. Deduped per (provider, account_ref, provider_event_id). |
| `fleet_tracking_watermarks` | Per (provider, account_ref) high-water mark, last run, last error, consecutive failure count. |

### Discovery / Reconciliation
`reconcileTrackers()` (`src/services/tracking/discovery.ts`) runs before every portal poll and
matches the portal's vehicle list against active `fleet_vehicles` by registration. It is
bidirectional: vehicles active in FibreFlow but absent from the portal (`fleetOnly`), and portal
vehicles matching no active fleet vehicle (`portalOnly`), are both surfaced in the poll response
under `coverage`. A tracker row is only written on a confident match.

Four guards, all of which report rather than fail silently:

1. **Empty portal list = fetch failure**, not truth. Reconciliation is skipped entirely rather
   than deactivating every tracker on the account.
2. **Zero matches = fetch failure** too. A reseller report tree can legitimately return folder
   nodes that pass validation and match nothing.
3. **Never take over from another provider.** `uq_fleet_trackers_one_active_per_vehicle` is
   fleet-wide, and `setVehicleTracker`'s deactivate is `WHERE vehicle_id = $1 AND is_active`
   with no provider predicate — so mapping a vehicle Cartrack already tracks switches the
   Cartrack row off, silently downgrading it from a 2-minute feed to a 2-hourly scrape with
   nothing to map it back. Vehicles tracked elsewhere are skipped and reported as
   `coverage.alreadyTrackedElsewhere` (which also means somebody is paying for two
   subscriptions).
4. **Half or more of the account cannot be unmapped in one tick.** The boundary is inclusive:
   a report truncated to the first of two equal pages lands exactly on it.

**Ambiguity is refused, never resolved.** Two fleet rows normalising to one registration
("LN40 MGGP" vs "LN40-MGGP", both legal under the raw-string UNIQUE), or one portal external id
appearing twice, drop out to `coverage.ambiguous` instead of picking a winner. A position stored
against the wrong vehicle cannot be repaired later — the dedup key
(`syn:account:external:recordedAt`) has no `vehicle_id`, so the corrected re-insert collides and
is dropped.

### Netstar: the tree API, not reports

Live positions come from ONE call, which returns every vehicle on the account together with
its last fix:

```
POST /VigilCloud4/Main/VehicleRepo/GetVehicleTreeDataPaging
     ?page=1&pageSize=2147483647&__ts=<ms>&treeFilter=&sortBy=&sortDir=
     X-Requested-With: XMLHttpRequest
-> { data: [ { Name, LeafId, GroupName, Lat, Long, DateTimeUtc, SpeedValue, Dir, IgnitionOn } ] }
```

**POST only** — the identical path answers 404 to a GET, and the portal routes on the XHR
header. `LeafId: 0` rows are folders (other clients on the reseller tree), not vehicles.
`DateTimeUtc` is `/Date(<epoch ms>)/`; folder rows carry DateTime.MinValue, which must be
rejected rather than stored as a year-0001 fix.

This replaced a per-vehicle CSV report flow that issued one job per vehicle per 31-day chunk
and polled each export up to ten times. It also replaced a `listVehicles` that called
`/Reports/ReportRepo/GetReportTree` — an endpoint that does not exist and always 404'd, so the
integration could never have mapped a single vehicle.

**The account is a reseller tree of ~11.5k vehicles across 6 groups** (Motus, Ungrouped, Key
Hire, SSA Acoustic, ICT-SA Worldwide, New Planet Telecoms). Six are Velocity's, split between
Motus and Ungrouped. Everything else belongs to other companies — which is why discovery
matches by registration and refuses ambiguity.

**`fetchPositions` is a snapshot**, declared as `granularity: 'snapshot'` on the provider so a
caller can tell. At most one fix per vehicle; `from`/`to` filter it rather than fetching
history. Because the watermark is the newest ingested fix and the window opens an hour behind
it, the vehicle that set the watermark is always back inside the window — so a parked fleet
re-presents the same fixes each tick and dedup absorbs them.

**That same property is why "no positions" cannot detect a dead feed.** A frozen portal keeps
returning the identical stale fixes forever, so `positions.length === 0` is unreachable and an
outage looks exactly like a healthy tick. The detector is instead the **newest fix across the
WHOLE account** (`newestFixAt`, exposed as `client.feedFreshness()`): the reseller tree carries
~11.5k vehicles across several commercial fleets, so something on it has always reported
recently. Silence across all of them is an outage; silence across our six is a parked weekend.
Stale beyond `STALE_FEED_MS` (6h = three cycles) raises `fleet.tracking_data_gap`. For
`granularity: 'history'` providers the old empty-window check still applies, because for them an
empty window really does mean nothing happened.

### Backfill
One-off historical backfill for a portal provider, walking backwards from now in provider-max
chunks (Netstar: 31 days) until retention is discovered by two consecutive empty chunks:

```bash
npx tsx scripts/backfill-tracking.ts --provider=netstar --floor=2024-08-01
```

Safe to run alongside the 2-hourly poll: it only appends positions and never touches
`fleet_vehicle_trackers`, so it cannot race the poll's reconcile.

**Interrupting is safe for the database, not for the portal.** Every write goes through
`ingestPositions()`'s dedup, so a re-run stores nothing twice — but a plain restart begins again
at `now()` and re-issues every report job it already did, one per vehicle per 31-day chunk,
against a partner-owned account. The cursor is printed on every chunk, on failure, and on
Ctrl-C; resume with it:

```bash
npx tsx scripts/backfill-tracking.ts --provider=netstar --floor=2024-08-01 \
  --to=2025-11-14T00:00:00.000Z
```

### Notification Events
Registered in `src/modules/notifications/constants/index.ts`:

| Event | Trigger | WhatsApp |
|-------|---------|----------|
| `fleet.tracking_pull_failed` | Auth failure during working hours (07:00–20:00 SAST) | Yes |
| `fleet.tracking_pull_degraded` | 3+ consecutive transient failures, or an auth failure overnight | No |
| `fleet.tracking_data_gap` | Portal authenticated but returned no usable data while trackers remain mapped | No |

`fleet.tracking_data_gap` also fires when discovery itself failed — a portal list that matched
nothing, or the deactivation brake engaging. Neither is visible in position volume, because
`fetchPositions` reads already-mapped trackers: positions keep arriving from the previous tick's
mappings while every newly added or renamed vehicle silently stops being trackable.

Recipients come from `FLEET_ALERT_USER_IDS` (env var, comma-separated `users.id`, not
`staff.id`) rather than a role lookup, since the fleet manager's `staff.position` is "Staff".
**Unset means every alert is dropped** — the poll response reports `alertRecipients: 0` so that
is visible without reading logs.

### Scheduling
The endpoint is inert until it is in velo's crontab. Registration wrapper resolves the secret
and port from the deploy dir's env file:

```
0 */2 * * * /home/velo/fibreflow-<env>/scripts/cron-portal-tracking.sh >> /home/velo/logs/poll-portal-tracking.log 2>&1
```

One tick is bounded to ~25 minutes by the client's runtime budget. Without it, a degenerate
portal (~11 min worst case per vehicle × 22 vehicles) outruns the 2-hour cadence, and every
later tick then skips on the advisory lock with a 200 while tracking is dead. Exceeding the
budget is reported as a partial fetch, which holds the watermark so the next tick resumes.

## API Endpoints

### Vehicle Portal
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/fleet/portal/verify-plate` | POST | VLM plate verification |
| `/api/fleet/vehicles/[id]/calibration` | GET | Check calibration status |
| `/api/fleet/vehicles/[id]/calibration` | POST | Create calibration |

### Check-In
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/fleet/check-in/records` | GET/POST | List/create check-ins |
| `/api/fleet/check-in/records/[id]` | GET/PUT | Get/update check-in |
| `/api/fleet/check-in/photos` | POST | Upload check-in photos |
| `/api/fleet/check-in/process-vlm` | POST | Process dashboard with VLM |

### Fuel
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/fleet/vehicles/[id]/fuel-transactions` | GET/POST | Fuel transactions |
| `/api/fleet/fuel/anomalies` | GET | Fuel anomaly detection |
| `/api/fleet/fuel/summary` | GET | Fuel usage summary |

## VLM Processing Modes

**CRITICAL**: The `process-vlm` endpoint runs in three modes:

| Mode | Condition | Fuel/Odometer Recording | VLM Results Saved |
|------|-----------|------------------------|-------------------|
| **Preview** | `recordId === 'pending'` or `photoId.startsWith('temp-')` | No | No |
| **Persist-only** | `persistResultsOnly === true` | No | Yes |
| **Full** | Neither of the above | Yes | Yes |

### Check-In Submission Flow
```
1. Photo capture → VLM preview (no DB writes)
2. User reviews/corrects values in form
3. Submit → createCheckRecord() saves user's final fuel/odometer to history
4. Post-submit → VLM re-processes with persistResultsOnly=true (saves VLM results only, no history)
```

**Why `persistResultsOnly` exists**: Without it, step 4 would create duplicate `fleet_fuel_history` entries that overwrite the user's manual corrections from step 3. The re-processing in step 4 is only to persist VLM extraction results to `fleet_photo_vlm_results` with real photo/record IDs.

### Fuel Source Values
| Source | Meaning |
|--------|---------|
| `vlm` | VLM auto-filled, user accepted as-is |
| `manual_override` | VLM extracted a value, user corrected it (HITL) |
| `check_in` | User entered manually (no VLM extraction) |
| `fuel_transaction` | From fuel purchase recording |
| `calibration` | From first-time vehicle calibration |

## Calibration Flow

```
First Check-In Flow:
1. Driver scans plate → VLM verifies
2. API checks: needsCalibration = !calibration && checkCount === 0
3. If true → VehicleCalibrationModal opens (mandatory)
4. Driver enters:
   - Current odometer (km)
   - Fuel level (0-100% in 10% increments)
   - Dashboard photo (for VLM learning)
5. Submit → calibration saved → normal check-in proceeds
```

## VLM Integration

### Dashboard Reading
- **Service**: `fleetVlmService.ts`
- **Model**: Qwen3-VL-8B-Instruct
- **Extracts**: Odometer reading, fuel gauge level
- **Pre-processing**: Blur detection + NAFNet deblurring

### Plate Verification
- **Endpoint**: `/api/fleet/portal/verify-plate`
- **Returns**: Extracted plate, confidence, matched vehicle

## Pages
| Page | Path | Purpose |
|------|------|---------|
| Vehicle Portal | `/fleet/portal` | Driver entry point |
| Check-In | `/fleet/check-in` | Inspection form |
| Vehicles | `/fleet/vehicles` | Vehicle list |
| Vehicle Detail | `/fleet/vehicles/[id]` | Single vehicle view |
| Fuel Dashboard | `/fleet/fuel` | Fuel analytics |
| GPS Investigation | `/fleet/investigation` | Trip analysis |
| Driver Leaderboard | `/fleet/drivers` | Performance ranking |

## Tab Order (Feb 2026)
Dashboard → Vehicles → Drivers → GPS Investigation → Locations → Fuel → Maintenance → Analytics → Portal → Check-Ins

## Vehicles List Defaults
- **Default filter**: Active vehicles (not all)
- **Count display**: Shows filtered count (e.g., "14 active vehicles")

## License Disc Feature
- **Modal**: `LicenseDiscModal.tsx` - Two-step wizard (upload → verify)
- **VLM Extraction**: Extracts disc number, registration, VIN, engine number, make, description, year, color, tare, GVM, expiry
- **Verification**: Cross-checks extracted data against vehicle record
- **Auto-update**: Can update missing VIN, engine number, color from disc

### License Disc API
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/fleet/vehicles/[id]/license-disc` | GET/POST | Get/create license disc |
| `/api/fleet/vehicles/extract-license-disk` | POST | VLM extraction from photo |

## Recent Changes (Feb 2026)
- **VLM Fuel Override Fix**: Post-submission VLM re-processing was overwriting user's manual fuel corrections with duplicate `fleet_fuel_history` entries. Fixed with `persistResultsOnly` flag on `process-vlm` endpoint
- **Fuel Source Tracking**: Added `fuelWasOverridden` state in `useCheckIn` hook - manual fuel corrections now tracked as `manual_override` source (matching odometer behavior)
- **Photos Tab**: Added to vehicle detail page showing all photos from check-ins
- **Photo Storage Fix**: Photos now use `/storage/` prefix for nginx proxy
- **Two Photo Tables**: `fleet_check_photos` (check-in photos) + `fleet_vehicle_photos` (general vehicle photos)
- **Photo Upload Fix**: Changed from `fetch` to `axios` for proper form-data handling
- Added `LicenseDiscModal` with full OCR extraction and verification
- Added `engineNumber` field to `FleetVehicle` type
- Reordered tabs: Vehicles first, then Drivers
- Default vehicles list to Active status filter
- Show filtered vehicle count in header

## Photo Storage Architecture

### Storage Flow
```
Camera capture → dataUrl + File → FormData → API → VF Storage (:8091) → nginx /storage/ proxy
```

### URL Format
- **Correct**: `/storage/fleet/check-ins/filename.jpeg` (via nginx proxy)
- **Wrong**: `/fleet/check-ins/filename.jpeg` (missing /storage/ prefix)
- **Wrong**: `https://domain/fleet/...` (VF Storage returns this but needs /storage/ added)

### Nginx Configuration
Each domain (dev, vf, app) needs `/storage/` proxy:
```nginx
location /storage/ {
    proxy_pass http://localhost:8091/;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    client_max_body_size 100M;
    expires 30d;
    add_header Cache-Control "public, immutable";
}
```

### Photo API
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/fleet/vehicles/[id]/photos` | GET | Get all vehicle photos (both tables) |
| `/api/fleet/check-in/photos` | POST | Upload check-in photo |

### Photos Tab on Vehicle Detail
- Shows photos from both `fleet_check_photos` and `fleet_vehicle_photos`
- Filter by photo type (dashboard, fuel_gauge, odometer, etc.)
- Links to Check-In History page
- Lightbox for full-size viewing

## Vehicles API Query Branches

**IMPORTANT**: `pages/api/fleet/vehicles.ts` has 8 query branches for different filter combinations. When adding new fields (like license disc), ALL branches must be updated:

| Branch | Condition |
|--------|-----------|
| 1 | `status && type && search` |
| 2 | `status && type` |
| 3 | `status` |
| 4 | `type` |
| 5 | `search` |
| 6 | `assigned === 'true'` |
| 7 | `assigned === 'false'` |
| 8 | Default (no filters) |

### License Disc in Vehicles List
All branches include:
```sql
ld.expiry_date as "licenseDiscExpiry",
CASE
  WHEN ld.expiry_date IS NULL THEN NULL
  WHEN ld.expiry_date < CURRENT_DATE THEN 'expired'
  WHEN ld.expiry_date <= CURRENT_DATE + INTERVAL '7 days' THEN 'critical'
  WHEN ld.expiry_date <= CURRENT_DATE + INTERVAL '30 days' THEN 'warning'
  ELSE 'ok'
END as "expiryStatus"

LEFT JOIN LATERAL (
  SELECT expiry_date FROM fleet_license_disc
  WHERE vehicle_id = fv.id AND status = 'active'
  ORDER BY expiry_date DESC
  LIMIT 1
) ld ON true
```

## Recent Changes (Feb 2026)
- **Merged Audit into History**: Single "Check-Ins" page at `/fleet/check-in/history`
- **Admin Delete**: Admins/super_admins can delete check-in records (cascading delete)
- **Access Control**: Non-admins only see their own check-ins
- **VLM Confidence Flag**: Low confidence (<50%) marks records as needing review
- **Weekly Check-Ins Verified**: 4 required photos, 16 checklist items, license plate VLM

## Check-In History Page
Combined audit and history view at `/fleet/check-in/history`:

| Feature | Description |
|---------|-------------|
| VLM Results | Shows extracted values with confidence % |
| Odometer Discrepancies | Flags anomalies (rollback, excessive km) |
| Approval Actions | Approve/reject with notes |
| Admin Delete | Red trash icon, confirmation required |
| Access Control | Non-admins see only their records |

### Delete Cascade Order
```
fleet_photo_vlm_results → fleet_check_photos → fleet_check_responses
→ fleet_odometer_history → fleet_fuel_history → fleet_check_records
```

## Daily vs Weekly Check-In

| Aspect | Daily | Weekly |
|--------|-------|--------|
| Required Photos | 2 (dashboard, fuel) | 4 (front, rear, dashboard, fuel) |
| Optional Photos | 0 | 3 (under vehicle, license disk, damage) |
| VLM Analysis | Odometer, fuel | License plate ×2, odometer, fuel |
| Checklist Items | 2 | 16 (Safety, Exterior, Interior) |
| Template | "Daily Quick Check" | "Weekly Pre-Trip Inspection" |

### Weekly Checklist Categories
- **Safety** (3): Warning Lights⚠️, Lights Working, Horn
- **Exterior** (9): Tyres⚠️, Lights & Indicators⚠️, Mirrors, Windscreen, Wipers, License Disk, Number Plate, Under Vehicle, Exterior Damage
- **Interior** (4): Seat Position, Mirrors Position, Door Closure, Seatbelts⚠️

## Camera Permission Handling

The `VehicleCalibrationModal` and `OdometerOverrideModal` use `navigator.mediaDevices.getUserMedia()` for camera access. Error handling distinguishes:

| Error | Message | User Action |
|-------|---------|-------------|
| `NotAllowedError` | Step-by-step permission fix instructions | Tap lock icon → Camera → Allow → Refresh |
| `NotFoundError` | "No camera found on this device" | Use a device with a camera |
| `NotReadableError` | "Camera is being used by another app" | Close other camera apps |
| Generic | "Check your browser settings" | General troubleshooting |

**IMPORTANT**: No file upload fallback — drivers must take photos with the camera. The error messages include a "Refresh Page" button because browser permission changes require a page reload to take effect.

## Recent Changes (Feb 2026)
- **Camera Permission UX**: Improved error messages with step-by-step fix instructions instead of generic "allow camera permissions" message (Johann Lubbe report, 2026-02-09)

## Recent Changes (Jan 2026)
- Added `VehicleCalibrationModal` for first-time setup
- Added calibration API with grandfathering logic
- Integrated NAFNet deblurring for blurry dashboard photos
- CPU mode for NAFNet (RTX 5090 sm_120 incompatible)

## Overnight Parking Compliance (mig 483, PR 1 of 3)

Nightly job that asks, for every active vehicle at 20:00 SAST: is it where its
driver declared it parks?

| Piece | Where |
|-------|-------|
| Pure classifier | `src/modules/fleet/parking/classifyParkingCompliance.ts` |
| SQL | `src/modules/fleet/parking/parkingQueries.ts` |
| Orchestrator | `src/modules/fleet/parking/runParkingCheck.ts` |
| Shared types (pg-free) | `src/modules/fleet/parking/types.ts` |
| Endpoint | `pages/api/cron/fleet-parking-check.ts` (x-cron-secret) |
| Cron wrapper | `scripts/cron-fleet-parking-check.sh` |
| Tables | `fleet_vehicle_parking_locations`, `fleet_parking_compliance_checks` |

**Schedule.** `0 20 * * * /home/velo/fibreflow-<env>/scripts/cron-fleet-parking-check.sh`.
The endpoint is inert until that line is in velo's crontab, and an absent nightly
run raises no alert — check `fleet_parking_compliance_checks` has rows for
yesterday before assuming it is running.

**Backfill.** `scripts/cron-fleet-parking-check.sh 2026-08-04` re-runs a missed
night as of 20:00 SAST that day, from the position history already stored. The
endpoint rejects a malformed or future `?date=` rather than falling back to now.

### Rules
- **Results are evidence.** Every FK on `fleet_parking_compliance_checks` is
  `ON DELETE SET NULL`, and `vehicle_registration` is snapshotted onto the row,
  so a hard-deleted vehicle (`DELETE /api/fleet/vehicles?permanent=true`) leaves
  its violation history readable. Never make these CASCADE.
- **Alert on the transition, not on `inserted`.** `insertComplianceCheck`
  returns `previousResult` as well; the seam is
  `result === 'violation' && previousResult !== 'violation'` (`newViolation`).
  A re-run that upgrades `unknown` → `violation` is an UPDATE, so dedup keyed on
  `inserted` drops the only alert that mattered.
- **Precedence is deliberate:** `no_address` > `not_verifiable` > `unknown` >
  `compliant`/`violation`. A missing address is the driver's problem; a missing
  tracker is a hardware problem. They go to different people.
- **`unknown` is not `compliant`.** Absence of evidence is stored as its own
  result, never collapsed into a pass.
- Staleness ceiling is 72h (`STALE_FIX_MAX_HOURS`) so a weekend park still
  classifies normally.
- SQL is covered against a real Postgres by
  `tests/migrations/483_fleet_parking_queries.test.ts` — the unit tests mock the
  query layer out, so without that file the statements are never parsed.

## Ituran (Avis account) — portal behind a bot challenge

Covers KW96KRGP and KX82PLGP. Live since 2026-08-07; brings coverage to 15/23.

**Why this one is a script, not a provider in `/api/cron/poll-portal-tracking`.**
`www.ituran.com` is behind a Reblaze WAF that answers unrecognised clients with
**HTTP 247** and a JS puzzle. Clearing it needs a real browser, and the browser
is Playwright — a *devDependency*. Registering Ituran in `configuredProviders()`
would make the Next.js route bundle reach Playwright, so the mint lives in
`scripts/poll-ituran-tracking.ts`. Everything after the mint is shared: the
script builds the same `ConfiguredProvider` and calls the same `pollProvider()`,
so reconcile/ingest/watermark/alerting are identical across providers.

**The two credentials fail independently** (all verified against the live portal):

| Sent | Result |
|------|--------|
| `waap_id` cookie alone | 200, full data |
| `IWEB_LB` alone, or no cookies | 247 challenge |
| `waap_id` + bogus `PassEnc` | 200-family, `ErrorStr: "LoginError!"` |

So `waap_id` (WAF pass) and `PassEnc` (login token) are separate, and each maps
to a different repair. The ASP.NET `Iweb_SSID` cookie is **not** required and is
deliberately not sent. Session is minted fresh per run and never persisted — at
a 2-hourly cadence a ~5s mint is not worth caching, and nothing portal-shaped
ever lands in the database.

**Three mint traps, each of which cost an attempt:**
1. `channel: 'chromium'` is required — Playwright's default headless *shell* is
   detected and never clears the puzzle. The full build clears it in ~1.6s.
2. `userAgent` **must** be overridden. Even the full chromium channel still
   advertises `HeadlessChrome/...` in headless mode and the WAF refuses it. The
   failure is indistinguishable from "browser not installed". One shared
   `BROWSER_UA` constant is used by both the mint and the poller, because the
   WAF issues `waap_id` against the minting client's identity.
3. Submit must **click `#btnLogin`** — it is ASP.NET WebForms and Enter does not
   fire the postback. A wrong password does not throw; the portal re-serves the
   login page, so success is asserted positively (navigated away + holds a token).

**Timestamps — the payload carries one instant in three zones:**
```
Location_RowLocTime  "2026-08-07 10:26:54"  UTC          <- the only one used
LastGoodLocTimeStr   "07/08/2026 12:26:54"  SAST, display
DATEsortable         "2026-08-07 12:26:54"  SAST          <- the trap
DataTimeStamp        "2026-08-07 13:27:01"  Israel (UTC+3), envelope-level
```
`DATEsortable` looks ISO and sorts correctly, so it reads as the obvious choice —
it is local time with no zone marker, and using it files every fix 2h in the
future, poisoning the watermark.

**Always send `LastDataTimeStamp=not initialized`** (full snapshot). The app's own
later polls send a timestamp plus `OnlyDifferences` **and map bounds** — copying
that shape silently drops every vehicle outside the rectangle you happened to send.

Cron: `30 */2 * * *` via `scripts/cron-ituran-tracking.sh`, offset from the
Netstar poll. Env: `ITURAN_PORTAL_USER`, `ITURAN_PORTAL_PASS`, optional
`ITURAN_PORTAL_URL` / `ITURAN_ACCOUNT_REF` (default `avis`).

## Tracking auth circuit breaker — and how to clear it

Portal logins are rate-limited by the vendor. **Cartrack's `ct_login` locks the
account out after ~20 failed attempts**, which would cost us the data source
entirely — so a dead credential must not be retried every tick. `authBreaker.ts`
throttles it, keyed on `fleet_tracking_watermarks.consecutive_failures` and
`last_error`. It applies to **every** provider that runs through `pollProvider()`
— Netstar and the Cartrack portal via `configuredProviders()`, and Ituran via
`scripts/poll-ituran-tracking.ts`, which calls the same function.

| State | When | Behaviour |
|---|---|---|
| closed | < 3 consecutive auth failures | polls normally |
| open | ≥ 3, within 24h of the last attempt | tick skipped, still alerts |
| half-open | ≥ 3, 24h since the last attempt | **one probe allowed** — a working credential closes it automatically |
| hard-stop | ≥ 12 failures | probing stops; needs the SQL below |

Only failures whose `last_error` classifies as an auth failure
(`authFailure.ts`) throttle anything — a transient or gap streak also increments
the counter, and those can self-heal.

**Budget:** 3 to open, then ≤1 probe/day, stopping at 12 — about 12 vendor
attempts over nine days, leaving ~8 of Cartrack's 20 unspent. Unthrottled, a
2-hourly cron spends all 20 in under two days.

**Clearing a hard-stop** (fix the credential in the env file FIRST, or the next
probe just re-arms it):
```sql
UPDATE fleet_tracking_watermarks
SET consecutive_failures = 0, last_error = NULL
WHERE provider = 'cartrack' AND account_ref = 'urent';   -- adjust to the account
```

⚠️ Do NOT "simplify" the half-open state away. The skip returns *before* any
watermark write, so a breaker that only ever skips freezes
`consecutive_failures`, making its own predicate permanently true and blocking
the only code path that could produce the success needed to clear it. That is a
one-way latch requiring hand-editing the database — strictly worse than the
retry storm it replaces, because it fires after ~6 hours instead of ~40.

## Live tracking coverage — who is on which feed, and why the rest are dark

**18 of 23 active vehicles**, as at 2026-08-07. Four independent feeds, all writing
`fleet_vehicle_positions` through the same `pollProvider()` tick.

⚠️ **A feed only runs if its credentials are in the DEPLOYED env.** Merging a provider is not
the same as switching it on: `configuredProviders()` skips one whose vars are absent, silently
and by design, and the tick then reports a perfectly healthy `providersConfigured: 1`. Urent
shipped in #2392 but sat dark until `CARTRACK_PORTAL_ACCOUNT`/`_SUBUSER`/`_PASS` were added to
prod `.env.local` and the service restarted — Next.js reads that file at start, so a restart
is required, not just a deploy. **To check what is actually live, read
`providersConfigured` and the `results[]` accountRefs in
`/home/velo/logs/poll-portal-tracking.log` — not this table.**

| provider / account_ref | Vehicles | Transport | Cadence |
|---|---|---|---|
| `cartrack` / `velocity` | 7 | REST API, HTTP Basic | 2 min, **from dev** (:3005) |
| `netstar` / `europcar` | 6 | portal form login | 2 h, from prod (:3000) |
| `cartrack` / `urent` | 3 | fleetweb JSON-RPC | 2 h, same cron as Netstar (`configuredProviders()`) |
| `ituran` / `avis` | 2 | portal + WAF, browser mint | 2 h at :30, standalone script |

⚠️ Cartrack REST polls **from dev** and the portals **from prod**. One shared database, so
coverage is correct either way, but the credentials live in different `.env.local` files and a
dev deploy interrupts velocity's feed while prod deploys interrupt the other three.

### The rule that explains the gaps

**We do not fit trackers to vehicles we do not own.** Every feed above except
`cartrack/velocity` is a *rental or lease company's own* tracking, which we see only because
they gave us portal access. So an untracked vehicle usually means "a hire company we have no
login for", not "a bug".

### The 5 that cannot be synced (checked 2026-08-07)

| Vehicle | Ownership | Why dark | What would fix it |
|---|---|---|---|
| **KR27FNGP** Land Cruiser | **company** | **No Cartrack unit subscribed.** Our account carries 8 subscriptions — 5 Foton, 3 Suzuki EECO — and none is a Land Cruiser. Not a mapping fault; the device does not exist. | Commercial: add it to the Cartrack subscription. Discovery then maps it by plate on the next 2-min poll, no code change. **The only one of the five within our own control.** |
| HW50PDGP | rental | `docs/Fleet` lists it under Urent, but it is **not on that portal**. | Ask Urent which plate is current, then fix `docs/Fleet`. |
| MV49GBGP, NC60ZDGP | rental | Hire company unknown — not Europcar, Urent or Avis. | Identify the company; if it has a portal, adding a provider is now a well-trodden path. |
| CR69KTZN | **leased** | Our only leased vehicle. The lessor holds any tracker. | Ask the lessor for access. |

### Data corrections outstanding

- ⚠️ **`docs/Fleet`'s Urent list does not match the portal.** The doc lists HG16TDGP,
  HW50PDGP, HW50KNGP, JZ29GJGP, JZ29GCGP. The portal (captured live 2026-08-07) serves
  HG16TDGP, **HW50JYGP**, HW50KNGP, JZ29GCGP, JZ29GJGP. So:
  - **HW50PDGP** is in the doc but **not on the portal** — it is one of the 5 dark vehicles.
  - **HW50JYGP** is on the portal but **absent from the doc**, and is `retired` in
    `fleet_vehicles`.
  - **JZ29GCGP** is in both and is also `retired`.

  Five plates on the portal, only **3 map** to active fleet rows: HG16TDGP, HW50KNGP,
  JZ29GJGP. The mechanism is `reconcileTrackers` in `discovery.ts`, which matches only against
  `fleet_vehicles WHERE status = 'active'` — so a retired vehicle appears in
  `unknownOnPortal` even when its plate matches perfectly. That is why HW50JYGP
  (`439158881`) and JZ29GCGP (`214881212`) never map, and it is correct behaviour, not a
  matching failure: a retired vehicle should not acquire a live tracker. Worth asking Urent whether HW50PDGP and HW50JYGP are the same vehicle re-plated —
  that is a question for them, not an inference to record as fact.
- ⚠️ Our Cartrack account has an **8th subscription with no `vehicle_name`**. Source: the
  live REST call `GET /vehicles` on 2026-08-07 — these are Cartrack's OWN
  `registration` values, which are internal placeholders and do NOT appear anywhere in
  `fleet_vehicles`, so this cannot be checked from our database. That row's `registration` is
  `TEMP-2071192S1`; MW67LZGP's is `TEMP-2071192`, so the `S1` suffix suggests a second device
  on the same vehicle. Correctly left unmapped (the provider matches on `vehicle_name`, which
  is null here), but possibly a subscription being paid for and unused. **Verify against the
  Cartrack billing portal before acting** — the suffix is suggestive, not proof.

### Watch-item: the circuit-breaker numbers are Cartrack-calibrated

`AUTH_BREAKER_THRESHOLD` 3 / `AUTH_PROBE_COOLDOWN_MS` 24h / `AUTH_HARD_STOP` 12 are derived
from **Cartrack's observed ~20-attempt lockout**. Netstar's and Ituran's real lockout
behaviour is **undocumented** — those numbers became their default without being verified for
them. Better than the unbounded retries they had before, but it is an assumption: if either
starts throttling unexpectedly, check that tuning first. See the breaker section above.
