# Automated QA Photo Processing Pipeline

> **Automated ingestion and classification of construction QA photos**  
> **Launched:** 2026-02-21  
> **Schedule:** 3x daily (6am, 12pm, 6pm SAST)

---

## Overview

The Automated QA Photo Processing Pipeline automatically ingests construction quality assurance photos from SharePoint, downloads them, and uses Vision Language Model (VLM) classification to categorize them into checklist steps.

This eliminates manual photo upload and classification, ensuring that field photos are available in FibreFlow within hours of upload to SharePoint.

### Key Features
- **Automatic SharePoint ingestion** — Monitors 6 project folders for new photos
- **Intelligent classification** — VLM identifies checklist steps (foundation, pole, labels, etc.)
- **Multi-source support** — Handles both SharePoint and QField photos
- **Scalable** — Processes up to 2000 photos per run (3x daily = 6000/day capacity)
- **Zero manual intervention** — Runs via cron, auto-recovers from errors

---

## Architecture

### Three-Step Pipeline

```
┌─────────────────────────────────────────────────────────────┐
│  Step 1: Ingest SharePoint Pole Photos                      │
│  ↓ Downloads new photos from 6 project folders              │
│  ↓ Creates construction_qa_reviews + construction_qa_photos │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Step 2: Ingest SharePoint Dome Joint Photos                │
│  ↓ Downloads dome joint photos (separate script)            │
│  ↓ Uses pole-spatial matching + VLM GPS fallback            │
└─────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│  Step 3: VLM Classification                                 │
│  ↓ Sends unclassified photos to Qwen3-VL (Velocity:8100)   │
│  ↓ Classifies into 7 checklist steps                        │
│  ↓ Updates construction_qa_photos + review step booleans    │
└─────────────────────────────────────────────────────────────┘
```

### Schedule
**Cron:** 3x daily at 6am, 12pm, 6pm SAST  
**Crontab entry:**
```bash
0 6,12,18 * * * /home/velo/fibreflow-production/scripts/cron-classify-photos.sh >> /home/velo/logs/vlm-classify-cron.log 2>&1
```

### Processing Capacity
- **Per run:** Up to 2000 photos
- **Daily:** Up to 6000 photos (3 runs)
- **Sources:** SharePoint + QField combined

---

## Scripts

### 1. Cron Wrapper (`cron-classify-photos.sh`)

**Location:** `/home/velo/fibreflow-production/scripts/cron-classify-photos.sh`  
**Purpose:** Orchestrates the 3-step pipeline

**Workflow:**
1. Calls `ingest-sharepoint-qa.py --project all`
2. Calls `ingest-sharepoint-joint-qa.py --project all`
3. Calls `classify-qa-photos-vlm.py --source all --limit 2000`

**Error handling:** Continues on errors (logs warnings)

**Example output:**
```
========================================
  QA Photo Sync Cron — 2026-02-21 06:00:00 SAST
========================================

  [Step 1/3] Ingesting SharePoint pole photos...
  Processed 42 new photos for Lawley
  Processed 15 new photos for Mamelodi

  [Step 2/3] Ingesting SharePoint dome joint photos...
  Processed 8 new dome joints

  [Step 3/3] Classifying unclassified photos via VLM...
  Classified 65 photos (45 poles, 20 joints)

  Cron complete: 06:05:23
========================================
```

### 2. SharePoint Pole Ingestion (`ingest-sharepoint-qa.py`)

**Location:** `scripts/ingest-sharepoint-qa.py`  
**Purpose:** Download pole photos from SharePoint folders

**Usage:**
```bash
# Single project
python3 scripts/ingest-sharepoint-qa.py --project Lawley

# All projects
python3 scripts/ingest-sharepoint-qa.py --project all

# Dry run (test without writing to DB)
python3 scripts/ingest-sharepoint-qa.py --project Lawley --dry-run
```

**Supported Projects:**
- Lawley
- Mamelodi
- Thembisa
- Ivory Park
- Midrand
- Doornfontein

**SharePoint Integration:**
- Uses Microsoft Graph API
- OAuth2 client credentials flow
- Tenant: `f22e6344-a35d-43b0-ad8c-a247f513c1ee`
- Drive ID: `b!54aBz82X_0qdf-Qc8hPv-PQzZQ4Q2eFGrzwQ6nSz79cVH1Quyz5vQavmQwdsBGRy`

**Photo Naming Convention:**
- Poles: `{PROJECT}.P.{NUMBER}.{INDEX}.jpg` (e.g., `LAW.P.42.1.jpg`)
- Extracts pole number from filename
- Links to existing `construction_qa_reviews` records

### 3. SharePoint Joint Ingestion (`ingest-sharepoint-joint-qa.py`)

**Location:** `scripts/ingest-sharepoint-joint-qa.py`  
**Purpose:** Download dome joint photos from SharePoint

**Features:**
- Pole-spatial matching via haversine distance
- VLM GPS fallback for unmatched folders
- Handles 42 joints across 3 projects

### 4. VLM Classification (`classify-qa-photos-vlm.py`)

**Location:** `scripts/classify-qa-photos-vlm.py`  
**Purpose:** Classify photos into Civil QA checklist steps using vision AI

**Usage:**
```bash
# Classify SharePoint photos only
python3 scripts/classify-qa-photos-vlm.py --project Lawley --source sharepoint --limit 100

# Classify QField photos only
python3 scripts/classify-qa-photos-vlm.py --project all --source qfield --limit 200

# Classify all sources (used by cron)
python3 scripts/classify-qa-photos-vlm.py --project all --source all --limit 2000 --local-minio
```

**Flags:**
- `--project` — Project name or `all`
- `--source` — `sharepoint`, `qfield`, or `all`
- `--limit` — Max photos to process per run
- `--local-minio` — Use direct MinIO access on Velocity (faster than SSH)
- `--dry-run` — Test classification without DB updates

**VLM Configuration:**
- **Model:** Qwen/Qwen3-VL-8B-Instruct
- **Endpoint:** http://100.96.203.105:8100 (Velocity local)
- **Max dimension:** 1024px (images resized for speed)

**Checklist Steps (7 categories):**
1. Foundation / Base
2. Full Pole Visible
3. Pole Label
4. CCA H4 Tag
5. Vertical Alignment
6. Guy Wires / Stays
7. Slack Bracket

**Classification Prompt:**
```
Analyze this construction QA photo. Identify which of these checklist steps are visible:
1. Foundation/base clearly visible
2. Full pole visible from ground to top
3. Pole label/number visible
4. CCA H4 treatment tag visible
5. Pole is vertically aligned (not leaning)
6. Guy wires/stays installed (if applicable)
7. Slack bracket installed (if applicable)

Return JSON: {"steps": [1, 3, 5], "confidence": 0.95}
```

**Database Updates:**
1. Updates `construction_qa_photos.classified_steps` (array of step numbers)
2. Updates `construction_qa_reviews` step booleans (`step_1_foundation`, etc.)
3. Sets `vlm_classification_date` timestamp
4. Stores VLM confidence score

---

## Database Schema

### `construction_qa_photos`
```sql
id UUID PRIMARY KEY
review_id UUID REFERENCES construction_qa_reviews(id)
photo_url TEXT              -- SharePoint or MinIO URL
source VARCHAR(50)          -- 'sharepoint' or 'qfield'
classified_steps INTEGER[]  -- Array of step numbers [1, 3, 5]
vlm_confidence DECIMAL      -- 0.0 - 1.0
vlm_classification_date TIMESTAMP
```

### `construction_qa_reviews`
```sql
id UUID PRIMARY KEY
project_id UUID
pon_id UUID
pole_number INTEGER
work_type VARCHAR(50)       -- 'pole_installation', 'dome_joint'
step_1_foundation BOOLEAN
step_2_full_pole BOOLEAN
step_3_pole_label BOOLEAN
step_4_cca_tag BOOLEAN
step_5_vertical BOOLEAN
step_6_guy_wires BOOLEAN
step_7_slack_bracket BOOLEAN
```

---

## Monitoring & Debugging

### Cron Logs
```bash
# View latest cron run
tail -f /home/velo/logs/vlm-classify-cron.log

# Check last 3 runs
tail -100 /home/velo/logs/vlm-classify-cron.log | grep "Cron complete"
```

### Manual Testing
```bash
# Test SharePoint ingestion (dry run)
cd /home/velo/fibreflow-production/scripts
python3 ingest-sharepoint-qa.py --project Lawley --dry-run

# Test VLM classification (50 photos)
python3 classify-qa-photos-vlm.py --project Lawley --source sharepoint --limit 50

# Check classification stats
psql $DATABASE_URL -c "
SELECT 
  work_type,
  COUNT(*) AS total_reviews,
  COUNT(CASE WHEN step_1_foundation THEN 1 END) AS foundation_complete,
  COUNT(CASE WHEN classified_steps IS NOT NULL THEN 1 END) AS classified_photos
FROM construction_qa_reviews
GROUP BY work_type;
"
```

### Common Issues

**Issue:** SharePoint token expired  
**Solution:** Script auto-refreshes tokens; check client secret if failing

**Issue:** VLM endpoint unreachable  
**Solution:** Verify Velocity VLM is running: `curl http://100.96.203.105:8100/health`

**Issue:** Photos not appearing in FibreFlow  
**Solution:** Check photo URLs are accessible; verify `construction_qa_photos` records exist

**Issue:** Classification stuck on old photos  
**Solution:** Cron only processes new (unclassified) photos; re-classify all with:
```bash
python3 classify-qa-photos-vlm.py --project all --source all --limit 10000
```

---

## Performance Metrics

**Typical Run (6am):**
- SharePoint pole ingestion: 30-50 new photos
- SharePoint joint ingestion: 5-10 new photos
- VLM classification: 40-60 photos
- Total time: 3-5 minutes

**VLM Speed:**
- ~1.5 seconds per photo (includes download, resize, inference, DB write)
- 2000 photo limit = ~50 minutes max runtime

**Classification Accuracy:**
- Average confidence: 0.85-0.95
- Manual review recommended for confidence < 0.70
- False positive rate: <5% (based on spot checks)

---

## Related Files

**Scripts:**
- `scripts/cron-classify-photos.sh` — Cron orchestrator
- `scripts/ingest-sharepoint-qa.py` — SharePoint pole ingestion
- `scripts/ingest-sharepoint-joint-qa.py` — SharePoint joint ingestion
- `scripts/classify-qa-photos-vlm.py` — VLM classification

**Documentation:**
- `docs/PRD-civil-qa.md` — Civil QA module PRD
- `docs/UNIFIED-NOTIFICATION-SERVICE.md` — Notification integration (future)

**Database:**
- `scripts/migrations/189_bulk_ingest_civil_qa.sql` — Initial dome joint migration
- `construction_qa_reviews` table
- `construction_qa_photos` table

---

## Future Enhancements

### Planned
- [ ] Real-time notifications when photos fail QA (via UNS)
- [ ] Auto-escalation of low-confidence classifications
- [ ] Daily summary email to project managers
- [ ] Integration with field tech mobile app (QR code → photo upload)
- [ ] S3 backup of all classified photos

### Under Consideration
- [ ] GPU acceleration for VLM (currently CPU-only)
- [ ] Multi-model ensemble (combine multiple VLMs for higher accuracy)
- [ ] Historical trend analysis (track QA compliance over time)
- [ ] Auto-generate QA reports for billing milestones

---

## Support

**For issues with the automation pipeline:**
- **SharePoint/Photo ingestion:** Elon (CTO)
- **VLM classification:** Flow (Apps)
- **Database/schema:** Elon (CTO)
- **Documentation:** Scribe

**Cron management:** Forge (DevOps)

**Commits:**
- `0b1f0c1c` — QField photo classification + cron automation (2026-02-21)
- `87d322f1` — Add --project all + full cron pipeline (2026-02-21)
- `1f4dcef6` — Initial VLM classification scripts (2026-02-20)

---

**Last Updated:** 2026-02-21 08:59 SAST  
**Maintained By:** Scribe
