---
name: qfield
description: QField/QFieldCloud integration reference for FibreFlow. GPKG imports, photo sync, OES sync, photo validation, resize pipeline. USE WHEN user says 'qfield', 'qfieldcloud', 'gpkg', 'geopackage', 'qfield sync', 'qfield photos', 'field sync', 'qfield import', 'oes sync', 'photo resize', 'photo validation', 'sync-qa-to-qfield'.
---

# QField Integration Skill

Comprehensive reference for all QField/QFieldCloud integration touchpoints in FibreFlow.

USE WHEN: "qfield", "qfieldcloud", "gpkg", "geopackage", "qfield sync", "qfield photos", "field sync", "qfield import", "oes sync", "photo resize", "photo validation", "qa to qfield", "sync-qa-to-qfield", "qfield project"

---

## Section 1: Quick Reference

### Key Files

| Category | File | Purpose |
|----------|------|---------|
| Module | `src/modules/qfield-sync/` | Bidirectional sync UI and hooks |
| Module | `src/modules/qfield-import/` | GPKG import wizard (4-phase) |
| Module | `src/modules/qfield-qa/` | Photo QA dashboard and workflow |
| Python | `/opt/qfield-sync/sync_oes_db_to_qfield.py` | OES sync script (runs as velo) |
| Python | `/opt/qfield-sync/sync_server.py` | Webhook server (port 8095) |
| Python | `/opt/qfield-sync/resize_photos_boto.py` | Photo resizer (boto3 + PIL) |
| Python | `/opt/qfield-sync/validate_photos.py` | VLM photo validator |
| Python | `scripts/sync-qa-to-qfield.py` | Push QA decisions back to QField GPKG |
| Node | `scripts/sync-qfield-photos-to-local.js` | Bulk copy MinIO photos to local storage |
| Node | `scripts/migrate-qfield-photos.js` | One-time MinIO→local migration |
| Python reader | `scripts/qfield-sync/read_gpkg.py` | Reads GPKG from MinIO, outputs JSON |
| TS lib | `src/lib/qfield/gpkg-import-layers.ts` | UNNEST bulk upsert for all layer types |

### Ports and Services

| Service | Host | Port | Notes |
|---------|------|------|-------|
| QField webhook server | Velocity (100.96.203.105) | 8095 | OES sync trigger |
| QFieldCloud (nginx) | Velocity (100.96.203.105) | 8082 | Public: qfield.fibreflow.app |
| QFieldCloud Django | Velocity (internal) | 8000 | Internal only |
| MinIO API | Velocity (internal) | 8009→9000 | qfieldcloud-minio-1 container |
| MinIO Console | Velocity (internal) | 8010→9001 | Admin UI |
| VLM (Qwen3) | Velocity | 8100 | Photo validation |

### URLs

| URL | Purpose |
|-----|---------|
| `https://qfield.fibreflow.app` | QFieldCloud public URL |
| `http://100.96.203.105:8095` | Webhook server (internal) |
| `http://100.96.203.105:8100/v1/chat/completions` | VLM API endpoint |

### Environment Variables

```bash
QFIELD_API_TOKEN     # QFieldCloud REST API token (set in .env.local)
MINIO_BUCKET         # Default: qfieldcloud-prod
VLM_API_URL          # Default: http://100.96.203.105:8100
VPS_HOST             # Default: 100.96.203.105
VPS_USER             # Default: velo
VPS_OES_PATH         # Default: /opt/qfield-sync
DATABASE_URL         # Neon PostgreSQL connection
```

### MinIO Bucket and Paths

```
Bucket:  qfieldcloud-prod    (NOT qfieldcloud-local)
mc alias: local              (NOT minio/)

Photo path format:
  projects/{qf_project_id}/files/DCIM/{filename}.jpg/{version-id}
  Example: projects/137eb5ec-.../files/DCIM/JPEG_20251016130535337.jpg/v20251107044855-6296d2d1

Version ID format:
  v{YYYYMMDDHHMMSS}-{first 8 chars of UUID}
  Example: v20260206134722-6abcf9f1

GPKG path format:
  projects/{qf_project_id}/files/{filename}.gpkg/   ← directory of versions
  projects/{qf_project_id}/files/{filename}.gpkg/{version-id}
```

---

## Section 2: Architecture

### High-Level Data Flow

```
QField App (tablet/phone)
    ↓ WiFi/4G sync
QFieldCloud (Django + PostGIS, qfield.fibreflow.app)
    ↓ stores in
MinIO (qfieldcloud-prod bucket, Velocity internal)
    ↓
FibreFlow reads via two paths:
  A) Webhook trigger (POST :8095/sync/oes) → Python scripts
  B) UI-triggered GPKG import (Next.js → child_process → read_gpkg.py)
  C) Photo proxy (docker exec mc cat) → browser/VLM
    ↓
Neon PostgreSQL (production DB)
    ↓
FibreFlow sends decisions back to QField:
  scripts/sync-qa-to-qfield.py → updates GPKG → upload → QFieldCloud processes
```

### Photo Flow

```
Field technician photos in QField
    ↓ sync
MinIO (qfieldcloud-prod)
    ↓ cron every 2h (6am-8pm)
Photo resizer (/opt/qfield-sync/resize_photos_boto.py)
    — 10-20MB → max 2048px, JPEG 85% quality
    ↓
Photos remain in MinIO (smaller versions)
    ↓ accessed via docker exec mc cat
FibreFlow photo proxy API → browser
VLM validation (Qwen3 on :8100)
    ↓
qfield_photo_validations table (Neon)
    ↓ migration 189 ingestion
construction_qa_reviews + construction_qa_photos
```

### OES Sync Flow

```
OES Excel import (pages/api/activate/import-oes.ts)
    ↓ HTTP POST
Webhook server (:8095/sync/oes)
    ↓ runs as velo
sync_oes_db_to_qfield.py
    ↓ queries Neon (qfield_projects + qfield_project_links)
    ↓ fetches activated DRs from v_qfield_oes_activations view
    ↓ fetches remaining drops NOT in oes_activations
    ↓ creates GPKG file (2 layers)
    ↓ uploads to QFieldCloud API (Token auth)
QFieldCloud triggers process_projectfile + package jobs
    ↓
Tablets sync on next connect
```

### CRITICAL: Use Internal DNS for MinIO

```
CORRECT:  http://minio:9000       (internal Docker DNS)
WRONG:    http://172.17.0.1:8009  (Docker bridge IP — breaks when networking changes)
```

Both `app` AND `worker_wrapper` containers must be restarted after any `.env` changes.

---

## Section 3: QFieldCloud Infrastructure

### Docker Containers

| Container | Purpose | Port |
|-----------|---------|------|
| `qfieldcloud-app-1` | Django/Gunicorn app server | 8000 (internal) |
| `qfieldcloud-nginx-1` | Reverse proxy | 8082→80 |
| `qfieldcloud-worker_wrapper-{1-8}` | Job processing (8 instances) | — |
| `qfieldcloud-db-1` | PostgreSQL + PostGIS | 5433→5432 |
| `qfieldcloud-minio-1` | Object storage | 8009→9000, 8010→9001 |
| `qfieldcloud-memcached-1` | Cache | — |
| `qfieldcloud-ofelia-1` | Cron scheduler | — |

### Configuration Files

```
/opt/qfieldcloud/docker-compose.yml          ← DO NOT EDIT
/opt/qfieldcloud/docker-compose.override.yml ← Local overrides (EDIT THIS)
/opt/qfieldcloud/.env                        ← Environment variables
/opt/qfieldcloud/entrypoint-wrapper.sh       ← CSRF patch wrapper (permanent)
/opt/qfieldcloud/settings_csrf_patch.py      ← CSRF patch code
```

### Gunicorn Settings (in .env)

```bash
GUNICORN_TIMEOUT_S=600
GUNICORN_MAX_REQUESTS=5000   # Increased Feb 2026 (was 1000)
GUNICORN_WORKERS=8           # Must be >= worker_wrapper count
GUNICORN_THREADS=4
```

**CRITICAL:** Gunicorn workers MUST be >= worker_wrapper count. If workers < worker_wrappers, connection saturation causes `ConnectionResetError(104)` during project file downloads.

### Restart Commands

```bash
cd /opt/qfieldcloud

# Restart app (picks up .env changes)
docker-compose up -d app

# Restart workers (MUST do this too after .env changes)
docker-compose restart worker_wrapper

# Restart nginx
docker-compose up -d nginx

# Full restart
docker-compose down && docker-compose up -d

# Check all containers
docker ps -a --filter "name=qfield"
```

### Health Checks

```bash
# Service status
curl http://100.96.203.105:8095/status          # Webhook server
curl https://qfield.fibreflow.app/api/v1/       # QFieldCloud API
curl http://100.96.203.105:8100/health          # VLM service

# Webhook server detailed check
curl http://100.96.203.105:8095/health

# QFieldCloud admin shell
docker exec qfieldcloud-app-1 python manage.py shell
```

### CSRF Configuration (Permanent — Feb 2026)

CSRF is automatically applied via entrypoint wrapper on every container start. No manual steps needed.

```bash
# Verify CSRF is applied
docker exec qfieldcloud-app-1 python manage.py shell -c \
  "from django.conf import settings; print(settings.CSRF_TRUSTED_ORIGINS)"
# Expected: ['https://srv1083126.hstgr.cloud', 'https://qfield.fibreflow.app']
```

### Project Configuration — Known QFieldCloud Project UUIDs

| QField Project Name | UUID | Purpose |
|--------------------|------|---------|
| FT_Master_Progress | `af058301-32d1-4bca-84f9-83b899fcbb34` | OES sync — all 3 FF projects, default |
| FT_Lawley | `2e988631-462b-448f-ae15-bb693a68cd55` | Lawley only |
| FT_Mohadin / MOA_Site_Audit_2026 | `bec5f353-2e83-4f6b-989a-fca83ad94e16` | Mohadin only |
| FT_Mamelodi_POP1 / MAM1_Site_Audit_2026 | `2ce80264-170c-4f05-ada1-68220d7e5885` | Mamelodi only |
| LAW_Site_Audit_2026 | `2e988631-462b-448f-ae15-bb693a68cd55` | Lawley site audit |
| THM1_Site_Audit_2026 | `63341eb4-bc81-4607-a3d6-580ea2a7457c` | Thembisa POP 1 |
| THM2_Site_Audit_2026 | `4112f297-5647-425c-9b19-c9c68f4f421b` | Thembisa POP 2 |
| LAW_Pole_Audit | `07b7109f-479b-4a7b-b33c-13e2af0c6bd3` | Lawley pole audit photos |
| MOA_Pole_Audit | `137eb5ec-4c0b-4eab-8a5c-de046eb06349` | Mohadin pole audit photos |
| MAM_Pole_Audit | `c1e14ea2-489c-4376-a59a-1253df404dde` | Mamelodi pole audit photos |
| ETW_Pole_Audit | `04900ce2-1f2e-45bf-b3c8-8c78bc6540db` | Etwatwa pole audit photos |
| Etwatwa | `47585401-1b25-4d3b-8d18-4337ea26df88` | Etwatwa civil |
| Test Project (Automations) | `e849b878-f8a8-4f84-a3f1-9fbd051686c0` | OES sync test |

### FibreFlow Project UUIDs

| Project | UUID |
|---------|------|
| Lawley | `4eb13426-b2a1-472d-9b3c-277082ae9b55` |
| Mohadin | `bf9a90db-e758-4c05-b999-694cd63c451f` |
| Mamelodi | `7003dc06-9af7-4a7c-bc6c-a177d77784f2` |
| Thembisa POP 1 | `7d8b94d6-8e5a-4dbb-9ede-69ce3884e004` |
| Thembisa POP 3 | `1de088dd-fe24-43fb-b8d3-94fca61ef91d` |
| Etwatwa | `c7255076-1d2f-41ce-97bb-858b8c87ee27` |

---

## Section 4: GPKG Import Pipeline

### Overview

GeoPackage (GPKG) files are SQLite databases with spatial extensions. QField exports them to MinIO. FibreFlow imports them into Neon via a Python reader called from Next.js via `child_process.exec`.

### Pipeline

```
User selects QField project in UI
    ↓
GET /api/qfield/gpkg-layers?qfieldProjectId=<uuid>
    ↓ lists GPKG files in MinIO
POST /api/qfield/gpkg-preview
    ↓ runs read_gpkg.py --preview (metadata only, fast)
    ↓ returns layer counts + sample fields
User selects layers + mode (merge/replace)
    ↓
POST /api/qfield/gpkg-import
    ↓ runs read_gpkg.py --project-id (full feature read)
    ↓ Python reads GPKG from MinIO via docker exec
    ↓ JSON piped to Next.js
    ↓ importPoles/Joints/etc (UNNEST bulk upsert, 1000 per batch)
qfield_import_jobs record updated with results
```

### MinIO Access Commands

```bash
# List available buckets
docker exec qfieldcloud-minio-1 mc ls local/
# → qfieldcloud-backups/  qfieldcloud-prod/

# List GPKG files in a project
docker exec qfieldcloud-minio-1 mc ls local/qfieldcloud-prod/projects/{uuid}/files/

# List versions of a GPKG (JSON for parsing)
docker exec qfieldcloud-minio-1 mc ls --json \
  local/qfieldcloud-prod/projects/{uuid}/files/LAWPoles.gpkg/

# Download latest GPKG version
docker exec qfieldcloud-minio-1 mc cat \
  "local/qfieldcloud-prod/projects/{uuid}/files/LAWPoles.gpkg/{version-id}" \
  > /tmp/LAWPoles.gpkg
```

### Layer Detection Heuristics (read_gpkg.py)

| Column Pattern | Detected As |
|---------------|-------------|
| `Pole Type` or `PhotoPole` | poles |
| `type` column + Point geometry | joints |
| `Cable size` | cable_spans |
| `cblcpty` + MultiLineString | drops |
| MultiPolygon + `zone_no` only | zone_boundaries |
| MultiPolygon + `pon_no` | pon_boundaries |
| `Node` column | pops |

### Import Modes

- **Merge**: `COALESCE(existing_field, new_field)` — existing non-null preserved, gaps filled
- **Replace**: `DELETE FROM <table> WHERE project_id = ?` then bulk INSERT — full refresh

### Batch Size and Timeouts

- **Batch size**: 1000 features per UNNEST query
- **Import timeout**: 120s
- **Preview timeout**: 60s
- **maxBuffer**: 50MB for preview/layers, 200MB for import (large GPKG files)

### SA Bounds Filter

Coordinates outside South Africa bounds are silently dropped:
- Latitude: -35.0 to -22.0
- Longitude: 16.0 to 33.0

### GPKG Geometry Decoding

- Header: 2 bytes `"GP"` + version + flags + 4 bytes SRID
- Envelope type from flags bits 1-3 (0=none, 1=xy, 2=xyz, 3=xym, 4=xyzm)
- After header+envelope: standard WKB payload
- WKB types: 1=Point, 2=LineString, 3=Polygon, 5=MultiLineString, 6=MultiPolygon

### Job Tracking

```sql
SELECT status, layer_counts, records_created, records_updated, errors,
       started_at, completed_at
FROM qfield_import_jobs
WHERE project_id = '<ff_project_uuid>'
ORDER BY created_at DESC LIMIT 5;
```

Statuses: `running`, `completed`, `completed_with_errors`, `failed`

---

## Section 5: Photo Pipeline

### Photo Resizer (Server-Side, Every 2 Hours)

**Problem**: iOS/Android native camera photos are 10-20MB. QFieldCloud Django limit is 2.5MB memory per request.

**Solution**: Automated cron resizes photos after upload using boto3 + PIL inside `qfieldcloud-app-1` (which has these Python libraries). Do NOT run from host — `/usr/bin/mc` on host is GNU Midnight Commander, not MinIO client.

```bash
# Cron schedule (runs as root/velo on Velocity):
0 6,8,10,12,14,16,18,20 * * * /opt/qfield-sync/qfield-photo-resize-cron.sh

# Configuration:
MAX_DIMENSION = 2048      # Max width/height
JPEG_QUALITY = 85         # Compression quality
MIN_SIZE_MB = 3           # Cron threshold (skip files < 3MB)
BUCKET = 'qfieldcloud-prod'
BACKUP_BUCKET = 'qfieldcloud-backups'
```

**Commands**:

```bash
# Dry run (always first)
/opt/qfield-sync/qfield-photo-resize.sh --dry-run

# Backup only (no resize)
/opt/qfield-sync/qfield-photo-resize.sh --backup-only

# Full resize
/opt/qfield-sync/qfield-photo-resize.sh

# With custom settings
/opt/qfield-sync/qfield-photo-resize.sh --max-size 5 --limit 10

# Check logs
tail -50 /opt/qfield-sync/photo-resize.log

# List backups
/opt/qfield-sync/qfield-photo-resize.sh --list-backups

# Rollback a specific backup
/opt/qfield-sync/qfield-photo-resize.sh --rollback BACKUP_ID
```

**MinIO versioned file regex** (critical for correct detection):
```python
IMAGE_PATTERN = re.compile(
  r'\.(jpg|jpeg|png|heic)/v[0-9]+-[a-f0-9]+$|\.(jpg|jpeg|png|heic)$',
  re.IGNORECASE
)
```

### Photo Sync: MinIO → Local Storage

QField photos stored in MinIO with `source='qfield'` can be bulk-copied to local disk.

```bash
# Bulk sync (up to 6000 photos)
node scripts/sync-qfield-photos-to-local.js

# Limit batch
node scripts/sync-qfield-photos-to-local.js --limit 500
```

- Source: `construction_qa_photos WHERE source = 'qfield'`
- Dest: `/home/velo/storage/qa-photos/{project-slug}/{feature-id}/{filename}`
- After copy: updates `source='local'`, `storage_key={relPath}`

### Photo Access via Photo Proxy API

```
GET /api/qfield/photo-proxy?key={photo_key}
```

Fetches via `docker exec qfieldcloud-minio-1 mc cat 'local/qfieldcloud-prod/{path}'`. MinIO uses erasure-coded storage — files are sharded across `/data1`, `/data2`, etc. and CANNOT be read with direct `cat`.

### Query MinIO Path from QFieldCloud DB

```bash
docker exec qfieldcloud-db-1 psql -U qfieldcloud_db_admin -d qfieldcloud_db -c "
SELECT f.project_id,
  'projects/' || f.project_id || '/files/' || f.name || '/v' ||
  to_char(fv.created_at, 'YYYYMMDDHH24MISS') || '-' ||
  substring(fv.id::text, 1, 8) as photo_key,
  fv.created_at
FROM filestorage_file f
JOIN filestorage_fileversion fv ON fv.file_id = f.id
WHERE f.name LIKE 'DCIM/%'
ORDER BY fv.created_at DESC LIMIT 20;
"
```

---

## Section 6: QField ↔ Construction QA Integration

### Photo Ingest: QField → Construction QA

Migration 189 (`scripts/migrations/189_ingest_qfield_to_construction_qa.sql`) bulk-ingests `qfield_photo_validations` into `construction_qa_reviews` + `construction_qa_photos`.

**API endpoint for incremental ingest**:

```bash
# Dry run
CRON_SECRET=$(grep CRON_SECRET .env.local | head -1 | cut -d= -f2)
curl -s -X POST https://dev.fibreflow.app/api/construction-qa/ingest-qfield \
  -H "Content-Type: application/json" \
  -H "x-cron-secret: $CRON_SECRET" \
  -d '{"dryRun": true}' | python3 -m json.tool

# Live ingest
curl -s -X POST https://dev.fibreflow.app/api/construction-qa/ingest-qfield \
  -H "x-cron-secret: $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"dryRun": false}'
```

### Push-Back: QA Decisions → QField GPKG

After QA review in FibreFlow, decisions are written back into the QField GPKG files so field staff see updated pole statuses on their tablets.

```bash
# Dry run (all projects)
python3 scripts/sync-qa-to-qfield.py --dry-run

# Single project dry run
python3 scripts/sync-qa-to-qfield.py --project Lawley --dry-run

# Live sync (all projects)
python3 scripts/sync-qa-to-qfield.py

# Live sync (single project)
python3 scripts/sync-qa-to-qfield.py --project Mohadin
```

**Status mapping** (FibreFlow QA → QField pole Status column):

| FibreFlow Status | QField Status |
|-----------------|---------------|
| `approved` | `(ADMIN) Q/A Complete` |
| `rejected` / `retake_required` / `rework_needed` | `Q/A Failed` |
| Has photos but no QA decision yet | `Pole Verified/ Civil Complete` |
| No photos | unchanged |

**Process**:
1. Downloads current GPKG from MinIO via `docker exec mc cat`
2. Opens as SQLite, disables SpatiaLite triggers (`ST_IsEmpty` not available in plain SQLite)
3. Updates `Status`, `Pole Plant Date`, `Q/A Date`, `Q/A Civil Comments` columns
4. Re-enables triggers
5. Uploads via QFieldCloud REST API (`POST /api/v1/files/{project_id}/{path}/`)
6. QFieldCloud auto-triggers `process_projectfile` + `package` jobs

### Project GPKG Mapping

| Project | QField UUID | GPKG File | Table |
|---------|-------------|-----------|-------|
| Thembisa POP 1 | `63341eb4-...` | `Poles.gpkg` | `Poles` |
| Thembisa POP 3 | `5f3b962a-...` | `THM_3_Poles.gpkg` | `thm_3_poles` |
| Lawley | `2e988631-...` | `LAWPoles.gpkg` | `LAWPoles` |
| Mohadin | `bec5f353-...` | `MOAPoles.gpkg` | `MOAPoles` |
| Mamelodi | `2ce80264-...` | `MAMPoles.gpkg` | `MAMPoles` |
| Etwatwa | `47585401-...` | `PolesAudit.gpkg` | `PolesAudit` |

**Label column** for pole ID matching: `label_1` (Thembisa), `label` (all others)

### VLM Photo Validation

Validation runs against Qwen3-VL-8B-Instruct on `http://100.96.203.105:8100/v1/chat/completions`.

**Batch thresholds**:
- Up to 5 photos: synchronous, 3 concurrent
- More than 5: background (fire-and-forget), returns `queued` status immediately

**Work types and VLM prompts**:

| Work Type | QField Layer Names |
|-----------|--------------------|
| `pole_installation` | `poles`, `Poles` |
| `cable_stringing` | `cables`, `fiber_cables`, `primary_feeder`, `secondary_feeder`, `distribution` |
| `dome_joint` | `splice_points`, `dome_joints`, `fts`, `sts` |
| `activation` | `drops`, `service_drops` |

**Confidence threshold**: default 0.60 (60%). Below threshold → `needs_retake = true`.

**WhatsApp notifications** on rejection: bridge endpoint `http://72.61.197.178:8083/send-message`.

---

## Section 7: OES → QField Sync

### Architecture (March 2026 — Project-Split Sync)

Each enabled QField project receives only the DRs linked to its associated FibreFlow projects (not all DRs from all projects).

```bash
# Manual trigger (must run as velo, NOT root)
sudo -u velo bash -c 'cd /opt/qfield-sync && ./venv/bin/python3 sync_oes_db_to_qfield.py --report-date YYYY-MM-DD'

# Check webhook status
curl http://100.96.203.105:8095/status

# View OES sync log
tail -f /var/log/qfield-oes-sync.log
```

### Active Sync Targets (March 2026)

| QField Project | FF Projects Linked |
|---|---|
| FT_Master_Progress (`af058301-...`) | Lawley + Mohadin + Mamelodi |
| FT_Lawley (`2e988631-...`) | Lawley only |
| FT_Mohadin (`bec5f353-...`) | Mohadin only |
| FT_Mamelodi_POP1 (`2ce80264-...`) | Mamelodi only |

All other projects have `sync_enabled = false`.

### Two Layers Per GPKG

| Layer | Color | Source | Purpose |
|-------|-------|--------|---------|
| `OES FF DDMMYYYY All` | Cerise pink (222,49,99) | `v_qfield_oes_activations` | Activated DRs |
| `FF Remaining DRs DDMMYYYY` | Orange (255,165,0) | `drops` NOT IN `oes_activations` | Unactivated drops |

**Circle size**: 1.5mm. **Date format in name**: `DDMMYYYY` (e.g., `29012026`).

### SA Bounds Filter

```python
# Coordinates outside these bounds are filtered
LATITUDE:  -35.0 to -22.0
LONGITUDE:  16.0 to 33.0
```

### Adding a New Project to OES Sync

```sql
-- 1. Enable sync
UPDATE qfield_projects SET sync_enabled = true WHERE name = '<project name>';

-- 2. Link to FibreFlow project
INSERT INTO qfield_project_links (qfield_project_id, fibreflow_project_id)
VALUES (
  (SELECT id FROM qfield_projects WHERE name = '<qf project name>'),
  '<ff_project_uuid>'
);

-- 3. Optionally link to master progress project too
INSERT INTO qfield_project_links (qfield_project_id, fibreflow_project_id)
VALUES (
  (SELECT id FROM qfield_projects WHERE qfield_project_id = 'af058301-32d1-4bca-84f9-83b899fcbb34'),
  '<ff_project_uuid>'
);
```

Then run a manual sync to verify.

### CRITICAL: Never Run Sync Script as Root

```bash
# WRONG — creates root-owned /tmp/qfield_oes_sync/ dirs, velo can't overwrite
sudo python3 /opt/qfield-sync/sync_oes_db_to_qfield.py

# CORRECT
sudo -u velo bash -c 'cd /opt/qfield-sync && ./venv/bin/python3 sync_oes_db_to_qfield.py'

# Fix permission error from previous root run
sudo rm -rf /tmp/qfield_oes_sync/
```

### QFieldCloud API Auth

QFieldCloud API uses Token-based auth. The script uses username/password login — NOT `Token` header auth (which fails).

```bash
# Token is set in environment:
echo $QFIELD_API_TOKEN

# API upload format:
curl -sk -X POST "https://qfield.fibreflow.app/api/v1/files/{project_id}/{encoded_path}/" \
  -H "Authorization: Token $QFIELD_API_TOKEN" \
  -F "file=@{local_file};filename={filename};type=application/octet-stream"
```

---

## Section 8: API Endpoints

### Legacy QField Sync (pages/api root)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/qfield-sync-dashboard` | Dashboard metrics |
| POST | `/api/qfield-sync-start` | Initiate sync job |
| GET | `/api/qfield-sync-current` | Current job status |
| GET | `/api/qfield-sync-history` | Past sync jobs |
| POST | `/api/qfield-sync-cancel` | Cancel running job |
| POST | `/api/qfield-sync-conflicts` | Resolve conflicts |
| GET | `/api/qfield-sync-config` | Get sync settings |
| PUT | `/api/qfield-sync-config` | Update settings |
| GET | `/api/qfield-sync-poles` | QField pole data |
| GET | `/api/qfield-sync-cables` | QField cable data |
| GET | `/api/qfield-sync-drops` | QField drop data |

### QField Namespace (pages/api/qfield/)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/qfield/projects` | List linked QField projects |
| GET | `/api/qfield/projects/[id]` | Single project details |
| GET | `/api/qfield/projects/discover` | Discover projects in QFieldCloud |
| GET | `/api/qfield/gpkg-layers` | List GPKG files in MinIO |
| POST | `/api/qfield/gpkg-preview` | Preview layer counts and fields |
| POST | `/api/qfield/gpkg-import` | Execute GPKG import job |
| POST | `/api/qfield/oes-sync` | Trigger OES→QField sync (SSE stream) |
| POST | `/api/qfield/oes-upload` | Upload OES data to QField |
| GET/POST | `/api/qfield/poles-sync` | Sync pole data |
| GET | `/api/qfield/photo-proxy` | Proxy photos from MinIO |
| POST | `/api/qfield/validate-photo` | Real-time validation (QField plugin) |
| GET | `/api/qfield/qa-projects` | Projects with QA photos |
| GET | `/api/qfield/qa-hierarchy` | Zone → PON → feature tree |
| GET | `/api/qfield/qa-validations` | List photos with filters/pagination |
| POST | `/api/qfield/qa-validate` | Trigger VLM validation |
| POST | `/api/qfield/qa-actions` | Approve/reject/escalate |
| POST | `/api/qfield/qa-assignments` | Assign photos to reviewers |
| GET | `/api/qfield/qa-stats` | Dashboard statistics |

---

## Section 9: Database Tables

### qfield_projects (migration 134)

```sql
CREATE TABLE qfield_projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  qfield_project_id VARCHAR(100) NOT NULL UNIQUE,  -- QFieldCloud UUID
  name VARCHAR(255) NOT NULL,
  description TEXT,
  qfield_url VARCHAR(500),
  is_active BOOLEAN DEFAULT true,
  is_default BOOLEAN DEFAULT false,    -- Default for OES sync
  sync_enabled BOOLEAN DEFAULT true,
  last_synced_at TIMESTAMPTZ,
  wa_group_id UUID REFERENCES wa_group_config(id),  -- migration 165
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### qfield_project_links (migration 134)

```sql
CREATE TABLE qfield_project_links (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  qfield_project_id UUID NOT NULL REFERENCES qfield_projects(id) ON DELETE CASCADE,
  fibreflow_project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(qfield_project_id, fibreflow_project_id)
);
```

### qfield_import_jobs (migration 109)

```sql
CREATE TABLE qfield_import_jobs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id UUID NOT NULL REFERENCES projects(id),
  qfield_project_id VARCHAR(100),
  status VARCHAR(50) DEFAULT 'pending',  -- running, completed, completed_with_errors, failed
  layer_counts JSONB DEFAULT '{}',
  records_created INTEGER DEFAULT 0,
  records_updated INTEGER DEFAULT 0,
  errors JSONB DEFAULT '[]',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Infrastructure Tables (migration 109)

All created with `source VARCHAR(50)` for tracking origin ('qfield', 'sow', 'sow+qfield'):

- `joints` — dome joints, splice closures, splitters. Unique: `(project_id, joint_label)`
- `cable_spans` — cable segments. Unique: `(project_id, span_label)`
- `zone_boundaries` — zone polygons. Unique: `(project_id, zone_no)`
- `pon_boundaries` — PON polygons. Unique: `(project_id, pon_no)`
- `pops` — Point of Presence. Unique: `(project_id, pop_label)`

Poles and drops tables also have `source` column (added in migration 109).

### qfield_photo_validations (migration 20260207, extended by 110)

```sql
-- Core fields (migration 20260207)
id UUID PRIMARY KEY
photo_key TEXT NOT NULL               -- MinIO path
feature_id TEXT                       -- Pole/DR/splice ID
feature_type TEXT                     -- 'pole', 'drop', 'splice', 'cable'
work_type TEXT                        -- 'pole_installation', 'cable_stringing', 'dome_joint', 'activation'
project_id UUID                       -- QFieldCloud project ID
vlm_confidence DECIMAL(3,2)           -- 0.00 to 1.00
vlm_feedback TEXT
vlm_raw_response JSONB
needs_retake BOOLEAN DEFAULT FALSE
retake_notified_at TIMESTAMPTZ
retake_completed_at TIMESTAMPTZ
validated_at TIMESTAMPTZ
checklist_step INTEGER                -- migration 231
step_label TEXT                       -- migration 231

-- Workflow fields (migration 110)
workflow_status TEXT DEFAULT 'pending'  -- pending, in_review, approved, rejected, escalated
manual_status TEXT                    -- approved, rejected
manual_reviewed_by TEXT
manual_reviewed_at TIMESTAMPTZ
manual_notes TEXT
assigned_to TEXT
assigned_at TIMESTAMPTZ
due_date TIMESTAMPTZ
priority TEXT DEFAULT 'normal'        -- low, normal, high, urgent
escalation_level INT DEFAULT 0
escalated_at TIMESTAMPTZ
escalation_reason TEXT
file_size_bytes BIGINT
file_modified_at TIMESTAMPTZ
```

### qfield_validation_config (migration 20260207)

```sql
CREATE TABLE qfield_validation_config (
  project_id UUID PRIMARY KEY,
  validation_enabled BOOLEAN DEFAULT FALSE,
  confidence_threshold DECIMAL(3,2) DEFAULT 0.60,
  notify_on_failure BOOLEAN DEFAULT TRUE,
  notification_group_jid TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Supporting Tables (migration 110, 165)

- `qfield_qa_assignments` — assignment history (who assigned what, when, due dates)
- `qfield_qa_actions` — audit trail (assign/approve/reject/escalate/revalidate/comment)
- `qfield_qa_notifications` — WA notification log (rejection/escalation/assignment/retake_reminder)

### GPKG Sync State (migration 231)

```sql
CREATE TABLE qfield_gpkg_sync_state (
  qf_project_id UUID NOT NULL,
  gpkg_path TEXT NOT NULL,
  last_version TEXT,
  last_synced_at TIMESTAMPTZ,
  row_count INTEGER,
  PRIMARY KEY (qf_project_id, gpkg_path)
);
```

### View

`v_qfield_qa_photos` — joins `qfield_photo_validations` with `poles`, `drops`, `qfield_projects` for full context.

---

## Section 10: Common Tasks

### Check QField Service Health

```bash
# Webhook server
curl http://100.96.203.105:8095/status

# QFieldCloud app (from Velocity)
curl http://localhost:8000/api/v1/

# VLM service
curl http://100.96.203.105:8100/health

# All QField containers running?
docker ps -a --filter "name=qfield" --format "table {{.Names}}\t{{.Status}}"

# Worker logs (last 30 min)
for i in 1 2 3 4 5 6 7 8; do
  echo "=== wrapper-$i ==="
  docker logs --since 30m qfieldcloud-worker_wrapper-$i 2>&1 | \
    grep -E 'Error|error|failed|Finished' | tail -5
done
```

### Restart QField Services

```bash
cd /opt/qfieldcloud

# Safe restart sequence
docker-compose up -d app          # Restart Django app
docker-compose restart worker_wrapper  # Restart all 8 workers
docker-compose up -d nginx        # Restart nginx if needed

# Full restart (service interruption)
docker-compose down && docker-compose up -d
```

### Manual GPKG Import (Command Line)

```bash
# 1. List available projects
docker exec qfieldcloud-minio-1 mc ls local/qfieldcloud-prod/projects/

# 2. List GPKG files for a project
docker exec qfieldcloud-minio-1 mc ls \
  local/qfieldcloud-prod/projects/{qf_project_uuid}/files/

# 3. Get latest version of a GPKG
docker exec qfieldcloud-minio-1 mc ls --json \
  "local/qfieldcloud-prod/projects/{uuid}/files/LAWPoles.gpkg/" | \
  python3 -c "import sys, json; lines=[json.loads(l) for l in sys.stdin if l.strip()]; \
  print(max(lines, key=lambda x: x['lastModified'])['key'])"

# 4. Trigger import via API
CRON_SECRET=$(grep CRON_SECRET .env.local | head -1 | cut -d= -f2)
curl -s -X POST https://dev.fibreflow.app/api/qfield/gpkg-import \
  -H "Content-Type: application/json" \
  -H "Cookie: $(cat /tmp/ff-cookie)" \
  -d '{
    "projectId": "<ff_project_uuid>",
    "qfieldProjectId": "<qf_project_uuid>",
    "selectedLayers": ["poles", "joints", "cable_spans"],
    "mode": "merge"
  }'
```

### Photo Resize (Manual)

```bash
# Always dry-run first
/opt/qfield-sync/qfield-photo-resize.sh --dry-run

# Resize all photos > 3MB
/opt/qfield-sync/qfield-photo-resize.sh

# Check results
tail -50 /opt/qfield-sync/photo-resize.log
```

### Photo Sync Troubleshooting (MinIO → Local)

```bash
# Check how many photos still sourced from qfield (not yet local)
export $(grep DATABASE_URL .env.local | head -1 | xargs)
node -e "
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
sql\`SELECT source, COUNT(*) FROM construction_qa_photos GROUP BY source\`
  .then(r => r.forEach(x => console.log(x.source, x.count)));
"

# Sync remaining
node scripts/sync-qfield-photos-to-local.js --limit 1000
```

### Add New Project to QField

1. Create project in QFieldCloud admin: `https://qfield.fibreflow.app/admin/`
2. Add `admin` user as collaborator on the project
3. Register in FibreFlow:

```sql
INSERT INTO qfield_projects (qfield_project_id, name, is_active, sync_enabled)
VALUES ('<qf_uuid>', '<Project Name>', true, true);

INSERT INTO qfield_project_links (qfield_project_id, fibreflow_project_id)
VALUES (
  (SELECT id FROM qfield_projects WHERE qfield_project_id = '<qf_uuid>'),
  '<ff_project_uuid>'
);
```

4. Add to `sync-qa-to-qfield.py` `FF_TO_QF_CIVIL_AUDIT` dict if civil audit needed
5. Run manual OES sync to verify

### Fix Stuck QFieldCloud Jobs

```bash
# Check for stuck jobs
docker exec qfieldcloud-app-1 python manage.py shell -c "
from qfieldcloud.core.models import Job
stuck = Job.objects.filter(status='failed', started_at__isnull=False, finished_at__isnull=True)
print(f'Stuck: {stuck.count()}')
for j in stuck: print(f'  {j.pk} | {j.type}')
"

# Fix stuck jobs (set finished_at)
docker exec qfieldcloud-app-1 python manage.py shell -c "
from django.utils import timezone
from qfieldcloud.core.models import Job
stuck = Job.objects.filter(status='failed', started_at__isnull=False, finished_at__isnull=True)
for j in stuck:
    j.finished_at = timezone.now()
    j.save(update_fields=['finished_at'])
    print(f'Fixed: {j.pk}')
"

# Fix orphaned queued jobs
docker exec qfieldcloud-app-1 python manage.py shell -c "
from qfieldcloud.core.models import Job
orphans = Job.objects.filter(status='queued', started_at__isnull=True)
for j in orphans:
    j.status = Job.Status.PENDING
    j.save(update_fields=['status'])
    print(f'Reset: {j.pk}')
"

# Trigger reprocess for failed project
docker exec qfieldcloud-app-1 python manage.py shell -c "
from qfieldcloud.core.models import ProcessProjectfileJob, Project
p = Project.objects.get(pk='PROJECT_UUID_HERE')
job = ProcessProjectfileJob.objects.create(project=p, created_by=p.owner)
print(f'Created job: {job.pk}')
"
```

---

## Section 11: Troubleshooting

### QField Sync Not Triggering

**Symptoms**: OES import succeeds but QField sync doesn't run.

```bash
# Check webhook server is running
curl http://100.96.203.105:8095/status

# Check logs
tail -100 /var/log/qfield-oes-sync.log

# Manual trigger
sudo -u velo bash -c 'cd /opt/qfield-sync && \
  ./venv/bin/python3 sync_oes_db_to_qfield.py --report-date $(date +%Y-%m-%d)'
```

### `FileTransferStatus.FAILED` in OES Sync

**Cause**: `admin` user is not a collaborator on the target QFieldCloud project.

**Fix**: Add `admin` user as collaborator on every sync-enabled project in QFieldCloud admin.

### `process_projectfile failed` on QFieldCloud

**Cause**: Worker containers or QGIS container issue.

```bash
# Rebuild QGIS worker image (last resort)
cd /opt/qfieldcloud
sudo docker-compose build qgis
sudo docker-compose restart worker_wrapper
```

### Photos Not Appearing in FibreFlow

1. Check photo key format (must include version suffix: `v20260206134722-6abcf9f1`)
2. Check MinIO path: `docker exec qfieldcloud-minio-1 mc ls "local/qfieldcloud-prod/{key}"`
3. Check proxy API: `GET /api/qfield/photo-proxy?key={url_encoded_key}`
4. Check photo resize log for errors: `tail -50 /opt/qfield-sync/photo-resize.log`

### GPKG Import Failures

**"Failed to parse GPKG reader output"**:
```bash
# Run read_gpkg.py directly to see the error
cd /home/hein/Workspace/FF_Next.js
python3 scripts/qfield-sync/read_gpkg.py \
  --project-id <qf_uuid> --preview 2>&1 | head -50
```

**"No data found for layer"**:
- Layer not detected by heuristics — check column names in GPKG against detection table
- `docker exec qfieldcloud-minio-1 mc cat "local/qfieldcloud-prod/..."` and inspect with sqlite3

**Timeout on large datasets**:
- Normal for 10k+ features. Import timeout is 120s.
- Try importing layer-by-layer instead of all at once.

**Unique key conflicts in errors array**:
- Use Replace mode to clear existing data first, then re-import
- Or investigate the conflicting records: `SELECT * FROM poles WHERE (project_id, pole_number) = ...`

### MinIO Connection Problems

**HTTP-524 timeout when QField tablets sync**:
- Check `STORAGES` JSON in `/opt/qfieldcloud/.env` — must use `http://minio:9000` not `http://172.17.0.1:8009`
- Restart BOTH app AND worker_wrapper after fixing: `docker-compose up -d app worker_wrapper`

**"mc not found" on host**:
- `/usr/bin/mc` on Velocity host = GNU Midnight Commander (NOT MinIO client)
- Use `docker exec qfieldcloud-minio-1 mc` instead
- Or use boto3 inside `qfieldcloud-app-1`

### VLM Photo Validation Failures

```bash
# Check VLM service health
curl http://100.96.203.105:8100/health

# Test VLM directly
curl -X POST http://100.96.203.105:8100/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{"model":"Qwen/Qwen3-VL-8B-Instruct","messages":[{"role":"user","content":"Hello"}],"max_tokens":50}'

# Check recent validation failures in DB
psql $DATABASE_URL -c "
SELECT photo_key, work_type, vlm_feedback, validated_at
FROM qfield_photo_validations
WHERE needs_retake = true
ORDER BY validated_at DESC LIMIT 10;
"
```

### QFieldCloud Job Processing Issues

**Jobs stuck at `pending`**: Workers not picking up jobs.
```bash
docker-compose restart worker_wrapper
```

**Jobs stuck at `queued`**: Worker died mid-processing.
```bash
# Reset orphaned queued jobs (see Section 10 above)
```

**`ConnectionResetError(104)` in worker logs**: Gunicorn saturated.
```bash
# Increase workers in .env
# GUNICORN_WORKERS=8 (must match worker_wrapper count)
docker-compose up -d app worker_wrapper
```

### OES Sync: PermissionError on GPKG

**Cause**: Script was run as root previously; `/tmp/qfield_oes_sync/` owned by root; `velo` cannot overwrite.

```bash
sudo rm -rf /tmp/qfield_oes_sync/
# Then re-run as velo
sudo -u velo bash -c 'cd /opt/qfield-sync && ./venv/bin/python3 sync_oes_db_to_qfield.py'
```

---

## Section 12: Related Skills

| Skill | Relevance |
|-------|-----------|
| `.claude/skills/qa-ingest.md` | SharePoint + QField photo ingestion into Construction QA |
| `.claude/skills/vlm-ops.md` | VLM service health, GPU, benchmark |
| `.claude/skills/vlm-categorization.md` | Photo step classification accuracy |
| `.claude/modules/vlm.md` | VLM service configuration |
| `.claude/modules/qfield-sync.md` | Module architecture reference |
| `.claude/modules/qfield-sync/.claude.md` | Compact module reference |
| `.claude/modules/qfield-import/.claude.md` | GPKG import module reference |
| `.claude/modules/qfield-qa/.claude.md` | QA dashboard module reference |

### Construction QA Integration

The `/api/construction-qa/ingest-qfield` endpoint feeds `qfield_photo_validations` data into the main Construction QA system (`construction_qa_reviews` + `construction_qa_photos`). See `.claude/skills/qa-ingest.md` for the full ingestion workflow including SharePoint pipeline.

### WhatsApp Notifications

QField photo rejection/escalation notifications route through the WA bridge at `http://72.61.197.178:8083/send-message`. See `.claude/modules/wa-monitor.md` for group JIDs and bridge details.

Group JIDs for QField notifications:
- Lawley: `120363418298130331@g.us`
- Mohadin: `120363421532174586@g.us`
- Mamelodi: `120363408849234743@g.us`
- Velo Test: `120363421664266245@g.us`
