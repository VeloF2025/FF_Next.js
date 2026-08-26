# Changelog - Fleet Module

All notable changes to the Fleet module will be documented in this file.

Format: `## [Commit Hash] - YYYY-MM-DD - Author - Type`

---

## [PR 4] - 2026-08-25 - Feature

**feat(fleet): telematics incident detectors, wired to the existing producer**

`src/modules/fleet/vehicleDetectors/` gains the four live detectors
(`theft_after_hours_movement`, `severe_driving`, `prolonged_unauthorized_stop`,
`lost_contact_moving`), a documented `accident_sos` stub, deterministic
source-event identity, project attribution, the position reads, and the
orchestration phase. No migration, no UI, no new cron entry: the phase runs
inside the existing `*/5` `fleet-operational-monitor` tick, AFTER
`runOperationalMonitor`, under the same advisory lock, with its own try/catch and
its own counters. A newly opened incident is notified here, exactly as
`monitorService` does on `opened`.

**Dedup comes free from `produceIncident`'s `source_event` path — recurrence does
NOT.** A repeat `sourceEventId` answers `unchanged` and touches nothing, so
`condition_last_seen_at` stays at the open instant: a vehicle still stopped in
the same place three hours later looks, to the manager queue, exactly like one
that stopped once. Recorded as a known limitation for a later slice, because
"still true" for a bucketed source event is a different question from "seen
again" for a roster detection.

**Two types are deliberately not implemented, and neither is a TODO:**

- `dangerous_area_entry` — **DEFERRED**. There is no dangerous-area geofence
  table in this database and authoring one is out of scope. Its
  `fleet_operational_incident_rules` row stays exactly as migration 529 leaves
  it; no code path references it, and `VEHICLE_DETECTOR_IDS` does not name it.
- `accident_sos` — **STUB**, returning zero events for every input. No SOS,
  panic, impact, crash, tow or jam field exists on any of the three feeds; all
  57 Cartrack `GET /vehicles/events` fields, Netstar's live `tree.ts` path and
  Ituran's `Statuses[].StatName` were enumerated on 2026-08-25 and are named in
  the module header. **Reopening condition:** Cartrack confirming which bit of
  its undocumented `input_state` bitfield is a panic input. Do not synthesise SOS
  from g-force — the type is `critical`, so a derived guess is a false emergency
  on WhatsApp.

**`prolonged_unauthorized_stop` buckets on the SAST calendar DAY, not the stop's
start instant.** The instant is not a stable key: the detection window slides
forward every tick, so a stop older than the 12-hour window is anchored on the
window's own moving edge and mints a fresh `sourceEventId` each tick — measured
at four ticks over thirteen hours, four ids, which at the real five-minute
cadence is twelve incidents an hour for one parked vehicle. The guarantee is now
exact: **at most one such incident per vehicle per SAST day** (a vehicle parked
Friday to Monday opens three or four, not one every tick). The cost, stated
rather than hidden: two genuinely separate unauthorized stops on one day are one
incident. A location grid was considered as a finer bucket and rejected — a grid
edge between two anchors 50 m apart reintroduces the duplicate it would replace.

**Two detectors are seven-vehicle detectors by construction.**
`prolonged_unauthorized_stop` requires a feed that samples during a stop (median
gap <= 300 s) and `lost_contact_moving` scales its threshold to `max(rule floor,
3 x the vehicle's own p90 gap)`. Eleven of eighteen tracked vehicles report every
10-35 minutes, so both stay silent for them. That is a property of the feeds, not
a defect; the module headers say so rather than letting the other eleven look
broken.

**Dry run over 7 days of real positions (2026-08-18 -> 08-25, producer replaced
by a counter, one `READ ONLY` transaction, 5-minute ticks replayed). It changed
the seed, which is why it is recorded here rather than in a comment:**

| detector | 18:00 window (as planned) | 21:00 window (**as seeded**) |
|---|---|---|
| `theft_after_hours_movement` | 64 total, **9.14/day**, 14 vehicles | 27 total, **3.86/day**, 13 vehicles |
| `severe_driving` | 8 total, 1.14/day, 1 vehicle | — |
| `prolonged_unauthorized_stop` | 19 total, 2.71/day, 2 vehicles | — |
| `lost_contact_moving` | 20 total, 2.86/day, 3 vehicles | — |

The three non-critical detectors sit inside acceptance criterion 3's <= 5/day at
the seeded thresholds, so **no default in this module was tuned.**

**What moved instead was migration 529's seeded after-hours window, from
18:00-06:00 to 21:00-05:00** (`41c59db75`, PR3). At 18:00 the theft detector was
opening 9.14 WhatsApp-bearing incidents a day on 14 of 18 vehicles, and none of
them was a false positive — it was the evening shoulder. Vehicle-days with
ignition-on moving fixes per SAST hour: 40 (18:00), 28 (19:00), 18 (20:00), then
7, 7, 3 across 21:00-23:00 and 2, 2, 0, 0, 1 across 00:00-04:00. Moving the
window to 21:00 removes the commute and keeps the night.

**The residual is the weekend, and it is a data decision, not a threshold.** Of
the 27 events at the seeded window, 19 fall on the Saturday and Sunday (11 and
8), because `weekends_are_after_hours` makes all weekend daytime work
after-hours. Weekday nights past 21:00 are 8 events over 5 days — 1.6/day. The
crews that work Saturdays need `fleet_vehicles.after_hours_exempt` set (which is
exactly what that column is for), or the weekend flag needs revisiting.
`scripts/fleet-detectors-dryrun.ts` takes `DRYRUN_AFTER_HOURS_START` and
`DRYRUN_ONLY` so any further proposal is measured before it is versioned rather
than after.

**A third gate, easy to miss: at least one ACTIVE oversight member.** Most
telematics incidents are projectless (a road is not inside a project AOI), and
`resolveIncidentRecipients` resolves a projectless incident to the oversight
roster. With `fleet_operational_incident_oversight_members` empty there is no
recipient at all: `sendIncidentOpenedNotification` returns
`NO_RECIPIENT_RESULT`, logs, and nobody is told — the incident still opens and
sits in a queue only an admin can see. Confirm the roster is populated before
either cron is registered.

**Be precise about what "not live yet" means.** WhatsApp for a critical
telematics incident is not waiting on PR5: `sendIncidentOpenedNotification` fires
the mandatory per-recipient DM on OPEN today, and the action runner escalates
after that. PR5 adds the GROUP post and a DM fallback — it does not switch the
channel on. What actually gates all of this is that neither cron is installed:
`scripts/cron-fleet-operational-monitor.sh` (which the detectors ride) and
`scripts/cron-fleet-incident-actions.sh` (escalation and the 08:15 summary) are
both recorded here as unscheduled pending deployment approval. Registering either
is a deployment action requiring separate approval, and the exemptions above
should be set first.

**Caveat on the dry run's `severe_driving` figure:** at the time of the run,
migrations 528 and 529 were not yet applied to the shared database, so it used
529's defaults from the file, treated every vehicle as non-exempt, and had no
`provider_event_type` column — meaning severe_driving was measured on its **g
fallback only**. Its PRIMARY path (`HARSH_BRAKING` / `HARSH_CORNERING`), which is
the one that fires on the six of seven vehicles whose g is structurally zero, is
not represented in those 8 events. Both migrations land with the next dev deploy;
the column then has to ACCUMULATE data (it is nullable with no backfill, so only
positions ingested after the deploy carry it) before a re-run means anything.

**Files:** `src/modules/fleet/vehicleDetectors/{sourceEventId,theftDetector,severeDrivingDetector,unauthorizedStopDetector,lostContactDetector,accidentSosDetector,detectorQueries,vehicleProjectResolver,vehicleDetectorService,types,afterHours}.ts`,
`pages/api/cron/fleet-operational-monitor.ts`, `scripts/fleet-detectors-dryrun.ts`,
`src/modules/fleet/vehicleDetectors/__tests__/**`,
`tests/routes/api/cron/fleet-operational-monitor.test.ts`.

---

## [PR 7] - 2026-08-20 - Feature

**feat(fleet): optional driver incident responses and Attendance correction linking**

Migration 511 (unapplied pending deployment approval) gives a driver
transparent, optional access to their own PR 6 operational incidents via
`/my/fleet/incidents`, plus append-only explanations, follow-ups, evidence
uploads, structured source-data concerns, and links to an existing Attendance
required-day correction. Drivers are notified only after an authorized
manager calls the new `request-driver-input` action — never merely because
an incident opened. Adds a `visibility` classification (`internal` /
`shared_with_driver` / `driver_submitted`) to PR 6 evidence/actions,
defaulting every existing and future manager-authored row to `internal`.
Two notification events registered
(`fleet.driver_input_requested`, `fleet.driver_response_received`). A driver
response never changes incident lifecycle/outcome, never rewrites Attendance/
GPS/assignment/site/vehicle/geofence evidence, and triggers no automatic
payroll/disciplinary/fraud/score effect. Requires no driver action — PR 6
workflows are unaffected. See `.claude/modules/fleet.md` (Driver Incident
Input section) and `docs/operations/fleet-operational-incidents.md`.

**Known gaps recorded, not silently fixed:** `explanationSummary` is always
`null` (no safe generator exists yet — an open product question); manager
queue filtering by `driverInputState`/`attendanceCorrectionState` is not
implemented (dead client plumbing for it was removed); `MAX_EXPLANATION_LENGTH
= 4000` has no basis in the design and awaits confirmation.

**Files:** `src/modules/fleet/incidents/driver/**`,
`pages/api/my/fleet/incidents/**`,
`pages/api/fleet/incidents/[incidentId]/request-driver-input.ts`,
`scripts/migrations/sql/511_fleet_incident_driver_input.sql`,
`src/modules/attendance/portal/client/**` (hub tile, correction-form
callback), `src/modules/notifications/constants/index.ts` (2 new events).

---

## [PR 6] - 2026-08-18 - Feature

**feat(fleet): operational incidents, escalation, and manager review queue**

Migration 510 (unapplied pending deployment approval) adds durable,
deduplicated incidents for four PR 4 operational statuses (`late`,
`wrong_site`, `evidence_mismatch`, `left_early`), a 5-minute detection cron
(`fleet-operational-monitor`), an escalation/08:15-SAST-summary/health cron
(`fleet-incident-actions`), a manager review queue at `/fleet/incidents`
(`fleet.incidents`/`fleet.incidents-settings` permissions), VF Storage
evidence attachment, and mandatory WhatsApp for critical explicit
source-event incidents. Six safety/telematics incident types
(`accident_sos`, `dangerous_area_entry`, `theft_after_hours_movement`,
`severe_driving`, `prolonged_unauthorized_stop`, `lost_contact_moving`) are
modeled and gated but have no producer wired in this PR. Requires no driver
action. See `.claude/modules/fleet.md` (Operational Incidents section) and
`docs/operations/fleet-operational-incidents.md`.

**Files:** `src/modules/fleet/incidents/**`, `pages/api/fleet/incidents/**`,
`pages/api/cron/fleet-operational-monitor.ts`,
`pages/api/cron/fleet-incident-actions.ts`, `pages/fleet/incidents.tsx`,
`scripts/migrations/sql/510_fleet_operational_incidents.sql`,
`src/lib/vfStorageUpload.ts` (extended, SiteCam path unchanged),
`src/modules/notifications/constants/index.ts` (5 new events).

---

## [5afe860] - 2026-03-11 - Hein van Vuuren - Fix

**fix(error-handling): add logging to TIER 1 silent catches (fleet, procurement, qfield, staff-docs, notifications)**

Added `console.error()` logging to 61 TIER 1 catch blocks that were silently swallowing errors across fleet, procurement, qfield, staff-docs, and notifications modules.

**Changes (Fleet Module):**
- Added error logging to 24 API endpoints in fleet module
- Check-in endpoints: items, records, templates, vehicle check-in, sync, VLM processing
- Fuel management endpoints: anomalies, cost breakdown, summary, transactions, trends, vehicles
- Driver management: available drivers, driver documents, drivers index
- Vehicle endpoints: vehicles list, individual vehicle check records and fuel transactions
- Portal endpoints: logout, session, verify-plate
- Investigation upload endpoint

**Files Changed (Fleet only):** 24 files, 39 insertions
- `pages/api/fleet/available-drivers.ts`
- `pages/api/fleet/check-in/items.ts`
- `pages/api/fleet/check-in/items/[itemId].ts`
- `pages/api/fleet/check-in/process-vlm.ts`
- `pages/api/fleet/check-in/records.ts`
- `pages/api/fleet/check-in/records/[recordId].ts`
- `pages/api/fleet/check-in/sync.ts`
- `pages/api/fleet/check-in/templates.ts`
- `pages/api/fleet/check-in/templates/[templateId].ts`
- `pages/api/fleet/check-in/vehicle/[vehicleId].ts`
- `pages/api/fleet/drivers-documents.ts`
- `pages/api/fleet/drivers/index.ts`
- `pages/api/fleet/fuel/anomalies.ts`
- `pages/api/fleet/fuel/anomalies/[id].ts`
- `pages/api/fleet/fuel/cost-breakdown.ts`
- `pages/api/fleet/fuel/summary.ts`
- `pages/api/fleet/fuel/transactions.ts`
- `pages/api/fleet/fuel/trends.ts`
- `pages/api/fleet/fuel/vehicles.ts`
- `pages/api/fleet/investigation/upload.ts`
- `pages/api/fleet/portal/logout.ts`
- `pages/api/fleet/portal/session.ts`
- `pages/api/fleet/portal/verify-plate.ts`
- `pages/api/fleet/vehicles.ts`
- `pages/api/fleet/vehicles/[id]/check-records.ts`
- `pages/api/fleet/vehicles/[id]/fuel-transactions.ts`

**Total across all modules:** 61 files, 118 insertions, 3 deletions

---

*Last Updated: 2026-03-11*
