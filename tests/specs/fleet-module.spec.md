# Test Specification: Fleet Module

## Document Info
| Field | Value |
|-------|-------|
| PRD | PRD-039-fleet-module.md |
| Feature | Fleet Vehicle Management & GPS Trip Investigation |
| Created | 2026-01-14 |

---

## Test Structure

```
tests/
├── specs/
│   └── fleet-module.spec.md          # This specification
├── unit/
│   └── modules/fleet/
│       ├── geoUtils.test.ts          # Haversine distance tests
│       ├── dateUtils.test.ts         # Work hours detection tests
│       ├── excelDateParser.test.ts   # Excel serial date tests
│       ├── gpsParser.test.ts         # GPS parsing tests
│       ├── tripClassifier.test.ts    # Classification tests
│       ├── patternDetector.test.ts   # Pattern detection tests
│       └── costCalculator.test.ts    # Cost calculation tests
├── integration/
│   └── api/fleet/
│       ├── vehicles.test.ts          # Vehicle CRUD API
│       ├── locations.test.ts         # Authorized locations API
│       └── investigation.test.ts     # GPS upload + processing
└── fixtures/
    ├── sample-gps.xlsx               # Sample GPS data
    └── known-distance.xlsx           # Known distance for accuracy
```

---

## Unit Tests: Geo Utils

**File:** `tests/unit/modules/fleet/geoUtils.test.ts`

### Test Cases

| Test ID | Test Case | Input | Expected Result |
|---------|-----------|-------|-----------------|
| GEO-001 | Haversine: Same point | (0,0) → (0,0) | 0 km |
| GEO-002 | Haversine: Lawley → Carletonville | (-26.35,27.82) → (-26.36,27.40) | ~38km ±2km |
| GEO-003 | Haversine: Johannesburg → Cape Town | (-26.20,28.04) → (-33.93,18.42) | ~1,270km ±20km |
| GEO-004 | Haversine: Cross hemisphere | (0,0) → (0,180) | ~20,015km (half Earth) |
| GEO-005 | isWithinRadius: Point inside | Point 5km away, radius 10km | true |
| GEO-006 | isWithinRadius: Point outside | Point 15km away, radius 10km | false |
| GEO-007 | isWithinRadius: On boundary | Point 10km away, radius 10km | true |
| GEO-008 | findNearestLocation: Multiple | 3 locations | Returns closest |
| GEO-009 | findNearestLocation: Empty array | No locations | null |

---

## Unit Tests: Date Utils

**File:** `tests/unit/modules/fleet/dateUtils.test.ts`

### Test Cases

| Test ID | Test Case | Input | Expected Result |
|---------|-----------|-------|-----------------|
| DT-001 | isWorkHours: Monday 10am | 2025-11-03T10:00 | true |
| DT-002 | isWorkHours: Monday 8pm | 2025-11-03T20:00 | false |
| DT-003 | isWorkHours: Saturday 10am | 2025-11-08T10:00 | false |
| DT-004 | isNightTime: 11pm | 2025-11-03T23:00 | true |
| DT-005 | isNightTime: 3am | 2025-11-03T03:00 | true |
| DT-006 | isNightTime: 10am | 2025-11-03T10:00 | false |
| DT-007 | isWeekend: Saturday | 2025-11-08 | true |
| DT-008 | isWeekend: Sunday | 2025-11-09 | true |
| DT-009 | isWeekend: Monday | 2025-11-03 | false |
| DT-010 | getTimeCategory: Work hours | Mon 10am | WORK_HOURS |
| DT-011 | getTimeCategory: After hours | Mon 7pm | AFTER_HOURS |
| DT-012 | getTimeCategory: Night | Mon 11pm | NIGHT_TRAVEL |

---

## Unit Tests: Excel Date Parser

**File:** `tests/unit/modules/fleet/excelDateParser.test.ts`

### Test Cases

| Test ID | Test Case | Input | Expected Result |
|---------|-----------|-------|-----------------|
| ED-001 | Parse Excel serial date | 45962.074479 | 2025-11-01T01:47:15Z |
| ED-002 | Parse Excel serial date (midnight) | 45962.0 | 2025-11-01T00:00:00Z |
| ED-003 | Parse Excel serial date (noon) | 45962.5 | 2025-11-01T12:00:00Z |
| ED-004 | Handle 1900 leap year bug | 60 | 1900-02-28 (not 02-29) |
| ED-005 | Parse string date | "2025-11-01" | 2025-11-01T00:00:00Z |
| ED-006 | Handle invalid input | "invalid" | null |

---

## Unit Tests: GPS Parser

**File:** `tests/unit/modules/fleet/gpsParser.test.ts`

### Test Cases

| Test ID | Test Case | Expected Result |
|---------|-----------|-----------------|
| GPS-001 | Parse valid Excel with GPS points | success=true, totalPoints > 0 |
| GPS-002 | Extract trips from Ignition On/Off | trips.length > 0, all trips have start/end times |
| GPS-003 | Handle Excel date serial format | Correct timestamps on points |
| GPS-004 | Calculate trip distance (Haversine) | Distance within expected range |
| GPS-005 | Handle missing columns | Returns validation error |
| GPS-006 | Handle empty file | Returns error "No GPS points found" |
| GPS-007 | Fuzzy column matching | "Longitude"/"Long"/"lng" all work |
| GPS-008 | Parse vehicle info from header | Extracts registration |
| GPS-009 | Handle consecutive Ignition On (no Off) | Skips incomplete trip |
| GPS-010 | Handle trips with zero distance | distanceKm = 0 |

---

## Unit Tests: Trip Classifier

**File:** `tests/unit/modules/fleet/tripClassifier.test.ts`

### Test Cases

| Test ID | Test Case | Expected Result |
|---------|-----------|-----------------|
| TC-001 | Trip start within authorized radius | classification = 'AUTHORIZED' |
| TC-002 | Trip end within authorized radius | classification = 'AUTHORIZED' |
| TC-003 | Trip outside all authorized locations | classification = 'UNAUTHORIZED' |
| TC-004 | Trip during work hours (Mon-Fri 06:00-18:00) | timeCategory = 'WORK_HOURS' |
| TC-005 | Trip after hours (18:00-22:00) | timeCategory = 'AFTER_HOURS' |
| TC-006 | Trip at night (22:00-05:00) | timeCategory = 'NIGHT_TRAVEL' |
| TC-007 | Weekend trip (Saturday) | dayType = 'WEEKEND' |
| TC-008 | Weekday trip (Tuesday) | dayType = 'WEEKDAY' |
| TC-009 | Work hours at non-work location | isWorkHoursViolation = true |
| TC-010 | Global location applies | Uses global for classification |
| TC-011 | Vehicle-specific override | Uses override instead of global |

---

## Unit Tests: Pattern Detector

**File:** `tests/unit/modules/fleet/patternDetector.test.ts`

### Test Cases

| Test ID | Test Case | Expected Result |
|---------|-----------|-----------------|
| PD-001 | Detect weekend usage pattern | Returns WEEKEND_USAGE pattern |
| PD-002 | Detect after-hours pattern | Returns AFTER_HOURS pattern |
| PD-003 | Detect night travel pattern | Returns NIGHT_TRAVEL pattern |
| PD-004 | Detect suspicious POI (casino) | Returns SUSPICIOUS_POI with HIGH risk |
| PD-005 | Detect suspicious POI (bar) | Returns SUSPICIOUS_POI with HIGH risk |
| PD-006 | Detect work hours violation | Returns WORK_HOURS_VIOLATION |
| PD-007 | Detect unauthorized overnight | Returns UNAUTHORIZED_OVERNIGHT |
| PD-008 | Detect consecutive unauthorized nights (>3) | Returns CRITICAL severity |
| PD-009 | No patterns in normal authorized usage | Returns empty array |
| PD-010 | Multiple patterns detected | Returns all applicable patterns |

---

## Unit Tests: Cost Calculator

**File:** `tests/unit/modules/fleet/costCalculator.test.ts`

### Test Cases

| Test ID | Test Case | Expected Result |
|---------|-----------|-----------------|
| CC-001 | Calculate cost with defaults | km × 4.50 (3.00 fuel + 1.50 depreciation) |
| CC-002 | Calculate cost with custom rates | Uses provided rates |
| CC-003 | Calculate authorized vs unauthorized | Separates costs correctly |
| CC-004 | Zero distance trip | Cost = 0 |
| CC-005 | Aggregate multiple trips | Sums correctly |

---

## Integration Tests: Fleet API

**File:** `tests/integration/api/fleet/vehicles.test.ts`

### Test Cases

| Test ID | Method | Endpoint | Expected |
|---------|--------|----------|----------|
| API-V-001 | POST | /api/fleet/vehicles | 201, returns vehicle ID |
| API-V-002 | GET | /api/fleet/vehicles | 200, returns array |
| API-V-003 | GET | /api/fleet/vehicles/[id] | 200, returns vehicle |
| API-V-004 | PUT | /api/fleet/vehicles/[id] | 200, returns updated |
| API-V-005 | DELETE | /api/fleet/vehicles/[id] | 200, status='retired' |
| API-V-006 | POST | /api/fleet/vehicles (duplicate) | 400, validation error |
| API-V-007 | GET | /api/fleet/vehicles/invalid-id | 404 |
| API-V-008 | POST | /api/fleet/vehicles/[id]/assign | 200, creates assignment |
| API-V-009 | POST | /api/fleet/vehicles/[id]/unassign | 200, marks inactive |

---

## Integration Tests: Authorized Locations API

**File:** `tests/integration/api/fleet/locations.test.ts`

### Test Cases

| Test ID | Method | Endpoint | Expected |
|---------|--------|----------|----------|
| API-L-001 | POST | /api/fleet/locations | 201, returns location ID |
| API-L-002 | GET | /api/fleet/locations | 200, returns array |
| API-L-003 | GET | /api/fleet/locations?vehicleId=X | 200, filtered list |
| API-L-004 | PUT | /api/fleet/locations/[id] | 200, returns updated |
| API-L-005 | DELETE | /api/fleet/locations/[id] | 200, is_active=false |
| API-L-006 | POST | /api/fleet/locations (invalid lat) | 400, validation error |

---

## Integration Tests: GPS Investigation API

**File:** `tests/integration/api/fleet/investigation.test.ts`

### Test Cases

| Test ID | Method | Endpoint | Expected |
|---------|--------|----------|----------|
| API-I-001 | POST | /api/fleet/investigation/upload | 201, returns jobId |
| API-I-002 | POST | upload (invalid file type) | 400, validation error |
| API-I-003 | POST | upload (file > 50MB) | 400, file too large |
| API-I-004 | GET | /api/fleet/investigation/[jobId] | 200, job status |
| API-I-005 | GET | /api/fleet/investigation/[jobId]/trips | 200, classified trips |
| API-I-006 | GET | /api/fleet/investigation/[jobId]/report | 200, PDF download |

---

## Validation Rules

### Vehicle Validation

| Field | Rule | Error Message |
|-------|------|---------------|
| registration | Required | "Registration is required" |
| registration | Unique | "Registration already exists" |
| registration | Max 20 chars | "Registration too long" |
| vehicleType | Required | "Vehicle type is required" |
| vehicleType | Valid enum | "Invalid vehicle type" |
| year | 1900-2100 | "Invalid year" |
| fuelRatePerKm | > 0 | "Fuel rate must be positive" |
| depreciationRatePerKm | >= 0 | "Depreciation rate cannot be negative" |

### Authorized Location Validation

| Field | Rule | Error Message |
|-------|------|---------------|
| name | Required | "Name is required" |
| name | Max 100 chars | "Name too long" |
| lat | Required | "Latitude is required" |
| lat | -90 to 90 | "Invalid latitude" |
| lon | Required | "Longitude is required" |
| lon | -180 to 180 | "Invalid longitude" |
| radiusKm | > 0 | "Radius must be positive" |
| radiusKm | <= 100 | "Radius cannot exceed 100km" |

### GPS Upload Validation

| Rule | Error Message |
|------|---------------|
| File required | "GPS file is required" |
| Max 50MB | "File size exceeds 50MB limit" |
| .xls/.xlsx extension | "Invalid file type" |
| Contains GPS data | "No GPS points found" |
| Valid vehicle ID | "Vehicle not found" |

---

## Test Fixtures

| File | Description |
|------|-------------|
| `sample-gps.xlsx` | Real GPS data with mixed trips |
| `known-distance.xlsx` | Trips with known distances |
| `empty.xlsx` | Empty file for error testing |
| `invalid-columns.xlsx` | Missing required columns |
