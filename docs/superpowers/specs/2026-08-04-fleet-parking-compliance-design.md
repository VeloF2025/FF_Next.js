# Fleet Overnight Parking Compliance — Design

**Date:** 2026-08-04
**Status:** Approved (design); implementation not started
**Scope:** Phase 1 — overnight parking only. Daytime project geofencing is explicitly deferred.

---

## 1. Problem

Velocity's vehicles go home with drivers at night. There is currently no record of
where any vehicle is *supposed* to be after hours, and therefore no way to tell
whether one is where it should be.

The requirement:

1. Drivers declare, in the `/my` PWA, where their assigned vehicle is parked overnight.
2. A driver may hold **one** address at a time. Changing it requires a manager's approval.
3. Every day at **20:00 SAST**, each vehicle is checked against its declared address.
4. Results are visible in the fleet module on the web side.

## 2. Decisions taken

| Question | Decision |
|---|---|
| Daytime project geofencing | **Deferred to Phase 2** — no source data exists (see §3) |
| Action on violation | Record **and** notify the fleet manager. No automatic contact to the driver. |
| Address capture | **On-site GPS capture**, reverse-geocoded for a human-readable label |
| Approver | **Anyone holding the approval-queue page permission** (see §9.1), not a named individual |
| Compliance radius | **200 m**, stored per location so exceptions can be widened |
| Schedule | **Every day**, including weekends |
| Vehicles without trackers | Register an address; results marked **not verifiable** |

## 3. Why Phase 2 is deferred

Daytime project geofencing was requested, but the data it depends on does not exist.
Verified against the live database on 2026-08-04:

| Source required | Actual |
|---|---|
| `fleet_authorized_locations` (geofences) | 0 rows |
| `projects` with latitude/longitude | 1 of 17 (11 active) |
| `fleet_vehicle_project_assignments` (active) | 0 |
| `staff.home_site_id` | 0 of 100 |
| `project_assignments` | 0 rows |
| `vehicle_assignments` (driver → vehicle, active) | **21** |

The driver-to-vehicle link is solid. Everything geographic is empty. Populating project
coordinates and vehicle-to-project assignments is a data exercise needing a business
owner, not an engineering task, and it must not block the overnight work.

Additionally, `/fleet/locations` — the geofence admin screen — has **zero `onClick`
handlers**, so no geofence can currently be created through the UI at all. The backend
CRUD in `pages/api/fleet/locations.ts` is complete and unreachable.

## 4. What already exists and is reused

- **`matchGeofence()`** (`src/modules/attendance/portal/geofenceUtils.ts`) — radius
  matching with tightest-fence-wins. Not called directly here (it is site-scoped), but
  it is the precedent for the distance logic.
- **`@/lib/geo`** — `haversineDistanceM()`, `isValidLatLon()`.
- **`GET /api/my/geocode`** — reverse geocoding via Nominatim behind a server-side proxy
  with a TTL cache and in-flight dedupe. Returns `{ geocode: … | null }` and never throws.
- **`/my` PWA tile system** (`src/modules/attendance/portal/client/tiles.tsx`) — the
  `<Tile>` primitive and the conditional-rendering pattern used by `VehicleTile`.
- **`findActiveVehicleAssignment(staffId)`** (`.../portal/clockUtils.ts`) — the
  authoritative driver → vehicle resolution.
- **Live tracking** — `fleet_vehicle_positions`, populated every 2 minutes by the
  `poll-tracking` cron for 7 Cartrack vehicles.
- **Notification bus** — `notify()` from `@/modules/notifications/services/notificationBus`,
  with typed events in `src/modules/notifications/constants/index.ts`.

**No forward geocoding exists** (address text → coordinates), and the on-site GPS
capture decision means none needs to be built.

## 5. Critical constraint — trackers sleep when parked

Cartrack devices transmit only while moving. A vehicle correctly parked at 17:30 stops
reporting, so at 20:00 its most recent fix is hours old.

Consequences that the design must honour:

- The check evaluates the **last known position as of 20:00**, not a live position, and
  **is not restricted to fixes from the check date**. A vehicle parked from Friday 17:00
  and checked on Sunday has its most recent fix two days earlier; that fix is still the
  best evidence of where it is.
- A stale fix is **evidence of being stationary**, not a fault. Staleness must never
  by itself produce a violation.
- A vehicle that produced **no fix at all** is `unknown`, not `violation`.

### 5.1 The staleness threshold

Using an arbitrarily old fix eventually becomes dishonest: a tracker that failed while
the vehicle was away would leave a stale fix that we would keep reporting as fact.

The rule: `STALE_FIX_MAX_HOURS`, **default 72**, held as a named constant. A fix older
than this yields `unknown` regardless of distance.

72 hours is chosen so that a vehicle parked across a standard weekend (Friday 17:00 to
Sunday 20:00 is ~51 hours) still classifies normally, while a tracker silent for longer
than a long weekend stops being treated as authoritative.

**Considered and rejected:** an asymmetric rule where a stale fix *inside* the radius
stays `compliant` while a stale fix *outside* becomes `unknown`. It is arguably more
accurate — a vehicle last seen at its own parking spot has very likely not moved — but
it biases every ambiguous case toward "compliant", which is the wrong default for a
compliance system, and it makes the classifier harder to reason about and to test.

This is the single parameter most likely to need tuning once real data accumulates. It
must be a named constant, not a literal buried in a query.

The existing live map already has a related symptom worth noting: `STALE_AFTER_SECONDS`
is 15 minutes in `pages/api/fleet/positions/live.ts`, so every parked vehicle greys out
and reads as "tracker offline". That is a separate pre-existing UX issue, not addressed here.

## 6. Schema — migration 483

Files go in `scripts/migrations/sql/`. The migration runner only scans that directory;
a file placed in a parent directory is silently ignored.

### 6.1 `fleet_vehicle_parking_locations`

Holds declaration, request, approval and history in one table.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `vehicle_id` | uuid → `fleet_vehicles(id)` | not null |
| `declared_by_staff_id` | uuid → `staff(id)` | not null |
| `lat`, `lon` | numeric(10,7) | not null |
| `accuracy_m` | numeric | GPS accuracy reported at capture |
| `radius_m` | integer | not null, default 200 |
| `label` | varchar(120) | driver's own name, e.g. "My yard" |
| `address_text` | text | reverse-geocoded; informational only |
| `status` | varchar(20) | `pending` \| `active` \| `superseded` \| `rejected` \| `withdrawn` |
| `request_note` | text | driver's reason for the change |
| `decision_note` | text | manager's note |
| `decided_by` | uuid → `staff(id)` | |
| `decided_at` | timestamptz | |
| `effective_from` | timestamptz | set when a row becomes `active` |
| `superseded_at` | timestamptz | set when replaced |
| `created_at`, `updated_at` | timestamptz | default `now()` |

Business rules enforced by partial unique indexes, not application code:

```sql
CREATE UNIQUE INDEX ux_parking_active_per_vehicle
  ON fleet_vehicle_parking_locations (vehicle_id) WHERE status = 'active';

CREATE UNIQUE INDEX ux_parking_pending_per_vehicle
  ON fleet_vehicle_parking_locations (vehicle_id) WHERE status = 'pending';
```

The first is "one address at a time". The second prevents a driver stacking multiple
open requests.

**Lifecycle.** A submission is inserted as `pending`. Approval, in a single transaction,
sets the previous `active` row to `superseded` (stamping `superseded_at`) and promotes
the pending row to `active` (stamping `effective_from` and `decided_by`/`decided_at`).
Rejection sets `rejected` with a `decision_note`. A driver may move their own `pending`
row to `withdrawn`.

### 6.2 `fleet_parking_compliance_checks`

One row per vehicle per night.

| Column | Type | Notes |
|---|---|---|
| `id` | uuid pk | |
| `vehicle_id` | uuid → `fleet_vehicles(id)` | not null |
| `check_date` | date | SAST calendar date |
| `evaluated_at` | timestamptz | when the job ran |
| `parking_location_id` | uuid → `fleet_vehicle_parking_locations(id)` | nullable |
| `last_fix_at` | timestamptz | nullable |
| `last_fix_lat`, `last_fix_lon` | numeric(10,7) | nullable |
| `last_fix_age_seconds` | integer | nullable |
| `distance_m` | integer | nullable |
| `result` | varchar(24) | see below |
| `created_at` | timestamptz | default `now()` |

```sql
CREATE UNIQUE INDEX ux_parking_check_per_vehicle_day
  ON fleet_parking_compliance_checks (vehicle_id, check_date);
```

### 6.3 Result states

| Result | Meaning | Who acts |
|---|---|---|
| `compliant` | Last known fix within `radius_m` | nobody |
| `violation` | Last known fix outside the radius | fleet manager (notified) |
| `unknown` | Has an active tracker, but no fix at all or the newest fix is older than `STALE_FIX_MAX_HOURS` (§5.1) | whoever owns tracker health |
| `not_verifiable` | Vehicle has no tracker mapping | procurement / commercial |
| `no_address` | No active declared address | the driver |

These are deliberately not collapsed. `no_address` is a driver-compliance gap, `unknown`
is a hardware gap and `not_verifiable` is a commercial gap; merging them would hide which
of three different people needs to do something.

## 7. The nightly job

**Endpoint:** `pages/api/cron/fleet-parking-check.ts`
**Auth:** `x-cron-secret` header, matching the convention in `pages/api/cron/poll-tracking.ts`.
**Schedule:** `0 20 * * *` in **velo's crontab**, not `vercel.json` — Vercel crons do not
fire for this systemd-hosted app. The server timezone is `Africa/Johannesburg (SAST, +0200)`,
verified 2026-08-04, so no timezone arithmetic is required.

The crontab entry reads `CRON_SECRET` from the environment file rather than embedding it,
following the `poll-tracking` entry.

**Algorithm**, per vehicle where `fleet_vehicles.status = 'active'`:

1. Resolve the `active` row in `fleet_vehicle_parking_locations`. None → `no_address`, stop.
2. Resolve tracker mapping in `fleet_vehicle_trackers`. None → `not_verifiable`, stop.
3. Find the most recent `fleet_vehicle_positions` row at or before the 20:00 instant,
   **with no restriction on the fix's own date**. None at all → `unknown`, stop.
4. If the fix is older than `STALE_FIX_MAX_HOURS` (§5.1) → `unknown`, stop. Record
   `last_fix_at` and `last_fix_age_seconds` regardless, so the dashboard can show *why*
   it was unknown rather than just asserting it.
5. `haversineDistanceM(fix, location)`. Within `radius_m` → `compliant`, else `violation`.
6. Insert with `ON CONFLICT (vehicle_id, check_date) DO NOTHING`.

Per-vehicle evaluation is independent: one malformed row must not abort the run.

**Notifications: `violation` only.** `no_address` and `unknown` appear on the dashboard
but stay silent. Nightly nagging about an unregistered vehicle would train recipients to
ignore the channel.

## 8. PWA — driver side

A **"Vehicle parking"** tile on the `/my` hub, rendered under the same condition as the
existing `VehicleTile` (staff has an active vehicle assignment).

**Page:** `/my/vehicle/parking`

States:
- **No address** → "Register where `<REG>` is parked overnight" + capture flow
- **Active** → current label, geocoded address, approved date, "Request a change"
- **Pending** → read-only view of the request, with a withdraw action
- **Rejected** → the manager's `decision_note`, and the option to submit a new request

**Capture flow:** `navigator.geolocation` → display coordinates and accuracy →
call `/api/my/geocode` for a label → optional label and note → submit.

**Accuracy gate:** reject a capture with accuracy worse than 100 m and ask the driver to
move into the open and retry. Storing a fix with 500 m of error guarantees false
violations for the life of that address.

**Offline:** not supported in v1. The portal has an offline queue, but a parking
registration is not time-critical in the way a clock-in is.

### 8.1 APIs

Both wrapped in `withMySession`.

- `GET /api/my/vehicle/parking` — active row, pending row, recent history for the
  caller's own vehicle.
- `POST /api/my/vehicle/parking` — submit a declaration or change request.
  Body: `{ lat, lon, accuracyM, label?, requestNote? }`.

**The vehicle is resolved server-side** via `findActiveVehicleAssignment(session.staffId)`.
A `vehicleId` supplied in the request body is ignored. This mirrors the portal-auth
hardening of 2026-07-30 (`canAccessPortalVehicle`), which closed exactly this class of hole.

## 9. Web — fleet module

**Approval queue** — pending requests with vehicle, driver, current versus requested
location, the distance between the two, and the driver's note. Approve or reject with a
note.

### 9.1 Authorization

Authorization in this codebase is **page/route based**, not role-capability based. The
`access_permissions` table holds rows of `type IN ('module','page','tab')` with keys like
`fleet.locations` and a `route`. There is **no** "fleet manager" capability to gate on —
an earlier draft of this document assumed one incorrectly.

Migration 483 therefore also seeds two `access_permissions` rows, following the existing
pattern:

| type | key | label | route |
|---|---|---|---|
| `page` | `fleet.parking` | Parking Compliance | `/fleet/parking` |
| `page` | `fleet.parking-requests` | Parking Requests | `/fleet/parking/requests` |

"Approver" therefore means *anyone granted `fleet.parking-requests`*, assigned through
the existing role/permission administration rather than through anything new.

Unrelated observation, recorded but out of scope: `/fleet/map` has **no** row in
`access_permissions`, unlike every other fleet page.

**Compliance dashboard** — last night's result per vehicle across the five states;
history filterable by date range and result; drill-in showing the fix that decided the
outcome (timestamp, coordinates, distance, age). The evidence matters the first time a
driver disputes a violation.

**Navigation.** Both screens sit under the existing **Operations** tab in
`src/components/fleet/fleetNavConfig.ts`. This requires updating `getActiveTabId()` and
`src/components/fleet/__tests__/fleetNavConfig.test.ts`.

## 10. Notifications

This is the fleet module's **first** use of `notify()`. The module has never called the
notification bus, so this is an integration risk rather than a wiring change.

New event types in `src/modules/notifications/constants/index.ts`, each needing entries
in all five maps (routing, icon, severity, label, category):

| Event | Recipient | Channels |
|---|---|---|
| `fleet.parking_violation` | fleet manager | in-app, email |
| `fleet.parking_change_requested` | fleet manager | in-app, email |
| `fleet.parking_change_decided` | the requesting driver | in-app |

The third is a deliberate exception to "no automatic contact with drivers": that rule
was set for violations. Someone who submits a request must learn its outcome or the
workflow stalls.

## 11. Error handling

| Condition | Behaviour |
|---|---|
| GPS denied or unavailable | Explicit guidance, never a silent failure |
| Reverse geocode fails | Store coordinates; label falls back to "Unnamed location" |
| One vehicle errors in the nightly run | Logged; other vehicles still evaluated |
| No position data | `unknown` — never a violation |
| Cron fires twice | Unique index makes the second run a no-op |
| Driver changed since request | Re-validate the vehicle assignment at approval time |

No empty catch blocks. All logging via `log` from `@/lib/logger`.

## 12. Testing

**Pure function first.** `classifyParkingCompliance(lastFix, location, checkAt)` returns
one of the five states and lives outside the route handler, so it is testable without
infrastructure. This mirrors `src/modules/fleet/utils/liveMapHelpers.ts`, which was
extracted from `FleetMap` for the same reason.

Coverage:
- All five result states
- Distance boundaries: exactly at `radius_m`, one metre outside, zero distance
- Null and invalid coordinates on either side
- A fix from a *previous day* but within `STALE_FIX_MAX_HOURS` classified on distance,
  not as `unknown` — the weekend-parking case
- Staleness boundaries: exactly at `STALE_FIX_MAX_HOURS`, and one second beyond it
- A stale fix **inside** the radius still yields `unknown`, confirming the rejected
  asymmetric rule (§5.1) has not crept back in
- Idempotency: run the job twice, assert one row per vehicle per date
- Lifecycle: approving a request supersedes exactly one previous row
- Both partial unique indexes reject a second `active` and a second `pending` row
- API auth: a body-supplied `vehicleId` cannot override the session's vehicle

**Browser verification is required and currently blocked.** The PWA capture flow and
the approval queue must be checked on dev by someone with browser automation available;
it cannot be done from the current workstation (no browser extension, and no `.env.local`
for a local server).

## 13. Out of scope

- **Daytime project geofencing** (Phase 2). The design generalises: a daytime check is
  the same `classifyParkingCompliance` computation against a different geofence over a
  different time window, so Phase 2 is largely data plus a second cron entry.
- Fixing the dead `/fleet/locations` geofence admin screen.
- The parked-reads-as-stale behaviour on the live map.
- Retention policy for `fleet_vehicle_positions` (67 MB per 19 days, no policy today).
  Worth noting: compliance evidence is stored in `fleet_parking_compliance_checks`
  precisely so it survives any future pruning of raw positions.

## 14. Open questions

All seven design decisions in §2 were confirmed before this document was written. Two
items were resolved during spec review rather than by the requester, and are flagged
here so they can be overridden:

1. **`STALE_FIX_MAX_HOURS = 72`** (§5.1). Chosen so weekend-parked vehicles classify
   normally. Expect to tune this after a month of real data.
2. **Notifying a driver of their own request's outcome** (§10). A deliberate exception
   to "no automatic contact with drivers", which was set in the context of violations.
