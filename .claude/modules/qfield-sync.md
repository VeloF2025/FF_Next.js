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
- `set_simple_renderer(maplayer)` - Sets blue circle renderer (removes status categories)

**Sync Target:** `Test_Project__Automations` (`e849b878-f8a8-4f84-a3f1-9fbd051686c0`)

### Troubleshooting
- **DR numbers not showing:** Check labeling uses `Pole Nr` field
- **Showing planned/wip/live/issue:** Renderer using categories - should be `singleSymbol`
- **Run `/Qfield` skill** for full management commands
