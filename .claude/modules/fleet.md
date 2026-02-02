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
Dashboard → Vehicles → Drivers → GPS Investigation → Locations → Fuel → Maintenance → Analytics → Portal → Check-In Audit

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
- Added `LicenseDiscModal` with full OCR extraction and verification
- Added `engineNumber` field to `FleetVehicle` type
- Reordered tabs: Vehicles first, then Drivers
- Default vehicles list to Active status filter
- Show filtered vehicle count in header

## Recent Changes (Jan 2026)
- Added `VehicleCalibrationModal` for first-time setup
- Added calibration API with grandfathering logic
- Integrated NAFNet deblurring for blurry dashboard photos
- CPU mode for NAFNet (RTX 5090 sm_120 incompatible)
