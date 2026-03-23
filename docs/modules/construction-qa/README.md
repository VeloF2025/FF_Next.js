# Construction-QA Module

**Last Updated:** 2026-03-13  
**Status:** Active  
**Maintainer:** Development Team

---

## Overview

The Construction-QA module provides comprehensive quality assurance workflows for pole installation projects, including:

- **Automated photo ingestion** from QFieldCloud and SharePoint
- **Checklist-based validation** with 8-step civil construction tracking
- **QA decision workflows** (PASS, REWORK_NEEDED, FAIL)
- **Bidirectional QField integration** (photos → FibreFlow, decisions → QField technicians)
- **WhatsApp notifications** for project stakeholders

---

## Core Features

### 1. GPKG Photo Extraction Pipeline

**Purpose:** Automatically extract construction photos from QFieldCloud GeoPackage (GPKG) files and sync them into FibreFlow's photo validation system.

**Scripts:**
- `scripts/extract-gpkg-photos.py` — Extracts photo references from GPKG checklist columns
- `scripts/cron-qa-ingest.sh` — Orchestrates daily photo ingestion (05:00 SAST)

**Supported Projects:**
| Project | QField ID | GPKG File | Label Column |
|---------|-----------|-----------|--------------|
| Lawley | 2e988631-462b-448f-ae15-bb693a68cd55 | LAWPoles.gpkg | label |
| Mohadin | bec5f353-2e83-4f6b-989a-fca83ad94e16 | MOAPoles.gpkg | label |
| Mamelodi | 2ce80264-170c-4f05-ada1-68220d7e5885 | MAMPoles.gpkg | label |
| Etwatwa | 47585401-1b25-4d3b-8d18-4337ea26df88 | PolesAudit.gpkg | label |
| Thembisa POP 1 | 63341eb4-bc81-4607-a3d6-580ea2a7457c | Poles.gpkg | label_1 |
| Thembisa POP 3 | 5f3b962a-7901-43f7-a284-1c1a9ed7f3d1 | THM_3_Poles.gpkg | label_1 |
| Tonga | 7fe59cdc-b1d5-475d-8448-5cf2e9f7175b | Civil Audit.gpkg | Pole Label |

**Checklist Steps (Column-to-Step Mapping):**

The GPKG extractor automatically detects photo columns and maps them to 8-step construction checklists:

| Step | Pattern | Label | Notes |
|------|---------|-------|-------|
| 1 | `^1[\.\s].*(?:before\|mark)` | Before Photo | Initial pole state |
| 2 | `^2[\.\s].*(?:during\|digging)` | During Photo | Digging in progress |
| 3 | `^3[\.\s].*(?:depth\|measuring)` | Depth Photo | Depth measurement proof |
| 4 | `^4[\.\s].*(?:end.?plate\|visible)` | End Plates | Visible end plates |
| 5 | `^5[\.\s].*(?:compact\|backfill)` | Compaction | Soil backfill/compaction |
| 6 | `^6[\.\s].*(?:level\|spirit)` | Level Check | Spirit level verification |
| 7 | `^7[\.\s].*(?:after\|picture)` | After Photo | Final pole state |
| 8 | `^8[\.\s].*(?:label\|foto\|photo)` | Pole Label | Pole ID/label photo |

**Database Schema:**
- `qfield_photo_validations` — Intermediate storage of extracted photos
  - Added columns: `checklist_step` (INT), `step_label` (TEXT)
- `qfield_gpkg_sync_state` — Tracks last processed GPKG version per project
- `construction_qa_photos` — Final photos with step assignments
- `construction_qa_reviews` — QA decisions and workflow state

**Usage:**
```bash
# Extract all projects
python3 scripts/extract-gpkg-photos.py --all

# Extract single project
python3 scripts/extract-gpkg-photos.py --project "Lawley"

# Force reprocessing (skip version check)
python3 scripts/extract-gpkg-photos.py --all --force

# Dry run (no database writes)
python3 scripts/extract-gpkg-photos.py --all --dry-run

# Resolve unversioned photo keys (batch fix)
python3 scripts/extract-gpkg-photos.py --all
# (automatically included in full run)
```

**Cron Schedule:**
```bash
# Runs daily at 03:00 UTC (05:00 SAST)
0 3 * * * /home/velo/fibreflow-production/scripts/cron-qa-ingest.sh >> /tmp/qa-ingest-cron.log 2>&1
```

---

### 2. QA Decision Workflow & WhatsApp Integration

**Endpoints:**
- `POST /api/construction-qa/final-decision` — Record QA decision (PASS/REWORK_NEEDED/FAIL)
  - Triggers automatic note generation from reason codes
  - Sends WhatsApp notification to stakeholders
  - Initiates QField push-back (async, non-blocking)

**Request Body:**
```json
{
  "reviewId": "uuid",
  "decision": "PASS|REWORK_NEEDED|FAIL",
  "reasonCodes": ["string[]"],
  "notes": "string (auto-generated if not provided)"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "reviewId": "uuid",
    "decision": "REWORK_NEEDED",
    "waSent": true,
    "waError": null,
    "qfieldPushed": true
  }
}
```

---

### 3. Auto-Generated QA Notes

**Feature:** When marking a review as REWORK_NEEDED or FAIL, FibreFlow automatically generates notes from selected reason codes.

**Implementation (PhaseFinalDecision component):**
1. User selects reason codes (e.g., "Improper compaction", "Missing depth photo")
2. Component generates notes template:
   ```
   REJECTED: 2 issue(s) found.
   - Improper compaction
   - Missing depth photo
   ```
3. User can manually edit before submission
4. Notes are stored in `construction_qa_reviews.qa_notes`

**Reason Code Mappings:**
Defined in `PhaseFinalDecision.tsx` and stored with each review decision.

---

### 4. QField Push-Back Integration

**Purpose:** Send QA decisions back to QFieldCloud technicians via GPKG delta updates, so they see feedback directly in the QField mobile app.

**Endpoint:**
- `POST /api/construction-qa/push-qfield-comment` — Push QA notes to QField

**How It Works:**
1. QA decision is recorded (REWORK_NEEDED or FAIL)
2. `final-decision.ts` calls push-qfield-comment **asynchronously** (fire-and-forget)
3. Script resolves feature ID → QField feature fid
4. Creates delta payload with:
   - `Q/A Civil Comments` column (updated with decision notes)
   - `Status` column (set to "QA Approved/Rework/Rejected")
   - `Q/A Date` column (set to current date)
5. Posts delta via QFieldCloud REST API
6. Technicians see updated comments on their phone

**Supported Projects (for QField push-back):**
| Project | QField ID | Table | Comment Column |
|---------|-----------|-------|-----------------|
| Lawley | 2e988631-462b-448f-ae15-bb693a68cd55 | LAWPoles | Q/A Civil Comments |
| Mohadin | bec5f353-2e83-4f6b-989a-fca83ad94e16 | MOAPoles | QA Civil Comments |
| Mamelodi | 2ce80264-170c-4f05-ada1-68220d7e5885 | MAMPoles | Q/A Civil Comments |
| Tonga | 7fe59cdc-b1d5-475d-8448-5cf2e9f7175b | civil_audit | Q/A Civil Comments |

**Note:** Push-back is **async and non-blocking**:
- If push fails, the QA decision is still recorded in FibreFlow
- Failures logged to `logs/cqa-qfield-push.log` with module tag `cqa-qfield-push`

---

### 5. Photo Storage & Proxy

**Endpoint:**
- `GET /api/construction-qa/photo-proxy?key=<storage_key>` — Retrieve photos from MinIO

**Features:**
- **Version Resolution:** Automatically resolves unversioned paths to latest MinIO version
  - Example: `projects/uuid/files/DCIM/IMG001.jpg` → `projects/uuid/files/DCIM/IMG001.jpg/v20260310120500`
- **Immutable Caching:** Cache-Control: max-age=86400 (24 hours)
- **Magic Byte Verification:** Validates JPEG/PNG headers
- **Fallback:** If versioned path fails, tries alternate paths

**Batch Unversioned Key Resolution:**
```python
# Called automatically during photo extraction
python3 scripts/extract-gpkg-photos.py --all
# Resolves ~738 previously-unversioned storage keys to versioned paths
```

---

## Data Flow Diagram

```
QFieldCloud GPKG
    ↓ (daily 05:00)
extract-gpkg-photos.py
    ↓
qfield_photo_validations (intermediate)
    ↓ (cron-qa-ingest.sh)
qfieldIngestionService
    ↓
construction_qa_reviews (new review)
construction_qa_photos (photos with step labels)
    ↓ (user selects reason codes + decision)
PhaseFinalDecision (auto-generates notes)
    ↓ (POST /final-decision)
final-decision API
    ├→ WhatsApp stakeholders (async)
    ├→ Update qa_decision, qa_notes, qa_reason_code
    └→ push-qfield-comment (async, fire-and-forget)
         └→ QFieldCloud delta API
            └→ Technician sees feedback in QField mobile app
```

---

## API Endpoints

### Construction-QA Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/construction-qa/ingest-qfield` | Trigger QField photo ingestion (cron-protected) |
| POST | `/api/construction-qa/final-decision` | Record QA decision (PASS/REWORK_NEEDED/FAIL) |
| POST | `/api/construction-qa/push-qfield-comment` | Push QA notes to QField (async) |
| GET | `/api/construction-qa/photo-proxy` | Retrieve photo from MinIO with version fallback |

---

## Database Tables

### qfield_photo_validations
Intermediate storage for photos extracted from GPKG files.

```sql
CREATE TABLE qfield_photo_validations (
  id UUID PRIMARY KEY,
  photo_key TEXT,           -- MinIO storage path
  feature_id TEXT,          -- Pole label from GPKG
  feature_type TEXT,        -- "pole", "joint", etc.
  work_type TEXT,           -- "pole_installation"
  project_id UUID,          -- QFieldCloud project UUID
  checklist_step INT,       -- 1-8 (auto-detected from column)
  step_label TEXT,          -- "Before Photo", "Compaction", etc.
  created_at TIMESTAMPTZ
);
```

### qfield_gpkg_sync_state
Tracks which GPKG versions have been processed.

```sql
CREATE TABLE qfield_gpkg_sync_state (
  qf_project_id UUID,
  gpkg_path TEXT,           -- e.g., "LAWPoles.gpkg"
  last_version TEXT,        -- MinIO version hash
  last_synced_at TIMESTAMPTZ,
  row_count INT,
  PRIMARY KEY (qf_project_id, gpkg_path)
);
```

### construction_qa_reviews
Main QA review records.

```sql
ALTER TABLE construction_qa_reviews ADD COLUMNS:
  qa_decision VARCHAR(20),       -- "PASS", "REWORK_NEEDED", "FAIL"
  qa_notes TEXT,                 -- Auto-generated or user-provided
  qa_reason_code TEXT[],         -- Array of reason codes
  qa_decision_by VARCHAR(255),
  qa_decision_at TIMESTAMPTZ,
  discipline VARCHAR(50)         -- "civil", "optical", etc.
);
```

### construction_qa_photos
Final photos with step assignments.

```sql
ALTER TABLE construction_qa_photos ADD COLUMNS:
  checklist_step INT,            -- 1-8 (from qfield_photo_validations)
  step_label TEXT                -- "Before Photo", "Compaction", etc.
);
```

---

## Configuration

### Environment Variables

```bash
DATABASE_URL=postgres://...     # PostgreSQL connection string
QFCLOUD_API_TOKEN=...           # QFieldCloud API token for push-back
CRON_SECRET=...                 # Shared secret for cron endpoints
```

### QField Project Mappings

Located in: `src/modules/construction-qa/services/qfieldIngestionService.ts`

```typescript
const QFIELD_TO_FIBREFLOW: Record<string, string> = {
  // Map QFieldCloud project UUID → FibreFlow project UUID
  '2e988631-462b-448f-ae15-bb693a68cd55': '4eb13426-b2a1-472d-9b3c-277082ae9b55', // Lawley
  'bec5f353-2e83-4f6b-989a-fca83ad94e16': 'bf9a90db-e758-4c05-b999-694cd63c451f', // Mohadin
  '2ce80264-170c-4f05-ada1-68220d7e5885': '7003dc06-9af7-4a7c-bc6c-a177d77784f2', // Mamelodi
  '47585401-1b25-4d3b-8d18-4337ea26df88': 'c7255076-1d2f-41ce-97bb-858b8c87ee27', // Etwatwa
  '63341eb4-bc81-4607-a3d6-580ea2a7457c': '7d8b94d6-8e5a-4dbb-9ede-69ce3884e004', // Thembisa POP 1
  '5f3b962a-7901-43f7-a284-1c1a9ed7f3d1': '1de088dd-fe24-43fb-b8d3-94fca61ef91d', // Thembisa POP 3
  '7fe59cdc-b1d5-475d-8448-5cf2e9f7175b': 'ce3bf310-d6ba-4ede-ab36-a8c902a5efc6', // Tonga
};
```

---

## Troubleshooting

### Photos Not Extracted
1. Check cron logs: `tail -f /tmp/qa-ingest-cron.log`
2. Verify GPKG file exists in MinIO: `docker exec qfieldcloud-minio-1 mc ls local/qfieldcloud-prod/projects/{uuid}/files/`
3. Check column detection: Run with `--dry-run` to see detected columns

### QField Push-Back Failed
1. Check module logs: `grep cqa-qfield-push /var/log/fibreflow.log`
2. Verify QFieldCloud API token is set in `.env.local`
3. Check feature exists in GPKG: `sqlite3 {gpkg_file} "SELECT COUNT(*) FROM {table_name} WHERE {label_col} = '{feature_id}'"`

### Unversioned Photo Keys
The script automatically resolves unversioned MinIO paths during extraction. For batch fix of existing photos:
```bash
python3 scripts/extract-gpkg-photos.py --all
# Automatically calls resolve_unversioned_keys() at the end
```

---

## Recent Changes

See [CHANGELOG.md](./CHANGELOG.md) for detailed version history.

**Latest (2026-03-13):**
- ✅ Automated GPKG → FibreFlow photo sync pipeline
- ✅ Auto-generated QA notes from reason codes
- ✅ QField push-back integration for technician feedback
- ✅ Version resolution for unversioned photo paths
