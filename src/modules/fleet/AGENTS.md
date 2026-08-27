<!-- GENERATED — do not edit. Canonical source: ./.claude.md -->
<!-- Regenerate: node scripts/mirror-agents-md.mjs -->
<!-- You are reading the AGENTS.md view of the Claude-facing docs. Prose
     below may refer to ".claude.md" when describing the canonical side;
     that is accurate — only PATH references are rewritten to AGENTS.md. -->
# Module: fleet
<!-- Vehicle fleet management — check-in/out, VLM photo analysis, GPS trips, fuel, maintenance -->

## Purpose
Full vehicle lifecycle: driver check-in with VLM-validated photos, odometer/fuel tracking, GPS trip investigation, maintenance scheduling, driver scorecards, and portal sessions.

## Key Files
| File | Purpose |
|------|---------|
| `check-in/components/CheckInForm.tsx` | Main check-in UI |
| `check-in/components/VehicleCalibrationModal.tsx` | Mandatory first-time calibration modal |
| `check-in/hooks/useCheckIn.ts` | Check-in workflow state + VLM orchestration |
| `check-in/hooks/useOfflineSync.ts` | Offline sync for field use |
| `services/fleetVlmService.ts` | Barrel re-export of all VLM sub-services |
| `services/odometerExtractor.ts` | Multi-pass odometer reading + calibration |
| `services/fuelExtractor.ts` | Fuel gauge + receipt extraction |
| `services/vehicleDocExtractor.ts` | Plate, licence disk, check-in dispatcher |
| `services/gpsParser.ts` | GPS log parsing for trip investigation |
| `portal/createPortalSession.ts` | Sessionless portal for field technicians |

## API Endpoints
| Method | Path | Purpose |
|--------|------|---------|
| GET/POST | `/api/fleet/vehicles` | List / create vehicles |
| GET/PUT | `/api/fleet/vehicles/[id]` | Vehicle CRUD |
| GET/POST | `/api/fleet/vehicles/[id]/calibration` | First-time calibration |
| GET/POST | `/api/fleet/vehicles/[id]/fuel` | Fuel fill-ups |
| GET/DELETE | `/api/fleet/fuel/transactions` | Fuel transaction management |
| POST | `/api/fleet/check-in/process-vlm` | VLM processing for check-in photos |
| GET/POST | `/api/fleet/check-in/records` | Check-in CRUD |
| POST | `/api/fleet/check-in/sync` | Offline sync endpoint |
| GET | `/api/fleet/investigation/index` | GPS investigation jobs |
| POST | `/api/fleet/investigation/upload` | Upload GPS log |
| GET | `/api/fleet/analytics/index` | Fleet analytics summary |
| GET | `/api/fleet/drivers/leaderboard` | Driver score leaderboard |
| GET | `/api/fleet/expiring` | Expiring licences/documents |
| GET | `/api/my/fleet/incidents` | Driver's own incident list (mig 511, PR 7) |
| GET | `/api/my/fleet/incidents/[incidentId]` | Driver's own redacted incident detail |
| POST | `/api/my/fleet/incidents/[incidentId]/submissions` | Driver explanation/follow-up (append-only) |
| POST | `/api/my/fleet/incidents/[incidentId]/evidence` | Driver evidence upload |
| POST | `/api/my/fleet/incidents/[incidentId]/attendance-correction-link` | Link an existing Attendance correction |
| POST | `/api/fleet/incidents/[incidentId]/request-driver-input` | Manager requests optional driver input |
| GET | `/api/fleet/incidents/[incidentId]/timeline` | Scoped incident chronology, keyset-paged on a µs `sort_at` (`cursor`, `limit`≤200) |
| GET | `/api/fleet/analytics/operations` | Operations analytics cards + monthly series (PR 8 task 7) |
| GET | `/api/fleet/analytics/operations/drill-down` | The incident ids behind a number, cursor-paged |

## Database Tables
- `fleet_vehicles` — vehicle registry
- `fleet_vehicle_calibration` — first-time odometer/fuel setup per vehicle
- `fleet_check_records` / `fleet_check_responses` / `fleet_check_photos` — check-in data
- `fleet_odometer_history` / `fleet_odometer_anomalies` — mileage tracking
- `fleet_fuel_history` / `fleet_fuel_transactions` — fuel events
- `fleet_gps_jobs` / `fleet_gps_trips` / `fleet_investigation_summaries` — GPS investigation
- `fleet_driver_scores` — driver scorecard data
- `fleet_vehicle_documents` / `fleet_license_disc` / `fleet_vehicle_finance` / `fleet_vehicle_insurance` / `fleet_vehicle_lease` — vehicle docs
- `fleet_vehicle_parking_locations` / `fleet_parking_compliance_checks` — overnight parking compliance (mig 483); see `.claude/modules/fleet.md`
- `fleet_portal_sessions` — sessionless portal tokens
- `fleet_photo_vlm_results` — cached VLM results per photo
- `fleet_audit_log` — audit trail
- `fleet_operational_incidents` / `..._rules` / `..._observations` / `..._actions` / `..._evidence` / `..._oversight_members` / `..._monitor_runs` — operational incidents (mig 510, PR 6); see `.claude/modules/fleet.md`
- `fleet_incident_driver_input_settings` / `..._requests` / `..._submissions` / `fleet_incident_attendance_correction_links` — optional driver incident input (mig 511, PR 7, unapplied); see `.claude/modules/fleet.md`

## Critical Rules
- First-time check-in REQUIRES calibration modal — never skip
- VLM runs on `100.96.203.105:8100`; resize images to max 1024×768 (sharp) before sending
- Managers see ALL records; technicians see only their own
- Odometer history is single source of truth for stats — not check-in snapshots
- Always calculate price/L from amount÷litres; never store pre-calculated rate
- Portal sessions use separate auth (no user login required)
- Offline sync writes to local IndexedDB, then `POST /check-in/sync` on reconnect
- Parking compliance rows are evidence: FKs are `ON DELETE SET NULL`, never CASCADE
- Driver parking declarations resolve the vehicle from the `/my` session — a body `vehicleId` is ignored
- Every parking submission enters as `pending`; even a first address needs approval
- Parking approval is ONE transaction (supersede + promote); half of it leaves two active rows or none
- Approving re-checks the driver still holds the vehicle; rejecting deliberately does not
- Operational incidents (`src/modules/fleet/incidents/`, PR 6) auto-detect only `late`/`wrong_site`/`evidence_mismatch`/`left_early`; safety/telematics types need an explicit source event
- Incident condition-clearing requires `attendance_confirmed`/`on_site_dual` AND zero evaluation flags — stale/missing evidence never clears
- Migration 510 and its cron entries are unapplied/unscheduled until a separate deployment approval; see `.claude/modules/fleet.md`
- Driver-input requests/submissions/correction-links (`src/modules/fleet/incidents/driver/`, PR 7) are append-only except a column-scoped `UPDATE` on 6 bookkeeping columns of `fleet_incident_driver_input_requests` — never a blanket grant
- A driver's explanation is stored twice on purpose: `fleet_incident_driver_submissions.explanation` (driver-scoped) and verbatim in the `driver_response_received` action's `note` (manager-visible audit timeline) — do not deduplicate
- New evidence MIME types need a registered byte signature in `MIME_SIGNATURES` (`src/lib/vfStorageUpload.ts`) BEFORE they can be enabled in driver-input settings — `versionDriverInputSettings` fails closed otherwise
- Manager queue does NOT filter by `driverInputState`/`attendanceCorrectionState` — dead client plumbing for this was deliberately removed; land server + client together if built
- Operations analytics (`src/modules/fleet/incidents/analytics/`, PR 8 task 7) reads a month from ONE source: live facts if its first day is at or after the purge cutoff, released aggregates otherwise — never both, and never the base aggregate table (use the `_published` view)
- The live half has NO k-anonymity on purpose; it is safe only because `fleet.incidents:view` already confines the viewer to their own projects. Widening the audience (export, dashboard, broader permission) invalidates that reasoning — see `.claude/modules/fleet-analytics-disclosure.md`
- `op_driver`/`op_vehicle`/`op_type`/`op_severity`/`op_outcome`/`op_evidence` AND `op_site` are refused (400) over any purged month, never silently dropped — dropping a filter WIDENS the answer. `op_site` is refused because migration 527's view publishes organisation and project rows only
- A TOTAL_ONLY aggregate publishes a component's root total with a NULL denominator and none of its members; a NONE component publishes nothing at all (incidents are all-or-nothing — `incident.total` is no metric key). Omit the missing keys, notice them per month + component, and never render them as 0. A purged month has no histogram at all (no bucket columns in the view)
- Every card/series value carries `coverage: { months, of }` — months of the range that reported the key. A card summing fewer months than the range is a partial total and must say so; project-coverage notices are counted PER MONTH, never over the union
- Vehicle telematics detectors (`src/modules/fleet/vehicleDetectors/`, PR 4) ride the EXISTING `*/5` `fleet-operational-monitor` tick as a second phase under the same lock — no new cron entry, and a detector fault must never fail the roster monitor
- A detector's `sourceEventId` is the only thing between one condition and 288 incidents a day: deterministic, bucketed, never `Date.now()`. Theft buckets on the CALENDAR after-hours night, severe_driving on `provider_event_id`, the stop on its SAST calendar DAY (its start instant SLIDES with the window — that bug shipped four ids in four ticks), lost contact on the last-fix instant
- The detector phase SENDS the opened notification itself (same call as `monitorService`) — without it a new telematics incident is silent until the action runner escalates it, and for a critical type the first thing anyone hears is an escalation WhatsApp
- Source-event dedup is free from the producer; RECURRENCE is not — `condition_last_seen_at` is never advanced for a source event, so a still-true condition looks like a one-off in the queue (known limitation)
- A telematics incident is attributed to the driver `vehicle_assignments` names for that vehicle at the EVENT instant (SAST calendar date, both ends inclusive, newest start wins; null when none) — source-event path ONLY, and that `staff_id` puts the incident on the driver's `/my` surface and enables driver-input requests, while notifications still go to PM + oversight only
- Most telematics incidents are PROJECTLESS (a road is not inside an AOI), and `isProjectOwnedByScope` refuses a null project to any restricted scope — so they are admin/oversight-only. Fleet managers who must work that queue need oversight membership, not a widened attribution rule
- Detectors read `fleet_vehicle_positions` DIRECTLY, never `fleet_vehicle_daily_stats` — an unbuilt day and an empty day look identical, so that dependency would fail silent
- `prolonged_unauthorized_stop` and `lost_contact_moving` are seven-vehicle detectors by construction (the other eleven feeds sample every 10–35 min). That is a property of the feeds; do not "fix" it by widening the cadence gate or by restricting to `granularity='history'` (`cartrack/urent` is history and is one of the eleven)
- `accident_sos` is a documented stub — NO feed carries an SOS/panic/impact field. Never synthesise one from g-force or harsh braking: it is `critical`, so a derived guess is a false emergency on WhatsApp
- `dangerous_area_entry` is DEFERRED, not stubbed: no dangerous-area geofence table exists, and no code path references it
- Vehicle-day stats (`src/modules/fleet/dailyStats/`, PR6) render through `web/statsDisplay.ts` ONLY — `coverage_ignition = false` makes ignition/moving/idle AND the speeding duration an em dash at any value, `coverage_complete = false` is a third "Partial" state, a missing row is "No data": never a 0 for any of the three
- `GET /api/fleet/vehicles/[id]/day-route?includePositions=1` returns a full SAST day of raw fixes to any holder of `fleet.vehicle-stats:view` — deliberate (Hein's call, the route map needs it), opt-in, one vehicle and one day, capped at 5,000 rows. Widening that permission inherits this disclosure; see `.claude/modules/fleet.md`
- Vehicle-day stats build (`dailyStats/`, mig 528): a row is a FULL REPLACEMENT, so a build window may only open at a SAST midnight — a part-day window overwrites a complete row with a plausible smaller one
- `coverage_gforce` is per vehicle-day (`linear_g <> 0 OR lateral_g <> 0`), never per provider: 6 of 7 `cartrack/velocity` vehicles report constant ZERO, not null
- The build never refolds a fix older than `min(watermark - 6h, yesterday 00:00 SAST)`; the repair is `scripts/fleet-daily-stats-backfill.ts --vehicle <id> --refold-day <YYYY-MM-DD>`, never a widened lookback
- The backfill must stay the SAME code path as the cron — a test fails if `backfillRunner.ts` imports anything outside its allowlist or grows SQL of its own
- Severity, not `whatsapp_enabled`, is what keeps a telematics type off WhatsApp: `requiresMandatoryIncidentWhatsApp` is `critical && source_event` and ignores the flag entirely
- Migration 511 and its number are unapplied; migration numbering churned (490→496→499→503→506→507→510→511) as master advanced — always re-check the free number before adding a new Fleet migration

## Common Issues
| Issue | Fix |
|-------|-----|
| VLM re-processes overwriting manual fuel correction | Check `user_corrected` flag before VLM write |
| Fuel transactions: wrong price/L | Recalculate from raw amount + litres |
| Portal plate scan fails silently | Retry logic in `vehicleDocExtractor.ts`; check network |
| GPS investigation job stuck | Check `fleet_gps_jobs.status`; re-upload raw log |

<!-- Auto-updated by /kb. Last: 2026-05-12 -->
