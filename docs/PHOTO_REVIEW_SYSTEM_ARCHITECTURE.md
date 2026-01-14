# Photo Review System Architecture

**Date**: January 14, 2026
**Project**: FibreFlow Next.js
**Status**: Production Active

---

## Executive Summary

The FibreFlow Photo Review system is a **three-service architecture** for installation photo verification, AI-powered quality evaluation, and WhatsApp QA tracking. This document provides a complete architectural overview of how these systems interconnect and share data.

### Three Core Services

1. **Photo Review Dashboard** (`http://localhost:3005/photo-review`)
   - **Technology**: Next.js 14 + React + TypeScript
   - **Purpose**: Web UI for reviewing photos, triggering AI evaluations, sending feedback
   - **Database**: Neon PostgreSQL (`foto_ai_reviews` table)

2. **WA Monitor Module** (`/wa-monitor`)
   - **Technology**: React module + Python VPS service
   - **Purpose**: WhatsApp QA tracking with 12-step installation checklist + barcode scanning
   - **Database**: Neon PostgreSQL (`qa_photo_reviews` table)

3. **DR Photo API Service** (`http://192.168.1.150:8003`)
   - **Technology**: FastAPI (Python) + Gemini Vision AI
   - **Purpose**: Download photos from 1Map GIS, AI evaluation, GPS validation
   - **Database**: Neon PostgreSQL (`dr_photo_downloads` table)

---

## System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                         FIELD TECHNICIAN WORKFLOW                            │
│  📱 WhatsApp QA Submissions │ 🗺️  1Map GIS Data │ 📸 BOSS VPS Photo Storage │
└──────────────────────────────────────────────────────────────────────────────┘
                    │                      │                      │
                    ▼                      ▼                      ▼
            ┌──────────────┐      ┌──────────────┐      ┌──────────────┐
            │ VPS Monitor  │      │ DR Photo API │      │ Photo Review │
            │  (Python)    │      │  (FastAPI)   │      │  (Next.js)   │
            │ 72.60.17.245 │      │192.168.1.150 │      │localhost:3005│
            └──────────────┘      └──────────────┘      └──────────────┘
                    │                      │                      │
                    └──────────────────────┼──────────────────────┘
                                           ▼
            ┌────────────────────────────────────────────────────────┐
            │         NEON POSTGRESQL DATABASE (Shared)              │
            │         ep-dry-night-a9qyh4sj.gwc.azure.neon.tech      │
            │                                                         │
            │  ┌──────────────────┐  ┌──────────────────┐           │
            │  │ qa_photo_reviews │  │ foto_ai_reviews  │           │
            │  │ (WA Monitor)     │  │ (AI Evaluations) │           │
            │  │ - 12 QA steps    │  │ - Step results   │           │
            │  │ - Serial scans   │  │ - Overall status │           │
            │  └──────────────────┘  └──────────────────┘           │
            │                                                         │
            │  ┌──────────────────┐  ┌──────────────────┐           │
            │  │ stock_serials    │  │stock_consumptions│           │
            │  │ (Equipment)      │  │ (Installations)  │           │
            │  └──────────────────┘  └──────────────────┘           │
            │                                                         │
            │  ┌────────────────────────────────────────┐           │
            │  │ dr_photo_downloads (DR Photo API)      │           │
            │  │ - GPS metadata, AI verification        │           │
            │  └────────────────────────────────────────┘           │
            └────────────────────────────────────────────────────────┘
```

---

## 1. Photo Review Dashboard

### Overview
- **URL**: `http://localhost:3005/photo-review`
- **Production**: `https://app.fibreflow.app/photo-review`
- **Purpose**: Primary UI for QA teams to review installation photos and AI evaluations

### Data Sources

#### BOSS VPS API (Primary Photo Storage)
```
URL: http://100.96.203.105:8001
Purpose: External photo storage uploaded by field technicians via WhatsApp
Endpoints:
  - GET /api/photos → List all DRs with photos
  - GET /api/photo/{dr_number}/{filename} → Fetch individual photo
```

#### Neon PostgreSQL (Evaluation Storage)
```sql
-- Table: foto_ai_reviews
-- Purpose: Store AI evaluation results from DR Photo API

CREATE TABLE foto_ai_reviews (
  dr_number VARCHAR(50) PRIMARY KEY,
  overall_status VARCHAR(10),              -- 'PASS' | 'FAIL'
  average_score DECIMAL(4,2),              -- 0.00 to 10.00
  total_steps INTEGER DEFAULT 12,
  passed_steps INTEGER,
  step_results JSONB,                      -- Array of step evaluations
  markdown_report TEXT,                    -- AI-generated report
  feedback_sent BOOLEAN DEFAULT FALSE,
  feedback_sent_at TIMESTAMP,
  evaluation_date TIMESTAMP
);
```

### Key Components

#### Frontend
```
pages/photo-review.tsx
  ↓ uses
src/modules/photo-review/hooks/usePhotos.ts
  ↓ calls
src/modules/photo-review/services/fotoEvaluationService.ts
  ↓ fetches from
pages/api/foto/photos.ts (Backend API)
```

#### Critical Backend API: `/api/foto/photos.ts`

**Purpose**: Orchestrates data from BOSS VPS and Neon DB

**Data Flow**:
```typescript
// Step 1: Fetch photos from BOSS VPS
const bossResponse = await fetch('http://100.96.203.105:8001/api/photos');
const { drs } = await bossResponse.json();

// Step 2: Fetch evaluations from Neon DB
const evaluations = await pool.query(`
  SELECT dr_number, overall_status, average_score, feedback_sent, evaluation_date
  FROM foto_ai_reviews
  ORDER BY evaluation_date DESC
`);

// Step 3: Merge data into unified DropRecord[]
const dropRecords = drs.map((dr) => ({
  dr_number: dr.dr_number,
  project: dr.project,
  photos: dr.photos.map((photo) => ({
    id: `${dr.dr_number}-${index}`,
    url: `/api/foto/photo-proxy?url=${encodeURIComponent(photo.url)}`,  // CORS bypass
    step: photo.type,
    stepLabel: extractStepLabel(photo.filename),
    timestamp: photo.modified,
    filename: photo.filename,
  })),
  evaluated: !!evaluations.find(e => e.dr_number === dr.dr_number),
  evaluation_date: evaluation?.evaluation_date,
  feedback_sent: evaluation?.feedback_sent,
  overall_status: evaluation?.overall_status,
}));
```

### API Endpoints

| Endpoint | Method | Purpose | Data Source |
|----------|--------|---------|-------------|
| `/api/foto/photos` | GET | Fetch all DRs with photos | BOSS VPS + Neon DB |
| `/api/foto/photo-proxy` | GET | Proxy BOSS VPS photo (CORS bypass) | BOSS VPS |
| `/api/foto/evaluation/[dr_number]` | GET | Fetch evaluation for specific DR | Neon DB |
| `/api/foto/evaluate` | POST | Trigger AI evaluation | DR Photo API |
| `/api/foto/feedback` | POST | Send WhatsApp feedback | WhatsApp Bridge |

### Photo Proxy Pattern

**Problem**: CORS prevents direct browser access to BOSS VPS photos
**Solution**: Proxy through Next.js API

```typescript
// Frontend requests proxied URL
const photoUrl = `/api/foto/photo-proxy?url=${encodeURIComponent(bossVpsUrl)}`;

// Backend (pages/api/foto/photo-proxy.ts) forwards request
const response = await fetch(bossVpsUrl);
const buffer = await response.arrayBuffer();
return new Response(buffer, { headers: { 'Content-Type': 'image/jpeg' } });
```

---

## 2. WA Monitor Module

### Overview
- **URL**: `http://localhost:3005/wa-monitor`
- **Architecture**: Fully isolated "Lego block" module
- **Purpose**: Monitor WhatsApp QA submissions, track 12-step installation checklist

### Isolation Pattern

✅ **Zero dependencies** on main app code:
- Does NOT import from `@/lib/*`
- Does NOT import from `@/services/*`
- Can be extracted to microservice without changes

### Data Flow

```
WhatsApp Groups (Lawley, Mohadin, Mamelodi, etc.)
  ↓ (technician uploads photos)
VPS Monitor (Python service on 72.60.17.245)
  ↓ (parses messages, extracts photos, stores QA data)
Neon PostgreSQL (qa_photo_reviews table)
  ↓ (fetches QA records)
WA Monitor Dashboard (React UI)
```

### Database Schema

```sql
CREATE TABLE qa_photo_reviews (
  id UUID PRIMARY KEY,
  drop_number VARCHAR(50),                     -- DR123456
  project VARCHAR(100),                        -- Lawley, Mohadin, etc.
  user_name VARCHAR(255),                      -- Technician name
  user_phone VARCHAR(50),                      -- WhatsApp number

  -- 12 QA Steps (boolean - true if photo uploaded)
  step_01_house_photo BOOLEAN DEFAULT false,
  step_02_cable_from_pole BOOLEAN DEFAULT false,
  step_03_cable_entry_outside BOOLEAN DEFAULT false,
  step_04_cable_entry_inside BOOLEAN DEFAULT false,
  step_05_wall_box BOOLEAN DEFAULT false,
  step_06_ont_back BOOLEAN DEFAULT false,
  step_07_power_meter BOOLEAN DEFAULT false,
  step_08_ont_barcode BOOLEAN DEFAULT false,   -- 🔥 Now with barcode scanning
  step_09_ups_serial BOOLEAN DEFAULT false,    -- 🔥 Now with barcode scanning
  step_10_final_setup BOOLEAN DEFAULT false,
  step_11_ont_lights BOOLEAN DEFAULT false,
  step_12_signature BOOLEAN DEFAULT false,

  -- Incorrect photo marking (Nov 17, 2025)
  incorrect_steps TEXT[] DEFAULT '{}',
  incorrect_comments JSONB DEFAULT '{}',

  -- Serial scanning integration (Jan 13, 2026) 🆕
  ont_serial_scanned VARCHAR(100),
  ups_serial_scanned VARCHAR(100),
  router_serial_scanned VARCHAR(100),
  ont_consumption_id UUID REFERENCES stock_consumptions(id),
  ups_consumption_id UUID REFERENCES stock_consumptions(id),
  scan_gps_lat DECIMAL(10, 7),
  scan_gps_lng DECIMAL(10, 7),
  scan_timestamp TIMESTAMP WITH TIME ZONE,
  serials_verified BOOLEAN DEFAULT false,

  -- Metadata
  first_message_date TIMESTAMP,
  completed_at TIMESTAMP,
  group_jid VARCHAR(100),                      -- WhatsApp group ID
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

### Monitored WhatsApp Groups

| Project | WhatsApp Group JID | Technicians |
|---------|-------------------|-------------|
| **Lawley** | `120363418298130331@g.us` | ~20 |
| **Mohadin** | `120363421532174586@g.us` | ~15 |
| **Mamelodi** | `120363408849234743@g.us` | ~25 |
| **Velo Test** | `120363421664266245@g.us` | 5 |

### VPS Monitor Service

**Location**: `/opt/wa-monitor/prod/` on VPS (72.60.17.245)
**Language**: Python (WhatsApp Business API integration)
**Config**: `/opt/wa-monitor/prod/config/projects.yaml`

**Safe Restart**:
```bash
# ✅ CORRECT - Clears Python cache
/opt/wa-monitor/prod/restart-monitor.sh

# ❌ WRONG - Keeps stale cache
systemctl restart wa-monitor-prod
```

### Stock Tracking Integration (4-Stage)

```
┌─────────────────────────────────────────────────────────────────┐
│ Stage 1: Receipt → Stage 2: Checkout → Stage 3: Installation   │
│ (Warehouse)       (Morning)           (WA Monitor QA)           │
└─────────────────────────────────────────────────────────────────┘
```

**Installation Workflow** (Step 8 & 9):

```typescript
// Technician scans ONT barcode during QA review
POST /api/wa-monitor-scan-serial
{
  qaReviewId: "uuid",
  dropNumber: "DR123456",
  stepNumber: 8,                               // ONT barcode step
  serialNumber: "ONT-SERIAL-123",
  technicianId: "uuid",
  gpsLat: -25.7461,
  gpsLng: 28.1881,
  scanTimestamp: "2026-01-14T10:30:00Z"
}

// Backend validates and links to stock system:
// 1. Find serial in stock_serials table
// 2. Verify status = 'issued' (not already installed)
// 3. Create stock_consumption record
// 4. Update stock_serials.status = 'installed'
// 5. Link to qa_photo_reviews via ont_consumption_id
```

### Critical Distinction: Two Drop Tables

❌ **Common Mistake**: Confusing two separate drop tables!

| Table | Source | Purpose | API |
|-------|--------|---------|-----|
| **`drops`** | SOW Excel imports | Project planning, fiber routing | `/api/sow/drops` |
| **`qa_photo_reviews`** | WhatsApp QA submissions | Installation verification, quality tracking | `/api/wa-monitor-drops` |

**Never confuse these tables!** They serve completely different purposes.

---

## 3. DR Photo API Service

### Overview
- **URL**: `http://192.168.1.150:8003`
- **Technology**: FastAPI (Python) + Gemini Vision AI
- **Purpose**: Download photos from 1Map GIS, AI-powered evaluation, GPS validation

### Key Features

#### 1. 1Map GIS Integration

**Downloads photos from 1Map** based on DR number:

```python
async def search_1map_photos(dr_number: str) -> List[Dict[str, Any]]:
    async with OneMapSpecialistAgent() as agent:
        record = await agent.get_dr(dr_number)  # Fetch DR from 1Map

        # Extract photos from all property records
        for prop_record in record.property_records:
            for photo_type, photo_id in prop_record.photos.items():
                photos_list.append({
                    'filename': f"{photo_type}_{photo_id}.jpg",
                    'photo_type': photo_type,           # ph_prop, ph_ont, ph_ups
                    'photo_id': photo_id,
                    'primary_id': prop_record.primary_id,  # Needed for download
                    'step_number': get_step_for_photo_type(photo_type),  # 1-12
                    'source': '1map'
                })
```

**Photo Type to Step Mapping**:
```python
PHOTO_TYPE_TO_STEP = {
    'ph_prop': 1,        # House Photo
    'ph_cbl_r': 2,       # Cable Route
    'ph_entry_out': 3,   # Entry Outside
    'ph_entry_in': 4,    # Entry Inside
    'ph_wall': 5,        # Wall Box
    'ph_ont_back': 6,    # ONT Back
    'ph_power': 7,       # Power Meter
    'ph_barcode': 8,     # ONT Barcode
    'ph_ups': 9,         # UPS Serial
    'ph_final': 10,      # Final Setup
    'ph_led': 11,        # ONT Lights
}
```

#### 2. GPS/EXIF Extraction

**Extracts GPS coordinates from photo metadata**:

```python
from lib.image.exif_extractor import extract_gps_metadata
from lib.image.gps_validator import GPSValidator, GPSValidationStatus

# Extract GPS coordinates from photo EXIF data
gps_metadata = extract_gps_metadata(photo_path)
# Returns: {
#   'latitude': -25.7461,
#   'longitude': 28.1881,
#   'altitude': 1234.5,
#   'photo_datetime': '2026-01-14T10:30:00Z',
#   'camera_make': 'Samsung',
#   'camera_model': 'SM-G998B',
# }

# Validate GPS against site location (from 1Map or drops table)
validator = GPSValidator(site_lat=-25.7460, site_lng=28.1880)
validation = validator.validate_location(gps_lat, gps_lng)
# Returns: GPSValidationStatus.VALID | SUSPECT | INVALID
# Thresholds: < 500m = VALID, 500m-2km = SUSPECT, > 2km = INVALID
```

#### 3. AI Photo Evaluation (Gemini Vision)

**Evaluates photo quality using Gemini 2.0 Flash**:

```python
async def evaluate_photo_with_gemini(
    photo_path: str,
    step_number: int,
    expected_content: str
) -> Dict[str, Any]:
    prompt = f"""
    Evaluate this installation photo for Step {step_number}: {expected_content}

    Criteria:
    1. Clarity and focus (0-10)
    2. Correct content (0-10)
    3. Lighting quality (0-10)
    4. Completeness (0-10)

    Provide:
    - Overall score (0-10)
    - Pass/Fail status
    - Detailed feedback
    - Issues found
    """

    # Call Gemini Vision API
    response = await gemini_client.generate_content([prompt, image_data])

    return {
        'step_number': step_number,
        'overall_score': 7.5,
        'status': 'PASS',
        'clarity_score': 8.0,
        'content_score': 7.0,
        'lighting_score': 8.0,
        'completeness_score': 7.0,
        'feedback': 'ONT barcode is clearly visible...',
        'issues': [],
        'confidence': 0.92
    }
```

**AI Model Fallback Chain**:
1. **Primary**: Gemini 2.0 Flash (Google)
2. **Fallback 1**: GPT-4o Vision (OpenAI)
3. **Fallback 2**: Claude Vision Agent (Anthropic)

#### 4. Database Persistence

```sql
CREATE TABLE dr_photo_downloads (
  id UUID PRIMARY KEY,
  dr_number VARCHAR(50),
  project VARCHAR(100),
  filename VARCHAR(255),
  file_path TEXT,
  file_size INTEGER,
  file_hash VARCHAR(64),                       -- SHA-256 for deduplication

  -- 1Map metadata
  onemap_layer_id VARCHAR(100),
  onemap_attachment_id VARCHAR(100),

  -- GPS/EXIF metadata
  exif_data JSONB,
  gps_latitude DECIMAL(10, 7),
  gps_longitude DECIMAL(10, 7),
  gps_altitude DECIMAL(10, 2),
  photo_datetime TIMESTAMP,
  camera_make VARCHAR(100),
  camera_model VARCHAR(100),

  -- GPS validation
  gps_validation_status VARCHAR(20),           -- VALID, SUSPECT, INVALID
  gps_distance_from_site_km DECIMAL(10, 3),

  -- AI evaluation
  ai_verification_status VARCHAR(20),          -- pass, fail, pending
  ai_verification_result JSONB,
  ai_confidence DECIMAL(4, 3),

  -- Timestamps
  downloaded_at TIMESTAMP,
  analyzed_at TIMESTAMP
);
```

### REST API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| **Core Photo Operations** |
| `/api/record/{dr_number}` | GET | Fetch DR record from 1Map |
| `/api/download/{dr_number}` | POST | Download photos from 1Map |
| `/api/photo/{dr_number}/{filename}` | GET | Serve photo file |
| `/api/download-zip/{dr_number}` | GET | Download all photos as ZIP |
| **AI Evaluation** |
| `/api/evaluate/{dr_number}` | POST | Trigger AI evaluation for all photos |
| `/api/evaluate/{dr_number}/status` | GET | Check evaluation progress |
| `/api/evaluations/{dr_number}` | GET | Fetch evaluation results |
| `/api/evaluations` | GET | List all evaluations |
| **QA Workflow** |
| `/api/qa/trigger/{dr_number}` | POST | Start QA verification workflow |
| `/api/qa/status/{dr_number}` | GET | Check QA workflow status |
| `/api/qa/summary` | GET | QA summary statistics |
| **Data Management** |
| `/api/photos` | GET | List all DRs with photos |
| `/api/photos/{dr_number}` | GET | List photos for specific DR |
| `/api/search` | GET | Search DRs by project/status |
| `/api/stats` | GET | System statistics |
| **Web UI** |
| `/` | GET | HTML dashboard for manual review |

---

## Integration Points

### 1. Photo Review ↔ BOSS VPS

```
Photo Review Frontend
  ↓ (user opens /photo-review)
GET /api/foto/photos (Next.js API)
  ↓ (proxy request)
GET http://100.96.203.105:8001/api/photos (BOSS VPS)
  ↓ (return photo list with metadata)
Photo Review API merges with Neon DB evaluations
  ↓ (return unified DropRecord[])
Photo Review UI displays photos + evaluation status
```

### 2. Photo Review ↔ DR Photo API (AI Evaluation)

```
Photo Review UI ("Evaluate" button click)
  ↓ (user triggers evaluation)
POST /api/foto/evaluate (Next.js API)
  ↓ (forward request)
POST http://192.168.1.150:8003/api/evaluate/{dr_number} (DR Photo API)
  ↓ (AI processing with Gemini Vision)
DR Photo API:
  1. Downloads photos from 1Map
  2. Extracts GPS/EXIF metadata
  3. Validates GPS against site location
  4. Runs AI evaluation with Gemini Vision
  5. Stores results in Neon DB (foto_ai_reviews)
  ↓ (evaluation complete)
GET /api/foto/evaluation/{dr_number} (Next.js API)
  ↓ (fetch from Neon DB)
SELECT * FROM foto_ai_reviews WHERE dr_number = '{dr_number}'
  ↓ (return evaluation results)
Photo Review UI displays AI evaluation results
```

### 3. WA Monitor ↔ Stock Tracking (Serial Scanning)

```
Technician completes installation
  ↓ (opens QA review in WA Monitor)
WA Monitor Dashboard (Step 8: ONT Barcode)
  ↓ (clicks "Scan ONT Barcode")
BarcodeScannerModal (camera opens)
  ↓ (scans barcode: ONT-SERIAL-123)
POST /api/wa-monitor-scan-serial
  ↓ (validate & link to stock system)
Backend Transaction:
  1. Find serial in stock_serials table
  2. Verify status = 'issued' (not already installed)
  3. Create stock_consumption record (drop_number, serial_id, gps, timestamp)
  4. Update stock_serials.status = 'installed'
  5. Update qa_photo_reviews (ont_serial_scanned, ont_consumption_id)
  ↓ (return success)
WA Monitor UI shows "ONT Serial: ONT-SERIAL-123" ✅
```

### 4. DR Photo API ↔ 1Map GIS (Photo Download)

```
DR Photo API receives download request
  ↓
POST /api/download/{dr_number}
  ↓ (fetch DR record from 1Map)
OneMapSpecialistAgent.get_dr(dr_number)
  ↓ (1Map API call)
GET https://app.1map.io/api/v1/layers/search?dr_number={dr_number}
  ↓ (extract photos from property_records)
For each photo_type (ph_prop, ph_ont, ph_ups, etc.):
  ↓ (download photo binary)
  GET https://app.1map.io/api/v1/layers/{primary_id}/attachments/{photo_id}
  ↓ (save to filesystem)
  data/dr_photos/{dr_number}/{photo_type}_{photo_id}.jpg
  ↓ (extract GPS/EXIF metadata)
  extract_gps_metadata(photo_path)
  ↓ (validate GPS against site location)
  GPSValidator.validate_location(photo_gps, site_gps)
  ↓ (store metadata in database)
  INSERT INTO dr_photo_downloads (
    dr_number, filename, file_path,
    gps_latitude, gps_longitude, gps_validation_status,
    ai_verification_status, ...
  )
```

---

## Database Schema Relationships

```sql
-- Photo Review Evaluation (AI results)
foto_ai_reviews (dr_number PK)
  ← Stores AI evaluation results for DR
  ← Referenced by Photo Review UI
  ← Written by DR Photo API

-- WA Monitor QA Tracking (WhatsApp submissions)
qa_photo_reviews (id PK)
  ├── drop_number (DR123456)
  ├── ont_consumption_id FK → stock_consumptions.id
  └── ups_consumption_id FK → stock_consumptions.id
  ← Written by VPS Monitor (Python service)
  ← Read by WA Monitor Dashboard

-- Stock Tracking (4-Stage: Receipt → Checkout → Installation → Reconciliation)
stock_serials (id PK)
  ├── serial_number (ONT-SERIAL-123)
  ├── status (available → issued → installed)
  └── current_location_id FK → stock_locations.id

stock_consumptions (id PK)
  ├── serial_id FK → stock_serials.id
  ├── drop_number (DR123456)
  ├── consumed_by FK → users.id
  ├── gps_lat, gps_lng (installation location)
  └── consumption_date
  ← Referenced by qa_photo_reviews (ont_consumption_id, ups_consumption_id)

-- DR Photo API Downloads (1Map photos with GPS validation)
dr_photo_downloads (id PK)
  ├── dr_number (DR123456)
  ├── file_path (data/dr_photos/DR123456/ph_ont_123.jpg)
  ├── gps_latitude, gps_longitude (from EXIF)
  ├── gps_validation_status (VALID/SUSPECT/INVALID)
  ├── ai_verification_status (pass/fail/pending)
  └── ai_verification_result JSONB (Gemini Vision output)
  ← Written by DR Photo API

-- 1Map GIS Data (site location reference)
onemap_properties (id PK)
  ├── drop_number (DR123456)
  ├── latitude, longitude (site location for GPS validation)
  ├── ont_barcode (expected serial from 1Map)
  └── photos JSONB (ph_prop: 123, ph_ont: 456, ...)
  ← Referenced by DR Photo API for site location
```

---

## Configuration & Environment Variables

### Shared Database (All Services)
```env
DATABASE_URL=postgresql://neondb_owner:npg_aRNLhZc1G2CD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb
```

### Photo Review (Next.js)
```env
BOSS_VPS_API_URL=http://100.96.203.105:8001
DR_PHOTO_API_URL=http://192.168.1.150:8003
```

### DR Photo API (FastAPI)
```env
ONEMAP_EMAIL=<1Map account email>
ONEMAP_PASSWORD=<1Map account password>
GEMINI_API_KEY=<Google Gemini API key>
OPENAI_API_KEY=<OpenAI API key> (fallback)
ANTHROPIC_API_KEY=<Anthropic API key> (fallback 2)
DR_PHOTOS_PATH=data/dr_photos
```

### VPS Monitor (Python)
```env
DATABASE_URL=<Neon PostgreSQL connection string>
WHATSAPP_BRIDGE_URL=http://localhost:8092
```

---

## Deployment & Maintenance

### Photo Review Dashboard
```bash
# Local development
npm run build && PORT=3005 npm start

# Production deployment (Velocity Server)
ssh louis@100.96.203.105
cd /var/www/fibreflow
git pull && npm ci && npm run build
pm2 restart fibreflow-prod
```

### DR Photo API Service
```bash
# Start service (on 192.168.1.150)
uvicorn scripts.dr_photo_api_modified:app --host 0.0.0.0 --port 8003

# Or via systemd
sudo systemctl start dr-photo-api
sudo systemctl enable dr-photo-api  # Auto-start on boot
```

### VPS Monitor (WhatsApp)
```bash
# Safe restart (clears Python cache)
ssh root@72.60.17.245
/opt/wa-monitor/prod/restart-monitor.sh

# Add new WhatsApp group
nano /opt/wa-monitor/prod/config/projects.yaml
# Add group configuration in YAML format
/opt/wa-monitor/prod/restart-monitor.sh
```

---

## Troubleshooting

### Photo Review Issues

**Problem**: Photos not loading (CORS error)
**Solution**: Check BOSS VPS API is accessible, verify photo proxy is working

**Problem**: Evaluations not showing
**Solution**: Check Neon DB connection, verify `foto_ai_reviews` table has data

### WA Monitor Issues

**Problem**: "Send Feedback" button not working
**Solution**:
```bash
ssh louis@100.96.203.105
systemctl restart whatsapp-bridge-prod
```

**Problem**: New WhatsApp group not being monitored
**Solution**: Add group to `/opt/wa-monitor/prod/config/projects.yaml`, restart monitor

### DR Photo API Issues

**Problem**: Photos not downloading from 1Map
**Solution**: Check 1Map credentials (`ONEMAP_EMAIL`, `ONEMAP_PASSWORD`)

**Problem**: AI evaluation failing
**Solution**: Check Gemini API key (`GEMINI_API_KEY`), verify API quota

**Problem**: GPS validation always INVALID
**Solution**: Check site location in `onemap_properties` table, verify GPS coordinates

---

## Security Considerations

### Database Access
- All services share Neon PostgreSQL connection
- Use connection pooling (max 10 connections per service)
- Never commit `DATABASE_URL` to git

### API Keys
- Store in `.env` files (never commit)
- Rotate Gemini/OpenAI keys monthly
- Use separate keys for dev/prod

### Photo Storage
- BOSS VPS photos are public (no authentication)
- DR Photo API local storage (`data/dr_photos/`) requires filesystem permissions
- 1Map photos require authentication (email/password)

---

## Performance Optimization

### Photo Review Dashboard
- Photo proxy caches responses (15-minute TTL)
- Neon DB connection pool (min 2, max 10 connections)
- Frontend pagination (50 DRs per page)

### DR Photo API
- Async photo downloads (concurrent limit: 10)
- GPS extraction cached in database
- AI evaluation batched (5 photos at a time)

### WA Monitor
- Real-time updates via WebSocket (not polling)
- Database indexes on `drop_number`, `project`, `completed_at`

---

## Future Enhancements

### Planned Features
1. **Real-time AI evaluation** - Evaluate photos as they're uploaded to WhatsApp
2. **GPS anomaly detection** - Alert when photo GPS doesn't match site location
3. **Multi-language support** - WhatsApp feedback in Afrikaans, Zulu, Xhosa
4. **Mobile app** - Native Android/iOS app for technicians
5. **Predictive analytics** - Predict installation quality based on historical data

### Technical Debt
1. **BOSS VPS dependency** - Consider migrating to Firebase Storage or S3
2. **DR Photo API local storage** - Migrate to cloud storage (S3/Azure Blob)
3. **1Map API rate limiting** - Implement retry logic with exponential backoff
4. **WA Monitor isolation** - Extract to microservice for better scalability

---

## Related Documentation

- `src/modules/wa-monitor/README.md` - WA Monitor comprehensive documentation
- `src/modules/wa-monitor/ISOLATION_GUIDE.md` - Module isolation patterns
- `docs/DATABASE_TABLES.md` - Complete database schema reference
- `scripts/dr_photo_api_modified.py` - DR Photo API source code
- `.claude/expertise.yaml` - PAI project knowledge

---

**Last Updated**: January 14, 2026
**Reviewed By**: Claude Code (System Familiarization)
**Status**: Production Active
