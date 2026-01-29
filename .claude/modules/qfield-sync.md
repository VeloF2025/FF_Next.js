# Module: qfield-sync

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | Bidirectional synchronization between QFieldCloud (GIS field app) and FibreFlow database |
| **Status** | Active (planned enhancements) |
| **Complexity** | High |
| **Category** | operations |

## Dependencies

### Internal FF Modules
None

### External Packages
- @tanstack/react-query
- Neon PostgreSQL serverless client
- QFieldCloud API (external)

## Database

### Tables
- `qfield_sync_jobs` - Sync operation tracking
- `qfield_sync_conflicts` - Collision detection
- `sow_fibre` - Target for cable sync
- `sow_poles` - Target for pole sync

### Key Queries
- SELECT qfield_sync_jobs WHERE status = 'syncing'
- SELECT qfield_sync_conflicts WHERE resolution IS NULL
- SELECT sow_fibre BY cable_id for existence check
- UPDATE sow_fibre with verified field data

## API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/qfield-sync-dashboard` | Dashboard data |
| POST | `/api/qfield-sync-start` | Initiate sync |
| GET | `/api/qfield-sync-current` | Current job status |
| GET | `/api/qfield-sync-history` | Recent jobs |
| POST | `/api/qfield-sync-cancel` | Abort job |
| POST | `/api/qfield-sync-conflicts` | Resolve conflicts |
| GET | `/api/qfield-sync-config` | Get settings |
| PUT | `/api/qfield-sync-config` | Update settings |
| GET | `/api/qfield-sync-poles` | QField pole data |
| GET | `/api/qfield-sync-cables` | QField cable data |
| GET | `/api/qfield-sync-drops` | QField drop data |

## Services

### QFieldSyncService
```typescript
startSync(type, direction)
syncFiberCables(job, direction)
syncPoles(job, direction)
syncSpliceClosures(job, direction)
syncTestPoints(job, direction)
getCurrentJob()
cancelSync()
resolveConflict(conflictId, resolution)
```

### QFieldSyncApiService (frontend)
```typescript
getDashboardData()
getCurrentJob()
getSyncHistory()
startSync(type, direction)
cancelSync()
resolveConflict()
updateConfig(config)
```

### QFieldCloudApiService
```typescript
getProjects()
getFeatures(projectId, layerId)
updateFeatures(projectId, layerId, features)
```

## Components
- `QFieldSyncDashboard` - Main interface
- `ConnectionStatus` - Connectivity status
- `SyncJobCard` - Active job display
- `SyncStatsCard` - Statistics
- `SyncHistoryTable` - Past operations
- `ConflictResolver` - Conflict UI
- `SyncConfigModal` - Settings
- `FiberCableDataViewer` - Cable comparison
- `FieldInstallationsViewer` - Pole data
- `ErrorBoundary` - Error handling

## Hooks

### useQFieldSync()
```typescript
// Methods
startSync(type, direction)
cancelSync()
resolveConflict(conflictId, resolution)
refreshData()
updateConfig(config)

// Returns
dashboardData, currentJob, syncHistory, isLoading, error
```

## Patterns
- Long-running sync jobs (async with progress)
- Conflict detection between QFieldCloud and FibreFlow
- Bidirectional sync with direction control
- Field mapping configuration
- Automatic status mapping (qfield_planned → pending)
- Batch processing (configurable size)
- Retry logic with configurable attempts

## Gotchas
- **PLANNED NOT IMPLEMENTED**: Pole audit → Fiber stringing sync (See README lines 230-465)
- **Read-Only Currently**: Bidirectional methods are stubs
- **Status Mapping**: QField 'field_' prefix vs FibreFlow 'pending/completed'
- **Field Transform**: JSON geometries, date formats, boolean conversions needed
- **GPS Validation**: Flag if difference > 50m
- **Manual Conflicts**: Pole number mismatches require manual review
- **WebSocket Partial**: WebSocket support mentioned but not fully implemented
- **Polling Interval**: Default 5 minutes
- **Large Batches**: fiber_cables can be 1000+

## OES Sync (Jan 2026)

### Server-Side Sync Script
Location: `/opt/qfield-sync/sync_oes_db_to_qfield.py`
Webhook server: `/opt/qfield-sync/sync_server.py` (port 8095)

**Key Functions:**
- `fetch_sync_target_projects()` - Queries Neon `qfield_projects` table for active+sync_enabled projects
- `fetch_oes_data()` - Returns dict with `all_activated` and `remaining` coordinate lists
- `create_gpkg()` - Creates GeoPackage with 2 tables (all + remaining)
- `upload_to_qfieldcloud()` - Uploads GPKG + QGS to a single project, triggers jobs
- `set_renderer(maplayer, color)` - Sets 1.5mm circle renderer with specified RGBA color
- `add_pole_nr_labeling(maplayer)` - Adds DR number labels using `Pole Nr` field
- `is_valid_sa_coordinate(lat, lon)` - Filters coordinates outside South Africa bounds

**Multi-Project Sync:** Syncs to ALL projects with `is_active=true AND sync_enabled=true` in `qfield_projects` table.

**Sync-enabled projects:**
- `af058301-32d1-4bca-84f9-83b899fcbb34` (Production - OES & Project Progress, `is_default=true`)
- `e849b878-f8a8-4f84-a3f1-9fbd051686c0` (Test Project Automations)

**IMPORTANT:** QFieldCloud `admin` user must be added as a collaborator on target projects.

### Two-Layer Structure (Jan 29, 2026)

| Layer | Color | Source | Records | Purpose |
|-------|-------|--------|---------|---------|
| `OES FF DDMMYYYY All` | 🟢 Green | `v_qfield_oes_activations` (planned coords) | ~7,662 | All activated DRs |
| `FF Remaining DRs DDMMYYYY` | 🟠 Orange | `drops` NOT IN `oes_activations` | ~63,306 | Unactivated drops |

**Circle size:** 1.5mm
**Date format:** `DDMMYYYY` (e.g., `29012026`)
**GPKG filename:** `OES FF DDMMYYYY.gpkg`

### Webhook Trigger

The OES import (`pages/api/activate/import-oes.ts`) triggers the webhook:
```
POST http://100.96.203.105:8095/sync/oes
Body: { "reportDate": "YYYY-MM-DD", "batchId": "...", "totalRows": N }
```

### Database View

The `v_qfield_oes_activations` view includes:
- `oes_latitude`, `oes_longitude` - Actual GPS from OES Excel
- `planned_latitude`, `planned_longitude` - Planned GPS from drops table
- `distance_meters` - Calculated distance between actual and planned

### South Africa Bounds Filtering

Coordinates outside these bounds are filtered out:
- Latitude: -35.0 to -22.0
- Longitude: 16.0 to 33.0

### Troubleshooting
- **Sync timed out:** Check `/var/log/qfield-oes-sync.log` and `curl http://100.96.203.105:8095/status`
- **FileTransferStatus.FAILED:** Check admin is collaborator on the target project
- **process_projectfile failed:** Rebuild Docker image: `cd /opt/qfieldcloud && sudo docker-compose build qgis`, restart workers
- **DR numbers not showing:** Check labeling uses `Pole Nr` field
- **Dots outside SA:** SA bounds filter should catch these; check raw GPS data
- **Run `/Qfield` skill** for full management commands
