# Photo Upload Flow from 1Map to FibreFlow

**Date:** 2025-12-24
**Status:** Active System Documentation

---

## 📋 Table of Contents

1. [System Overview](#system-overview)
2. [Component Architecture](#component-architecture)
3. [Photo Flow Diagram](#photo-flow-diagram)
4. [Step-by-Step Process](#step-by-step-process)
5. [Server Locations](#server-locations)
6. [API Endpoints](#api-endpoints)
7. [Photo Storage](#photo-storage)
8. [How Photos Are Uploaded](#how-photos-are-uploaded)

---

## System Overview

Photos for DR installations flow through multiple systems before being evaluated by FibreFlow's AI:

```
1Map GIS (Source)
    ↓
Field Technician (Mobile App)
    ↓
1Map Database (Attachments)
    ↓
BOSS VPS API (Scraper/Cache)
    ↓
FibreFlow (Evaluation)
```

---

## Component Architecture

### System Components

| Component | Location | Port | Purpose |
|-----------|----------|------|---------|
| **1Map GIS** | https://1map.co.za | 443 | Source system for photos |
| **BOSS VPS API** | 100.96.203.105 | 8001 | Photo cache & API |
| **FibreFlow Prod** | app.fibreflow.app | 3005 | Main evaluation system |
| **Velocity Server** | 100.96.203.105 | 8100 | VLM AI model (Qwen3-VL) |

---

## Photo Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│                    1. Field Collection                       │
├─────────────────────────────────────────────────────────────┤
│  Field Technician                                           │
│    ↓ (Uses 1Map Mobile App)                                │
│  Takes installation photos on-site                          │
│    ↓                                                         │
│  Photos uploaded to 1Map GIS                                │
│    - Property ID attachments                                │
│    - Photo types: ph_prop, ph_bl, ph_after, etc.           │
└─────────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│              2. 1Map GIS Storage (Source)                    │
├─────────────────────────────────────────────────────────────┤
│  https://1map.co.za                                         │
│    ↓                                                         │
│  Photos stored as Property Attachments:                     │
│    - Linked to Property ID (e.g., 3876903)                 │
│    - Tagged with photo type (e.g., "ph_prop")              │
│    - Metadata: timestamp, user, DR number                   │
│    - Format: JPEG, ~100-200KB each                         │
└─────────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│       3. BOSS VPS API - Photo Scraper/Cache                  │
├─────────────────────────────────────────────────────────────┤
│  Server: 100.96.203.105:8001                                 │
│  Service: /opt/foto-review-api/ui-module/1map_api.py       │
│    ↓                                                         │
│  Browser Automation (Playwright):                           │
│    1. Login to 1map.co.za                                   │
│    2. Search for DR number                                  │
│    3. Navigate to Properties tab                            │
│    4. Download photo attachments                            │
│    5. Save locally by DR number                             │
│    ↓                                                         │
│  Storage: /opt/foto-review-api/1map_images/                │
│    - Organized by project folders                           │
│    - Filename format: DR{number}_ph_{type}_{propertyid}.jpg│
│    - Example: DR1730550_ph_prop_3876451.jpg                │
│    ↓                                                         │
│  API Endpoint: GET /api/photos                              │
│    - Returns JSON list of all DRs and photos               │
│    - Photo metadata: filename, type, size, modified date   │
│    ↓                                                         │
│  API Endpoint: GET /api/photo/{dr_number}/{filename}       │
│    - Serves individual photo file                           │
│    - Direct image download                                  │
└─────────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│         4. FibreFlow - Fetch Photos for Evaluation           │
├─────────────────────────────────────────────────────────────┤
│  App: https://app.fibreflow.app/foto-review                │
│  Code: src/modules/foto-review/services/fotoVlmService.ts  │
│    ↓                                                         │
│  fetchDrPhotos(drNumber):                                   │
│    1. Fetch photo list from BOSS API                        │
│       GET http://100.96.203.105:8001/api/photos             │
│    ↓                                                         │
│    2. Find DR in response                                   │
│       data.drs.find(dr => dr.dr_number === drNumber)       │
│    ↓                                                         │
│    3. Build photo URLs                                      │
│       http://100.96.203.105:8001/api/photo/{dr}/{filename}  │
│    ↓                                                         │
│  Returns: Array of photo URLs                               │
│    [                                                         │
│      "http://100.96.203.105:8001/api/photo/DR1730550/DR1730550_ph_prop_3876451.jpg",
│      "http://100.96.203.105:8001/api/photo/DR1730550/DR1730550_ph_bl_3876912.jpg",
│      ...                                                     │
│    ]                                                         │
└─────────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│         5. VLM Evaluation - Download & Analyze              │
├─────────────────────────────────────────────────────────────┤
│  Code: src/modules/foto-review/services/fotoVlmService.ts  │
│    ↓                                                         │
│  For each QA step (1-10):                                   │
│    ↓                                                         │
│    For each batch of 6 photos:                              │
│      1. Download photo from BOSS API                        │
│         fetch(photoUrl)                                     │
│      ↓                                                       │
│      2. Convert to base64                                   │
│         Buffer.from(arrayBuffer).toString('base64')         │
│      ↓                                                       │
│      3. Send to VLM API                                     │
│         POST http://100.96.203.105:8100/v1/chat/completions│
│         {                                                    │
│           model: "Qwen/Qwen3-VL-8B-Instruct",              │
│           messages: [{                                      │
│             content: [                                      │
│               { type: "text", text: "Evaluate Step X..." },│
│               { type: "image_url", url: "data:image/jpeg;base64,..." }
│             ]                                               │
│           }]                                                │
│         }                                                    │
│      ↓                                                       │
│      4. VLM analyzes photo                                  │
│         - Looks through 6 photos                            │
│         - Finds most relevant photo for this step           │
│         - Returns score & comment                           │
│      ↓                                                       │
│    Take BEST result across all batches                      │
│    ↓                                                         │
│  Return final 10-step evaluation                            │
└─────────────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────────────┐
│              6. Results Display & Feedback                   │
├─────────────────────────────────────────────────────────────┤
│  FibreFlow UI:                                              │
│    - Display evaluation results                             │
│    - Show pass/fail for each step                           │
│    - Generate WhatsApp feedback message                     │
│    ↓                                                         │
│  WhatsApp Feedback (optional):                              │
│    POST http://72.60.17.245:8080/api/send                  │
│    - Send results to project WhatsApp group                 │
│    - Include pass/fail status, scores, comments             │
└─────────────────────────────────────────────────────────────┘
```

---

## Step-by-Step Process

### 1. Field Technician Uploads Photos

**Location:** On-site installation
**Tool:** 1Map Mobile App (Android/iOS)

1. Technician completes installation
2. Opens 1Map mobile app
3. Navigates to the property in 1Map
4. Takes photos for each QA step:
   - `ph_prop` - House photo
   - `ph_drop` - Cable span from pole
   - `ph_hm_ln` - Cable entry outside
   - `ph_hm_en` - Cable entry inside
   - `ph_wall` - Wall installation
   - `ph_cbl_r` - Cable routing & ONT back
   - `ph_powm2` - Power meter
   - `ph_after` - Final installation
   - `ph_bl` - Green lights & DR label
   - `ph_sign1/2/3` - Customer signatures
5. Uploads photos to 1Map
6. Photos linked to Property ID and DR number

### 2. Photos Stored in 1Map GIS

**Location:** https://1map.co.za
**Storage:** Database attachments

- Photos attached to Property records
- Each photo tagged with:
  - Property ID (e.g., 3876903)
  - Photo type (e.g., "ph_prop")
  - DR number (e.g., "DR1730550")
  - Timestamp
  - Uploaded by (user)
- Accessible via 1Map web interface

### 3. BOSS VPS Scrapes Photos from 1Map

**Location:** BOSS VPS (100.96.203.105)
**Service:** Browser Automation

**Process:**

```python
# /opt/foto-review-api/onemap_browser_automation.py

1. Initialize Playwright browser
2. Navigate to https://1map.co.za/login
3. Login with credentials
4. Search for DR number
5. Find associated properties
6. Click Properties tab
7. Download all photo attachments
8. Save to /opt/foto-review-api/1map_images/{project}/{dr_number}/
9. Rename files: DR{number}_ph_{type}_{propertyid}.jpg
```

**API Server:**

```python
# /opt/foto-review-api/ui-module/1map_api.py (Port 8001)

@app.get("/api/photos")
def get_photos():
    """
    Scan /opt/foto-review-api/1map_images/
    Return JSON with all DRs and photos
    """

@app.get("/api/photo/{dr_number}/{filename}")
def serve_photo(dr_number, filename):
    """
    Serve photo file from disk
    """
```

### 4. FibreFlow Fetches Photo URLs

**Location:** FibreFlow Production (app.fibreflow.app)
**Code:** `src/modules/foto-review/services/fotoVlmService.ts`

```typescript
async function fetchDrPhotos(drNumber: string): Promise<string[]> {
  const BOSS_API_URL = 'http://100.96.203.105:8001';

  // 1. Fetch photo list
  const response = await fetch(`${BOSS_API_URL}/api/photos`);
  const data = await response.json();

  // 2. Find this DR
  const drData = data.drs.find(dr => dr.dr_number === drNumber);

  // 3. Build photo URLs
  const photoUrls = drData.photos.map(photo =>
    `${BOSS_API_URL}/api/photo/${drNumber}/${photo.filename}`
  );

  return photoUrls;
  // Example: [
  //   "http://100.96.203.105:8001/api/photo/DR1730550/DR1730550_ph_prop_3876451.jpg",
  //   "http://100.96.203.105:8001/api/photo/DR1730550/DR1730550_ph_bl_3876912.jpg",
  //   ...
  // ]
}
```

### 5. VLM Downloads & Evaluates Photos

**Location:** Velocity Server (100.96.203.105:8100)
**Model:** Qwen3-VL-8B-Instruct

```typescript
// For each QA step
for (const qaStep of QA_STEPS) {
  // For each batch of 6 photos
  for (const batch of batches) {
    // 1. Download photos from BOSS API
    const base64Images = [];
    for (const photoUrl of batch) {
      const response = await fetch(photoUrl);
      const arrayBuffer = await response.arrayBuffer();
      const base64 = Buffer.from(arrayBuffer).toString('base64');
      base64Images.push(base64);
    }

    // 2. Send to VLM
    const vlmResponse = await fetch('http://100.96.203.105:8100/v1/chat/completions', {
      method: 'POST',
      body: JSON.stringify({
        model: 'Qwen/Qwen3-VL-8B-Instruct',
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: 'Evaluate ONLY Step 1: House Photo...' },
            ...base64Images.map(img => ({
              type: 'image_url',
              image_url: { url: `data:image/jpeg;base64,${img}` }
            }))
          ]
        }]
      })
    });

    // 3. VLM returns evaluation
    // { step_number: 1, score: 10, passed: true, comment: "..." }
  }

  // Take BEST result for this step across all batches
}
```

---

## Server Locations

### BOSS VPS (Old VPS)

**IP:** 100.96.203.105
**Location:** Hostinger VPS

**Services:**
- **Port 8001** - 1Map Photo API
  - `/opt/foto-review-api/ui-module/1map_api.py`
  - Serves photos via `/api/photo/{dr}/{filename}`

**Photo Storage:**
```
/opt/foto-review-api/1map_images/
├── Lawley/
│   ├── DR1730550/
│   │   ├── DR1730550_ph_prop_3876451.jpg
│   │   ├── DR1730550_ph_bl_3876912.jpg
│   │   └── ...
│   └── DR1730551/
├── Mohadin/
└── Unknown/
```

### FibreFlow Production

**URL:** https://app.fibreflow.app
**Server:** 72.60.17.245
**Port:** 3005

**Code:**
- `src/modules/foto-review/services/fotoVlmService.ts`
- Fetches photos from BOSS API
- Sends to VLM for evaluation

### Velocity Server

**IP:** 100.96.203.105 (Tailscale)
**Port:** 8100

**Service:**
- vLLM with Qwen3-VL-8B-Instruct model
- Evaluates installation photos
- Returns JSON results

---

## API Endpoints

### BOSS VPS API (100.96.203.105:8001)

#### Get All Photos
```http
GET /api/photos

Response:
{
  "total_drs": 160,
  "total_photos": 1887,
  "drs": [
    {
      "dr_number": "DR1730550",
      "photo_count": 16,
      "photos": [
        {
          "filename": "DR1730550_ph_prop_3876451.jpg",
          "type": "ph_prop",
          "size": 142880,
          "modified": "2025-12-10T12:06:39"
        }
      ]
    }
  ]
}
```

#### Get Individual Photo
```http
GET /api/photo/{dr_number}/{filename}

Example:
GET /api/photo/DR1730550/DR1730550_ph_prop_3876451.jpg

Response: Image file (JPEG)
```

### FibreFlow API (app.fibreflow.app)

#### Evaluate DR
```http
POST /api/foto/evaluate
Content-Type: application/json

{
  "dr_number": "DR1730550"
}

Response:
{
  "success": true,
  "data": {
    "dr_number": "DR1730550",
    "overall_status": "PASS",
    "average_score": 8.5,
    "total_steps": 10,
    "passed_steps": 9,
    "step_results": [...]
  }
}
```

---

## Photo Storage

### 1Map GIS Storage

- **Location:** 1map.co.za database
- **Format:** Property attachments
- **Access:** Web interface or API (requires login)

### BOSS VPS Cache

- **Location:** `/opt/foto-review-api/1map_images/`
- **Organization:** `{project}/{dr_number}/{filename}`
- **Filename Format:** `DR{number}_ph_{type}_{propertyid}.jpg`
- **Persistence:** Local disk

### Photo Types

| Photo Type | Step | Description |
|-----------|------|-------------|
| `ph_prop` | 1 | House Photo |
| `ph_drop` / `ph_outs` | 2 | Cable Span from Pole |
| `ph_hm_ln` | 3 | Cable Entry Outside |
| `ph_hm_en` | 4 | Cable Entry Inside |
| `ph_wall` | 5 | Wall Installation |
| `ph_cbl_r` | 6 | Cable Routing & ONT Back |
| `ph_powm2` | 7 | Power Meter Reading |
| `ph_ups` | 8 | UPS Serial Number |
| `ph_after` | 9 | Final Installation |
| `ph_bl` | 10 | Green Lights & DR Label |
| `ph_sign1/2/3` | 1 | Customer Signatures |

---

## How Photos Are Uploaded

### Manual Process (Current)

1. **Field Tech** uses 1Map mobile app
2. **Photos uploaded** to 1map.co.za
3. **BOSS VPS** runs browser automation to scrape photos
4. **Photos cached** locally on BOSS VPS
5. **FibreFlow** fetches from BOSS API
6. **VLM evaluates** photos

### Automated Process (Future Enhancement)

**Option A: Direct 1Map API Integration**
- Use 1Map API to download photos directly
- No browser automation needed
- Faster, more reliable

**Option B: WhatsApp Integration**
- Photos sent via WhatsApp groups
- WA Monitor extracts and stores
- Already implemented for some projects

---

## Troubleshooting

### Issue: Photos Not Found

**Symptoms:** `fetchDrPhotos()` returns empty array

**Solutions:**

1. **Check BOSS API:**
   ```bash
   curl http://100.96.203.105:8001/api/photos | jq '.drs[] | select(.dr_number=="DR1730550")'
   ```

2. **Check if photos were scraped:**
   ```bash
   ssh root@100.96.203.105
   ls -la /opt/foto-review-api/1map_images/*/DR1730550/
   ```

3. **Re-scrape photos from 1Map:**
   ```bash
   # Run browser automation script
   cd /opt/foto-review-api
   python3 onemap_browser_automation.py DR1730550
   ```

### Issue: Photos Won't Load in UI

**Symptoms:** 404 errors for photo URLs

**Solutions:**

1. **Check BOSS API is running:**
   ```bash
   ssh root@100.96.203.105
   lsof -i:8001
   ```

2. **Check photo file exists:**
   ```bash
   curl -I http://100.96.203.105:8001/api/photo/DR1730550/DR1730550_ph_prop_3876451.jpg
   ```

3. **Check network connectivity:**
   ```bash
   ping 100.96.203.105
   curl http://100.96.203.105:8001/api/photos
   ```

---

## Summary

**Photos flow through 4 systems:**

1. **1Map GIS** - Source (photos uploaded by field techs)
2. **BOSS VPS** - Cache (scrapes and serves photos)
3. **FibreFlow** - Fetch (gets photo URLs from BOSS API)
4. **Velocity Server** - Evaluate (VLM downloads and analyzes)

**Key Points:**
- Photos stored in 1Map as property attachments
- BOSS VPS scrapes photos using browser automation
- Photos cached locally on BOSS VPS disk
- FibreFlow fetches photo URLs from BOSS API
- VLM downloads photos and evaluates them
- Results sent to WhatsApp for feedback

---

**Last Updated:** 2025-12-24
**Maintained By:** Development Team
**Related Docs:**
- `docs/wa-monitor/FOTO_REVIEWS_1MAP_INTEGRATION.md`
- `src/modules/foto-review/README.md`
