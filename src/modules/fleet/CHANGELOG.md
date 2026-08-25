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
its own counters. Dedup and recurrence come free from
`produceIncident`'s `source_event` path — a repeat `sourceEventId` answers
`unchanged`.

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

**Two detectors are seven-vehicle detectors by construction.**
`prolonged_unauthorized_stop` requires a feed that samples during a stop (median
gap <= 300 s) and `lost_contact_moving` scales its threshold to `max(rule floor,
3 x the vehicle's own p90 gap)`. Eleven of eighteen tracked vehicles report every
10-35 minutes, so both stay silent for them. That is a property of the feeds, not
a defect; the module headers say so rather than letting the other eleven look
broken.

**Dry run over 7 days of real positions (2026-08-18 -> 08-25, producer replaced
by a counter, one `READ ONLY` transaction, 5-minute ticks replayed):**

| detector | total | per day | worst day | vehicles |
|---|---|---|---|---|
| `theft_after_hours_movement` | 64 | **9.14** | 12 | 14 |
| `severe_driving` | 8 | 1.14 | 3 | 1 |
| `prolonged_unauthorized_stop` | 19 | 2.71 | 8 | 2 |
| `lost_contact_moving` | 20 | 2.86 | 5 | 3 |

The three non-critical detectors are inside acceptance criterion 3's <= 5/day at
the seeded defaults, so **no default in this module was tuned**.

**`theft_after_hours_movement` at 9.14/day is a WhatsApp-bearing finding, and it
is not a code defect.** Every event is real after-hours movement: 14 of 18
vehicles drove after 18:00 in the week, and the hourly distribution of
ignition-on moving fixes shows it is the evening shoulder, not the night —
vehicle-days with movement per SAST hour are 40 (18:00), 28 (19:00), 18 (20:00),
then 7, 7, 3 for 21:00-23:00 and 2, 2, 0, 0, 1 for 00:00-04:00. Two levers exist,
both outside this PR's code: `fleet_vehicles.after_hours_exempt` (migration 529,
which is exactly what it is for) and a rule version moving
`after_hours_start_time` later. **Neither the crontab entry nor WhatsApp delivery
(PR5) may be enabled until one of them is applied.** `scripts/fleet-detectors-dryrun.ts`
takes `DRYRUN_AFTER_HOURS_START` and `DRYRUN_ONLY` so the effect of a proposed
window can be measured before it is versioned.

**Caveat on the dry run's `severe_driving` figure:** migrations 528 and 529 are
not applied to the shared database yet, so the run used 529's seeded defaults,
treated every vehicle as non-exempt, and had no `provider_event_type` column —
meaning severe_driving was measured on its **g fallback only**. The provider-event
path (`HARSH_BRAKING` / `HARSH_CORNERING`), which is the primary one and fires on
the six of seven vehicles whose g is structurally zero, is not represented in the
8 events above. Re-run after 528 lands.

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
