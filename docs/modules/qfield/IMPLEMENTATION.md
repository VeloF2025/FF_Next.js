# QField MinIO Integration — Technical Implementation Guide

**Feature**: QField photo upload status tracking & MinIO verification
**Commits**: 2c44979, 6fc1069 (related QField changes)
**Status**: Live (2026-03-14)
**Priority**: P1 (Critical bug fix: prevents ghost records)
**Module**: QField
**Last Updated**: 2026-03-16

---

## Problem: The QFieldCloud Sync Race Condition

### Context

QFieldCloud syncs field data to FibreFlow asynchronously:
1. **GPKG metadata** (GeoPackage SQLite database) syncs quickly (~5 min after field submission)
2. **DCIM binaries** (actual JPG/MP4 files) sync slowly (~30-60 min lag, sometimes 24+ hours)

This created a critical race condition in our photo ingestion pipeline:

```
T+0min    : Field technician submits QField form
T+5min    : GPKG metadata syncs to fibreflow (we parse it)
T+10min   : We create DB record for photo "IMG_20260314.JPG" (based on GPKG reference)
T+40min   : Photo binary finally appears in MinIO
           (But DB record already exists; if photo never arrives, record persists forever)
```

### The Bug

**Symptoms**:
- DB contains 1,560 photo records with no actual file in MinIO
- VLM classifier processes fake photo references → classification fails
- "Available" photos marked as complete; missing photos silently skipped
- Data audit shows "6,500 photos classified" but actual files = 4,940

**Root Cause**: `extract-gpkg-photos.py` trusted GPKG metadata without verifying file existence.

### Impact

- ❌ 1,560 "ghost" records with no backing file
- ❌ Misleading VLM processing metrics (counting non-existent files)
- ❌ Storage quota confusion (DB says 1,560 files, S3 has 4,940)
- ❌ NOC can't distinguish "photo pending upload" from "photo lost"

---

## Solution: MinIO Existence Verification

### 1. Upload Status Enumeration

Before processing any photo, classify its upload state:

```
📊 ENUM: upload_status
├─ 'available'       — File verified in MinIO, ready for processing
├─ 'pending_upload'  — GPKG metadata received, file waiting in QFieldCloud queue
└─ 'missing'         — File stale (7+ days pending), marked for manual review
```

### 2. GPKG Ingestion Workflow (Enhanced)

**Old Flow** (broken):
```
1. Parse GPKG → extract photo references
2. Create DB record for each reference
3. Done (hope file arrives later)
```

**New Flow** (fixed):
```
1. Parse GPKG → extract photo references
2. FOR EACH project:
   a. Batch-list MinIO DCIM directory (one API call per project)
   b. Check: does photo file exist in MinIO?
   c. IF yes → create DB record with status='available'
   d. IF no → create DB record with status='pending_upload'
3. Schedule recheck-pending-uploads.py to resolve pending records later
```

### 3. Migration 243: `photo_upload_status` Column

```sql
ALTER TABLE qfield_photos ADD COLUMN upload_status VARCHAR(50) DEFAULT 'available';

-- Initialize 1,560 existing unversioned records as pending_upload (conservative estimate)
UPDATE qfield_photos 
SET upload_status = 'pending_upload' 
WHERE upload_status IS NULL 
  AND created_at < NOW() - INTERVAL 7 DAY;

CREATE INDEX idx_qfield_photos_upload_status ON qfield_photos(upload_status);
CREATE INDEX idx_qfield_photos_project_id_status ON qfield_photos(project_id, upload_status);
```

---

## Scripts

### 1. `extract-gpkg-photos.py` (Enhanced)

**Purpose**: Extract photo metadata from GPKG files, verify MinIO existence, classify upload status.

**Algorithm**:

```python
def ingest_qfield_photos(project_id: int):
    """
    1. Extract GPKG photos for project
    2. Batch-list MinIO DCIM directory
    3. Classify each photo as available/pending/missing
    """
    
    # Step 1: Parse GPKG metadata
    gpkg_path = f"/tmp/qfield_{project_id}.gpkg"
    photos_from_gpkg = parse_gpkg(gpkg_path)
    # Returns: [
    #   {'photo_path': 'DCIM/abc-uuid/IMG_001.JPG', 'feature_id': 123},
    #   ...
    # ]
    
    # Step 2: Batch-list MinIO DCIM for this project
    # (Avoid 1,560 individual stat() calls; use bulk prefix list)
    minio_client = Minio(...)
    existing_files = set()
    for obj in minio_client.list_objects('dcim', prefix=f"{project_id}/"):
        existing_files.add(obj.object_name)
    # Returns: set(['DCIM/abc-uuid/IMG_001.JPG', ...])
    
    # Step 3: Classify each photo
    for photo_ref in photos_from_gpkg:
        full_path = f"{project_id}/{photo_ref['photo_path']}"
        
        if full_path in existing_files:
            status = 'available'  # File already in MinIO
        else:
            status = 'pending_upload'  # GPKG says it exists, but MinIO doesn't have it yet
        
        # Create/update DB record
        db.insert_or_update('qfield_photos', {
            'project_id': project_id,
            'photo_path': photo_ref['photo_path'],
            'upload_status': status,
            'feature_id': photo_ref['feature_id'],
            'created_at': now(),
        })
```

**Key Changes**:
1. Batch-list MinIO DCIM once per project (not per photo)
2. Classify status before inserting DB record
3. Return count of `available` vs `pending_upload` for logging

**Input**: GPKG file from QFieldCloud sync webhook
**Output**: DB records with upload_status populated
**Metrics**: `{available: 1200, pending_upload: 15, missing: 0}`

---

### 2. `recheck-pending-uploads.py` (New)

**Purpose**: Resolve `pending_upload` records when files finally appear in MinIO.

**Schedule**: Run hourly (or on-demand after import)

**Algorithm**:

```python
def recheck_pending_uploads():
    """
    1. Find all 'pending_upload' records
    2. Check MinIO for each one
    3. Update to 'available' if found
    4. Mark as 'missing' if 7+ days old
    """
    
    # Step 1: Fetch all pending records
    pending = db.query("""
        SELECT id, project_id, photo_path, created_at
        FROM qfield_photos
        WHERE upload_status = 'pending_upload'
        ORDER BY created_at ASC
    """)
    
    available_count = 0
    missing_count = 0
    still_pending = 0
    
    for record in pending:
        full_path = f"{record.project_id}/{record.photo_path}"
        
        # Step 2: Check MinIO
        try:
            minio_client.stat_object('dcim', full_path)
            # File exists!
            db.update('qfield_photos', record.id, {'upload_status': 'available'})
            available_count += 1
        except minio.NotFound:
            # File still missing
            days_pending = (now() - record.created_at).days
            
            if days_pending >= 7:
                # Stale: mark as missing (manual review required)
                db.update('qfield_photos', record.id, {'upload_status': 'missing'})
                missing_count += 1
                log_alert(f"Photo {record.photo_path} marked MISSING after 7 days")
            else:
                still_pending += 1
    
    # Log metrics
    log_info(f"Recheck pending: {available_count} → available, {missing_count} → missing, {still_pending} still pending")
```

**Input**: Runs on schedule, no parameters
**Output**: Updates DB records, sends alerts for 7+ day stale photos
**Metrics**: Logged to CloudWatch

---

### 3. `classify-qa-photos-vlm.py` (Updated)

**Purpose**: Route photos to VLM classification, only process `available` photos.

**Change**:

```python
# Before: Process all photos
photos = db.query("SELECT * FROM qfield_photos WHERE classified = FALSE")

# After: Skip pending/missing photos
photos = db.query("""
    SELECT * FROM qfield_photos 
    WHERE classified = FALSE 
      AND upload_status = 'available'
""")
```

**Why**: Don't waste VLM API calls on non-existent files.

---

## Database Schema

### Table: `qfield_photos`

```sql
CREATE TABLE qfield_photos (
  id BIGSERIAL PRIMARY KEY,
  
  -- Core metadata
  project_id BIGINT NOT NULL,
  photo_path VARCHAR(512) NOT NULL,  -- e.g., 'DCIM/abc-uuid/IMG_001.JPG'
  mime_type VARCHAR(50),             -- 'image/jpeg', 'video/mp4', etc.
  
  -- Upload status (NEW)
  upload_status VARCHAR(50) NOT NULL DEFAULT 'available',
  -- Enumeration: 'available' | 'pending_upload' | 'missing'
  -- available: file verified in MinIO, ready for processing
  -- pending_upload: GPKG metadata received, file not yet in MinIO
  -- missing: stale (7+ days pending), needs manual review
  
  -- Processing metadata
  classified BOOLEAN DEFAULT FALSE,
  qa_decision VARCHAR(50),           -- 'PASS', 'REVIEW', 'REJECT', etc.
  vlm_confidence FLOAT,              -- Confidence score from VLM
  
  -- Audit trail
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_by_user_id BIGINT,
  
  -- Relationships
  FOREIGN KEY (project_id) REFERENCES projects(id),
  FOREIGN KEY (created_by_user_id) REFERENCES users(id)
);

-- Indexes for common queries
CREATE INDEX idx_qfield_photos_project_id ON qfield_photos(project_id);
CREATE INDEX idx_qfield_photos_upload_status ON qfield_photos(upload_status);
CREATE INDEX idx_qfield_photos_classified ON qfield_photos(classified, upload_status);
CREATE INDEX idx_qfield_photos_project_status ON qfield_photos(project_id, upload_status);
```

---

## Deployment & Rollout

### 1. Backfill Existing Records (Committing)

**Action**: Run migration 243, then recheck-pending-uploads.py

```bash
# Step 1: Apply schema migration
psql -U velo fibreflow < migrations/sql/243_photo_upload_status.sql

# Step 2: Backfill 1,560 existing unversioned records as pending_upload
psql -U velo fibreflow -c "UPDATE qfield_photos SET upload_status = 'pending_upload' WHERE upload_status IS NULL"

# Step 3: Immediately check if any of those pending records have now appeared in MinIO
python3 scripts/recheck-pending-uploads.py

# Expected output:
# Recheck pending: 1,200 → available, 50 → missing, 310 still pending
```

### 2. Enable New Ingestion (2026-03-14)

- Deploy extract-gpkg-photos.py update
- Deploy recheck-pending-uploads.py
- Update classify-qa-photos-vlm.py to filter by upload_status

### 3. Monitor (2026-03-14 to 2026-03-21)

**CloudWatch Dashboard**:
- Metric: `qfield_photos_pending_count` (should trend → 0 over 7 days)
- Metric: `qfield_photos_missing_count` (should stabilize)
- Alert: If pending_count > 100 after 24 hours, escalate

### 4. Cleanup (2026-03-21+)

- Archive 1,560 "missing" photo records (after manual review)
- Update NOC dashboard to show missing photo count
- Document root cause in post-mortem

---

## Performance Characteristics

### MinIO Batch-List Performance

**Scenario**: Project with 5,000 GPKG photo references, 3,000 files actually in MinIO

**Old Approach** (5,000 stat() calls):
- Time: ~2.5 min (500ms per stat call on slow network)
- API calls: 5,000
- Failures: High (network flakiness)

**New Approach** (1 batch list):
- Time: ~3 sec
- API calls: 1 (streaming paginated results)
- Failures: Rare (bulk operation is more robust)

**Savings**: 99.9% reduction in API calls, 50x speed improvement

---

## Monitoring & Alerts

### CloudWatch Metrics

```python
# In extract-gpkg-photos.py
cloudwatch.put_metric_data('QField', 'PhotosAvailable', available_count)
cloudwatch.put_metric_data('QField', 'PhotosPending', pending_count)
cloudwatch.put_metric_data('QField', 'PhotosMissing', missing_count)

# In recheck-pending-uploads.py
cloudwatch.put_metric_data('QField', 'ResolvedToAvailable', resolved_count)
cloudwatch.put_metric_data('QField', 'MarkedMissing', marked_missing)
cloudwatch.put_metric_data('QField', 'StillPending', still_pending)
```

### Alerts

| Alert | Threshold | Action |
|-------|-----------|--------|
| `PhotosPending > 500` | More than 500 pending for >24h | Page on-call engineer |
| `PhotosMissing > 100` | More than 100 marked missing | Manual review required |
| `VLM_NoAvailablePhotos` | Zero available photos on project | Check MinIO health |

---

## Testing Strategy

### Unit Tests

1. **test_extract_gpkg_photos.py**
   - Mock GPKG file → extract photo references
   - Mock MinIO list → verify status classification
   - Expected: 80% available, 20% pending (realistic ratio)

2. **test_recheck_pending_uploads.py**
   - Setup: 100 pending records, add 30 to MinIO
   - Run recheck
   - Expected: 30 → available, 0 → missing (all < 7 days old)
   - Setup: 50 pending 8+ days old, no MinIO files
   - Expected: 50 → missing

3. **test_classify_qa_photos_vlm.py**
   - Setup: 100 available + 50 pending + 10 missing photos
   - Run classifier with filter
   - Expected: Processes only 100 (available)

### Integration Test

1. Upload GPKG file to QFieldCloud webhook
2. Trigger extract-gpkg-photos.py
3. Verify: DB has records with upload_status='pending_upload'
4. Upload photo to MinIO manually
5. Run recheck-pending-uploads.py
6. Verify: Record updated to upload_status='available'
7. Run classify-qa-photos-vlm.py
8. Verify: Photo classified (not skipped)

---

## Troubleshooting

### Issue: 1,000+ records still pending after 7 days

**Check**:
1. Are field devices actually syncing QFieldCloud? (Check QFieldCloud logs)
2. Is MinIO reachable from Python environment? (Try `minio_client.list_buckets()`)
3. Is project_id path correct? (Check S3 console for DCIM/{project_id} prefix)

**Action**:
- Run `recheck-pending-uploads.py` manually with `--verbose` flag
- Check MinIO health: `aws s3 ls s3://fibreflow-dcim/DCIM/`
- Contact field ops: "Why is QField not syncing photos for project_id=456?"

### Issue: All photos marked as 'missing' after 7 days

**Check**:
1. Is MinIO batch-list returning correct paths? (Enable debug logging)
2. Are photo paths in GPKG matching MinIO directory structure? (Path mismatch?)
3. Did QFieldCloud binary upload actually happen? (Check QField audit log)

**Action**:
- Sample 10 photo_path values from DB
- Manually list MinIO: `minio_client.list_objects('dcim', prefix='DCIM/')`
- Compare paths (may be case-sensitive on Linux)
- If paths don't match, fix path normalization in extract-gpkg-photos.py

---

## Related Features & Dependencies

- **field-ops**: Pole plant date sync (reads qfield_photos.upload_status)
- **construction-qa**: VLM classification (skips pending/missing photos)
- **noc**: Photo attachment UI (can reference qfield_photos for gallery)

---

## Success Metrics

1. **Ghost Records Eliminated**: 1,560 → 0 pending/missing after stabilization
2. **VLM Accuracy**: Zero wasted API calls on non-existent files
3. **Audit Trail**: 100% of photos classified as available/pending/missing (no unknowns)
4. **Resolution Time**: 90% of pending photos resolved within 24 hours of file arrival
5. **Alert Response**: <15 min response time to "missing photo" alert

---

## References

- **Related Commits**:
  - 2c44979 — MinIO verification + upload_status tracking
  - Migration 243 — Schema changes
- **Related Modules**: qfield, construction-qa, field-ops
- **Data Sources**: QFieldCloud GPKG files, MinIO DCIM directory
- **Knowledge Base**: `kb/qfield-sync.md` (detailed QFieldCloud behavior)

**Last Updated**: 2026-03-16 | **Owner**: Elon (CTO) | **Status**: Live
