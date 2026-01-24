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

**Key Functions:**
- `add_pole_nr_labeling(maplayer)` - Adds DR number labels using `Pole Nr` field
- `set_renderer(maplayer, color)` - Sets single-symbol renderer with specified color
- `is_valid_sa_coordinate(lat, lon)` - Filters coordinates outside South Africa bounds
- `fetch_oes_data()` - Returns dict with 'actual' and 'planned' coordinate lists
- `create_gpkg_with_two_tables()` - Creates GeoPackage with both actual and planned tables

**Sync Target:** `Test_Project__Automations` (`e849b878-f8a8-4f84-a3f1-9fbd051686c0`)

### Dual-Layer Feature (Jan 24, 2026)

The sync now creates **two layers** for GPS discrepancy detection:

| Layer | Color | Source | Purpose |
|-------|-------|--------|---------|
| `OES DD-MM-YY Actual` | 🔵 Blue | OES Excel GPS (`oes_latitude`, `oes_longitude`) | Where technician actually was |
| `OES DD-MM-YY Planned` | 🟢 Green | Drops table (`planned_latitude`, `planned_longitude`) | Where drop was planned |

**Visual Comparison:** Offset between blue and green dots indicates GPS discrepancy.

### Database View

The `v_qfield_oes_activations` view includes:
- `oes_latitude`, `oes_longitude` - Actual GPS from OES Excel
- `planned_latitude`, `planned_longitude` - Planned GPS from drops table
- `distance_meters` - Calculated distance between actual and planned (approximate)

### South Africa Bounds Filtering

Coordinates outside these bounds are filtered out:
- Latitude: -35.0 to -22.0
- Longitude: 16.0 to 33.0

This removes bad GPS data (e.g., coordinates in Iraq, Nepal, Indonesia).

### OES Database Sync (ff_oes_activations)

**Script:** `/opt/qfield-sync/sync_oes_to_qfield.py`

Syncs OES activation data from FibreFlow Neon DB to QFieldCloud PostgreSQL's `ff_oes_activations` table.

```bash
# Run full sync (truncate + insert)
cd /opt/qfield-sync && source venv/bin/activate
python3 sync_oes_to_qfield.py --full

# Delta sync (upsert only changed)
python3 sync_oes_to_qfield.py
```

**Column Mapping (CRITICAL):**
| Source (Neon view) | Target (QFieldCloud) |
|--------------------|---------------------|
| `oes_latitude` | `latitude` |
| `oes_longitude` | `longitude` |

The view `v_qfield_oes_activations` uses `oes_latitude`/`oes_longitude`, but the target table uses `latitude`/`longitude`. **Fixed 2026-01-24.**

**Data Sources:**
- `oes_activations` table: All OES Excel imports (historical + daily)
- Initial bulk import (2026-01-15): ~6,259 records (back to July 2025)
- Daily imports: ~150 records/day
- Total: 7,285+ records

**OES Count Discrepancy Explained:**
- QField dashboard shows `ff_oes_activations` count (QFieldCloud DB)
- OES Excel report only shows recent activations
- Database contains historical archive going back to July 2025

### Troubleshooting
- **DR numbers not showing:** Check labeling uses `Pole Nr` field
- **Showing planned/wip/live/issue:** Renderer using categories - should be `singleSymbol`
- **Blue dots outside project:** Check OES Excel GPS data quality
- **Green dots missing:** Drop not matched or has no coordinates
- **OES count mismatch:** Run `python3 sync_oes_to_qfield.py --full` on Velocity
- **Column error in sync:** Check SELECT uses `oes_latitude`, INSERT uses `latitude`
- **Run `/Qfield` skill** for full management commands
