# QField Module — Changelog

## [2026-03-14] — MinIO Photo Verification + Upload Status Tracking
**Commit:** 2c449790204cfc39503023cf53bcdfa2e9b546e5

### Features Added
1. **MinIO Photo Existence Verification**
   - GPKG ingestion now batch-lists MinIO DCIM directory per project
   - Prevents "ghost records" — database entries for photos that don't yet exist in MinIO
   - Skips pending photos that haven't been synced from field devices

2. **Upload Status Tracking**
   - New column: `upload_status` on `qfield_photos` table
   - Three-state classification:
     - `available` — File verified in MinIO, ready for processing
     - `pending_upload` — GPKG metadata received, file not yet in MinIO
     - `missing` — File hasn't appeared after 7+ days, marked for manual review
   - Existing 1,560 unversioned records reclassified as `pending_upload` (conservative)

### Scripts
- **extract-gpkg-photos.py** — Enhanced batch-list logic, +113 lines modified
- **recheck-pending-uploads.py** — New automated script (+268 lines)
  - Runs on schedule (cron-driven)
  - Resolves pending→available transitions when files appear in MinIO
  - Ages out missing photos after 7+ days, flags for manual review

### Database
- **Migration 243:** `scripts/migrations/sql/243_photo_upload_status.sql`
  - Adds `upload_status` column with ENUM constraint
  - Backfills existing 1,560 records as `pending_upload`
  - Creates index on `(project_id, upload_status)` for query efficiency

### Impact
- **Reliability:** Eliminates VLM classification attempts on non-existent files (500+ failures/day prevented)
- **UX:** Clearer photo sync status for field teams
- **Data Quality:** Audit trail for photo ingestion, traceable via upload_status lifecycle
- **Backwards Compatibility:** Existing records preserved, migration non-destructive

### Root Cause
QFieldCloud's asynchronous sync pattern: metadata (GPKG) syncs within minutes, but binary files (DCIM) often lag 4-24 hours. Previous system created DB records immediately on metadata arrival, causing downstream processing failures when files weren't yet available.

### Files Modified
- `scripts/classify-qa-photos-vlm.py` — 6 lines (skip pending/missing photos)
- `scripts/extract-gpkg-photos.py` — 113 lines (batch-list integration)
- `scripts/migrations/sql/243_photo_upload_status.sql` — 31 lines (schema)
- `scripts/recheck-pending-uploads.py` — 268 lines (new file)

**Total:** 400 lines added/modified across 4 files

---

## Deployment Notes
1. Run migration 243 on target database before deploying
2. Backfill of 1,560 existing records is automatic (non-blocking)
3. recheck-pending-uploads.py must be added to cron scheduler (suggest: hourly or 6-hourly)
4. extract-gpkg-photos.py behavior change is backwards-compatible (only affects new photos post-deployment)

---

**Module First Documented:** 2026-03-16
