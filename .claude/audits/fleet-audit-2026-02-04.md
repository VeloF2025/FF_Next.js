# Fleet Module Audit Report
**Date:** 2026-02-04
**Sample Vehicle:** KR27FNGP (Toyota Land Cruiser 2020)
**Vehicle ID:** 47db386b-1557-4936-8366-3645b407f2e7

## Executive Summary

The fleet module has a robust architecture with 127 source files, 59 API endpoints, and 30+ database tables. However, **critical data persistence bugs** were identified that prevent odometer history and photos from being saved correctly.

---

## Critical Issues Found

### 1. Odometer History NOT Being Saved
**Severity:** CRITICAL
**Impact:** No odometer tracking, can't detect anomalies or fraud

**Root Cause:** `createCheckRecord()` in `checkInService.ts:286` saves `odometer_reading` to `fleet_check_records` but does NOT call `recordOdometerReading()` to save to `fleet_odometer_history`.

**Flow Analysis:**
```
createCheckRecord()  →  fleet_check_records.odometer_reading ✅
                    ❌  fleet_odometer_history (NOT CALLED)
```

`recordOdometerReading()` is ONLY called from `process-vlm.ts:146` when:
- VLM successfully extracts a reading
- Validation doesn't reject the reading
- Not in preview mode

**Fix Required:** Add `recordOdometerReading()` call in `createCheckRecord()` when manual odometer is provided:
```typescript
// After line 333 in checkInService.ts
if (input.odometerReading) {
  await recordOdometerReading({
    vehicleId: input.vehicleId,
    checkRecordId: recordRow.id,
    reading: input.odometerReading,
    source: 'manual',
  });
}
```

### 2. Photos Not Being Uploaded for Some Check-ins
**Severity:** HIGH
**Impact:** Missing photo evidence for compliance/audit

**Root Cause:** Photo upload at `useCheckIn.ts:564` only uploads if `photo.file` exists:
```typescript
if (photo.file) {  // Photos without File object are NOT uploaded
```

**Issue:** If camera capture only provides `dataUrl` without `File` object, photos are captured locally but never uploaded to server.

**Verification Needed:** Check if `CheckInPhotoGridEnhanced.tsx` passes the File object from camera capture.

### 3. VLM Results Not Persisting
**Severity:** MEDIUM
**Impact:** VLM analysis lost, can't audit AI decisions

**Root Cause:** VLM processing happens in two phases:
1. **Preview mode** (with temp IDs) - Results NOT saved to DB
2. **Post-submit** (fire-and-forget) - May fail silently

At `useCheckIn.ts:597-616`, VLM re-processing is done without awaiting:
```typescript
fetch('/api/fleet/check-in/process-vlm', {...})
  .then(r => {...})  // Fire and forget
  .catch(e => log.error(...));  // Only logs, no recovery
```

---

## Database Audit Results for KR27FNGP

| Table | Status | Count | Notes |
|-------|--------|-------|-------|
| fleet_vehicles | ✅ | 1 | Vehicle found, status: active |
| fleet_vehicle_calibration | ✅ | 1 | 167,478 km, 40% fuel |
| fleet_check_records | ⚠️ | 3 | All "pending" status - none approved |
| fleet_odometer_history | ❌ | 0 | **EMPTY - Critical bug** |
| fleet_check_photos | ❌ | 0 | **No photos for this vehicle** |
| fleet_photo_vlm_results | ❌ | 0 | **No VLM results** |
| fleet_license_disc | ✅ | 1 | Active, expires 2026-06-30 |
| fleet_vehicle_documents | ⚠️ | 0 | No documents |
| fleet_vehicle_insurance | ⚠️ | 0 | No insurance records |
| fleet_fuel_transactions | ✅ | varies | Has fuel data |

---

## Data Anomalies Detected

### 30,006 km Odometer Jump
**Check-in on 2025-01-24:**
- Odometer reading: **197,484 km**
- Calibration reading: **167,478 km** (from 2024-12-23)
- **Jump of 30,006 km in ~1 month**

This should have triggered an anomaly warning but wasn't captured because:
1. No odometer history to compare against
2. VLM validation runs in preview mode only

---

## API Audit Results

All 59 fleet APIs were tested. Key findings:

| Endpoint | Status | Notes |
|----------|--------|-------|
| /api/fleet/vehicles | ✅ | Returns 21 vehicles |
| /api/fleet/check-in/records | ✅ | Returns 12 records with full data |
| /api/fleet/check-in/templates | ✅ | Returns 3 templates (daily, weekly, default) |
| /api/fleet/check-in/audit | ✅ | Returns 12 audit records |
| /api/fleet/fuel/summary | ✅ | Fuel analytics working |
| /api/fleet/drivers/* | ✅ | Driver endpoints working |

---

## UI/UX Audit Results

| Page | Status | Notes |
|------|--------|-------|
| Fleet Dashboard | ✅ | All stats loading |
| Vehicle List | ✅ | 21 vehicles displayed |
| Vehicle Detail | ✅ | All tabs working (Overview, Odometer, Fuel, Docs, Insurance) |
| Check-In Form | ✅ | Daily/Weekly modes working |
| Driver Dashboard | ✅ | Leaderboard working |
| Driver Scoring | ✅ | Stats displayed |
| Fuel Analytics | ✅ | Charts rendering |
| Check-In Audit | ✅ | Discrepancy detection UI working |
| Portal Page | ✅ | Shows "Take Photo" button for calibrated vehicles |

---

## Driver Data Audit

### Assigned Driver for KR27FNGP
- **Name:** Keoratile Sekatle
- **ID:** 79d0e4fd-c0e5-40c2-beba-4f37a07e0ea0
- **Status:** Active
- **License:** ⚠️ Shows "Invalid/Missing" - Expired 2021-11-14

**Issue:** Driver with expired license is assigned to active vehicle.

---

## Fixes Implemented (2026-02-04)

### ✅ Fix 1: Odometer History Persistence
**File:** `src/modules/fleet/services/checkInService.ts`

Added `recordOdometerReading()` call in `createCheckRecord()` to ensure odometer readings are ALWAYS saved to `fleet_odometer_history`, regardless of VLM processing success.

```typescript
if (input.odometerReading) {
  await recordOdometerReading({
    vehicleId: input.vehicleId,
    checkRecordId: recordRow.id,
    reading: input.odometerReading,
    source: input.odometerSource || 'check_in',
  });
}
```

### ✅ Fix 2: HITL Correction Tracking
**Files:**
- `src/modules/fleet/types/check-in.types.ts` - Extended `OdometerSource` type
- `src/modules/fleet/check-in/hooks/useCheckIn.ts` - Track when user overrides VLM

Added new source types:
- `check_in` - Initial submission value
- `manual_override` - HITL correction after VLM extraction

The hook now tracks `odometerWasOverridden` state and passes the correct source to the API.

### ✅ Fix 3: Approval Authentication
**File:** `pages/fleet/check-in/history.tsx`

Replaced hardcoded `'current-user-id'` with actual authenticated user ID from `useAuth()`.

---

## Remaining Recommendations

### Short-term Fixes (P1)

1. **Backfill Odometer History**
   - Create migration script to copy readings from `fleet_check_records.odometer_reading` to `fleet_odometer_history`

2. **Photo Upload Investigation**
   - Verify File object is being passed through camera flow
   - Add fallback: convert dataUrl to File if File not available

3. **Driver License Validation**
   - Add warning/block when assigning drivers with expired licenses

### Long-term Improvements (P2)

4. **VLM Reliability**
   - Add health check before VLM calls
   - Implement queuing for failed VLM requests

5. **Role-based Approval**
   - Restrict approval to fleet managers only (not any authenticated user)

---

## Files Analyzed

- `pages/api/fleet/check-in/records.ts` - Check-in API
- `pages/api/fleet/check-in/photos.ts` - Photo upload API
- `pages/api/fleet/check-in/process-vlm.ts` - VLM processing
- `src/modules/fleet/services/checkInService.ts` - Core service (1203 lines)
- `src/modules/fleet/check-in/hooks/useCheckIn.ts` - React hook (905 lines)
- `src/modules/fleet/check-in/components/CheckInForm.tsx` - UI component
- `scripts/fleet-audit.ts` - Audit script created

---

## Audit Status

| Task | Status |
|------|--------|
| Portal Authentication | ✅ Completed |
| Check-In Flow | ✅ Completed |
| Fleet APIs | ✅ Completed |
| Data Persistence | ✅ Completed - **BUGS FOUND** |
| UI/UX Audit | ✅ Completed |

**Total Time:** ~45 minutes
