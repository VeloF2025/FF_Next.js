# PRD-039: Fleet Vehicle Management & GPS Trip Investigation

## Document Info
| Field | Value |
|-------|-------|
| PRD Number | 039 |
| Feature | Fleet Module |
| Status | In Development |
| Created | 2026-01-14 |
| Branch | `feature/fleet-module` |

---

## 1. Executive Summary

### 1.1 Vision
Transform FibreFlow's vehicle management from a staff-embedded feature into a standalone Fleet module with comprehensive GPS trip analysis, automated investigation reports, and unauthorized usage detection.

### 1.2 Problem Statement
- Vehicles are currently buried in Staff detail pages with no fleet-wide visibility
- No GPS tracking analysis capability
- Manual investigation of unauthorized vehicle usage is time-consuming (4-6 hours per vehicle)
- No automated detection of suspicious patterns (casino visits, after-hours usage, unauthorized overnights)

### 1.3 Solution
A dedicated Fleet module that:
- Provides centralized vehicle registry
- Enables automated GPS Excel import and trip analysis
- Generates professional PDF investigation reports
- Maintains seamless integration with Staff vehicle assignments

### 1.4 Success Metrics
| Metric | Target |
|--------|--------|
| GPS Processing Time | < 5 minutes for 40,000+ points |
| Report Generation | Fully automated (zero manual intervention) |
| Trip Classification Accuracy | > 95% |
| POI Detection | 100% coverage within 250m radius |

---

## 2. User Stories

### 2.1 Fleet Manager
```
AS A fleet manager
I WANT TO view all company vehicles in one place
SO THAT I can manage the fleet efficiently
```

**Acceptance Criteria:**
- [ ] Fleet dashboard shows all vehicles with status
- [ ] Can filter by status, type, assigned/unassigned
- [ ] Can create new vehicles
- [ ] Can see which staff member has each vehicle

### 2.2 GPS Investigation
```
AS A fleet manager
I WANT TO upload GPS tracking data and get an automated investigation report
SO THAT I can identify unauthorized vehicle usage without manual analysis
```

**Acceptance Criteria:**
- [ ] Drag-drop Excel upload
- [ ] Automatic vehicle detection from file
- [ ] Processing status with progress indicator
- [ ] PDF report matching sample format (12 pages)
- [ ] Interactive map with trip visualization

### 2.3 Staff Assignment
```
AS AN HR administrator
I WANT TO assign fleet vehicles to staff members
SO THAT I can track who has which company vehicle
```

**Acceptance Criteria:**
- [ ] Staff > Vehicles tab shows assigned vehicles from Fleet
- [ ] Can assign existing Fleet vehicle
- [ ] Can create new vehicle (adds to Fleet + assigns)
- [ ] Can edit vehicle details (updates Fleet record)
- [ ] View vehicle GPS investigation history

### 2.4 Authorized Locations
```
AS A fleet manager
I WANT TO configure authorized locations (work sites, accommodations)
SO THAT the system can classify trips as authorized or unauthorized
```

**Acceptance Criteria:**
- [ ] Global locations (apply to all vehicles)
- [ ] Per-vehicle overrides
- [ ] Configurable radius (km)
- [ ] Location types: work_site, accommodation, supplier, client

---

## 3. Functional Requirements

### 3.1 Fleet Vehicle Management

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-FV-001 | Create vehicle with registration, make, model, year, color, VIN | P0 |
| FR-FV-002 | Vehicle types: bakkie, sedan, van, truck, SUV | P0 |
| FR-FV-003 | Ownership: company, rental, leased | P0 |
| FR-FV-004 | Configurable fuel/depreciation rates per vehicle | P0 |
| FR-FV-005 | Vehicle status: active, maintenance, retired | P1 |
| FR-FV-006 | Assignment history per vehicle | P1 |

### 3.2 GPS Trip Investigation

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-GPS-001 | Upload Excel file (max 50MB) | P0 |
| FR-GPS-002 | Parse trips from Ignition On/Off markers | P0 |
| FR-GPS-003 | Calculate trip distance via Haversine formula | P0 |
| FR-GPS-004 | Classify trips: AUTHORIZED, UNAUTHORIZED | P0 |
| FR-GPS-005 | Time categories: WORK_HOURS, AFTER_HOURS, NIGHT_TRAVEL | P0 |
| FR-GPS-006 | POI enrichment via Nominatim (bars, restaurants, casinos) | P0 |
| FR-GPS-007 | Detect suspicious patterns (see Section 3.4) | P0 |
| FR-GPS-008 | Generate PDF report matching sample format | P0 |
| FR-GPS-009 | Interactive Leaflet map with trip routes | P1 |
| FR-GPS-010 | Export CSV of trips | P2 |

### 3.3 Staff Integration

| ID | Requirement | Priority |
|----|-------------|----------|
| FR-SI-001 | Staff > Vehicles tab reads from Fleet | P0 |
| FR-SI-002 | Assign existing Fleet vehicle to staff | P0 |
| FR-SI-003 | Create new vehicle from Staff modal (adds to Fleet) | P0 |
| FR-SI-004 | Edit vehicle details (updates Fleet record) | P0 |
| FR-SI-005 | View vehicle GPS investigation history | P1 |

### 3.4 Pattern Detection

| Pattern | Classification | Risk Level |
|---------|---------------|------------|
| Casino within 250m | UNAUTHORIZED | HIGH |
| Bar/tavern within 250m | UNAUTHORIZED | HIGH |
| Nightclub within 250m | UNAUTHORIZED | HIGH |
| Weekend trip (Sat/Sun) | Flagged | MEDIUM |
| After-hours (18:00-06:00) | Flagged | LOW-MEDIUM |
| Night travel (22:00-05:00) | UNAUTHORIZED | MEDIUM |
| Work hours at non-work location | VIOLATION | HIGH |
| Unauthorized overnight location | UNAUTHORIZED | HIGH |
| > 6 consecutive unauthorized nights | CRITICAL | CRITICAL |

---

## 4. Non-Functional Requirements

| ID | Requirement | Target |
|----|-------------|--------|
| NFR-001 | GPS file processing time | < 5 min for 40K points |
| NFR-002 | API response time | < 500ms (p95) |
| NFR-003 | Nominatim rate limiting | 1 request/sec |
| NFR-004 | PDF generation | < 30 seconds |
| NFR-005 | Concurrent users | 50+ |
| NFR-006 | Data retention | 90 days for GPS files |

---

## 5. Architecture Decision

**Option B: Clean Separation (Chosen)**
- Fleet = Company vehicles (long-term staff assignments)
- Assets = Equipment (check out/in, short-term)
- Equipment can still be assigned TO vehicles via `toType: 'vehicle'`

### Data Model

```
┌─────────────────┐     ┌─────────────────────┐     ┌─────────────┐
│ fleet_vehicles  │────<│ vehicle_assignments │>────│    staff    │
│ (source of      │     │ (link table)        │     │             │
│  truth)         │     └─────────────────────┘     └─────────────┘
└────────┬────────┘
         │
         ├──────────────┐
         │              │
┌────────▼────────┐  ┌──▼─────────────────────┐
│ fleet_gps_jobs  │  │ fleet_authorized_      │
│ (investigations)│  │ locations              │
└────────┬────────┘  └────────────────────────┘
         │
┌────────▼────────┐
│ fleet_gps_trips │
└────────┬────────┘
         │
┌────────▼────────┐
│ fleet_trip_poi  │
└─────────────────┘
```

---

## 6. Database Schema

### 6.1 New Tables

**Migration:** `scripts/migrations/039_fleet_module.sql`

| Table | Purpose |
|-------|---------|
| `fleet_vehicles` | Source of truth for vehicle details |
| `fleet_authorized_locations` | Global + per-vehicle authorized locations |
| `fleet_gps_jobs` | GPS processing job tracking |
| `fleet_gps_trips` | Individual trips extracted from GPS |
| `fleet_trip_poi` | POI enrichment for suspicious locations |
| `fleet_investigation_summaries` | Aggregated metrics per job |

### 6.2 Modified Tables

| Table | Change |
|-------|--------|
| `vehicle_assignments` | Add `fleet_vehicle_id` FK reference |

---

## 7. Module Structure

```
src/modules/fleet/
├── types/
│   ├── vehicle.types.ts      # FleetVehicle, VehicleType
│   ├── gps.types.ts          # GPSPoint, GPSTrip, ClassifiedTrip
│   ├── investigation.types.ts # Job, Summary, Report
│   └── index.ts
├── services/
│   ├── vehicleService.ts     # CRUD for fleet_vehicles
│   ├── gpsParser.ts          # Excel → trips
│   ├── tripClassifier.ts     # Authorized/unauthorized
│   ├── poiEnrichment.ts      # Nominatim API
│   ├── patternDetector.ts    # Weekend, after-hours, POI
│   ├── costCalculator.ts     # Financial impact
│   └── reportGenerator.ts    # PDF generation
├── utils/
│   ├── geoUtils.ts           # Haversine distance
│   ├── dateUtils.ts          # Work hours detection
│   └── excelDateParser.ts    # Excel serial → Date
├── components/
│   ├── FleetDashboard.tsx
│   ├── VehicleList.tsx
│   ├── VehicleForm.tsx
│   ├── GPSUploadDropzone.tsx
│   ├── InvestigationDashboard.tsx
│   ├── TripMap.tsx           # Leaflet map
│   └── PatternAlerts.tsx
├── hooks/
│   ├── useFleetVehicles.ts
│   ├── useInvestigation.ts
│   └── useAuthorizedLocations.ts
└── README.md
```

---

## 8. API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/fleet/vehicles` | GET, POST | List/create vehicles |
| `/api/fleet/vehicles/[id]` | GET, PUT, DELETE | Vehicle CRUD |
| `/api/fleet/vehicles/[id]/assign` | POST | Assign to staff |
| `/api/fleet/vehicles/[id]/unassign` | POST | Remove assignment |
| `/api/fleet/locations` | GET, POST | Authorized locations |
| `/api/fleet/locations/[id]` | PUT, DELETE | Location CRUD |
| `/api/fleet/investigation/upload` | POST | Upload GPS Excel |
| `/api/fleet/investigation/[jobId]` | GET | Job status + summary |
| `/api/fleet/investigation/[jobId]/trips` | GET | Trip details |
| `/api/fleet/investigation/[jobId]/report` | GET | Download PDF |

---

## 9. UI Pages

| Page | Path | Description |
|------|------|-------------|
| Fleet Dashboard | `/fleet` | Overview, stats, recent activity |
| All Vehicles | `/fleet/vehicles` | Vehicle roster |
| Vehicle Detail | `/fleet/vehicles/[id]` | Vehicle info + assignment history |
| GPS Investigation | `/fleet/investigation` | Upload + job list |
| Investigation Report | `/fleet/investigation/[jobId]` | Dashboard with map |
| Authorized Locations | `/fleet/locations` | Global + per-vehicle |

---

## 10. GPS Investigation Pipeline

```
1. Upload GPS Excel
   └── POST /api/fleet/investigation/upload

2. Parse Excel (xlsx library)
   └── Extract trips (Ignition On → Ignition Off)
   └── Calculate distance via Haversine

3. Classify Trips
   └── Check against authorized locations (geofencing)
   └── Detect work hours, weekend, night travel

4. Enrich with POI (Nominatim API, 1 req/sec)
   └── Find bars/restaurants/casinos within 250m
   └── Flag suspicious locations

5. Detect Patterns
   └── Work hours violations
   └── Unauthorized overnight stays
   └── Consecutive suspicious behavior

6. Calculate Costs
   └── unauthorized_km × (fuel_rate + depreciation_rate)

7. Generate PDF Report
   └── HTML template → Puppeteer → PDF
   └── Matching sample report format

8. Return job ID + summary
```

---

## 11. Validation Rules

### Vehicle Validation

| Field | Rule | Error Message |
|-------|------|---------------|
| registration | Required, unique, max 20 chars | "Registration is required" / "Registration already exists" |
| vehicleType | Required, enum | "Vehicle type is required" |
| make | Optional, max 50 chars | - |
| model | Optional, max 50 chars | - |
| year | Optional, 1900-2100 | "Invalid year" |
| fuelRatePerKm | Required, > 0 | "Fuel rate must be positive" |
| depreciationRatePerKm | Required, >= 0 | "Depreciation rate cannot be negative" |

### Authorized Location Validation

| Field | Rule | Error Message |
|-------|------|---------------|
| name | Required, max 100 chars | "Name is required" |
| lat | Required, -90 to 90 | "Invalid latitude" |
| lon | Required, -180 to 180 | "Invalid longitude" |
| radiusKm | Required, > 0, <= 100 | "Radius must be between 0 and 100 km" |

### GPS Upload Validation

| Rule | Error Message |
|------|---------------|
| File required | "GPS file is required" |
| Max 50MB | "File size exceeds 50MB limit" |
| .xls or .xlsx extension | "Invalid file type. Upload .xls or .xlsx" |
| Must contain GPS points | "No GPS points found in file" |

---

## 12. Dependencies

### Install
```bash
npm install leaflet react-leaflet @types/leaflet
```

### Already Available
- xlsx (Excel parsing)
- puppeteer (PDF generation)
- recharts (charts)

---

## 13. Files to Create/Modify

| Action | File |
|--------|------|
| CREATE | `scripts/migrations/039_fleet_module.sql` |
| CREATE | `src/modules/fleet/` (entire module) |
| CREATE | `pages/api/fleet/*.ts` (10 API files) |
| CREATE | `pages/fleet/*.tsx` (6 pages) |
| MODIFY | `src/components/layout/Sidebar.tsx` (add Fleet section) |
| MODIFY | `src/modules/staff/components/tabs/VehiclesTab.tsx` (use Fleet data) |
| MODIFY | `pages/api/staff/[staffId]/vehicles.ts` (join with fleet_vehicles) |

---

## 14. Implementation Order (TDD)

### Phase 1: Foundation
1. Database migration
2. TypeScript types
3. Geo utilities (Haversine)

### Phase 2: GPS Processing
4. Excel parser
5. Trip classifier
6. Pattern detector

### Phase 3: API
7. Vehicle CRUD API
8. Investigation upload API
9. Location management API

### Phase 4: UI
10. Fleet pages
11. Leaflet map integration
12. Staff vehicles integration

### Phase 5: Reports
13. PDF report generator
14. Report download API

---

## 15. Risk Assessment

| Risk | Mitigation |
|------|------------|
| Large GPS files (50MB+) | Streaming parser, progress indicator |
| Nominatim rate limits | Queue with 1 req/sec, caching |
| PDF generation timeout | Background job, async processing |
| Data migration | Backward compatible, incremental |

---

## 16. Security & Permissions

### Role-Based Access

| Role | Permissions |
|------|-------------|
| Admin | Full access to all Fleet features |
| Fleet Manager | CRUD vehicles, upload GPS, view reports |
| HR Manager | Assign vehicles to staff, view vehicle list |
| Staff | View own assigned vehicle only |

### Data Security
- GPS data contains location history - treat as sensitive PII
- Reports should be access-controlled (only creator + admins)
- File uploads scanned for malware before processing
- API endpoints protected by Clerk authentication

---

## 17. PDF Report Sections

**Matching sample report format (12 pages):**

### 17.1 Cover Page
- Vehicle registration, make/model
- Investigation period (start - end date)
- Overall classification: AUTHORIZED / UNAUTHORIZED / MIXED
- Generated date and preparer

### 17.2 Executive Summary
- Total trips count
- Authorized vs unauthorized breakdown (pie chart)
- Total kilometers driven
- Unauthorized kilometers
- Financial impact summary

### 17.3 Proximity POI Analysis
- Suspicious locations within 250m
- Categories: casino, bar, nightclub, restaurant
- Visit frequency per location
- Risk level badges (LOW/MEDIUM/HIGH)

### 17.4 Work Hours Violation Analysis
- Days with unauthorized locations during work hours
- Timeline visualization
- Location details per violation

### 17.5 Overnight Location Analysis
- Unauthorized overnight stays (not at accommodation)
- Consecutive nights count
- Distance from nearest authorized location
- Map of overnight locations

### 17.6 Night Trips Analysis
- Trips between 22:00 - 05:00
- Start/end locations
- Distance and duration
- Purpose assessment

### 17.7 Financial Impact
- Fuel rate per km: R3.00 (configurable)
- Depreciation rate per km: R1.50 (configurable)
- Total unauthorized cost calculation
- Breakdown by category (weekend, after-hours, etc.)

### 17.8 Recommendations
**Immediate Actions:**
- Address specific violations
- Vehicle recovery if needed
- Staff disciplinary process

**Long-Term:**
- GPS monitoring policy
- Authorized location updates
- Training requirements

---

## 18. Error Handling

### API Error Codes

| Code | Error | Resolution |
|------|-------|------------|
| 400 | Invalid file format | Upload .xls or .xlsx only |
| 400 | File too large | Max 50MB |
| 400 | No GPS data found | Check file contains GPS points |
| 404 | Vehicle not found | Check vehicle ID |
| 404 | Job not found | Check job ID |
| 409 | Registration exists | Use different registration |
| 500 | Processing failed | Retry upload |
| 503 | Nominatim unavailable | POI enrichment skipped, retry later |

### Retry Logic
- GPS processing: 3 retries with exponential backoff
- Nominatim API: Queue with 1 req/sec, cache results
- PDF generation: Timeout after 60s, mark job as failed

---

## 19. Testing Requirements

### Coverage Targets

| Category | Target |
|----------|--------|
| Unit tests | > 80% |
| Integration tests | > 70% |
| E2E tests | Critical paths |

### Test Files
- `tests/unit/modules/fleet/` - Unit tests (99 tests ✓)
- `tests/integration/api/fleet/` - API tests
- `tests/e2e/fleet/` - Full flow tests

### Test Fixtures
| File | Purpose |
|------|---------|
| `sample-gps.xlsx` | Standard GPS data |
| `known-distance.xlsx` | Distance accuracy validation |
| `empty.xlsx` | Error handling |
| `large-file.xlsx` | Performance testing (40K+ points) |

---

## 20. Wireframes

### Fleet Dashboard
```
┌─────────────────────────────────────────────────────┐
│ Fleet Dashboard                              [+ Add] │
├─────────────────────────────────────────────────────┤
│ ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌─────────────┐ │
│ │ Total   │ │ Active  │ │ Assigned│ │ Investigations│
│ │   12    │ │   10    │ │    8    │ │      3       │ │
│ └─────────┘ └─────────┘ └─────────┘ └─────────────┘ │
├─────────────────────────────────────────────────────┤
│ Recent Vehicles                                      │
│ ┌─────────────────────────────────────────────────┐ │
│ │ GP 456-789  Toyota Hilux    John Smith  Active  │ │
│ │ CA 123-456  Ford Ranger     Jane Doe    Active  │ │
│ └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

### GPS Investigation Upload
```
┌─────────────────────────────────────────────────────┐
│ GPS Investigation                                    │
├─────────────────────────────────────────────────────┤
│  ┌───────────────────────────────────────────────┐  │
│  │                                               │  │
│  │     📁 Drop GPS Excel file here               │  │
│  │        or click to browse                     │  │
│  │                                               │  │
│  │     Supports: .xls, .xlsx (max 50MB)         │  │
│  │                                               │  │
│  └───────────────────────────────────────────────┘  │
│                                                      │
│  Vehicle: [Select vehicle ▼]                        │
│                                                      │
│  [Upload & Process]                                 │
├─────────────────────────────────────────────────────┤
│ Recent Jobs                                          │
│ ┌─────────────────────────────────────────────────┐ │
│ │ GP 456-789  Nov 1-30  Completed  [View Report]  │ │
│ │ CA 123-456  Oct 1-31  Processing  75%           │ │
│ └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-14 | Initial PRD created |
| 2026-01-14 | Added Security, Report Sections, Error Handling, Testing, Wireframes |
