# Serial Audit & Tracking System

## Overview

Comprehensive serial number tracking for ONT and UPS devices across the DR lifecycle. Tracks serials from three independent sources, detects mismatches, logs all changes for forensic searching.

## Serial Data Hierarchy

| Column | Source | Meaning | Updates |
|--------|--------|---------|---------|
| `ont_serial_scanned` | 1Map / WA group photos | What was physically scanned at install time | Backfill from BOSS API |
| `onemap_ont_serial` | BOSS API (1Map cache) | Mirror of 1Map barcode data | Set during backfill/process |
| `oes_serial` | OES Nokia Excel import | Currently active ONT on the network (SOURCE OF TRUTH) | Updated every OES import |
| `ups_serial_scanned` | 1Map / WA group photos | UPS serial scanned at install | Backfill from BOSS API |
| `onemap_ups_serial` | BOSS API | Mirror of 1Map UPS data | Set during backfill/process |
| `vlm_ont_serial_step6` | VLM AI extraction | ONT serial from Step 6 (ONT Back) photo | VLM processing |
| `vlm_ont_serial_step9` | VLM AI extraction | ONT serial from Step 9 (Green Lights) photo | VLM processing |

**Key rule**: `ont_serial_scanned` = 1Map/WA scan (install-time). `oes_serial` = OES (network truth). Never overwrite `ont_serial_scanned` with OES data.

## Serial Swap Detection Columns

| Column | Type | Purpose |
|--------|------|---------|
| `serial_swap_detected` | BOOLEAN | Flag: ONT serial scanned differs from OES serial |
| `serial_swap_status` | TEXT | Workflow status (pending/investigating/resolved) |
| `serial_swap_details` | TEXT (JSON) | Details: oes_serial, scanned_serial, detected_at, source |
| `serial_swap_detected_at` | TIMESTAMP | When the mismatch was first detected |
| `serial_swap_corrected_at` | TIMESTAMP | When the swap was resolved |
| `serial_swap_corrected_by` | TEXT | Who resolved it |

## Activity Log Event Types

All serial events logged to `dr_activity_log` table (JSONB `event_data`):

| Event Type | Trigger | Event Data Fields |
|------------|---------|-------------------|
| `SERIAL_BACKFILL` | 1Map backfill script/cron | `source`, `reason`, `ont_serial`, `ups_serial`, `ont_barcode_raw` |
| `SERIAL_MISMATCH` | Audit script | `event`, `ont_serial_scanned`, `oes_serial`, `project`, `source` |
| `SERIAL_MISMATCH_DETECTED` | OES import | `oes_serial`, `ont_serial_scanned`, `source`, `note` |
| `OES_SERIAL_CHANGED` | OES import | `old_oes_serial`, `new_oes_serial`, `ont_serial_scanned`, `source` |
| `SERIAL_SWAP` | DR acknowledgment | `swap_type`, `scanned_serial`, fields vary |
| `oes_activated` | OES import (new records) | `serial_number`, `activation_datetime`, `team` |

## Data Flow

```
1. DR Created (WA submission / manual)
   └→ process-new-dr.ts fetches from BOSS API
      └→ Sets ont_serial_scanned, ups_serial_scanned (from 1Map barcode)
      └→ If no photos: STILL captures serials (bug fixed 2026-01-29)

2. Backfill Cron (every 15 min)
   └→ backfill-onemap-data.ts
      └→ Finds DRs missing serials (regardless of photo count, bug fixed 2026-01-29)
      └→ Fetches from BOSS API, updates ont_serial_scanned

3. OES Import (daily manual)
   └→ import-oes.ts
      └→ ALWAYS updates oes_serial (removed COALESCE, 2026-01-29)
      └→ Detects OES serial changes vs previous import
      └→ Detects mismatches vs ont_serial_scanned
      └→ Sets serial_swap_detected flag
      └→ Logs OES_SERIAL_CHANGED and SERIAL_MISMATCH_DETECTED to activity log
```

## Mismatch Classification

When `ont_serial_scanned != oes_serial`:

| Type | Pattern | Example | Meaning |
|------|---------|---------|---------|
| `REAL_SWAP` | Both valid ALCL serials, different | ALCLB48CC3CA vs ALCLB480F4B7 | Actual ONT replacement |
| `UPS_AS_ONT` | Scanned starts with `GU18` | GU18W12V... scanned as ONT | Wrong device scanned |
| `SCAN_ERROR` | Length >15, contains `*` or `'` | Garbled barcode data | Scanner misread |
| `FORMAT_DIFF` | Same alphanumeric, different formatting | ALCL-B48 vs ALCLB48 | Cosmetic difference only |
| `PARTIAL_SCAN` | Length <8 | ALCLB4 | Incomplete scan |

## SQL Search Queries

### Find all serial changes for a DR
```sql
SELECT event_type, event_data, actor, created_at
FROM dr_activity_log
WHERE drop_number = 'DR1234567'
  AND event_type IN ('SERIAL_BACKFILL', 'SERIAL_MISMATCH', 'SERIAL_MISMATCH_DETECTED',
                     'OES_SERIAL_CHANGED', 'SERIAL_SWAP', 'oes_activated')
ORDER BY created_at;
```

### Find all DRs where a specific ONT serial appeared
```sql
SELECT drop_number, ont_serial_scanned, oes_serial, serial_swap_detected
FROM dr_photo_unified_reviews
WHERE UPPER(ont_serial_scanned) = UPPER('ALCLB48CC3CA')
   OR UPPER(oes_serial) = UPPER('ALCLB48CC3CA');
```

### Search activity log for a lost ONT serial
```sql
SELECT drop_number, event_type, event_data, created_at
FROM dr_activity_log
WHERE event_data::text ILIKE '%ALCLB48CC3CA%'
ORDER BY created_at DESC;
```

### Find all real swaps (ONT replacements)
```sql
SELECT drop_number, ont_serial_scanned, oes_serial, serial_swap_detected_at
FROM dr_photo_unified_reviews
WHERE serial_swap_detected = TRUE
  AND ont_serial_scanned NOT LIKE 'GU18%'
  AND LENGTH(ont_serial_scanned) >= 8
  AND LENGTH(ont_serial_scanned) <= 15
ORDER BY serial_swap_detected_at DESC;
```

## 2026-01-29 Comprehensive Audit Results

| Metric | Count |
|--------|-------|
| Total DRs | 8,205 |
| Had ont_serial_scanned | 2,957 (before backfill) |
| Missing ont_serial_scanned | 5,248 (before backfill) |
| Backfilled from 1Map | 4,893 |
| Still missing (not in 1Map) | 245 |
| Still missing (no barcode) | 110 |
| ONT vs OES mismatches | 125 (at time of audit) |
| OES serial changes | Detected on each import |

### Root Causes Fixed
1. **process-new-dr.ts**: Early return when no photos discarded serial data from BOSS API
2. **backfill-onemap-data.ts**: `photo_count > 0` filter excluded DRs without photos from serial backfill

### Commits
- Bug fixes: committed 2026-01-29 (process-new-dr.ts + backfill-onemap-data.ts)
- OES swap detection: committed 2026-01-29 (import-oes.ts rewrite of Step 7)
- Mismatch baseline: 125 SERIAL_MISMATCH entries logged to activity

## Key Files

| File | Purpose |
|------|---------|
| `pages/api/activate/process-new-dr.ts` | New DR processing, fetches serials from BOSS API |
| `pages/api/cron/backfill-onemap-data.ts` | Cron: backfill missing serials from 1Map |
| `pages/api/activate/import-oes.ts` | OES import with swap detection (Step 7) |
| `src/modules/activate/services/oneMapIntegrationService.ts` | 1Map API integration |
| `pages/api/activate/dr-acknowledgment.ts` | First WA response, initial swap detection |
