# Fleet Module

Vehicle management and GPS trip investigation for FibreFlow.

## Overview

The Fleet module provides:
- Centralized vehicle registry (source of truth for all company vehicles)
- GPS trip analysis and classification
- Automated investigation report generation
- Suspicious pattern detection (casino visits, after-hours, unauthorized overnights)
- Financial impact calculation

## Module Structure

```
src/modules/fleet/
├── types/
│   ├── vehicle.types.ts      # FleetVehicle, VehicleType, VehicleStatus
│   ├── gps.types.ts          # GPSPoint, GPSTrip, ClassifiedTrip
│   ├── investigation.types.ts # GPSJob, InvestigationSummary
│   └── index.ts
├── services/
│   ├── gpsParser.ts          # Excel → GPS points → Trips
│   ├── tripClassifier.ts     # Authorized/unauthorized classification
│   ├── patternDetector.ts    # Suspicious pattern detection
│   ├── costCalculator.ts     # Financial impact calculation
│   └── index.ts
├── utils/
│   ├── geoUtils.ts           # Haversine distance, geofencing
│   ├── dateUtils.ts          # Work hours, time categories
│   ├── excelDateParser.ts    # Excel serial date conversion
│   └── index.ts
├── components/               # UI components (to be implemented)
├── hooks/                    # React hooks (to be implemented)
└── README.md
```

## Database Tables

| Table | Purpose |
|-------|---------|
| `fleet_vehicles` | Source of truth for vehicle details |
| `fleet_authorized_locations` | Authorized locations for geofencing |
| `fleet_gps_jobs` | GPS processing job tracking |
| `fleet_gps_trips` | Extracted trips from GPS data |
| `fleet_trip_poi` | POI enrichment for suspicious locations |
| `fleet_investigation_summaries` | Aggregated metrics per job |

## GPS Investigation Pipeline

```
1. Upload GPS Excel
   └── POST /api/fleet/investigation/upload

2. Parse Excel (xlsx library)
   └── extractTripsFromPoints()
   └── Calculate distance via Haversine

3. Classify Trips
   └── classifyTrips()
   └── Check against authorized locations

4. Detect Patterns
   └── detectPatterns()
   └── Weekend, after-hours, suspicious POI

5. Calculate Costs
   └── calculateTotalCosts()
   └── Fuel + depreciation rates

6. Generate Report
   └── reportGenerator (to be implemented)
   └── PDF with charts and maps
```

## Key Functions

### GPS Parsing
```typescript
import { parseGPSExcel, extractTripsFromPoints } from '@/modules/fleet';

const result = await parseGPSExcel(excelBuffer);
console.log(result.trips); // GPSTrip[]
```

### Trip Classification
```typescript
import { classifyTrips } from '@/modules/fleet';

const classifiedTrips = classifyTrips(trips, authorizedLocations, vehicleId);
```

### Pattern Detection
```typescript
import { detectPatterns } from '@/modules/fleet';

const patterns = detectPatterns(classifiedTrips);
// Returns: WEEKEND_USAGE, AFTER_HOURS, NIGHT_TRAVEL, SUSPICIOUS_POI, etc.
```

### Cost Calculation
```typescript
import { calculateTotalCosts } from '@/modules/fleet';

const costs = calculateTotalCosts(trips, fuelRate, depreciationRate);
// Returns: totalCost, authorizedCost, unauthorizedCost
```

## Pattern Types

| Pattern | Description | Severity |
|---------|-------------|----------|
| `WEEKEND_USAGE` | Trips on Saturday/Sunday | MEDIUM |
| `AFTER_HOURS` | Trips 18:00-22:00 | LOW-MEDIUM |
| `NIGHT_TRAVEL` | Trips 22:00-05:00 | MEDIUM-HIGH |
| `SUSPICIOUS_POI` | Near casino, bar, nightclub | HIGH |
| `WORK_HOURS_VIOLATION` | Unauthorized location during work hours | HIGH |
| `CONSECUTIVE_UNAUTHORIZED_NIGHTS` | 3+ consecutive unauthorized nights | CRITICAL |

## Integration with Staff Module

The Fleet module integrates with Staff > Vehicles:
- Vehicles are created in Fleet, assigned to staff
- Staff > Vehicles tab reads from Fleet via `fleet_vehicle_id`
- Editing a vehicle in Staff updates the Fleet record

## Default Cost Rates

- Fuel: R3.00/km
- Depreciation: R1.50/km
- Total: R4.50/km

## Tests

```bash
# Run all Fleet tests
npm test -- tests/unit/modules/fleet/

# Run specific test file
npm test -- tests/unit/modules/fleet/gpsParser.test.ts
```

## PRD & Documentation

- PRD: `docs/PRDs/PRD-039-fleet-module.md`
- Migration: `scripts/migrations/039_fleet_module.sql`
- Test Specs: `tests/specs/fleet-module.spec.md`
