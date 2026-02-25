# Data Sync Module

**Status:** Active  
**Last Updated:** 2026-02-24  
**Complexity:** High  
**Lines of Code:** ~6,500  
**Recent Activity:** 46 commits since 2026-02-01  

---

## Overview

Data Sync is a unified data reconciliation and import interface combining three major systems:
1. **Maintenance data imports** — field maintenance records
2. **Activate data imports** — network activation records
3. **OLT Report processing** — Optical Line Terminal (network equipment) data management

The module provides automated queue processing, 1Map API lookups, OES (network equipment) auto-detection, data validation, and comprehensive reporting.

---

## Architecture

### Core Groups (Tabs)

| Group | Purpose | Key Components |
|-------|---------|-----------------|
| **Maintenance** | Import field maintenance records | MaintenanceGroup |
| **Activate** | Import activation records | ActivateGroup |
| **OLT Reports** | Manage optical line terminal data (6 sub-tabs) | OltReportGroup |

### OLT Report Sub-Tabs

| Tab | Purpose |
|-----|---------|
| **Import** | Upload and parse OLT report files |
| **Fixable** | Queue items ready for 1Map API lookup |
| **Investigate** | Manual investigation queue (data mismatches) |
| **Escalations** | Critical issues requiring escalation |
| **Fix Log** | Historical record of applied fixes |
| **Reporting** | Summary statistics and export |

### Data Flow

```
File Upload (OltImportTab)
    ↓
Parse & Queue (olt_onemap_lookup_queue)
    ↓
Auto-Detect Run (OltAutoDetectService)
    ↓
Process Queue (OltQueueProcessorService)
    ├→ Batch 1Map API lookups (50 items, concurrency 3)
    ├→ Retry logic (max 3 attempts per item)
    ├→ Link to olt_report_imports
    └→ Mark completed
    ↓
Results Available (OltFixableTab, OltInvestigateTab)
    ↓
User Actions (Investigate, Escalate, Fix)
    ↓
Reporting (OltReportingTab, metrics export)
```

---

## Key Services

### `oltQueueProcessorService.ts`

Processes pending 1Map API lookups from the auto-detect queue.

**Key Functions:**
- `processLookupQueue(runId?)` — Main processor, runs in batches of 50 items
- `processOneItem(client, item, importId)` — Process a single lookup
- Retry logic: 3 attempts maximum per item before marking as error
- Concurrency: 3 simultaneous 1Map API requests
- Stagger: 150ms between concurrent starts (avoid burst load)

**Status:** Working, HIGH confidence per code comments

**Database Tables:**
- `olt_onemap_lookup_queue` — pending/error/resolved items
- `olt_auto_detect_runs` — run status tracking
- `olt_report_imports` — import metadata

### `oltAutoDetectService.ts`

Auto-detection of OES (network equipment) from imported data.

**Features:**
- Serial number validation (GU18 prefix = UPS equipment)
- Batch processing from OES data
- Status tracking for UI feedback

---

## Hooks

### `useOltState(activeTab, onTabChange)`

Core state management hook for OLT Report tab navigation.

**State Managed:**
- Tab switching and permissions
- Current page (pagination)
- Statistics (pending, fixable, escalated counts)
- Auto-detect status
- Accessible tabs based on user permissions
- Filter state per tab

**Permissions Model:**
- Permission checks on tab access
- Access denied state if no tabs available
- Graceful degradation for restricted users

---

## Components

### `DataSyncPage`
Top-level page component. Routes to group components based active tab.

### `OverviewDashboard`
Summary view of all three data sync groups with statistics.

### Group Components
- `MaintenanceGroup` — maintenance imports UI
- `ActivateGroup` — activate imports UI
- `OltReportGroup` — OLT reports UI (6 tabs)

### OLT Report Tab Components

| Component | Purpose |
|-----------|---------|
| `OltImportTab` | File upload, parsing, initial queue creation |
| `OltFixableTab` | Auto-detected lookups ready for API calls |
| `OltInvestigateTab` | Manual review queue for data mismatches |
| `OltEscalationsTab` | Critical issues flagged for escalation |
| `OltFixLogTab` | Historical audit of applied fixes |
| `OltReportingTab` | Summary stats, export, KPIs |
| `OltAutoDetectBanner` | Status banner for auto-detect runs |

---

## Database Schema (Key Tables)

### `olt_onemap_lookup_queue`
```sql
id, drop_number, oes_serial, oes_batch_id, team
status (pending|processing|resolved|error)
attempts, last_error
created_at, processed_at
```

### `olt_auto_detect_runs`
```sql
id, filename (or "Auto-detect: OES Batch...")
status (processing_queue|completed)
completed_at
```

### `olt_report_imports`
```sql
id, filename, imported_at
-- Links queue items to import runs
```

---

## Workflow Example: OLT Auto-Import

**User Action:** Upload an OES batch file

1. **OltImportTab** parses file, creates rows in `olt_onemap_lookup_queue`
2. **OltAutoDetectService** kicks off auto-detect run
3. **OltQueueProcessorService** processes queue:
   - Reads 50 items at a time
   - Makes concurrent 1Map API calls (3 at a time, 150ms stagger)
   - Retries failures up to 3 times
   - Links results to import run
   - Marks run as completed
4. **OltFixableTab** shows results ready for review
5. User investigates/fixes/escalates as needed
6. **OltFixLogTab** records all actions
7. **OltReportingTab** exports summary

---

## Performance Characteristics

| Aspect | Value |
|--------|-------|
| Batch size | 50 items |
| Concurrent lookups | 3 requests |
| Stagger delay | 150ms |
| Retry limit | 3 attempts |
| Max iterations | 200 (safety limit = 10,000 max items per run) |

**Implication:** A typical run of 1,000 items processes in ~7-8 minutes (batches of 50, 3 concurrent).

---

## Known Patterns & Gotchas

### 1. Serial Number Validation
UPS equipment identified by `GU18` prefix in serial. Code:
```typescript
function isUpsSerial(serial: string | null): boolean {
  return !!serial && serial.toUpperCase().startsWith('GU18');
}
```

### 2. Fire-and-Forget Queue Processing
The queue processor runs independently of user actions. UI polls for status.

### 3. Permission Gates
OLT Report tabs are behind permissions. Users see nothing if they lack access — not an error, just graceful denial.

---

## Related Modules

- **system/oneMapApiService** — 1Map API client for equipment lookups
- **olt-report** — OLT report viewing (downstream of this data sync)
- **maintenance** — maintenance records integration
- **activate** — activation records integration

---

## Common Tasks

### Add a new OLT tab
1. Create component in `components/groups/olt/`
2. Add to `OLT_TABS` constant in `useOltState.ts`
3. Render in `OltReportGroup`

### Change batch size or concurrency
File: `services/oltQueueProcessorService.ts`
```typescript
const BATCH_SIZE = 50;        // Items per batch
const CONCURRENCY = 3;         // Concurrent 1Map requests
const STAGGER_MS = 150;        // Delay between concurrent starts
```

### Debug queue processing
Look at database queries in `oltQueueProcessorService.ts`:
- `olt_onemap_lookup_queue` — queue status
- `olt_auto_detect_runs` — run completion status
- Log output: `OltQueueProcessor: ...` messages

---

## Testing Notes

- Unit tests for serial validation (`isUpsSerial`)
- Integration tests for queue processor (mock DB pool)
- E2E: Upload file → verify queue population → verify API calls

---

**Next Steps:** Document maintenance and activate group internals (scope/PR follow-up).

---
*Written by: Scribe | 2026-02-24 | Self-improvement heartbeat task*
