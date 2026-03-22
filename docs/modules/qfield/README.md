# QField Module

## Overview
The QField module handles field data collection and synchronization with QFieldCloud. It manages DCIM (Digital Camera Image Management) photo ingestion from field devices, upload status tracking, and integration with VLM (Vision Language Model) analysis pipelines.

## Purpose
QFieldCloud syncs field survey data asynchronously—metadata (GPKG files) often arrives before binary files (DCIM photos). This module ensures photos are tracked accurately, prevents creating database records for non-existent files, and manages the lifecycle of field-captured images.

## Key Components

### Scripts
1. **extract-gpkg-photos.py** — Extracts photo references from GPKG metadata files, batch-lists MinIO DCIM directory per project to verify existence before ingestion
2. **classify-qa-photos-vlm.py** — Routes photos to VLM classification pipeline
3. **recheck-pending-uploads.py** — Resolves pending upload records when files appear in MinIO, marks stale (7+ days) photos as missing

### Database Schema
**Table: qfield_photos**
- `id` — Primary key
- `photo_path` — MinIO file path (DCIM/camera-uuid/filename.jpg)
- `upload_status` — Enumeration: `available` | `pending_upload` | `missing`
  - `available` — File verified in MinIO, ready for processing
  - `pending_upload` — GPKG metadata received, file not yet in MinIO (waiting for field sync)
  - `missing` — File stale (7+ days pending), unlikely to appear, marked for manual review
- `project_id` — FK to projects table
- `created_at` — Record creation timestamp
- `updated_at` — Last status change

## How It Works

### Photo Ingestion Workflow
1. QFieldCloud syncs GPKG metadata to fibreflow-production
2. **extract-gpkg-photos.py** parses GPKG, extracts photo references
3. **MinIO batch-list** verifies files actually exist (prevents ghost records)
4. Photos marked `available` are queued for VLM processing
5. Photos not found in MinIO are marked `pending_upload`

### Pending Upload Resolution
- **recheck-pending-uploads.py** runs on a schedule (hourly/daily)
- Checks MinIO for any `pending_upload` files that have now appeared
- Updates status to `available` and queues for processing
- After 7 days without appearance, marks as `missing` (manual review required)

### VLM Classification
- Only photos with `upload_status = 'available'` are sent to classify-qa-photos-vlm.py
- Photos with `pending_upload` or `missing` are skipped until resolved

## Migration (v243)
Schema migration 243_photo_upload_status.sql:
- Creates `upload_status` column on qfield_photos table
- Initializes 1,560 existing unversioned photo records as `pending_upload` (conservative classification)
- Maintains backwards compatibility with existing data

## Known Issues
- **File lag:** Field devices may take 4-24 hours to sync binaries (normal QFieldCloud behavior)
- **Stale pending records:** Photos marked `missing` after 7 days may sometimes re-appear; manual reconciliation available via support panel

## Configuration
- **MinIO DCIM prefix:** `dcim/` (per-project subdirectories: `dcim/{project-id}/`)
- **Pending timeout:** 7 days before marking as `missing`
- **Batch list size:** Default 500 files per project scan (configurable in extract-gpkg-photos.py)

## API Endpoints
N/A — This module is internal (cron-driven, not exposed to external API)

## Dependencies
- **MinIO** — Object storage for photo files
- **QFieldCloud** — Source of GPKG metadata + async file push
- **VLM pipeline** — Downstream consumer of `available` photos

## Testing
- Unit tests for upload_status classification logic in `tests/unit/qfield_test.py`
- Integration test: scheduled recheck-pending-uploads.py run confirms pending→available transitions
- Manual: `SELECT * FROM qfield_photos WHERE upload_status = 'missing' ORDER BY updated_at DESC` to audit aged photos

## Related Documentation
- [Field Operations Module](/docs/modules/field-ops/) — Upstream data source
- [VLM Classification Pipeline](/docs/modules/activate/) — Downstream consumer
- [Cron Jobs](/docs/modules/cron/) — Scheduler for extract-gpkg-photos.py + recheck-pending-uploads.py

---

**Last Updated:** 2026-03-16  
**Commit:** 2c449790204cfc39503023cf53bcdfa2e9b546e5
