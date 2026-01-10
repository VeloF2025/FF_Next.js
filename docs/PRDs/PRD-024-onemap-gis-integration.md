# PRD-024: 1Map GIS Integration with Excel Import

## Overview
Add 1Map GIS integration service with Excel import capabilities for bulk project data (poles, drops, zones, PONs).

## Problem Statement
1. No connection to 1Map GIS system for spatial data
2. Project data (poles, installations) manually tracked
3. No way to bulk import from Excel HLD sheets
4. GPS coordinates not systematically captured

## Goals
1. Create OneMap API client for 1Map authentication and data fetching
2. Create sync service for data synchronization
3. Build Excel import scripts for HLD sheets
4. Create database schema for GIS data

## Data Model

### OneMap Schema
```sql
-- Projects (extends existing)
CREATE TABLE onemap.projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code VARCHAR(10) UNIQUE NOT NULL,  -- LAW, MAM, MOH
  name VARCHAR(255) NOT NULL,
  total_drops INTEGER DEFAULT 0,
  total_poles INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW()
);

-- Zones within projects
CREATE TABLE onemap.zones (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES onemap.projects(id),
  code VARCHAR(20) NOT NULL,
  name VARCHAR(255),
  drop_count INTEGER DEFAULT 0,
  UNIQUE(project_id, code)
);

-- PONs (Passive Optical Networks)
CREATE TABLE onemap.pons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  zone_id UUID REFERENCES onemap.zones(id),
  project_id UUID REFERENCES onemap.projects(id),
  code VARCHAR(50) NOT NULL,
  splitter_type VARCHAR(20),  -- 1:8, 1:16, 1:32
  capacity INTEGER,
  UNIQUE(project_id, code)
);

-- Poles
CREATE TABLE onemap.poles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES onemap.projects(id),
  zone_id UUID REFERENCES onemap.zones(id),
  pon_id UUID REFERENCES onemap.pons(id),
  code VARCHAR(50) NOT NULL,
  pole_type VARCHAR(20),  -- distribution, feeder
  gps_lat DECIMAL(10, 7),
  gps_lng DECIMAL(10, 7),
  drop_count INTEGER DEFAULT 0,
  UNIQUE(project_id, code)
);

-- Drops (installations/homes)
CREATE TABLE onemap.drops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES onemap.projects(id),
  zone_id UUID REFERENCES onemap.zones(id),
  pon_id UUID REFERENCES onemap.pons(id),
  pole_id UUID REFERENCES onemap.poles(id),
  dr_number VARCHAR(20),
  address TEXT,
  gps_lat DECIMAL(10, 7),
  gps_lng DECIMAL(10, 7),
  status VARCHAR(20),  -- planned, installed, active
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_poles_project ON onemap.poles(project_id);
CREATE INDEX idx_poles_gps ON onemap.poles(gps_lat, gps_lng);
CREATE INDEX idx_drops_project ON onemap.drops(project_id);
CREATE INDEX idx_drops_dr ON onemap.drops(dr_number);
```

## OneMap API Client

### Authentication
```typescript
interface OneMapAuth {
  apiKey: string;
  baseUrl: string;
}

class OneMapClient {
  private auth: OneMapAuth;

  async authenticate(): Promise<string>;  // Returns token
  async getProjects(): Promise<OneMapProject[]>;
  async getZones(projectId: string): Promise<OneMapZone[]>;
  async getPoles(projectId: string): Promise<OneMapPole[]>;
  async getInstallations(projectId: string): Promise<OneMapInstallation[]>;
}
```

### Sync Service
```typescript
class OneMapSyncService {
  async syncProject(projectCode: string): Promise<SyncResult>;
  async syncAllProjects(): Promise<SyncResult[]>;
  async getLastSyncTime(projectId: string): Promise<Date>;
}

interface SyncResult {
  projectCode: string;
  zonesCreated: number;
  zonesUpdated: number;
  polesCreated: number;
  polesUpdated: number;
  dropsCreated: number;
  dropsUpdated: number;
  errors: string[];
}
```

## Excel Import Scripts

### HLD_Home Import (Installations/Drops)
Reads from project tracker Excel files:
- Sheet: `HLD_Home`
- Columns: Zone, PON, Pole, Address, GPS

```javascript
// scripts/import-onemap-excel.js
const xlsx = require('xlsx');
const { neon } = require('@neondatabase/serverless');

async function importHLDHome(filePath, projectCode) {
  const workbook = xlsx.readFile(filePath);
  const sheet = workbook.Sheets['HLD_Home'];
  const data = xlsx.utils.sheet_to_json(sheet);

  for (const row of data) {
    await sql`
      INSERT INTO onemap.drops (project_id, zone_id, pon_id, address, ...)
      VALUES (...)
      ON CONFLICT (project_id, dr_number) DO UPDATE SET ...
    `;
  }
}
```

### HLD_Pole Import
Reads pole data with GPS coordinates:
- Sheet: `HLD_Pole`
- Columns: Pole ID, Type, GPS Lat, GPS Lng

```javascript
// scripts/update-poles-from-hld.js
async function importHLDPoles(filePath, projectCode) {
  const sheet = workbook.Sheets['HLD_Pole'];
  // ... parse and insert poles with GPS
}
```

## Files to Create

### Services
- [ ] `src/services/onemap/index.ts` - Service exports
- [ ] `src/services/onemap/oneMapClient.ts` - API client
- [ ] `src/services/onemap/oneMapSyncService.ts` - Sync operations

### Scripts
- [ ] `scripts/create-onemap-schema.js` - Database schema creation
- [ ] `scripts/import-onemap-excel.js` - Excel HLD_Home import
- [ ] `scripts/update-poles-from-hld.js` - HLD_Pole GPS import
- [ ] `scripts/onemap-sync.js` - Full sync script

### Database
- [ ] `infrastructure/postgres/schema/004_onemap_integration.sql` - Schema DDL

## Data Volumes (Reference)

| Project | Code | Drops | Poles | Zones | PONs |
|---------|------|-------|-------|-------|------|
| Lawley | LAW | 23,707 | 4,471 | 20 | 212 |
| Mamelodi | MAM | 18,183 | 3,329 | 13 | 188 |
| Mohadin | MOH | 22,140 | 5,312 | 16 | 234 |
| **Total** | | **64,030** | **13,112** | **49** | **634** |

## Pole Classification

### Distribution Poles
- At customer premises
- Connected to drops
- End of fiber run

### Feeder Poles
- Main distribution points
- Connect to multiple distribution poles
- Higher capacity

## Import Process

1. **Create Schema**
   ```bash
   node scripts/create-onemap-schema.js
   ```

2. **Import Drops from HLD_Home**
   ```bash
   node scripts/import-onemap-excel.js "docs/project docs/VF_Project_Tracker_Lawley.xlsx" LAW
   ```

3. **Update Poles with GPS**
   ```bash
   node scripts/update-poles-from-hld.js "docs/project docs/VF_Project_Tracker_Lawley.xlsx" LAW
   ```

4. **Verify Import**
   ```sql
   SELECT project_code, COUNT(*) as drops FROM onemap.drops GROUP BY project_code;
   SELECT project_code, COUNT(*) as poles FROM onemap.poles GROUP BY project_code;
   ```

## Acceptance Criteria
1. OneMap schema created with all tables
2. OneMapClient can authenticate with 1Map API
3. Excel import parses HLD_Home and HLD_Pole sheets
4. Drops import with zone, PON, pole associations
5. Poles import with GPS coordinates and type
6. Sync service tracks last sync time
7. Import scripts handle duplicates (upsert)
8. All 64K+ drops imported successfully

## Environment Variables
```env
ONEMAP_API_KEY=your_api_key
ONEMAP_BASE_URL=https://api.1map.co.za
```

## Dependencies
- `xlsx` package for Excel parsing
- `@neondatabase/serverless` for database
- Project tracker Excel files in `docs/project docs/`

## Original PR
- PR #24: https://github.com/VelocityFibre/FF_Next.js/pull/24
- 7 files changed, +1,911 additions
