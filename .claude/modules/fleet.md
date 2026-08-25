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

## Operational Status Engine (migration 498, PR 4)

Operational status is an explainable, read-time classification of a roster member's assignment,
Attendance evidence, assigned-vehicle GPS, schedule, and required-site geometry. It is not stored
as a snapshot and does not create incidents, notifications, payroll outcomes, disciplinary records,
or driver scores. The implementation lives in `src/modules/fleet/operations/`; protected APIs are
under `/api/fleet/operations`, and the compact rule editor remains inside the Assignments workspace.

Migration `498_fleet_operational_status_rules.sql` adds `fleet_operational_status_rules` plus
`fleet.operations-status` and `fleet.operations-rules` permissions. Rule intervals are half-open
`[effective_from, effective_to)`, cannot overlap, and have exactly one open version. A change locks
and closes the current interval before inserting the next version in the same transaction; threshold
values in history are never overwritten. Activation instants use strict ISO calendar/clock/offset validation at
both the API and repository boundaries. The initial SAST rule is 60 minutes before/after the shift,
5-minute arrival and wrong-site confirmation, 10-minute departure confirmation, 10 km approaching
distance, two approaching readings, 5 km/h minimum motion, and 250 m mismatch tolerance.

### Status vocabulary and precedence

Every evidence package produces one primary status plus zero or more flags and a reason code.

| Status | Meaning |
|---|---|
| `off_duty` | Unscheduled without explicit work, or outside the monitoring window. |
| `scheduled_not_due` | Scheduled, but still before start or inside grace without confirmed arrival. |
| `unassigned` | No required operational site can be resolved. |
| `unverifiable` | Schedule/rule/source/geometry is unusable, assignment is ambiguous, or expected vehicle evidence is unavailable. |
| `late` | Arrival remains unconfirmed after grace. |
| `approaching` | Fresh vehicle fixes show the configured decreasing-distance moving trend. |
| `attendance_confirmed` | Attendance clock-in is inside the required site; vehicle confirmation is absent. |
| `vehicle_on_site_driver_unconfirmed` | Vehicle dwell is confirmed inside, but GPS alone cannot prove driver presence. |
| `on_site_dual` | Attendance and vehicle dwell both confirm the required site. |
| `wrong_site` | Attendance or continuous vehicle evidence confirms a different known site. |
| `evidence_mismatch` | Attendance and vehicle identify different sites and exceed mismatch tolerance. |
| `left_early` | Clock-out or confirmed departure occurs before scheduled end. |
| `shift_complete` | Clock-out is at/after scheduled end, or confirmed post-shift vehicle departure follows confirmed arrival. |

Decision precedence is: schedule/source/assignment/geometry gates, then cross-source mismatch and
wrong-site confirmation, then departure/completion, then arrival/approach/due/late. Supporting flags
retain material context: GPS stale/missing, Attendance missing, no vehicle, ambiguous assignment,
low-confidence geometry, outside-window evaluation, pending dwell/wrong-site/departure, vehicle-only
presence, and source errors. One malformed person's mapped evidence becomes that person's
`unverifiable`; a top-level batch-load failure remains an error and is never an empty success.

### Evidence and time rules

| Evidence | Confirmed result | Guardrail |
|---|---|---|
| Attendance only | Inside clock-in confirms `attendance_confirmed`; a sustained known wrong-site clock-in can confirm `wrong_site`. | Missing/invalid coordinates never become presence. A closed entry proceeds to departure/completion. |
| Vehicle only | Continuous inside dwell can produce `vehicle_on_site_driver_unconfirmed`; trend can produce `approaching`; continuous known-site outside evidence can produce `wrong_site`. | Always carries `vehicle_driver_presence_unconfirmed` when vehicle location is used as presence; a lone/stale/future/invalid fix cannot confirm continuity. |
| Attendance + vehicle | Agreement produces `on_site_dual`; distinct known sites beyond tolerance produce `evidence_mismatch`. | Vehicle GPS never overrides or impersonates the driver's Attendance evidence. |
| Neither / broken source | Before due: `scheduled_not_due`; after grace: `late`; an expected but unavailable vehicle feed: `unverifiable`. | Absence of evidence is not success. |

The effective rule and attendance schedule create `monitoringStart -> scheduledStart -> graceEnd ->
scheduledEnd -> monitoringEnd` in `Africa/Johannesburg`. Evaluation outside that bounded window is
`off_duty`; GPS history is loaded only from the earliest monitoring/confirmation lookback through
the earlier of the requested `asOf` and monitoring end. Roster history is limited to 31 days. Tracker freshness is not redefined here:
the batch loader calls the shared `staleAfterSecondsFor(provider, account)` once per distinct feed,
preserving the fast Cartrack REST versus slower portal-account thresholds.

Polygon containment uses PostGIS `ST_Covers`, so boundary points count as inside; distances use
geography casts and metres. Authorized-location circles use their configured radius. Low-confidence
AOIs remain usable but flagged. Arrival, wrong-site, and departure require continuous fresh sequences;
departure additionally requires a prior confirmed inside sequence.

### Privacy, APIs, and scope

- `GET /api/fleet/operations/status` returns coordinate-free roster summaries only.
- `GET /api/fleet/operations/status/[staffId]` returns only decision-relevant points inside the
  privacy window; an outside-window decision returns no coordinates and the full GPS history is never returned.
- `GET/POST /api/fleet/operations/rules` lists history or creates a new version; the audit actor is
  always the authenticated session user, never a request-body value.
- Status roster and detail reads require `fleet.operations-status:view`; rule-history GET requires
  `fleet.operations-rules:view`. A project manager is limited to their own active project.
  Cross-project access requires admin/super-admin or an active explicit user grant. Generic manager
  role alone is insufficient. Home-site/unassigned detail has no project and therefore requires
  oversight. Rule POST additionally requires `fleet.operations-rules:edit` and oversight.

PR 4 stops at calculation, protected APIs, rule history, and the compact Assignments rule dialog.
PR 5 owns operational dashboard/map presentation. PR 6 owns incidents and notifications. PR 7 owns
driver-facing confirmation/input, while PR 8 owns analytics and retention. Do not pull dashboards,
maps, alerts, persisted status snapshots, payroll/discipline effects, driver input, or analytics
backward into this engine.

## Operational Dashboard and Map (PR 5)

PR 5 presents the PR 4 read-time decisions without recalculating, persisting, or escalating them.
The existing `/fleet` Dashboard keeps its vehicle cards, investigations, and quick actions, and adds
**Today’s Operations** after the stat cards. Its coordinate-free
`GET /api/fleet/operations/overview` accepts scoped `projectId`, ISO `workDate`/`asOf`, optional
status group/status, and bounded pagination; it returns grouped counts, attention rows, evaluation
and rule metadata, pagination, and stale/source warnings. URL filters are the source of truth so
Dashboard count controls, Map content, refresh, and browser back/forward remain synchronized.

Only `on_site_dual` and `attendance_confirmed` count as **On site**. In particular,
`vehicle_on_site_driver_unconfirmed` is **Unverifiable** and labelled
`Vehicle on site — driver unconfirmed`: vehicle GPS is never presented as confirmed driver presence.
Default Needs Attention contains `late`, `wrong_site`, `evidence_mismatch`, `left_early`,
`unassigned`, `unverifiable`, and `vehicle_on_site_driver_unconfirmed`; normal states are available
through explicit filters. Operational loading/error state is independent: a failure preserves the
existing Dashboard/Map and last successful operational data with an explicit stale/error warning;
it is never rendered as all clear.

`GET /api/fleet/operations/map-overlay` requires ISO `workDate` and `asOf`, bounded pagination,
and at least one narrow UUID selection (`projectId`, `staffId`, or `siteId`); it adds optional
`staffId`, `siteId`, and scoped `includeGeometry`. It returns authorized operational badge rows, minimum authorized Attendance-only
points, selected required-site geometry, evidence/status timestamps, unplottable rows, and
evaluation metadata; it never returns raw provider payloads, unrelated geometry, contact details,
or out-of-scope evidence. PMs remain limited to owned projects, while authorized
oversight/admin access can span its permitted projects. `/api/fleet/positions/live` remains the
separate existing telemetry source.

The live Map’s marker grammar remains authoritative: marker fill is movement state and the white
ring is GPS freshness/contact. PR 5 adds a small attached operational badge only: green check
(on site), blue arrow (approaching), amber clock (late), red displaced pin (wrong site), purple
split/evidence mark (mismatch), grey question (unverifiable), hollow person/check (vehicle on
site, driver unconfirmed), orange exit (left early), or grey broken assignment (unassigned). A
badge never replaces fill or ring, and existing popup provider/speed/ignition/last-fix evidence
remains.

Attendance-only markers use only a minimum authorized captured Attendance coordinate and must say
`Attendance check-in evidence — not live tracking`; they are not animated or described as current
location. Staff without permissible/usable coordinates remain separately labelled in the attention
panel and are never fabricated at a project site, AOI centroid, home site, or vehicle position.
AOI polygons and Authorized Location circles load only for a selected project/site/staff or an
inspected attention row; all-project unfiltered mode never draws every geometry. Low-confidence
AOIs retain a warning style without being declared invalid.

Dashboard and Map current-date operational data may refresh no faster than every 30 seconds and
both support manual refresh. Telemetry and the operational overlay refresh independently, retain
their own last successful state on failure, and cancel updates on unmount/filter change. A selected
historical date disables automatic refresh and shows `Historical view` with its evaluation `asOf`.
Desktop attention is collapsible; mobile uses an accessible bottom sheet. Status needs icon/label
accessibility rather than color alone.

PR 5 has no migration. Roll back presentation with a normal PR revert: PR 4 APIs/rules remain
valid and no database/data rollback is required.

### Known limitations (PR 5)

Oversight users cannot yet select **All Projects**. `GET /api/fleet/operations/overview` requires a
`projectId`, and PR 4's `RosterStatusRequest.projectId` is a mandatory string. Project-manager scope
works correctly. This was deferred deliberately rather than change merged PR 4 service contracts
mid-stack; a follow-up PR must make the roster query optional-project and gate it to oversight roles.

Large selections do the per-staff evidence work twice. `getOperationalMapOverlay` pages the roster
and the evidence loader concurrently, but `getOperationalRosterStatus` already loads evidence per
page, so the geospatial/attendance joins in `evidenceQueries.ts` run twice per staff member. It is
bounded by `MAX_COMPLETE_ROSTER_ROWS` (2000; beyond that both endpoints return 400, never a 500 and
never a silent truncation) and it is correct, but a project near that bound is measurably slower
than a single-page selection. Worth collapsing to one evidence pass in a follow-up.

## Operational Incidents (migration 510, PR 6)

PR 6 turns four of PR 4's read-time statuses into durable, reviewable incidents and
adds a separate escalation/summary/health cron. Implementation lives in
`src/modules/fleet/incidents/`; protected APIs are under `/api/fleet/incidents`; the
manager queue is `/fleet/incidents` (Operations → Incidents, not a new dashboard).

**Migration execution and scheduler installation are deployment actions requiring
separate approval — neither has happened yet.** Merging this code does not create a
table, register a cron entry, or send a notification. **PR 6 requires no driver
action**: only managers/oversight record a reason, comment, or evidence.

### Incident types and lifecycle

Fourteen `incident_type` values fall into three groups, enforced by a CHECK
constraint on both `fleet_operational_incident_rules` and
`fleet_operational_incidents`:

| Group | Types | How they're produced |
|---|---|---|
| Scheduled (auto-detected) | `late`, `wrong_site`, `evidence_mismatch`, `left_early` | Every 5-minute monitor tick, straight off the PR 4 roster/status output. |
| Summary-only | `unassigned`, `unverifiable`, `vehicle_on_site_driver_unconfirmed`, `evidence_gap` | Never open an incident. Counted into the 08:15 SAST summary only when the type's rule has `includeInMorningSummary`. |
| Source-event (safety/telematics) | `accident_sos`, `dangerous_area_entry`, `theft_after_hours_movement`, `severe_driving`, `prolonged_unauthorized_stop`, `lost_contact_moving` | Require an explicit typed `IncidentSourceEvent` with a stable `sourceEventId` — **PR 6 ships no producer that calls these**; a future telematics/H&S integration calls `produceIncident({ producerKind: 'source_event', ... })`. |

`resolveScheduledIncidentType` (`incidentProducer.ts`) is the single source of truth
for the scheduled mapping — every other PR 4 status (`off_duty`, `approaching`,
`on_site_dual`, etc.) maps to `null` and never opens or feeds anything.

Lifecycle is `open -> acknowledged -> under_review -> resolved|dismissed`, enforced
both by a `lifecycle_status`+detail-columns CHECK constraint (each status requires
exactly its own actor/timestamp columns, no more, no less) and by
`reviewTransitions.ts` locking the row `FOR UPDATE` inside every transition. A
transition on an already-terminal incident is a 409, first-acknowledgement wins
(later acknowledgements are idempotent no-ops), and `resolved`/`dismissed` each
require a note plus an outcome drawn from their own fixed set (`resolved`:
`confirmed`/`valid_reason`/`assignment_error`/`geofence_error`/`no_action_required`;
`dismissed`: `false_positive`/`data_gap`/`duplicate`) — a further CHECK constraint
enforces that pairing at the database level, not just in application code. A
`duplicate` outcome requires a `linkedIncidentReference` resolving to a different,
existing incident. A rule can additionally require evidence for specific outcomes
(`evidence_required_outcomes`); the terminal transition 400s without at least one
`fleet_operational_incident_evidence` row when the chosen outcome is in that list —
acknowledgement is never blocked by this, only the terminal step.

Observations and actions are append-only (the migration only grants
`fibreflow_user` `SELECT, INSERT` on both tables, never `UPDATE`/`DELETE`).
Recurrence works after a terminal close: the "one active incident" uniqueness index
(`ux_fleet_operational_incidents_active_assignment`) is a **partial** index scoped
to `lifecycle_status IN ('open','acknowledged','under_review')`, so a new detection
for the same staff/type/day/assignment after a resolved-or-dismissed row opens a
fresh incident rather than colliding with history.

### Condition clearing — deliberately narrow

`evaluateConditionClearing` only ever sets `condition_cleared_at` on a still-open
incident — it never resolves or dismisses one, and is a safe no-op when there's no
matching active incident. The monitor (`monitorService.ts`) calls it for every
staff row whose *current* tick does **not** map to one of the four scheduled types,
but only actually clears when **both**:

- the current status is `attendance_confirmed` or `on_site_dual` — the only two PR 4
  statuses that *positively confirm* evidence, as opposed to merely not (yet)
  flagging a problem (`off_duty`, `approaching`, `scheduled_not_due` say nothing
  positive and never clear); **and**
- the evaluation carries zero flags of any kind — stale/missing GPS, missing
  attendance, low-confidence geometry, a pending confirmation, etc. all block
  clearing.

Stale, missing, or ambiguous evidence therefore never clears an incident — absence
of a problem signal is not proof the problem is gone. Recurrence before closure
(the condition reappears before a human closes the incident) removes
`condition_cleared_at` again without opening a second incident, via the same
"touch last-seen" path a repeated detection already takes.

`ScheduledIncidentProducerRequest` has no dedicated monitor-run field.
`RecordObservationInput.monitorRunId` is deliberately left `null` for scheduled
detections; run traceability instead flows through `requestCorrelationId`, which
`incidentProducer` stores on the `opened`/`condition_cleared` actions — the monitor
run ID is threaded in as that correlation ID rather than widening the Task 3
contract.

### Cron wrappers, auth, and health

Two independent cron endpoints, both behind `pages/api/cron/...` and a matching
`scripts/cron-fleet-*.sh` wrapper:

| Endpoint | Cadence | Does |
|---|---|---|
| `/api/cron/fleet-operational-monitor` | every 5 min | Loads every active project's complete PR 4 roster (one roster-loading *phase*; any one project's load failing fails the whole phase — never a silent partial), runs `incidentProducer` per staff row, sends `opened` notifications after each incident transaction commits. |
| `/api/cron/fleet-incident-actions` | at least every 5 min | **Four** independent phases in one tick: escalation (always), 08:15 SAST roster morning summary (at most once per SAST work date, skipped entirely before 08:15), 08:15 SAST **vehicle** summary (same gate, guarded by a claim rather than a run row — see Health below), status-monitor health check (always). One phase's failure never blocks or hides another's. |

**Auth is `x-cron-secret: <CRON_SECRET>`** — matching this Fleet module's own
existing convention (`fleet-parking-check.ts`, `fleet-check-reminders.ts`), fail-
closed when unset. `Authorization: Bearer <CRON_SECRET>` is used by some other,
unrelated cron endpoints in the repo (`appeals-vlm.ts`, `auto-qa.ts`,
`backfill-onemap-data.ts`), but a header-check count found `x-cron-secret` more
common overall — and either way, one module should not mix both conventions.
Both endpoints deliberately do **not** also accept `Authorization: Bearer` —
supporting two undocumented secret paths on one endpoint is exactly what this
repo's secret-handling rules forbid.

Both endpoints run their work inside `runWithCronLock` (`cronLock.ts`), which
mirrors `appeals-vlm.ts`'s pinned-connection discipline: `pool.connect()`,
`pg_try_advisory_lock(hashtext($1))` on that one connection, run the work, then
`pg_advisory_unlock`. If the unlock query itself fails, the connection is destroyed
via `client.release(true)` rather than returned to the pool — handing back a
connection that still thinks it holds the lock would leak that lock for the pool's
lifetime. Lock names are distinct per endpoint: `fleet-operational-monitor` and
`fleet-incident-actions`.

**Health.** `fleet_operational_monitor_runs` records `running` → `succeeded` /
`partial_failure` / `failed` for each of the three run kinds
(`status_monitor`/`escalation`/`morning_summary`).

**The vehicle summary phase (`vehicleSummaryPhase.ts`) deliberately has NO run
row.** `fleet_operational_monitor_runs_kind_check` admits only those three
kinds, and a fourth would need a migration purely for bookkeeping. Its
once-per-SAST-day guard is instead the Fleet Alerts group post's own
notification claim (`fleet-vehicle-morning-summary:<workDate>`), so exactly one
post reaches the group per day. The consequence to know before debugging it: its
counting query and per-recipient fan-out re-run on **every** tick after 08:15 —
harmless, because each notification is suppressed by its own idempotency key —
and its outcome appears only in `IncidentActionRunnerResult.vehicleSummary` and
the log, never in the runs table. Do not go looking for a
`vehicle_morning_summary` row; there isn't one. The incident-actions tick checks
the *other* cron's health: a `status_monitor` run stuck `running` for more than 15
minutes (3× the 5-minute cadence — absorbs one missed tick, still catches a real
outage promptly) is converted to `failed` and alerted; if nothing is stale, a
`status_monitor` run that hasn't started at all recently is also alerted.
**This can only work because the incident-actions cron is itself still running.**
If the entire external scheduler or host stops and *neither* endpoint executes,
nothing inside either one can observe that — an outage of that kind requires
external host/scheduler monitoring, not application code.

### Recipients, notifications, and escalation

`recipientService.resolveIncidentRecipients(projectId)` is the **one** recipient
path for every PR 6 notification: the active project manager
(`projects.project_manager`, which may hold either a `users.id` or a `staff.id`,
so it is resolved through both) plus active Fleet oversight members
(`fleet_operational_oversight_members`, effective-dated, one active row per user),
deduplicated and filtered to `users.is_active = true`. A projectless incident (or a
project-agnostic notification such as monitor-health) goes to oversight only. An
empty result is not thrown — it's returned as `{ failed: true }`, which every
caller records as a notification failure without rolling back the incident.

Five notification events, registered in `src/modules/notifications/constants/index.ts`:
`fleet.operational_incident_opened`, `_escalated`, `_resolved`,
`fleet.operational_morning_summary`, and `fleet.operational_monitor_failed`.
`fleet.incidents` and `fleet.incidents-settings` are RBAC permissions, not events —
do not count them here. Idempotency
keys are exact strings, not implementation detail: `fleet-incident-opened:<id>`,
`fleet-incident-escalated:<id>:<level>`, `fleet-incident-resolved:<id>:<outcome>`,
`fleet-morning-summary:<userId>:<projectId|unassigned>:<workDate>`,
`fleet-monitor-failed:<runKind>:<runId|missing>`,
`fleet-vehicle-morning-summary:<userId>:<workDate>` (per-recipient) and
`fleet-vehicle-morning-summary:<workDate>` (the group post's claim).

The vehicle summary reuses the registered `fleet.operational_morning_summary`
event but **must never** reuse `buildMorningSummaryIdempotencyKey`: that builder
renders a null project as the literal `unassigned`, which the roster summary
already emits for its own projectless bucket, so a shared namespace would give
both digests the same key per recipient per day and `claimNotification` would
silently drop whichever ran second. Vehicle incidents are projectless by
construction, so this is not a hypothetical collision.

**Mandatory WhatsApp for critical explicit-source incidents.** `notify()` resolves
channels from `DEFAULT_CHANNEL_PREFERENCES` plus a per-user override and has no
per-call channel override, and `fleet.operational_incident_opened` defaults to
`whatsapp: false` so routine/scheduled incidents never gain WhatsApp by accident.
So for the one case that must always get WhatsApp — `severity === 'critical' &&
producerKind === 'source_event'` — `incidentNotifications.ts` places a direct,
best-effort `deliverWhatsApp` call to every resolved recipient **in addition to**
the normal `notify()` call. A WhatsApp failure there is counted in the returned
`NotifyResult.failed` and never thrown; it cannot block the in-app/email delivery.

Escalation (`actionRunner.ts`) is a row-locked, atomic level increment: due
incidents are every `open` incident whose configured `acknowledgementTargetMinutes`
(first check) or `reminderIntervalMinutes` (later checks) has elapsed, below the
rule's `maximumEscalationLevel`. Seeded defaults: 15 minutes for the four scheduled
types, 5 minutes for the six critical source-event types, 15-minute reminders, max
level 3. Acknowledging an incident stops reminders by construction — escalation
only ever fires on `lifecycle_status = 'open'` rows, and acknowledgement moves the
row off `open` in its own transaction.

### VF Storage evidence

`uploadCategorizedFile` (`src/lib/vfStorageUpload.ts`) is a new, stricter,
category-aware sibling to the existing `uploadToVfStorage` — SiteCam's function and
behaviour are untouched; Fleet incident evidence uses only the new one. Fleet
storage keys are `<incidentId>-<randomUUID()>.<ext>` — **never any component of the
caller's filename or path** (`evidenceService.buildStorageFilename`); the display
filename is sanitized separately via `safeFilename` and only ever affects the
`original_filename` column, never the storage key.

`uploadCategorizedFile` validates MIME (`image/jpeg`, `image/png`,
`application/pdf`), size (15 MB, `MAX_EVIDENCE_BYTES`), and base64 shape **before**
any network call, and rejects a returned URL that isn't an approved VF Storage
origin (`isAllowedPhotoUrl`) via `VfStorageOriginError`. The upload only happens
**after** `evidenceService.addIncidentEvidence` has resolved scope, loaded and
scope-checked the incident, and confirmed it isn't `resolved`/`dismissed`. If the
database insert then fails — evidence row plus `evidence_added` action, one
transaction — the file is already sitting in VF Storage with nothing pointing at
it: this is logged as a structured orphan-storage reference (incident ID, storage
key/URL, MIME — never file content) via `IncidentEvidenceOrphanError`, for manual
reconciliation. **No delete path exists anywhere in this module** — evidence is
append-only both in the service and at the database grant level (`GRANT SELECT,
INSERT` only on `fleet_operational_incident_evidence`); a photo/upload failure can
never block acknowledgement or emergency notification delivery, because this
service never touches lifecycle columns or calls `incidentNotifications`.

### Review APIs and scope

`fleet.incidents` (view/edit) gates the review queue; `fleet.incidents-settings`
(view/edit) separately gates rule/oversight-membership management —
`reviewScope.ts` calls `operations/projectScope.ts`'s `hasOperationalOversight`
directly against these two keys (it is parameterized on permission key and
action, already called with a non-default key at
`pages/api/fleet/operations/rules.ts`), rather than duplicating its "base
permission AND (admin role OR an active per-user override grant)" idiom.
Migration 510 grants base `fleet.incidents` to `manager`/`project_manager` —
NOT `fleet.incidents-settings`, which is `admin`/`super_admin` only. So a
plain `manager` role never gains cross-project or projectless `fleet.incidents`
reach without an explicit `admin`/`super_admin` role or an active override
grant. A projectless incident always requires that unrestricted scope — a PM
never sees it. Bulk-acknowledge validates every requested incident (exists,
not already terminal, in scope) before mutating any; each acknowledgement then
still runs as its own row-locked transaction, and a per-item `terminal_conflict`
race (another manager resolved it in between) aborts the batch rather than
being reported as a silent success.

### Rule and oversight configuration

`fleet_operational_incident_rules` versions are effective-dated and non-overlapping
(a `gist` EXCLUDE constraint plus a partial unique index enforcing exactly one open
version per `incident_type`); `versionIncidentRule` locks the current stream,
closes it at the new effective timestamp, and inserts `version + 1` in one
transaction — never overwrites history. **One documented exception:** migration
529 re-versions the four non-emergency telematics rules (`severe_driving`,
`prolonged_unauthorized_stop`, `lost_contact_moving`, `dangerous_area_entry`)
from `critical` to `high` **in place**, with no close and no insert. It is
allowed to because those rules have never judged anything — nothing calls the
telematics detectors before PR4 — and a guard at the head of the file `RAISE`s
if any `fleet_operational_incidents` row carries one of those four types, so the
claim is proved at apply time rather than asserted. The rows it edits carry a
`529:reversioned{wa=..,imm=..,morn=..}` marker holding their prior flags, which
is how the rollback restores them. Any OTHER in-place rewrite of a rule row is
still a bug. `fleet_operational_oversight_members` is
the same effective-dated shape: `addOversightMember` requires an active FibreFlow
user (`isActiveFibreFlowUser`, checked before insert), and ending membership
(`endOversightMembership`) requires a reason and only ever sets `effective_to` —
membership is never deleted. **The migration seeds rules by incident type only;
no person is seeded anywhere.** The settings dialog's user-search
(`/api/fleet/incidents/settings/user-search`) is scoped to
`fleet.incidents-settings:edit` — it was fixed post-merge (commit
`41622266e`) after initially calling the admin-only `/api/admin/users`, which
403'd a non-admin holding settings access via an override grant.

### Dashboard/Map integration

`AttentionList.tsx` and `MapAttentionPanel.tsx` add a "View incidents"/"Incidents"
deep link **only** for the four incident-producing statuses (`late`, `wrong_site`,
`evidence_mismatch`, `left_early`) — every other attention status is summary-only
and gets no link. The link carries `incidentType`, `projectId`, and `staffId` into
`/fleet/incidents?...` so the queue opens pre-filtered. No new dashboard tab or
replacement page exists; the existing Dashboard and Map are unmodified otherwise.

## Driver Incident Input (migration 511, PR 7)

PR 7 gives a driver optional, transparent access to their own PR 6 incidents and
append-only ways to explain, attach evidence, report a source-data concern, and
link a canonical Attendance correction — through `/my/fleet/incidents`, not a new
portal. Implementation lives in `src/modules/fleet/incidents/driver/`; driver APIs
are under `/api/my/fleet/incidents`; the one manager-side addition is
`POST /api/fleet/incidents/[incidentId]/request-driver-input`.

**Migration 511 is unapplied — merging this code creates no table, sends no
notification, and applies no policy.** PR 7 requires no driver action: monitoring,
incident creation, escalation, and manager review all work exactly as PR 6 without
a single response. **Migration numbering moved while this PR was in flight** —
503 was 490, then 496, then 499, before landing here as master consumed each
number for unrelated work. Re-check `scripts/migrations/sql/` for the next free
number before creating any further Fleet migration; do not assume the next
integer after 503 is free.

### Append-only, with one narrow exception

`fleet_incident_driver_input_requests`, `fleet_incident_driver_submissions`, and
`fleet_incident_attendance_correction_links` are granted `SELECT, INSERT` only —
no blanket `UPDATE`, no `DELETE`. The one exception is a **column-scoped** grant on
`fleet_incident_driver_input_requests`: `superseded_at`, `closed_at`,
`closure_reason`, and the three `delivery_*_count` columns are writable, because
supersession/closure/delivery outcome are durable bookkeeping a manager reads back
later, not transient return values. `incident_id`, `requested_by`, `guidance`,
`requested_at`, `respond_by`, and `idempotency_key` remain unwritable after insert
— a blanket `UPDATE` grant would also let a manager silently rewrite the guidance
they sent a driver, which is exactly what this column list is designed to prevent.

### The driver's explanation is stored twice, on purpose

`fleet_incident_driver_submissions.explanation` is the driver-scoped source
record. Every accepted submission also writes that same trimmed text verbatim into
the `note` column of a `driver_response_received` row in
`fleet_operational_incident_actions` (`submissionService.ts`). This is not
duplication to clean up: the actions table is the append-only, manager-visible
audit timeline that `reviewQueries.ts`/`IncidentReviewDrawer.tsx` already render
and already gate behind PR 6's project-scope check — no manager read path selects
`fleet_incident_driver_submissions` directly. Before commit `caf1d18a9` the `note`
was hardcoded `NULL` and a manager could see *that* a driver responded but not
*what* they said; do not "deduplicate" this by dropping either copy.

### Visibility classification

`fleet_operational_incident_evidence` and `fleet_operational_incident_actions`
each gain a `visibility` column (`internal` / `shared_with_driver` /
`driver_submitted`), defaulting existing PR 6 rows and every future
manager-authored row to `internal` so nothing is retroactively disclosed. Driver
detail queries (`driverInputRepository.ts`) select only `shared_with_driver` and
`driver_submitted` rows — filtering happens in SQL, not by hiding fields in React.
Managers see all three classes; `IncidentReviewDrawer.tsx` renders a visibility
badge so a manager can tell an internal note from one shared with or submitted by
the driver.

### Driver-input state and response window

State is independent of incident lifecycle: `not_requested -> requested ->
responded`, with `expired` (window passed unanswered) and a presentation-only
`closed` (incident resolved/dismissed before a response). A manager's
`request-driver-input` call supersedes any prior open request rather than
overwriting it — only the latest open request controls the current `respond_by`.
The default response window is the end of the driver's second scheduled working
day after the request, computed from the driver's Attendance schedule in SAST,
skipping unscheduled days; with no schedule rows it falls back to Monday–Friday.
All of this is effective-dated configuration
(`fleet_incident_driver_input_settings`), not a hardcoded constant.

### Evidence MIME allowlist fails closed

`versionDriverInputSettings` (`settingsRepository.ts`) rejects any
`evidenceAllowedMimeTypes` entry absent from `vfStorageUpload.ts`'s
`SIGNATURE_REGISTERED_TYPES` — the list of MIME types `uploadCategorizedFile` can
actually verify by byte signature. Content verification fails closed there:
allowing a type in settings without a registered signature would make every
upload of it fail at runtime with a generic "content does not match declared
type" error, disconnected from the real cause. **Adding a new evidence MIME type
therefore always requires two changes together**: register its byte signature in
`MIME_SIGNATURES` (`src/lib/vfStorageUpload.ts`) first, then it becomes eligible
to enable in driver-input settings. The initial allowlist is `image/jpeg`,
`image/png`, `application/pdf`, 15 MB max.

### `explanationSummary` is deliberately always `null`

`DriverIncidentDetail.explanationSummary` (`driverIncidentService.ts`) is hardcoded
`null` in this PR — not a bug. No safe generator exists for a plain-language "why
this was flagged" summary: the only raw material is `evidenceSnapshot`, which
design §4/§9 forbids sending to a driver (it can carry coordinates/provider
payloads). `neutralLabel` remains the only shipped summary a driver sees. If a
manager requests input without writing guidance, the driver currently sees no
incident-specific reason beyond that neutral label — an open product question for
a future PR, not something to silently "fix" by relaxing the evidence-snapshot
boundary.

### Queue filtering is not implemented — do not add half of it

The manager queue does **not** filter by `driverInputState` or
`attendanceCorrectionState`. A client-only round-trip for both existed briefly in
`incidentApi.ts` and was removed in commit `caf1d18a9` because the server never
implemented the corresponding query parameters and no UI control ever called it —
it was dead plumbing pointing at a contract nobody honored. If this filtering is
built, the query-parameter handling in `pages/api/fleet/incidents/index.ts` (or
equivalent) and the client call in `incidentApi.ts` must land in the same change;
do not reintroduce one half without the other.

### Attendance correction linking

`attendanceCorrectionLinkService.ts` maps an incident's staff/work-date to an
**existing** Attendance required-day exception — it never creates a generic
correction, and generic Attendance corrections remain retired. Fleet stores only a
link (`fleet_incident_attendance_correction_links`, unique per
incident/correction pair) and displays Attendance's canonical state
(pending/approved/declined/cancelled) at read time; it never caches a second
authoritative status or copies correction content into incident fields. An
Attendance correction failure never discards an already-accepted Fleet
explanation, and a correction outcome never auto-closes the incident.

### `MAX_EXPLANATION_LENGTH` needs confirmation

`submissionService.ts` enforces a 4000-character cap on `explanation`. This number
was chosen with no basis in the PR 7 design document and awaits confirmation —
treat it as a placeholder-with-a-value, not a settled product decision, if it ever
needs to change.

### Notifications

Two events, registered in `src/modules/notifications/constants/index.ts`:
`fleet.driver_input_requested` and `fleet.driver_response_received`. Idempotency
keys: `fleet-driver-input-requested:{inputRequestId}:{driverUserId}` and
`fleet-driver-response-received:{submissionId}:{recipientUserId}`. A driver is
never notified merely because an incident opened — only after an authorized
manager requests input. Missing driver user mapping returns a recorded delivery
failure without losing the request (same pattern as PR 6's recipient resolution).

### Portal composition

`/my/fleet/incidents` and `/my/fleet/incidents/[incidentId]` compose into the
existing `/my` shell; the hub tile lives in the existing "Fleet & vehicle" group
in `MyHub.tsx`/`tiles.tsx`, not a new dashboard. `hub-summary.ts` adds
`fleetIncidents: { activeCount, inputRequestedCount }`, staff-scoped. No offline
upload queue exists in PR 7 — text submits first, files upload after and can retry
independently without discarding the accepted explanation.

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
   Cartrack row off, silently downgrading it from a 2-minute feed to the slower portal scrape with
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

Safe to run alongside the portal poll: it only appends positions and never touches
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
*/10 * * * * /home/velo/fibreflow-<env>/scripts/cron-portal-tracking.sh >> /home/velo/logs/poll-portal-tracking.log 2>&1
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

### Operations analytics (PR 8 task 7)
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/fleet/analytics/operations` | GET | Cards, monthly series, suppression notices, pipeline freshness |
| `/api/fleet/analytics/operations/drill-down` | GET | The incident ids behind a number, cursor-paged |

Both gate on `fleet.incidents:view`. See "Operations analytics read path" below
before adding a third caller.

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

## Operational Assignments (migration 497, PR 3)

`/fleet/assignments` holds the human-reviewed, explicit expectation for where a
staff member is expected to work. It is protected by `fleet.assignments` and is
scoped to projects the user may manage; a project-manager role alone never
authorizes reads or edits for another project.

| Table | Purpose |
|---|---|
| `fleet_project_operational_sites` | Auditable project-to-source mapping. A row has exactly one source: a project AOI or an authorized location; each project has at most one active default. |
| `fleet_operational_assignments` | Explicit roster and daily-override expectations, including stable project/site display snapshots. Active dates for a staff member may not overlap *within a kind* — two rosters may not overlap and two overrides may not overlap, but an override is expected to sit on top of the roster day it overrides. |
| `fleet_project_operational_site_audit` | Append-only operational-site changes. |
| `fleet_operational_assignment_audit` | Append-only roster, override, move, end, and supersede evidence. |

**Precedence and source boundary.** A one-day, reasoned `daily_override` is
highest precedence, followed by an active explicit roster assignment. Because
that precedence requires both rows to be active at once, the overlap guards are
scoped per `assignment_kind` — a single unscoped exclusion constraint would make
the override branch unreachable and the precedence above a dead letter. Vehicle-
project relationships and a staff member's home site remain derived fallbacks;
they are not copied into assignment rows. Geometry also remains at its source
instead of being duplicated into this module.

**Bulk safety.** Preview produces a deterministic fingerprint of the requested
roster and the conflict-relevant current state. Commit requires that fingerprint
and rejects a stale preview before its transaction writes anything. The two
kind-scoped database exclusion constraints are the final concurrent-overlap
guard.

**PR boundary.** PR 3 ends at operational site configuration, explicit
assignments, and expectation resolution. PR 4 owns downstream attendance-status
or workflow behavior; do not introduce it here.

## Recent Changes (Jan 2026)
- Added `VehicleCalibrationModal` for first-time setup
- Added calibration API with grandfathering logic
- Integrated NAFNet deblurring for blurry dashboard photos
- CPU mode for NAFNet (RTX 5090 sm_120 incompatible)

## Overnight Parking Compliance (mig 483, PRs 1–3)

### Operational foundations (migration 496)

- `notification_idempotency_claims` provides opt-in per-recipient notification deduplication.
- `fleet_parking_check_runs` records `running`, `succeeded`, `partial_failure`, and `failed` nightly executions.
- New violations notify UUIDs configured in `FLEET_ALERT_USER_IDS`; payloads exclude coordinates and addresses.
- The deduplication key is `parking-violation:<vehicle-id>:<YYYY-MM-DD>`.
- The check remains scheduled externally for 20:00 SAST; after 20:30 a missing completion is unhealthy.
- Health is available at `/api/fleet/parking/health` and shown on the existing `/fleet/parking` page.
- Deployment must register and verify the server cron separately. Merging code does not mutate crontab.

Nightly job that asks, for every active vehicle at 20:00 SAST: is it where its
driver declared it parks? PR 2 added the driver-facing declaration, PR 3 the
approval queue and the results dashboard.

| Piece | Where |
|-------|-------|
| Pure classifier | `src/modules/fleet/parking/classifyParkingCompliance.ts` |
| SQL | `src/modules/fleet/parking/parkingQueries.ts` |
| Orchestrator | `src/modules/fleet/parking/runParkingCheck.ts` |
| Shared types (pg-free) | `src/modules/fleet/parking/types.ts` |
| Endpoint | `pages/api/cron/fleet-parking-check.ts` (x-cron-secret) |
| Cron wrapper | `scripts/cron-fleet-parking-check.sh` |
| Tables | `fleet_vehicle_parking_locations`, `fleet_parking_compliance_checks` |
| **Driver API** | `pages/api/my/vehicle/parking.ts` (GET/POST/DELETE) |
| **Driver page** | `/my/vehicle/parking` + hub tile in `tiles.tsx` |
| **Driver SQL** | `src/modules/fleet/parking/driverParkingQueries.ts` |
| **Capture rules** | `src/modules/fleet/parking/declarationRules.ts` |
| **Approver notify** | `src/modules/fleet/parking/parkingNotifications.ts` |

### Driver side (PR 2)
- **The vehicle comes from the session, never the body.** `resolveDriverVehicle`
  joins `vehicle_assignments` → `fleet_vehicles` on the registration *string*
  (there is no vehicle FK on assignments). A body `vehicleId` is ignored, pinned
  by a test.
- **Every submission enters as `pending`** — a first address needs approval just
  as a change does. `ux_parking_active_per_vehicle` and
  `ux_parking_pending_per_vehicle` enforce one of each in the database; the
  route maps the pending index's 23505 to a 409 **by constraint name**, so that
  name is load-bearing.
- **Accuracy gate: 100 m** (`MAX_CAPTURE_ACCURACY_M`), enforced server-side and
  again in the browser. A 500 m fix sits inside the 200 m radius by luck and
  poisons every later check on that address.
- Capture uses `captureGPSWithFallback` from `@/modules/fleet/offline/gpsCapture`
  — never `navigator.geolocation` directly — so the iOS watchdog and the
  low-accuracy retry apply.
- Reverse geocoding is resolved server-side and is never fatal; a failure stores
  coordinates and the UI shows "Unnamed location".

### Fleet side (PR 3)
| Piece | Where |
|---|---|
| Approval queue | `/fleet/parking/requests` · `pages/api/fleet/parking/requests.ts` + `requests/[requestId]/decide.ts` |
| Compliance dashboard | `/fleet/parking` · `pages/api/fleet/parking/compliance.ts` |
| Decision transaction | `src/modules/fleet/parking/approvalQueries.ts` |
| Dashboard reads | `src/modules/fleet/parking/complianceQueries.ts` |
| Driver notification | `src/modules/fleet/parking/decisionNotifications.ts` |

- **Approval is one transaction on a pinned connection.** Promoting the pending
  row without superseding the active one leaves two active rows (which
  `ux_parking_active_per_vehicle` refuses, aborting the request) or none — and
  none silently turns every future nightly check into `no_address`. The row is
  re-read `FOR UPDATE` inside the transaction, not trusted from the queue the
  approver was looking at.
- **The driver's assignment is re-validated at approval time** (spec §11). A
  request from someone who has since handed the vehicle over is refused with
  `assignment_ended`, surfaced as a 409. A *rejection* skips that check — the
  driver may be gone and the request still needs closing out.
- **`decided_by` is a `staff(id)` FK but web sessions carry `users.id`** — hence
  `resolveStaffIdForUser`, which stores null rather than failing when an
  approver has no staff row.
- **Deciding is gated on `edit` of `fleet.parking-requests`**, reading the queue
  on `view`, and the dashboard on `view` of `fleet.parking`. 483 seeds all of it.
- The `@/lib/geo` alias in `vitest.migrations.config.ts` exists for this
  module's approval test; without it the whole file fails at collection.

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
  `tests/migrations/483_fleet_parking_queries.test.ts` and, for the driver side,
  `tests/migrations/483_fleet_parking_driver_queries.test.ts`, and for the
  approval transaction `tests/migrations/483_fleet_parking_approval.test.ts` — the unit tests
  mock the query layer out, so without those files the statements are never
  parsed. **Both are excluded from the default vitest run** (they throw at module
  load without `TEST_DATABASE_URL`), so CI does not execute them: run them
  deliberately with `TEST_DATABASE_URL=… npx vitest run tests/migrations/483_*`
  after touching either query module.

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
deliberately not sent. Session is minted fresh per run and never persisted — the ~5s mint was judged
not worth caching at the original 2-hourly cadence, and nothing portal-shaped
ever lands in the database.

⚠️ THAT PREMISE NOW BINDS. Each mint is a full Playwright launch through
Ituran's WAF, so the mint rate IS the challenge rate. On 2026-08-17 avis was
moved to a 10-minute interval and tripped the bot challenge ~80 minutes
later — `bot challenge did not clear — login form never appeared` — and the
cadence breaker auto-demoted it 10 → 30, where it recovered. 30 minutes is
the observed ceiling for this account; netstar and cartrack/urent run fine at
10 because neither re-authenticates per tick. Caching the session is the
change that would lift avis's ceiling — until then, do not re-raise it.

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

Cron: `5,15,25,35,45,55 * * * *` via `scripts/cron-ituran-tracking.sh`, offset from the
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
10-minute cron would spend all 20 in under four hours.

That budget is CADENCE-INDEPENDENT, which is why tightening the poll interval
does not bring a lockout closer: the 3-failure threshold is a count of
consecutive failures, and `AUTH_PROBE_COOLDOWN_MS` is 24h of WALL CLOCK, not a
tick count. At 10 minutes the breaker merely opens sooner (30 min rather than
6 hours) — it does not spend more attempts.

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

## Operational analytics aggregates

`fleet_operational_monthly_aggregates` is **internal** and is NOT a publishable anonymous dataset,
despite being designed as one. Adversarial review (PR #2594, 2026-08-23) found differencing
channels that per-key suppression does not close. Read
[`fleet-analytics-disclosure.md`](./fleet-analytics-disclosure.md) before exposing it through any
API, export, report, or UI.

Every read goes through `fleet_operational_monthly_aggregates_published` (migration 527), never the
base table: the view hard-codes `is_active = true`, and a superseded generation is the disclosive
one. `aggregateViewContract.test.ts` fails the build if any file outside the writer reaches past it.

The view is narrower than the table in two ways every reader must account for: it publishes
**organisation and project rows only** — no site rows — and it carries **no `contributor_count`, no
histogram columns and no `generalized_from_level`**. Release is per-component and tiered
(FULL / TOTAL_ONLY / NONE); a TOTAL_ONLY component publishes its root total with a NULL denominator
and none of its members.

## Incident chronology (`GET /api/fleet/incidents/[incidentId]/timeline`)

| Method | Endpoint | Gate |
|---|---|---|
| GET | `/api/fleet/incidents/[incidentId]/timeline` | `fleet.incidents:view` + project scope |

One ordered view of what happened to an incident, merged in memory from five PR4-7 tables
(`..._actions`, `..._observations`, `fleet_incident_attendance_correction_links`,
`user_notifications`, `fleet_incident_retention_hold_actions`). **There is no timeline table
and there never will be one** — `migrationContract.test.ts` asserts it.

Four things to know before changing it:

- **Summaries are never free text.** Every entry's summary is a label from an enum-keyed map,
  or a label with a database-computed count. No `note`, filename, storage locator, or JSONB
  blob is selected by any of the five queries; `timelineService.test.ts` greps the SQL and
  fails if a forbidden column reappears. That grep matches on a word boundary, so it does
  **not** catch `recipient_count` — any new column that names a person must be added by hand.
- **Paging is a keyset, per source.** Each query is bounded `(sort_at, id)` strictly past the
  cursor and stops at `limit + 1` rows. An instant-only bound is not a smaller version of this
  — being inclusive it re-reads the cursor row every page, so `nextCursor` is never emitted and
  the chronology dies after two pages (caught in review of PR #2603). Ordering and cursors live
  in `timelineCursor.ts`; the fixed table order there is half the sort key and must never be
  reordered. `recordedAt` is reported but never sorted on — no source can bound a read on
  another source's `recordedAt`.
- **🚨 The sort key is selected as text, never read off a `Date`.** All five columns are
  `timestamptz` (microseconds) and node-pg returns `Date` (milliseconds), so a cursor built from
  the returned value says `.123` where the row says `.123456` — and `occurred_at > '...123'` is
  then **true for the cursor row itself**, repeating it on every page. Two rows inside one
  millisecond ordered oppositely by id and by microsecond stop the walk advancing at all. Every
  source therefore selects
  `to_char(<col> AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS sort_at`, the cursor
  carries that string, and SQL compares `$2::timestamptz` parsed back from it (a text cast keeps
  all six digits). Fixed-width UTC text sorts lexicographically in chronological order, which is
  what lets the in-memory merge use it directly. Displayed `occurredAt` stays the `Date`.
- **Scope failures answer 403, missing incidents 404** — the same pair, in the same order, as
  `GET /api/fleet/incidents/[incidentId]`. `limit` above 200 is a 400, never a silent clamp.

## Operations analytics read path (PR 8 task 7)

### APIs and scope

`fleet.incidents` (view) gates both endpoints — the same permission as the review queue, because
there is no separate audience. The retained half of a response is derived from incidents the caller
can already open in that queue, and the historic half is read from the released aggregates. An
out-of-scope `op_project` or `op_site` is a **403**, not an empty chart: "nothing happened there"
and "not yours" are different answers and only one of them is true. A site is scope-checked through
its project, by the same `isProjectOwnedByScope` rule.

| Endpoint | Answers |
|---|---|
| `GET /api/fleet/analytics/operations` | Cards, a monthly series, suppression notices, and pipeline freshness scoped to the metric version the numbers were built under |
| `GET /api/fleet/analytics/operations/drill-down` | The incident ids behind a number, cursor-paged; `mode` is `retained_detail` or `aggregate_only` |

Filters are parsed once, by `operationsFilters.ts`, for both endpoints and (task 8) the export. They
carry an `op_` prefix so a deep link from the incident queue cannot silently pre-filter analytics.
A bad value is refused, never dropped — dropping one WIDENS the answer.

### Where a month's figures come from

A month whose identifiable detail still exists is derived **live**, from the same four fact kinds
and the same `calculateMonthlyMetrics` the nightly job uses. A month whose detail has been purged is
read from the aggregates. A month belongs to exactly one set, so a range spanning the boundary
counts nothing twice.

**The boundary is the purge's, and the purge works by DAY.** `retentionService` deletes every
incident with `work_date` strictly older than `resolveCutoffWorkDate`, so on the 24th the month
containing the cutoff is HALF gone. A month is retained only when its FIRST day is at or after that
cutoff; a half-purged month is read from the aggregates instead. `operationsScope.ts` imports
`resolveCutoffWorkDate` rather than restating it — two definitions of one boundary agree until one
of them changes. It is deliberately conservative while `live_retention_enabled` is off, so the
answer does not change on the day an operator turns deletion on.

### The live half carries no anonymity claim, by design

The retained half is deliberately NOT read from the aggregates, even though the aggregates cover
recent months too. Those rows are k-anonymised, and a manager of a three-person site would find
their own current numbers withheld from them by machinery meant to protect data that outlives the
retention window. The live half needs no k-anonymity because access is already confined to the
projects the viewer manages under `fleet.incidents:view`, and every incident behind a number is one
they can open in their own queue. **This is a property of that gate.** Any future caller reaching
this code with a wider audience — an export to a client, a public dashboard, a broader permission —
invalidates the reasoning, not just the numbers.

The historic half reports what was published and says what is missing, per month and per component:

- **TOTAL_ONLY** comes back as a root total with a NULL denominator; the members are **omitted, never
  rendered as zero**, and a notice names the group and the months.
- **NONE** comes back as no rows at all, and is the ONLY tier a component rooted on an internal tally
  can reach besides FULL — `incident.total` is no metric key, so incidents are all-or-nothing. A
  notice names those months too: nothing in the figures distinguishes "withheld" from "no incidents".
- Every card and every series value carries `coverage: { months, of }` — how many months of the range
  reported that key. A two-month range can hand back a two-month presence total beside a one-month
  incident total, and without this the incident figure reads as a fall that did not happen.

A purged month reports `histogram: null` — the view has no bucket columns — rather than an empty
histogram that would read as "no durations were recorded". The managed-projects coverage notice is
counted **per month**: over the union, a project that published in June and nothing in July looks
fully covered while July's total is quietly short one project.

### What the API refuses, and why

`op_driver`, `op_vehicle`, `op_type`, `op_severity`, `op_outcome` and `op_evidence` each name an
attribute of an individual incident, and none survives into a monthly count. **`op_site` is refused
too**, for a different reason: the published view has organisation and project rows only, so there is
no site row to read and answering from the project's row would widen the answer to every other site
in it. A range reaching past the boundary with any of them set is **refused with a 400** naming the
filters given, rather than answered by silently dropping them.

Two predicates, not one: `hasRetainedOnlyFilter` is the set an aggregate cannot honour (the six plus
`op_site`), and `hasIncidentShapedFilter` is the subset that decides which live fact kinds can
contribute. They were briefly the same definition; `op_site` is what separated them, because every
fact carries a site and a site filter narrows presence rather than making it inapplicable.

A drill-down over a range that STRADDLES the boundary is refused too. Analytics can merge two
sources because it answers in totals; a drill-down answers in incident ids and the purged months
have none.

Where a filter makes a fact kind inapplicable, the metrics that kind feeds are **omitted** from
cards and series rather than reported as zero: under `op_type=late`, `presence.scheduled_days: 0` is
a fact about the filter, and a card cannot say which.

---

## Vehicle-first spike findings (PR0, 2026-08-25)

Read-only spike answering U1–U4 of
`docs/superpowers/plans/2026-08-25-fleet-vehicle-day-stats-and-telematics-detectors.md`.
Measured against the live Cartrack REST API (one 15-min page + a paginated 7-day walk,
55,009 events) and the shared Supabase DB (`fleet_vehicle_positions`, last 30 days).
No plates, VINs or credentials reproduced here.

### U1 — SOS / panic / impact: not present on any feed. `accident_sos` stays a stub.

**Cartrack `GET /vehicles/events` returns 57 fields, not 44.** `cartrack/provider.ts` keeps 14.
The 43 discarded ones were enumerated in full on 2026-08-25. No panic, SOS, impact, crash, tow
or jam field exists. Fields specifically checked and cleared:

| Discarded field | What it actually carries |
|---|---|
| `event_description` | **Event-type vocabulary — decision-grade, see below** |
| `terminal_event_type_id` | Numeric code for the same vocabulary |
| `x_accel` / `y_accel` / `z_accel` | Raw 3-axis accelerometer, populated on the firmware family where `linear_g`/`lateral_g` are constant zero |
| `input_state` / `input_state2` / `input_state3` | Signed bitfields, 24 distinct values over 24 h. **The one place a panic button could still hide** — the bit map is undocumented on our side; resolving it is a question for Cartrack, not a guess |
| `output_state` | Bitfield, 4 distinct values |
| `driver_id`, `battery_percentage_left`, `manifold_pressure`, `oil_pressure`, `oil_temp`, `water_temp`, `dynamic2-4` | Always `null` on this tenant |
| `adc0-2`, `analog_0-2`, `temp1-4`, `rpm`, `dynamic1` | Constant (0 or 1) |
| `vext`, `vgsm`, `unit_temp`, `clock`, `terminal_id`, `user_id` | Device telemetry, no fleet-safety meaning |
| `chassis_number`, `registration`, `position_description(_id)`, `received_ts` | Identity / reverse-geocode / ingest metadata |

**`event_description` vocabulary — 55,009 events, 8 vehicles, 7 days (2026-08-18 → 08-25):**

| `event_description` | `terminal_event_type_id` | Count |
|---|---|---|
| `PERIODIC_EVENT` | 2 | 48,679 |
| `IDLING_CONTINUE` | 46 | 2,209 |
| `MOTION_START` / `MOTION_END` | 43 / 44 | 940 / 940 |
| `IGNITION_OFF` / `IGNITION_ON` | 27 / 28 | 680 / 679 |
| `IDLING_START` / `IDLING_END` | 33 / 34 | 274 / 274 |
| `GPS_LOCK` / `GPS_LOST` | 38 / 39 | 149 / 119 |
| `SPEEDING_START` / `SPEEDING_END` | 31 / 42 | 26 / 11 |
| `HARSH_CORNERING` | 35 | 19 |
| `HARSH_BRAKING` | 30 | 10 |

Fourteen values, no alarm class. **Cartrack's device already computes harshness itself** — this is
the single most useful thing the spike found, and it is thrown away on every ingest.

**Netstar.** The live 2-hourly path is `netstar/tree.ts` (`GetVehicleTreeDataPaging`), which carries
**no status/alarm field at all** — only an `IgnitionOn` boolean. `netstar/parse.ts`'s `Status` column
belongs to the CSV "All Activity" export, reached only by `scripts/backfill-tracking.ts` through the
`UNVERIFIED` `history.ts` path. Raw exports are **not retained** (no raw-payload table, no on-disk
dump, nothing in the ingest). The vocabulary is therefore only what the captured fixture and its
README record (968-row capture, 2026-08-05): `Timed Event`, `Stopped`, `Moving`, `Ignition on`,
`Ignition off`, `Speeding`, `Idling`, `HeadingChange`. No impact/panic/SOS value. `parse.ts` maps two
of the eight (`Ignition on/off` → `ignition`, `Speeding` → `isSpeeding`) and discards the rest.

**Ituran.** `Statuses[].StatName` is read only by `readIgnition`. Raw payloads are not retained
("nothing portal-shaped ever lands in the database"). Names observed in the live captures behind the
committed tests: `Ignition On`, `Ignition Off`, `Engine On`, `Engine Off`, `Vehicle Stopped`. No
panic/SOS value. Everything but the two `Ignition *` names is discarded.

**Decision: `accident_sos` ships as a documented stub** (plan §4, `accidentSosDetector.ts`). The
header must name the fields above and this date. The one open lead is Cartrack's `input_state`
bitfield — ask the vendor for the bit map before concluding the fleet has no panic button.

### U2 — g-force: units are **g**, but only **1 of 7** Cartrack vehicles reports it

`linear_g` is signed (negative = braking); `lateral_g` is already an unsigned magnitude
(`min = 0.000` over 237,419 rows, so `abs()` is a no-op). Magnitudes 0–0.74 are g, not m/s² or centi-g.

Distribution, `cartrack/velocity`, 30 days, n=237,419 — the only feed populating these columns:

| p50 | p99 | p99.9 | min | max |
|---|---|---|---|---|
| `linear_g` | 0.000 | 0.060 | 0.110 | -0.740 | 0.340 |
| `-linear_g` (braking) | 0.000 | 0.060 | 0.140 | | |
| `abs(lateral_g)` | 0.000 | 0.110 | 0.220 | 0.000 | 0.510 |

**🚨 `linear_g IS NOT NULL` is a worthless coverage test.** Six of the seven `cartrack/velocity`
vehicles report **constant zero**, not null — one distinct value across 200k+ rows:

| vehicle (first 8 of uuid) | fixes | distinct `linear_g` | non-zero `linear_g` | non-zero `lateral_g` |
|---|---|---|---|---|
| `af119f11` | 31,192 | 32 | 15,283 | 21,875 |
| `805037da`, `8c8e1824`, `0a70ca7c`, `d9af42eb`, `e6232221`, `a01270cc` | 22k–60k each | **1** | **0** | **0** |

A `coverage_gforce` flag derived from `provider = 'cartrack'` would be wrong for six of seven
vehicles. It must be derived **per vehicle-day from observed non-zero values**, never from the provider.

**🚨 And the one vehicle that does report g reports it wrong.** All 10 of the largest-magnitude rows
belong to `af119f11` at 6–7 km/h; 19 of its 20 braking events ≥ 0.35 g are at ≤ 10 km/h, one at 70+ km/h.
The live API confirms it: every `HARSH_BRAKING` sample carries `speed=6` and `lin≈-0.42..-0.68`. That
is a device artefact, not driving. A g threshold with no speed gate would report one vehicle
almost exclusively.

Meanwhile `HARSH_CORNERING` fires on the *other* firmware family with `linear_g=0, lateral_g=0` and
populated `x/y/z_accel` at 95–129 km/h — real events our g columns cannot see at all.

Hit rates, 30 days, 7 vehicles (fleet-wide events per day):

| threshold (g) | braking/day | accel/day | cornering/day |
|---|---|---|---|
| 0.25 | 1.07 | 0.13 | 4.67 |
| 0.30 | 0.70 | 0.03 | 1.83 |
| **0.35** | **0.67** | **0.00** | **0.77** |
| 0.42 | 0.67 | 0.00 | 0.37 |
| 0.50 | 0.40 | 0.00 | 0.07 |

### U3 — cadence: the plan's coverage matrix is wrong in three places

Per (provider, account_ref), last 30 days, SAST days:

| feed | vehicles | fixes/day p10 | fixes/day median | gap median | gap p90 | gap p99 | largest gap | ignition non-null | speed non-null | odometer non-null | real (non-zero) g |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `cartrack/velocity` | 7 | 386 | **1,169** | **8 s** | 30 s | 298 s | 84.6 h | 100 % | 100 % | 100 % | 6.4 % |
| `cartrack/urent` | 3 | 5 | 15 | 1,797 s | 7,581 s | 64,431 s | 91.3 h | 100 % | 100 % | 100 % | 0 % |
| `netstar/europcar` | 6 | 2 | 10 | 637 s | 9,618 s | 61,398 s | 25.4 h | **100 %** | 100 % | **0 %** | 0 % |
| `ituran/avis` | 2 | 6 | 11 | 2,095 s | 7,472 s | 47,896 s | 27.1 h | **94.5 %** | 100 % | 100 % | 0 % |

Corrections to the plan's §2 U3 table:
1. `cartrack/velocity` is **not** a 2-minute feed. It is event-driven with a **median 8-second** gap
   and ~1,169 fixes per vehicle-day (max 3,047). Any per-fix loop sized for "2 min" is off by ~15×.
2. `netstar/europcar` asserts ignition on **100 %** of fixes, not "only on transition rows" — because
   the live path is `tree.ts`'s `IgnitionOn` boolean, not the CSV `Status`. It supplies **no odometer**,
   so its distance must come from haversine, never an odometer delta.
3. `ituran/avis` asserts ignition on **94.5 %** of fixes, not "only on literal status".

So **idle is computable on all four feeds**, just at wildly different resolution — `ignition=true AND
speed_kph=0` fires on 12–23 % of fixes everywhere:

| feed | idle-feasible fixes/day (median) | share of fixes |
|---|---|---|
| `cartrack/velocity` | 1,872 | 23.2 % |
| `netstar/europcar` | 11 | 15.6 % |
| `cartrack/urent` | 6 | 17.6 % |
| `ituran/avis` | 3 | 12.1 % |

> **Superseded by PR1 (mig 528).** Idle-feasible FIXES are not idle SECONDS: attributing an interval
> needs both ends close together, and only `cartrack/velocity` (8 s median gap) clears the 300 s
> attribution ceiling. `coverage_ignition` therefore means MEASURABLE — ignition asserted on ≥90 % of
> fixes **AND** the day's median gap ≤ the ceiling — so `cartrack/urent`, `netstar/europcar` and
> `ituran/avis` fold to `coverage_ignition = false` with ignition/moving/idle at 0, rather than
> publishing a zero that reads as a parked vehicle.

Days with ≥1 fix out of 30: all seven `cartrack/velocity` vehicles 23–31; every `netstar`, `ituran`
and two `urent` vehicles exactly **19** (13 for one), because those feeds only went live 2026-08-06/07.
Coverage denominators must start at the vehicle's first position, never at 30.

Ingest lag (`received_at - recorded_at`) — what a "now minus last fix" detector actually races:

| feed | median | p90 | p99 | max |
|---|---|---|---|---|
| `cartrack/velocity` | 1.4 min | 2.4 min | 7.0 min | 34.6 min |
| `netstar/europcar` | 1.2 min | 10.9 min | 89.7 min | 307 min |
| `ituran/avis` | 4.1 min | 9.2 min | 90.6 min | 309 min |
| `cartrack/urent` | 1.4 min | 22.9 min | 99.1 min | 1,261 min |

Live `fleet_tracking_watermarks.poll_interval_minutes` on 2026-08-25: `netstar/europcar` 10,
`cartrack/urent` 30, `cartrack/velocity` 120, `ituran/avis` 120 (demoted, see the Ituran section).
Note `cartrack/velocity`'s 120 is not its ingest rate — the REST poll in `/api/cron/poll-tracking`
does not go through `cadence.ts`, which is why its lag is 1.4 min against a "120-minute" interval.

### U4 — restated (verified independently before this spike)

Migration **510 is applied**. `fleet_operational_incident_rules` holds **14 open rows** (one per type,
all `version 1`). As 510 seeds them, all six telematics types — `accident_sos`,
`theft_after_hours_movement`, `severe_driving`, `prolonged_unauthorized_stop`, `lost_contact_moving`,
`dangerous_area_entry` — are `severity='critical'`, `whatsapp_enabled=true`,
`immediate_notification=true`. Plan risk R5 stands: PR3 must precede PR4.

**Superseded by migration 529 (PR3).** After 529 the four non-emergency types — `severe_driving`,
`prolonged_unauthorized_stop`, `lost_contact_moving`, `dangerous_area_entry` — are `severity='high'`,
`whatsapp_enabled=false`, `immediate_notification=false`, `include_in_morning_summary=true`. Only
`accident_sos` and `theft_after_hours_movement` remain `critical` + WhatsApp, deliberately:
`requiresMandatoryIncidentWhatsApp` is `severity === 'critical' && producerKind === 'source_event'`
and ignores `whatsapp_enabled`, so severity is the only lever that stops a detector blasting
WhatsApp. The count stays at 14 open rows — 529 rewrites in place and inserts nothing. See the
in-place exception noted under "Rule and oversight configuration".

Migration numbering: at spike time max on `origin/master` was **527**. **528** is now taken by
`528_fleet_vehicle_daily_stats.sql` (PR #2617, merged) and **529** by
`529_fleet_vehicle_operational_rules.sql` (this PR3). Next free is **530** — re-check
`git ls-tree -r --name-only origin/master scripts/migrations/sql` before claiming one.
