# OLT Report Module

## Overview
Nokia OLT report import and 1Map serial fix system. Detects ONT serial mismatches between Nokia OLT exports and 1Map GIS system, then fixes them.

## Entry Point
`/system/data-sync?group=olt`

## Key Files

### API Routes (`pages/api/system/olt-report/`)
| File | Method | Purpose |
|------|--------|---------|
| `import.ts` | POST | Upload Nokia OLT Excel files |
| `records.ts` | GET | Fetch mismatch records with filters |
| `stats.ts` | GET | Summary counts by status |
| `fix-1map.ts` | POST | Fix single DR on 1Map (writes serial_change_history) |
| `swap-fix.ts` | POST | Cross-DR swap fix (both DRs get fixed) |
| `process-lookup-queue.ts` | POST | Background investigation of mismatches |
| `cross-dr-lookup.ts` | POST | Check if wrong serial belongs to another DR |
| `check-displaced.ts` | POST | Batch check wrong serials against OES activations |
| `displaced-report.ts` | GET | Displaced ONT report with activation status |
| `reporting.ts` | GET | Full reporting data + CSV export |
| `resolve.ts` | POST | Resolve investigation records |
| `auto-detect.ts` | POST | Auto-detect mismatches from OES data |
| `fix-status.ts` | PATCH | Update fix status |
| `imports.ts` | GET | Import history |
| `admin-users.ts` | GET | Users with manager role |

### UI Component
`src/modules/data-sync/components/groups/OltReportGroup.tsx` (~2500 lines)

### Tabs
1. **Import** — Upload Nokia OLT Excel files
2. **Fixable** — Records ready to fix (with displaced ONT warning badges)
3. **Investigate** — Cross-DR conflicts needing manual review
4. **Escalations** — Escalated records
5. **History** — Fix activity log + import history
6. **Reporting** — Sub-tabs: Records | Imports | Displaced ONTs (with CSV export)

## Database Tables

### `olt_mismatch_records`
Main table for mismatch records. Key columns:
- `drop_number`, `olt_serial`, `wrong_onemap_serial`
- `fix_status`: pending | fixed | needs_investigation | escalated | resolved | not_found | empty_serial
- `fix_result`, `fix_old_value`, `fix_attempted_at`, `fix_by`
- `detection_source`: manual | auto_detect
- `import_id` → `olt_report_imports`

### `olt_report_imports`
Import file tracking: filename, project, total_records, mismatch_count, imported_by, imported_at

### `serial_change_history`
Audit trail for all serial changes. JSONB `metadata` column includes:
- `wrong_onemap_serial` — the wrong serial that was on 1Map
- `displaced_serial` — the ONT serial that was overwritten
- `displaced_activated` — boolean, whether displaced serial is in OES
- `displaced_owner_dr` — if activated, which DR owns it
- `displaced_owner_team` — if activated, which team

### `oes_activations`
OES activation data used for displaced ONT lookups.

## Displaced ONT Tracking

When a fix overwrites a serial on 1Map, the old serial becomes "displaced". The system:
1. **At fix time** (`fix-1map.ts`, `swap-fix.ts`): Looks up displaced serial in `oes_activations`, records activation status in `serial_change_history` metadata
2. **On Fixable tab**: Batch-checks wrong serials via `check-displaced.ts`, shows warning badges:
   - ALCL/HWTC prefix → "Unactivated ONT" (amber) or activated info
   - GU18 prefix → "UPS Serial" (orange)
   - Other → "Invalid Serial" (gray)
3. **On Reporting tab**: Displaced ONTs sub-tab shows full breakdown with CSV export

## Fix Statuses Flow
```
pending → fixed (via fix-1map.ts)
pending → needs_investigation (via process-lookup-queue.ts, cross-DR conflict)
needs_investigation → resolved (via resolve.ts)
needs_investigation → escalated (manual)
escalated → resolved (manual)
```

## Auth
All endpoints require `withAuth(withRole('manager'))` — only managers and above can access.
