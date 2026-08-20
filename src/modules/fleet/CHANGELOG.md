# Changelog - Fleet Module

All notable changes to the Fleet module will be documented in this file.

Format: `## [Commit Hash] - YYYY-MM-DD - Author - Type`

---

## [PR 7] - 2026-08-20 - Feature

**feat(fleet): optional driver incident responses and Attendance correction linking**

Migration 506 (unapplied pending deployment approval) gives a driver
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
`scripts/migrations/sql/506_fleet_incident_driver_input.sql`,
`src/modules/attendance/portal/client/**` (hub tile, correction-form
callback), `src/modules/notifications/constants/index.ts` (2 new events).

---

## [PR 6] - 2026-08-18 - Feature

**feat(fleet): operational incidents, escalation, and manager review queue**

Migration 506 (unapplied pending deployment approval) adds durable,
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
`scripts/migrations/sql/506_fleet_operational_incidents.sql`,
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
