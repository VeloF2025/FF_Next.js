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

## Common Issues
| Issue | Fix |
|-------|-----|
| VLM re-processes overwriting manual fuel correction | Check `user_corrected` flag before VLM write |
| Fuel transactions: wrong price/L | Recalculate from raw amount + litres |
| Portal plate scan fails silently | Retry logic in `vehicleDocExtractor.ts`; check network |
| GPS investigation job stuck | Check `fleet_gps_jobs.status`; re-upload raw log |

<!-- Auto-updated by /kb. Last: 2026-05-12 -->
