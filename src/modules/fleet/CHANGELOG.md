# Changelog - Fleet Module

All notable changes to the Fleet module will be documented in this file.

Format: `## [Commit Hash] - YYYY-MM-DD - Author - Type`

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
