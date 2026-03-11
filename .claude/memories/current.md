# FibreFlow Current Session Progress

**Last Updated**: 2026-01-20 14:45
**Session Type**: Fleet Calibration + WA Admin Multi-Phone Support

---

## Completed This Session (Jan 20, 2026)

### Fleet Vehicle Calibration System

Added first-time vehicle setup flow for Fleet Portal:

**1. VehicleCalibrationModal.tsx** (NEW)
- Full-screen mandatory modal for first-time vehicle check-in
- Requires: Odometer reading, Fuel level (0-100%), Dashboard photo
- Supports VLM few-shot learning for dashboard recognition
- Location: `src/modules/fleet/check-in/components/VehicleCalibrationModal.tsx`

**2. Calibration API** (NEW)
- GET `/api/fleet/vehicles/[id]/calibration` - Check calibration status
- POST `/api/fleet/vehicles/[id]/calibration` - Create calibration
- Logic: `needsCalibration = !calibration && checkCount === 0`
- Table: `fleet_vehicle_calibration`

**3. Portal Integration**
- Updated `pages/fleet/portal.tsx` with calibration check on vehicle verification
- Modal shows automatically when `needsCalibration: true`

### WhatsApp Admin Multi-Phone Support

Added primary/fallback phone number tracking for WA services:

**1. Migration 096** (NEW)
- Created `wa_phone_numbers` table
- Added config entries for sender/bridge phones
- Tracks: service, phone_number, role (primary/fallback), status (paired/unpaired)

**2. Phones API** (NEW)
- `pages/api/communications/whatsapp/phones/index.ts` - List/Create phones
- `pages/api/communications/whatsapp/phones/[id].ts` - Get/Update/Delete phone

**3. Services Tab Enhancement**
- Shows registered phone numbers with role badges
- Added pairing/logout controls for services
- Updated `ServicesTab.tsx` with phone number display

**4. Type Definitions**
- Added `WaPhoneNumber`, `WaPhoneNumberInput`, `WaServicePhoneConfig` types
- Updated `waAdminApiService.ts` with `phonesApi` methods

### NAFNet Deblurring Service

Fixed RTX 5090 compatibility for image deblurring:

**Issue**: CUDA sm_120 (Blackwell) not supported by PyTorch 2.2
**Solution**: Force CPU mode with `NAFNET_FORCE_CPU=true`
**Service**: Port 8101 on 100.96.203.105

---

## Database Changes

### New Tables
- `wa_phone_numbers` - WhatsApp phone tracking with primary/fallback roles

### Modified Tables
- `wa_service_config` - Added sender/bridge phone config entries

### Vehicle KR27FNGP Reset
Deleted for fresh portal testing:
- 18 check records
- 35 photos
- 16 responses
- 5 odometer history
- 8 fuel history

---

## Key Files Created/Modified

| File | Change |
|------|--------|
| `src/modules/fleet/check-in/components/VehicleCalibrationModal.tsx` | NEW - First-time setup modal |
| `pages/api/fleet/vehicles/[id]/calibration.ts` | NEW - Calibration API |
| `pages/fleet/portal.tsx` | Added calibration check + modal |
| `scripts/migrations/096_wa_service_fallback.sql` | NEW - WA phone tracking |
| `pages/api/communications/whatsapp/phones/` | NEW - Phones CRUD API |
| `src/modules/communications/whatsapp/components/ServicesTab.tsx` | Phone display + pairing |
| `src/modules/communications/whatsapp/types/wa-admin.types.ts` | Phone type definitions |
| `src/modules/communications/whatsapp/services/waAdminApiService.ts` | Phones API methods |
| `scripts/whatsapp/whatsapp-sender-v2.go` | NEW - Go sender implementation |

---

## Current State

- **Branch**: master
- **Deployed**: dev.fibreflow.app (dev) + app.fibreflow.app (production) — staging retired 2026-03-11
- **Migration 096**: Applied to production DB
- **Fleet Calibration**: Ready for testing
- **WA Admin Phones**: Visible in Services tab

---

## Phone Numbers Registered

| Service | Phone | Name | Role | Status |
|---------|-------|------|------|--------|
| sender | +27824189511 | Hein (082 418 9511) | primary | paired |
| bridge | +27640412391 | Louis (064 041 2391) | primary | paired |

---

## Context for Next Session

### Fleet Portal Flow
1. Driver scans license plate
2. VLM verifies and identifies vehicle
3. **If first time**: Calibration modal appears (mandatory)
4. After calibration: Normal check-in flow

### WA Admin Services Tab
- Now shows registered phone numbers per service
- Supports pairing new devices via QR code
- Logout button clears session

### NAFNet Status
- Running on CPU mode (RTX 5090 incompatible with PyTorch 2.2)
- Service: http://100.96.203.105:8101
- Used for deblurring photos before VLM extraction
