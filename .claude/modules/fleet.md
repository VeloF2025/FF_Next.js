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

## Recent Changes (Jan 2026)
- Added `VehicleCalibrationModal` for first-time setup
- Added calibration API with grandfathering logic
- Integrated NAFNet deblurring for blurry dashboard photos
- CPU mode for NAFNet (RTX 5090 sm_120 incompatible)
