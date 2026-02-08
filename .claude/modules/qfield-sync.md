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

---

## Photo Resizer (Feb 2026)

### Problem
Users taking photos with native iOS/Android cameras produce 10-20MB images. QFieldCloud's Django memory limit (2.5MB) causes sync failures when these large photos are uploaded.

**QFieldCloud Limits:**
- nginx: `client_max_body_size 10G` (accepts large uploads)
- Django: `DATA_UPLOAD_MAX_MEMORY_SIZE: 2621440` (2.5MB memory limit)
- QField app "Maximum Picture Size" setting only works for photos taken IN QField, not gallery imports

### Solution: Server-Side Resize
Automated cron job resizes photos after upload using boto3 + PIL inside the qfieldcloud-app-1 container.

### Files
| File | Purpose |
|------|---------|
| `/opt/qfield-sync/resize_photos_boto.py` | Main resize script (boto3 + PIL) |
| `/opt/qfield-sync/qfield-photo-resize.sh` | Interactive wrapper |
| `/opt/qfield-sync/qfield-photo-resize-cron.sh` | Silent cron wrapper |
| `/opt/qfield-sync/photo-resize.log` | Activity log |
| `/opt/qfield-sync/photo_backups/` | Backup metadata JSONs |

### Configuration
```python
MAX_DIMENSION = 2048      # Max width/height
JPEG_QUALITY = 85         # Compression quality
MIN_SIZE_MB = 3           # Cron threshold (5MB for manual)
BUCKET = 'qfieldcloud-prod'
BACKUP_BUCKET = 'qfieldcloud-backups'
```

### MinIO Versioned Files
MinIO stores files with version suffixes: `filename.JPG/vXXXXXXXX-XXXXX`

The script uses regex to detect image files:
```python
IMAGE_PATTERN = re.compile(r'\.(jpg|jpeg|png|heic)/v[0-9]+-[a-f0-9]+$|\.(jpg|jpeg|png|heic)$', re.IGNORECASE)
```

### Cron Schedule
Runs every 2 hours during working hours (6am-8pm):
```
0 6,8,10,12,14,16,18,20 * * * /opt/qfield-sync/qfield-photo-resize-cron.sh
```

### Commands

**Interactive (on Velocity):**
```bash
# Preview (always do first)
/opt/qfield-sync/qfield-photo-resize.sh --dry-run

# Backup only (no resize)
/opt/qfield-sync/qfield-photo-resize.sh --backup-only

# Full resize (backup + resize)
/opt/qfield-sync/qfield-photo-resize.sh

# With options
/opt/qfield-sync/qfield-photo-resize.sh --max-size 5 --limit 10

# List backups
/opt/qfield-sync/qfield-photo-resize.sh --list-backups

# Rollback
/opt/qfield-sync/qfield-photo-resize.sh --rollback BACKUP_ID
```

**Check logs:**
```bash
tail -50 /opt/qfield-sync/photo-resize.log
```

### Results (Initial Run Feb 2026)
- **407 files** processed
- **~1,731MB → ~238MB** (saved ~1.5GB)
- 84-97% reduction per file

### Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| 0 files found | Regex not matching version suffix | Verify `IMAGE_PATTERN` includes `/v[0-9]+-` |
| mc not found | Host mc is Midnight Commander | Use boto3 inside container instead |
| Permission denied | Wrong log path | Use `/opt/qfield-sync/` not `/var/log/` |
| Container not found | Wrong container name | Use `qfieldcloud-app-1` (has boto3+PIL) |

### Safety Features
1. **Backup before resize**: All originals copied to `qfieldcloud-backups` bucket
2. **Rollback capability**: Restore from any backup ID
3. **Dry-run mode**: Preview without changes
4. **JSON logs**: Full audit trail in `/opt/qfield-sync/photo_backups/`
5. **Silent cron**: Only logs when work is done

---

## AI Photo Validation (Feb 2026)

### Overview
Automated quality assurance for QField construction photos using VLM (Vision Language Model) to validate photos against FiberTime standards. Validates photos AFTER QField sync completes on the server side, not in the QField app itself.

**Purpose:**
- Ensure construction photos meet quality standards before acceptance
- Catch common issues early (blurry, wrong angle, missing components)
- Provide immediate WhatsApp feedback to field technicians
- Reduce manual QA workload

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                     QField Photo Validation Flow                 │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  1. Technician takes photo in QField                             │
│  2. Photo syncs to MinIO (qfieldcloud-prod bucket)               │
│  3. Validation script runs (manual/cron)                         │
│     ├── Scans MinIO for photos by layer                          │
│     ├── Downloads photo                                          │
│     ├── Resizes to 1024x768 (VLM max)                            │
│     ├── Sends to VLM at 100.96.203.105:8100                      │
│     ├── Parses JSON response                                     │
│     └── Saves to qfield_photo_validations table                  │
│  4. If validation fails (confidence < threshold)                 │
│     ├── Marks needs_retake = true                                │
│     └── Sends WhatsApp notification (via 72.61.197.178:8083)     │
│  5. Technician sees feedback, retakes photo                      │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### Files

| File | Purpose |
|------|---------|
| `/opt/qfield-sync/validate_photos.py` | Main validation script (boto3 + VLM + PostgreSQL) |
| `/opt/qfield-sync/qfield-photo-validate.sh` | Interactive wrapper (handles container env) |

### Database Schema

**Tables:**
- `qfield_photo_validations` - Stores VLM validation results
- `qfield_validation_config` - Per-project validation settings

**Key Fields:**
```sql
-- qfield_photo_validations
id UUID
photo_key TEXT                    -- MinIO path
work_type TEXT                    -- pole_installation, cable_stringing, dome_joint, activation
vlm_confidence DECIMAL(3,2)       -- 0.00 to 1.00
vlm_feedback TEXT                 -- Human-readable feedback
vlm_raw_response JSONB            -- Full VLM response
needs_retake BOOLEAN              -- TRUE if confidence < threshold
retake_notified_at TIMESTAMPTZ    -- When WhatsApp sent
feature_id TEXT                   -- Linked pole/DR/splice ID
project_id UUID                   -- QFieldCloud project ID

-- qfield_validation_config
project_id UUID PRIMARY KEY
validation_enabled BOOLEAN DEFAULT FALSE
confidence_threshold DECIMAL(3,2) DEFAULT 0.60
notify_on_failure BOOLEAN DEFAULT TRUE
notification_group_jid TEXT       -- WhatsApp group for notifications
```

### Layer to Work Type Mapping

Photos are categorized by their QField layer name:

```python
LAYER_TO_WORK_TYPE = {
    'poles': 'pole_installation',
    'Poles': 'pole_installation',
    'cables': 'cable_stringing',
    'fiber_cables': 'cable_stringing',
    'primary_feeder': 'cable_stringing',
    'secondary_feeder': 'cable_stringing',
    'distribution': 'cable_stringing',
    'splice_points': 'dome_joint',
    'dome_joints': 'dome_joint',
    'fts': 'dome_joint',
    'sts': 'dome_joint',
    'drops': 'activation',
    'service_drops': 'activation',
}
```

### VLM Prompts by Work Type

Each work type has a specialized validation prompt:

**pole_installation:**
```
Validate this fiber pole installation photo.
Required: 1) Full pole visible from base to top, 2) Pole foundation visible,
3) Pole number label readable, 4) Slack bracket if breakout location
FiberTime checks: CCA H4 SANS 754 standard, stays/struts if required,
vertical orientation, no damage
Respond with JSON: {"valid": true/false, "confidence": 0.0-1.0,
"issues": [], "feedback": ""}
```

**cable_stringing:**
```
Validate this fiber cable stringing photo.
Required: 1) Cable route visible, 2) Attachment points shown, 3) Slack coil at pole
FiberTime checks: Slack coiled ≤300mm diameter, cable tied to slack bracket,
no back-feeding
Respond with JSON: {"valid": true/false, "confidence": 0.0-1.0,
"issues": [], "feedback": ""}
```

**dome_joint:**
```
Validate this dome joint/splice closure photo.
Required: 1) Dome enclosure visible, 2) Slack brackets visible,
3) Emergency mounting points
FiberTime checks: Slack on bracket, backhaul fiber separate, cables labeled
Respond with JSON: {"valid": true/false, "confidence": 0.0-1.0,
"issues": [], "feedback": ""}
```

**activation:**
```
Validate this drop cable installation photo.
Required: 1) Drop cable from STS to house, 2) Connection point visible,
3) Drip loop before entry
FiberTime checks: Max 50m drop, dead-end wrap on pigtail screw,
2-4mm fiber drop cable, slack max 10m
Respond with JSON: {"valid": true/false, "confidence": 0.0-1.0,
"issues": [], "feedback": ""}
```

### VLM Configuration

**Endpoint:** `http://100.96.203.105:8100/api/vlm`
**Model:** Qwen3-VL (multimodal vision-language model)
**Max Image Size:** 1024x768 pixels
**Timeout:** 30 seconds

### WhatsApp Notifications

**Bridge Endpoint:** `http://72.61.197.178:8083/send-message`

**Notification Format:**
```
⚠️ Photo Validation Failed

📷 Photo: IMG_20260207_001.jpg
🏷️ Feature: POLE-001
🔧 Work Type: Pole Installation
📊 Confidence: 45%

❌ Issues:
• Pole base not visible
• Label not readable

💬 Feedback:
Please retake photo showing full pole from base to top
with readable pole number label.

Please retake this photo addressing the issues above.
```

### Commands

**Interactive (on Velocity):**

```bash
# Preview (dry-run) - ALWAYS DO FIRST
/opt/qfield-sync/qfield-photo-validate.sh --validate --dry-run

# Validate specific project only
/opt/qfield-sync/qfield-photo-validate.sh --validate \
  --project-id af058301-32d1-4bca-84f9-83b899fcbb34

# Full validation with notifications
/opt/qfield-sync/qfield-photo-validate.sh --validate

# Test mode - send to Velo Test group only
/opt/qfield-sync/qfield-photo-validate.sh --validate --test-group --dry-run

# Custom confidence threshold (default: 0.6)
/opt/qfield-sync/qfield-photo-validate.sh --validate --confidence-threshold 0.7

# Dry run with test group
/opt/qfield-sync/qfield-photo-validate.sh --validate --dry-run --test-group
```

**Direct Python (inside container):**

```bash
# SSH to Velocity
ssh velo@100.96.203.105

# Run inside container with env vars
sudo docker exec -i qfieldcloud-app-1 bash -c "
  source /opt/qfield-sync/config.env && \
  python3 /opt/qfield-sync/validate_photos.py --validate --dry-run
"
```

### CLI Flags

| Flag | Description |
|------|-------------|
| `--validate` | Enable validation (REQUIRED - safety flag) |
| `--dry-run` | Preview without saving to DB or sending notifications |
| `--project-id UUID` | Only validate photos from specific project |
| `--confidence-threshold 0.0-1.0` | Pass/fail cutoff (default: 0.6) |
| `--test-group` | Send to Velo Test group (120363421664266245@g.us) only |

### Workflow

1. **Manual Run (Testing):**
   ```bash
   # Dry run first to see what would happen
   /opt/qfield-sync/qfield-photo-validate.sh --validate --dry-run

   # Test with actual VLM but don't notify
   /opt/qfield-sync/qfield-photo-validate.sh --validate --dry-run --test-group

   # Full run with notifications
   /opt/qfield-sync/qfield-photo-validate.sh --validate
   ```

2. **Automated (Future - Cron):**
   ```cron
   # Run every hour during working hours
   0 8-18 * * * /opt/qfield-sync/qfield-photo-validate.sh --validate
   ```

3. **Project-Specific:**
   ```bash
   # Enable validation for a project in database
   INSERT INTO qfield_validation_config (
     project_id,
     validation_enabled,
     confidence_threshold,
     notify_on_failure,
     notification_group_jid
   ) VALUES (
     'af058301-32d1-4bca-84f9-83b899fcbb34',
     TRUE,
     0.65,
     TRUE,
     '120363421532174586@g.us'  -- Mohadin group JID
   );
   ```

### Output Example

```
Starting QField Photo Validation...

Connecting to MinIO...
Connecting to database...
Scanning for QField photos...
Found 3 photos to validate

Validating 3 photos...

[1/3] IMG_20260207_001.jpg (pole_installation)
  Downloading...
  Validating with VLM...
  ✓ PASS - Confidence: 85%
  Saved validation ID: 550e8400-e29b-41d4-a716-446655440000

[2/3] IMG_20260207_002.jpg (cable_stringing)
  Downloading...
  Validating with VLM...
  ✗ FAIL - Confidence: 45%
  Issues: Slack coil not visible, Cable attachment unclear
  Saved validation ID: 550e8400-e29b-41d4-a716-446655440001
  ✓ WhatsApp notification sent to 120363421532174586@g.us

[3/3] IMG_20260207_003.jpg (activation)
  Downloading...
  Validating with VLM...
  ✓ PASS - Confidence: 72%
  Saved validation ID: 550e8400-e29b-41d4-a716-446655440002

=== Validation Summary ===
Total photos: 3
Passed: 2 (66.7%)
Failed: 1 (33.3%)
Errors: 0

Done!
```

### Database Queries

**Check recent validations:**
```sql
SELECT
  photo_key,
  work_type,
  vlm_confidence,
  needs_retake,
  validated_at
FROM qfield_photo_validations
ORDER BY validated_at DESC
LIMIT 10;
```

**Find failed validations needing retake:**
```sql
SELECT
  photo_key,
  work_type,
  vlm_confidence,
  vlm_feedback,
  feature_id
FROM qfield_photo_validations
WHERE needs_retake = TRUE
  AND retake_completed_at IS NULL
ORDER BY validated_at DESC;
```

**Get validation stats by work type:**
```sql
SELECT
  work_type,
  COUNT(*) as total,
  AVG(vlm_confidence) as avg_confidence,
  SUM(CASE WHEN needs_retake THEN 1 ELSE 0 END) as failed_count
FROM qfield_photo_validations
GROUP BY work_type
ORDER BY work_type;
```

**Find photos awaiting notification:**
```sql
SELECT
  id,
  photo_key,
  vlm_feedback,
  feature_id
FROM qfield_photo_validations
WHERE needs_retake = TRUE
  AND retake_notified_at IS NULL
ORDER BY validated_at ASC;
```

### Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| No photos found | Wrong layer naming | Check `LAYER_TO_WORK_TYPE` mapping matches QField layers |
| VLM timeout | Image too large or service down | Check VLM service: `curl http://100.96.203.105:8100/health` |
| WhatsApp not sent | Bridge down or wrong JID | Check bridge: `curl http://72.61.197.178:8083/health` |
| Permission denied | Missing env vars | Source `/opt/qfield-sync/config.env` before running |
| JSON parse error | VLM returned non-JSON | Check `vlm_raw_response` field for actual response |
| DB connection failed | Wrong NEON_DATABASE_URL | Verify env var in config.env |

### Future Enhancements

- [ ] Automatic retake detection (mark `retake_completed_at` when new photo synced)
- [ ] Extract `feature_id` from photo metadata/path
- [ ] Webhook trigger on QField sync completion
- [ ] Dashboard UI showing validation metrics
- [ ] Batch processing optimization (parallel VLM calls)
- [ ] Confidence score trending by technician
- [ ] Custom prompts per project
- [ ] Photo comparison (before/after retake)

### How It Works

1. **Server-Side Processing**: Photos are validated AFTER sync from QField to server, not during field capture
2. **VLM Analysis**: Each photo analyzed by Qwen3 vision model (http://100.96.203.105:8100)
3. **FiberTime Alignment**: Validation criteria based on documented FiberTime standards
4. **WhatsApp Notifications**: Results sent to technician's registered WhatsApp number
5. **Database Tracking**: All validations stored with confidence scores and retry tracking

**Pipeline:**
```
QField Upload → QFieldCloud Sync → Server Detection → VLM Validation → WhatsApp Notification → Database Storage
```

### Work Types Supported

| Work Type | FiberTime Ref | Key Validation Criteria |
|-----------|---------------|-------------------------|
| `pole_installation` | FiberTime Pole Standards | Pole vertical, visible foundation, pole number tag, proper grounding |
| `cable_stringing` | FiberTime Cable Standards | Cable properly tensioned, visible cable path, hardware installed, no sag |
| `dome_joint` | FiberTime Splicing Standards | Dome sealed, visible splice tray, proper cable entry, closure labeled |
| `activation` | FiberTime Activation Standards | ONT mounted, power connected, fiber terminated, visible status LEDs |

### Database Tables

**qfield_photo_validations**
```sql
CREATE TABLE qfield_photo_validations (
  id UUID PRIMARY KEY,
  project_id UUID REFERENCES qfield_projects,
  attachment_id UUID,  -- QFieldCloud attachment ID
  photo_url TEXT,
  work_type TEXT,      -- pole_installation, cable_stringing, dome_joint, activation
  validation_result JSONB,
  is_valid BOOLEAN,
  confidence_score DECIMAL(3,2),
  issues_found TEXT[],
  validated_at TIMESTAMP,
  technician_phone TEXT,
  notification_sent BOOLEAN,
  retry_count INTEGER DEFAULT 0,
  last_retry_at TIMESTAMP
);
```

**qfield_validation_config**
```sql
CREATE TABLE qfield_validation_config (
  id UUID PRIMARY KEY,
  project_id UUID REFERENCES qfield_projects,
  work_type TEXT,
  enabled BOOLEAN DEFAULT true,
  min_confidence_threshold DECIMAL(3,2) DEFAULT 0.70,
  notify_on_pass BOOLEAN DEFAULT false,
  notify_on_fail BOOLEAN DEFAULT true,
  validation_criteria JSONB,
  updated_at TIMESTAMP
);
```

### Commands

**Preview validation (dry-run):**
```bash
/opt/qfield-sync/validate_photos.py --validate --dry-run
```

**Validate with test group notifications:**
```bash
# Send results to test WhatsApp group instead of technicians
/opt/qfield-sync/validate_photos.py --validate --test-group
```

**Full validation (production):**
```bash
# Validates ALL unvalidated photos across all projects
/opt/qfield-sync/validate_photos.py --validate
```

**Specific project only:**
```bash
/opt/qfield-sync/validate_photos.py --validate --project-id af058301-32d1-4bca-84f9-83b899fcbb34
```

**Retry failed validations:**
```bash
# Retry photos where VLM validation failed (network/timeout errors)
/opt/qfield-sync/validate_photos.py --validate --retry-failed
```

**Custom confidence threshold:**
```bash
# Only flag photos with confidence < 0.80
/opt/qfield-sync/validate_photos.py --validate --min-confidence 0.80
```

### Toggle & Safety Controls

**1. Feature Flag (--validate)**
- Validation ONLY runs when `--validate` flag is explicitly passed
- Default behavior: sync without validation
- Prevents accidental validation runs

**2. Dry-Run Mode (--dry-run)**
- Shows what WOULD be validated without making changes
- No database writes, no notifications sent
- Always run dry-run before production validation

**3. Confidence Threshold**
- Default: 0.70 (70% confidence required)
- Configurable per project via `qfield_validation_config`
- Photos below threshold flagged as "needs review"

**4. Per-Project Settings**
```sql
-- Enable/disable validation for specific project
UPDATE qfield_validation_config
SET enabled = false
WHERE project_id = 'UUID';

-- Adjust confidence threshold for dome joints only
UPDATE qfield_validation_config
SET min_confidence_threshold = 0.80
WHERE work_type = 'dome_joint';
```

**5. Test Group Mode (--test-group)**
- Routes all notifications to test WhatsApp group
- Prevents spam to real technicians during testing
- Group ID: `120363321470033648@g.us` (FibreFlow Test)

**6. Retry Logic**
- Max 3 retry attempts for VLM failures
- Exponential backoff: 1min, 5min, 15min
- Separate retry from validation failures (photo quality issues)

### WhatsApp Notification Format

**Validation PASS:**
```
✅ Photo Approved: Pole Installation

Photo quality: EXCELLENT (92% confidence)
Location: Project XYZ
Time: 14:23 07 Feb 2026

Great work! Photo meets FiberTime standards.
```

**Validation FAIL:**
```
❌ Photo Rejected: Cable Stringing

Issues found:
• Cable appears to have excessive sag
• Proper tensioning hardware not visible
• Cable path unclear in image

Confidence: 68%
Location: Project XYZ
Time: 14:23 07 Feb 2026

Please retake photo following FiberTime standards.
Ref: FiberTime Cable Stringing Guide
```

**Validation ERROR (VLM timeout):**
```
⚠️ Photo Validation Error

Work type: Dome Joint
Error: VLM service timeout

Your photo has been queued for retry.
No action needed - you'll receive results shortly.
```

### Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| **VLM timeouts** | Qwen3 service overloaded/down | Check `curl http://100.96.203.105:8100/health`, restart if needed |
| **No notifications sent** | WhatsApp bridge down | Verify `curl http://100.96.203.105:8092/health` |
| **All photos fail validation** | Confidence threshold too high | Lower threshold in `qfield_validation_config` |
| **Photos not detected** | Sync didn't populate metadata | Check `qfield_sync_jobs` table for sync errors |
| **Wrong work type detected** | QField layer naming mismatch | Update work type mapping in validation script |
| **Duplicate validations** | Script ran multiple times | Check `validated_at IS NULL` filter in query |

**Check validation logs:**
```bash
tail -100 /opt/qfield-sync/validation.log
```

**View recent validations:**
```sql
SELECT
  work_type,
  is_valid,
  confidence_score,
  issues_found,
  validated_at
FROM qfield_photo_validations
WHERE validated_at > NOW() - INTERVAL '24 hours'
ORDER BY validated_at DESC;
```

**Reset validation for re-testing:**
```sql
-- Clear validation results for specific photo
DELETE FROM qfield_photo_validations
WHERE attachment_id = 'UUID';

-- Clear ALL validations for a project (use with caution)
DELETE FROM qfield_photo_validations
WHERE project_id = 'UUID';
```

---

## QField QA Dashboard (Feb 2026)

### Overview
Web-based dashboard for viewing QField photos, AI validation results, and performing manual QA review with approve/reject/escalate workflow.

**Page:** `/qfield/qa`
**Module:** `src/modules/qfield-qa/`

### Photo Proxy API

**Endpoint:** `GET /api/qfield/photo-proxy?key={photo_key}`

**CRITICAL:** MinIO uses erasure-coded storage - files are sharded across `/data1`, `/data2`, etc. You CANNOT use direct `cat` to read files.

**Solution:** Use `mc cat` (MinIO Client) inside the Docker container:
```typescript
const command = `docker exec qfieldcloud-minio-1 mc cat 'local/${MINIO_BUCKET}/${objectPath}' 2>&1`;
```

The `local` alias is pre-configured in the MinIO container to connect to `localhost:9000`.

### MinIO Photo Path Format

**IMPORTANT:** The photo version ID format in MinIO is:
```
v{YYYYMMDDHHMMSS}-{first 8 chars of UUID}
```

**Example:**
- QFieldCloud `filestorage_fileversion.id`: `6abcf9f1-93fd-404d-9276-b733610d1e3c`
- QFieldCloud `filestorage_fileversion.created_at`: `2026-02-06 13:47:22`
- **MinIO path:** `projects/{project_id}/files/DCIM/{filename}/v20260206134722-6abcf9f1`

**Query to get correct paths:**
```sql
SELECT
  f.project_id,
  'projects/' || f.project_id || '/files/' || f.name || '/v' ||
  to_char(fv.created_at, 'YYYYMMDDHH24MISS') || '-' ||
  substring(fv.id::text, 1, 8) as photo_key
FROM filestorage_file f
JOIN filestorage_fileversion fv ON fv.file_id = f.id
WHERE f.name LIKE 'DCIM/%';
```

### Import Script

**Script:** `scripts/import_qfield_photos.js`

Imports photos from QFieldCloud into `qfield_photo_validations` table:
1. Exports photo records from QFieldCloud PostgreSQL
2. Converts version UUID to MinIO path format
3. Inserts into FibreFlow with `workflow_status: 'pending'`

**Usage:**
```bash
# 1. Export from QFieldCloud (on Velocity server)
docker exec qfieldcloud-db-1 psql -U qfieldcloud_db_admin -d qfieldcloud_db -t -A -F'|' -c "
SELECT f.project_id, p.name,
  'projects/' || f.project_id || '/files/' || f.name || '/v' ||
  to_char(fv.created_at, 'YYYYMMDDHH24MISS') || '-' ||
  substring(fv.id::text, 1, 8) as photo_key,
  f.name, fv.created_at
FROM filestorage_file f
JOIN core_project p ON p.id = f.project_id
JOIN filestorage_fileversion fv ON fv.file_id = f.id
WHERE f.name LIKE 'DCIM/%'
  AND (f.name LIKE '%.jpg' OR f.name LIKE '%.JPG')
ORDER BY fv.created_at DESC;
" > /tmp/qfield_photos.csv

# 2. Copy to local
scp velo@100.96.203.105:/tmp/qfield_photos.csv /tmp/

# 3. Run import
npx tsx scripts/import_qfield_photos.js
```

### Database Schema

**Key columns in `qfield_photo_validations`:**
- `project_id` - UUID of QFieldCloud project
- `photo_key` - Full MinIO path (e.g., `projects/{uuid}/files/DCIM/photo.jpg/v20260206-abc123`)
- `work_type` - `pole_installation`, `cable_stringing`, `dome_joint`, `activation`
- `workflow_status` - `pending`, `in_review`, `approved`, `rejected`, `escalated`
- `vlm_confidence` - 0.00 to 1.00
- `vlm_feedback` - Human-readable AI feedback

### Stats (Feb 2026)

After initial import:
- **Total photos:** 5,965
- **Projects:** LAW_Pole_Audit (3,364), MOA_Pole_Audit (2,292), MOA_Site_Audit (595), etc.
