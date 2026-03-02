# WhatsApp Infrastructure Skill

> **Last updated:** 2026-03-02
> **Status:** Current architecture - VPS unified bridge + pole install ACK pipeline

## Overview

Comprehensive documentation of the WhatsApp communication infrastructure for FibreFlow DR photo processing and civil pole installation real-time ACK.

## Quick Reference

| Component | Port | Service | Location |
|-----------|------|---------|----------|
| **Go WhatsApp Bridge** | 8083 | `whatsapp-bridge.service` | VPS (72.61.197.178) `/opt/whatsapp-bridge/` |
| **WA Command Bot** | 8086 | `wa-command-bot.service` | VPS (72.61.197.178) |
| **WA Feedback (LEGACY)** | 8092 | `wa-feedback.service` | Velocity (100.96.203.105) - **DEPRECATED** |
| **VLM Server** | 8100 | `vllm-qwen.service` | Velocity (100.96.203.105) systemd service |
| **OneMap API** | 8003 | Docker: `dr-photo-api` | Velocity Docker container |

## Phone Numbers

| Purpose | Number | Format | Notes |
|---------|--------|--------|-------|
| **Unified Bridge** | +27 63 841 2276 | `27638412276@s.whatsapp.net` | VPS - receives DRs, sends acks directly |

**REMOVED SERVICES:**

## WhatsApp Groups (11 Monitored)

| Project | Group JID | Type |
|---------|-----------|------|
| **Lawley** | `120363418298130331@g.us` | dr_submission |
| **Mohadin** | `120363421532174586@g.us` | dr_submission |
| **Mamelodi** | `120363408849234743@g.us` | dr_submission |
| **Marketing Activations** | `120363422808656601@g.us` | dr_submission |
| **Mamelodi Internal** | `120363425029043207@g.us` | dr_submission |
| **Mohadin Maintenance** | `120363424360693693@g.us` | maintenance |
| **Lawley Maintenance** | `120363423947610853@g.us` | maintenance |
| **Mohadin Pre-Provision** | `120363423163566226@g.us` | pre_provision |
| **Velo Server** | `120363423864087150@g.us` | admin |
| **Tonga Mafemani** | `120363407161101660@g.us` | civil |
| **Tonga A - As Build & QA** | `120363426646561186@g.us` | civil |

### Group Types

| Type | Purpose | Pipeline |
|------|---------|----------|
| `dr_submission` | Drop/activation photo submissions | DR ACK → QA review |
| `maintenance` | Non-invoicable maintenance photos | Forward to maintenance API |
| `admin` | Admin/server alerts | No processing |
| `pre_provision` | Pre-provisioning workflow | TBD |
| `civil` | Pole installation photos | **Pole Install ACK pipeline** (real-time VLM classify → session track → ACK) |
| `optical` | Cable/optical installation photos | Same pipeline as civil (planned) |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                          VPS (72.61.197.178)                             │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐  │
│  │  WhatsApp User   │    │  Unified Bridge  │    │  FibreFlow API   │  │
│  │  (Field Agent)   │───▶│  (Port 8083)     │───▶│  (app.fibreflow) │  │
│  │                  │    │                  │    │                  │  │
│  │  Sends: DR123456 │    │  - whatsmeow lib │    │  dr-acknowledgment│  │
│  └──────────────────┘    │  - SQLite store  │    │  process-new-dr  │  │
│         ▲                │  - Neon DB write │    └────────┬─────────┘  │
│         │                └────────┬─────────┘             │            │
│         │                         │                       │            │
│         │    ┌────────────────────┼───────────────────────┘            │
│         │    │                    │                                     │
│         │    ▼                    ▼                                     │
│  ┌──────┴───────────┐    ┌──────────────────┐    ┌──────────────────┐  │
│  │  Threaded Reply  │    │   Neon Database  │    │  OneMap API      │  │
│  │  (Bridge sends   │    │  (PostgreSQL)    │    │  (Velocity)      │  │
│  │   directly!)     │    │                  │    │                  │  │
│  │                  │    │  wa_monitored_   │    │  Photo storage   │  │
│  │  📸 DR123456     │    │    groups        │    │  Serial lookup   │  │
│  │  ✅ Photos: 12   │    │  qa_photo_reviews│    │                  │  │
│  │  ✅ ONT: ABC123  │    │  dr_photo_unified│    │                  │  │
│  └──────────────────┘    └──────────────────┘    └──────────────────┘  │
│                                                                          │
│  ┌──────────────────┐                                                   │
│  │  WA Command Bot  │        SENDER_URL=http://localhost:1             │
│  │  (Port 8086)     │        (DISABLED - bridge sends directly)        │
│  │                  │                                                   │
│  │  Admin commands  │                                                   │
│  └──────────────────┘                                                   │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘

         Velocity Server (100.96.203.105) - LEGACY ONLY
         ┌────────────────────────────────────────┐
         │  wa-feedback.service (port 8092)       │
         │  ⚠️  DEPRECATED - avoid new usage      │
         └────────────────────────────────────────┘
```

## Pole Install ACK Pipeline (Added 2026-03-02)

Real-time photo classification and ACK for civil pole installations via WhatsApp.

### Flow
```
WhatsApp Group (civil) → Bridge downloads photo inline → base64 in POST body
                                                               ↓
                                              /api/field-ops/wa-message
                                                               ↓
                                              poleInstallAckService.ts (fire-and-forget)
                                                ├─ VLM classify step + extract pole#
                                                ├─ Find/create pole_install_session
                                                ├─ Cross-ref pole against poles table
                                                ├─ Update session progress counts
                                                └─ Build ACK → send via bridge /send-message
                                                               ↓
                                              ACK appears in WhatsApp group (~3 sec)
```

### Services
| Component | File | Purpose |
|-----------|------|---------|
| **Classifier** | `src/modules/field-ops/services/poleInstallClassifier.ts` | VLM classify photo into 9 steps, extract pole# from text |
| **ACK Service** | `src/modules/field-ops/services/poleInstallAckService.ts` | Session management, progress tracking, ACK builder, bridge send |
| **Completion** | `src/modules/field-ops/services/poleInstallCompletionService.ts` | Session → construction_qa_reviews link |
| **API Handler** | `pages/api/field-ops/wa-message.ts` | Receives bridge payload, fire-and-forget ACK pipeline |

### Photo Classification Steps
| Step | Description | Required Count |
|------|-------------|---------------|
| BEFORE | Marked ground showing hole location | 3 |
| DEPTH | Measuring tape in hole | 1 |
| STUMPING | Pole planted, various angles | 3 |
| COMPACTION | Cement/soil backfill around base | 1 |
| HOUSEKEEPING | Clean site around pole | 3 |
| DURING | Digging/preparation (bonus) | 0 |
| ENDPLATE | End plates on pole (bonus) | 0 |
| LEVEL | Spirit level on pole (bonus) | 0 |
| SIGNATURE | Sign-off sheet (bonus) | 0 |

**Standard pole = 11 required photos. Corner pole = 14.**

### Session Resolution
1. **Text declaration**: "Pole TON.P.A003" → creates session with pole#
2. **VLM extraction**: Pole# read from photo → matched to session
3. **Sender fallback**: Same sender within 4 hours → reuses active session

### Database Tables (Migration 229)
- `pole_install_sessions` — per-pole session with step counts, status, cross-reference
- `field_ops_wa_photos.pole_install_session_id` — FK to session
- `field_ops_wa_photos.classified_step` — VLM-assigned step name

### Bridge Change (2026-03-02)
Bridge now downloads civil/optical photos inline using `client.Download()`, base64-encodes them, and includes `photo_base64` + `photo_filename` in the forwarded JSON payload. Backup saved to `store/{chatJID}/{messageID}.jpg`.

---

## Message Flow

### 1. Incoming DR Message (Field Agent → System)

```
Field Agent sends "DR1730468" to WhatsApp group
         │
         ▼
VPS Bridge receives via whatsmeow event handler
         │
         ├──▶ Extract DR pattern: DR[0-9]+
         │
         ├──▶ Write to SQLite (local store/messages.db)
         │
         ├──▶ Insert/Update qa_photo_reviews (Neon)
         │
         ├──▶ Write to wa_monitor_drops table
         │
         ├──▶ Sync to dr_photo_unified_reviews
         │
         ▼
Call FibreFlow dr-acknowledgment API
         │
         ├──▶ Query OneMap for photo count
         │
         ├──▶ Extract ONT serial from barcode
         │
         ├──▶ Get UPS serial
         │
         ▼
Bridge sends threaded reply directly (no separate sender)
         │
         └──▶ "📸 DR1730468 Received!
              ✅ Photos: 12
              ✅ ONT Serial: ABC123
              ✅ UPS Serial: XYZ789"
```

### 2. Outgoing Feedback (QA Review → Field Agent)

```
QA Reviewer marks DR as complete/incomplete
         │
         ▼
Click "Send Feedback" on Dashboard
         │
         ▼
POST /api/wa-monitor-send-feedback (FibreFlow)
         │
         ├──▶ Get drop details from database
         │
         ├──▶ Determine WhatsApp group by project
         │
         ├──▶ Format feedback message
         │
         ▼
Send via VPS Bridge (port 8083)
         │
         └──▶ POST http://72.61.197.178:8083/send-message
         │
         ▼
Update feedback_sent timestamp in database
```

## Go WhatsApp Bridge (VPS)

### Location
```
VPS: 72.61.197.178
/opt/whatsapp-bridge/
├── whatsapp-bridge      # Compiled binary
├── bridge.log           # Application logs
├── store/
│   ├── messages.db      # SQLite message history
│   └── whatsapp.db      # whatsmeow session data
└── whatsapp-bridge.service  # Systemd service

Source (Velocity — compile locally):
/home/velo/whatsapp-bridge/main.go
```

### Key Features
- Uses `whatsmeow` library (go.mau.fi/whatsmeow)
- Stores session in SQLite (`whatsapp.db`)
- Writes directly to Neon PostgreSQL
- HTTP API on port 8083
- **Handles both receiving AND sending** (unified architecture)
- Version: 2.0.0

### Configuration (Environment)
```bash
FIBREFLOW_URL=https://app.fibreflow.app
NEON_DB_URL=postgresql://neondb_owner:...@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require
SENDER_URL=http://localhost:1  # DISABLED - bridge sends directly
```

### API Endpoints
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Service health check |
| `/groups` | GET | List monitored groups |
| `/reload-groups` | GET | Reload groups from DB (no restart) |
| `/send-message` | POST | Send message to group |

### Service Management
```bash
# SSH to VPS
ssh root@72.61.197.178

# Check status
systemctl status whatsapp-bridge

# Restart
systemctl restart whatsapp-bridge

# View logs
tail -f /opt/whatsapp-bridge/bridge.log
journalctl -u whatsapp-bridge -f
```

## WA Feedback Service (LEGACY)

### ⚠️ DEPRECATED - Avoid New Usage

**Location:** Velocity (100.96.203.105) port 8092

```bash
# Legacy service still running but not recommended
/home/louis/wa-feedback-service/wa-feedback-service.js
```

**Migration path:** Use VPS bridge `/send-message` endpoint instead.

## Database Tables

### wa_monitored_groups (Neon)
Groups monitored by the bridge:
```sql
CREATE TABLE wa_monitored_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_jid VARCHAR(100) UNIQUE NOT NULL,
  group_name VARCHAR(200) NOT NULL,
  project_name VARCHAR(200),
  group_type VARCHAR(50) DEFAULT 'dr_submission',  -- dr_submission, maintenance, admin, pre_provision
  description TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
```

### qa_photo_reviews (Neon)
Primary table for WhatsApp QA drops:
```sql
CREATE TABLE qa_photo_reviews (
  id UUID PRIMARY KEY,
  drop_number TEXT UNIQUE NOT NULL,
  project TEXT,
  user_name TEXT,
  sender_phone VARCHAR(20),  -- WhatsApp sender JID

  -- 12 QA steps
  step_01_house_photo BOOLEAN DEFAULT false,
  step_02_cable_from_pole BOOLEAN DEFAULT false,
  -- ... steps 3-12 ...

  -- Timestamps
  whatsapp_message_date TIMESTAMP,
  feedback_sent TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),

  -- Scanned serials
  ont_serial_scanned VARCHAR(100),
  ups_serial_scanned VARCHAR(100)
);
```

### dr_photo_unified_reviews (Neon)
Unified table for VLM categorization:
```sql
CREATE TABLE dr_photo_unified_reviews (
  id UUID PRIMARY KEY,
  drop_number VARCHAR(20) NOT NULL,
  project VARCHAR(100),
  sender_phone VARCHAR(20),

  -- VLM categorization
  vlm_categorization JSONB,
  vlm_categorization_status TEXT DEFAULT 'pending',

  -- 10 step flags
  step_01_house_photo BOOLEAN DEFAULT false,
  -- ... steps 2-10 ...

  -- Serials
  ont_serial_scanned VARCHAR(100),
  ups_serial_scanned VARCHAR(100)
);
```

## FibreFlow API Endpoints

### DR Acknowledgment
```
POST /api/activate/dr-acknowledgment
```
Called by VPS Bridge to get acknowledgment data:
```typescript
// Request
{ dropNumber: "DR1730468", project: "Lawley" }

// Response
{
  success: true,
  data: {
    dropNumber: "DR1730468",
    found: true,
    photoCount: 12,
    ontSerial: "ALCLB46BE62E",
    upsSerial: "GU18W12V2562847",
    message: "📸 *DR1730468 Received!*\n\n✅ Photos: 12..."
  }
}
```

### Send Feedback
```
POST /api/wa-monitor-send-feedback
```
Called by Dashboard to send QA feedback via VPS bridge:
```typescript
// Request
{
  dropId: "uuid",
  message: "DR1730468\n\nMissing items:\n• Cable Entry Outside"
}

// Response
{
  success: true,
  data: {
    dropNumber: "DR1730468",
    project: "Lawley",
    group: "Lawley Activation 3",
    sentAt: "2026-02-20T..."
  }
}
```

## SSH Commands

```bash
# Connect to VPS (WhatsApp services)
ssh root@72.61.197.178

# Check bridge status
systemctl status whatsapp-bridge

# View bridge logs
tail -f /opt/whatsapp-bridge/bridge.log

# Filter for DR processing
grep -E 'DR[0-9]+|Ack|acknowledgment' /opt/whatsapp-bridge/bridge.log | tail -30

# Restart bridge
systemctl restart whatsapp-bridge

# Test health
curl http://localhost:8083/health | jq .

# List monitored groups
curl http://localhost:8083/groups | jq .

# Reload groups from database
curl http://localhost:8083/reload-groups
```

```bash
# Run locally on Velocity as user hein (passwordless sudo)

# Check LEGACY wa-feedback (avoid new usage)
sudo systemctl status wa-feedback.service
```

## Troubleshooting

### Issue: Acknowledgments not sending
**Symptoms:** Field agent sends DR, no reply received

**Diagnosis:**
```bash
# SSH to VPS
ssh root@72.61.197.178

# Check bridge logs
grep -E 'ACK|ERROR|FAILED' /opt/whatsapp-bridge/bridge.log | tail -20

# Check health
curl http://localhost:8083/health

# Test acknowledgment API directly
curl -X POST https://app.fibreflow.app/api/activate/dr-acknowledgment \
  -H "Content-Type: application/json" \
  -d '{"dropNumber":"DR1730468","project":"Lawley"}'
```

**Common causes:**
- FibreFlow API unreachable
- OneMap timeout (5 second limit)
- Bridge service crashed
- WhatsApp session disconnected

**Fix:**
```bash
# Restart bridge
systemctl restart whatsapp-bridge

# Check if reconnected
tail -20 /opt/whatsapp-bridge/bridge.log
```

### Issue: Feedback not sending
**Symptoms:** "Send Feedback" button fails

**Diagnosis:**
```bash
# Check VPS bridge health
curl http://72.61.197.178:8083/health

# Check FibreFlow API logs (run locally on Velocity)
journalctl -u fibreflow -n 50
```

**Fix:**
```bash
# Restart VPS bridge
ssh root@72.61.197.178 "systemctl restart whatsapp-bridge"
```

### Issue: WhatsApp disconnected
**Symptoms:** All WhatsApp operations fail, bridge.log shows reconnection attempts

**Diagnosis:**
```bash
ssh root@72.61.197.178
tail -50 /opt/whatsapp-bridge/bridge.log | grep -E 'connect|disconnect|error'
curl http://localhost:8083/health | jq '.needs_auth, .pairing_state'
```

**Fix:**
1. Restart the bridge service: `systemctl restart whatsapp-bridge`
2. If `needs_auth: true`, may need to re-scan QR code (contact admin)

### Issue: Messages going to wrong group
**Check group configuration:**
1. Neon DB: `wa_monitored_groups` table
2. Reload groups: `curl http://72.61.197.178:8083/reload-groups`

## Adding a New WhatsApp Group

### Option A: WA Portal UI (Recommended)

Navigate to **Communications → WhatsApp → Groups tab**

1. Click **"Add Group"**
2. Fill in:
   - Group JID (see below for how to find it)
   - Group Name
   - Project Name
   - Type (dr_submission, maintenance, admin, pre_provision)
   - Description (optional)
3. Click **Save**
4. Bridge auto-reloads groups (no restart needed)

### Option B: Direct Database

#### Step 1: Add bridge phone to WhatsApp group
Add **+27 63 841 2276** to the WhatsApp group

#### Step 2: Find the Group JID
```bash
# Send a message in the group, then check VPS logs
ssh root@72.61.197.178 "tail -20 /opt/whatsapp-bridge/bridge.log | grep 'Storing message'"
# Look for: 📝 Storing message from 120363XXXXXXXXXX@g.us
```

#### Step 3: Add to database
```sql
INSERT INTO wa_monitored_groups
  (group_jid, group_name, project_name, group_type, description, is_active)
VALUES
  ('120363XXXXXXXXXX@g.us', 'Group Name', 'Project', 'dr_submission', 'Description', true);
```

#### Step 4: Reload groups
```bash
curl http://72.61.197.178:8083/reload-groups
```

## Security Considerations

1. **Phone numbers stored as JIDs** - Not plain numbers
2. **Messages stored in SQLite** - Local backup on VPS
3. **Neon connection uses SSL** - `sslmode=require`
4. **VPS SSH access** - Key-based authentication only
5. **No credentials in code** - Uses environment variables

## Related Skills

- `/activate` - DR photo review and VLM categorization
- `/vlm` - VLM infrastructure and configuration
- `/wa-monitor` - WA Monitor dashboard troubleshooting
- `/deploy` - Deployment procedures
- `civil-qa.md` - Construction QA (pole install sessions link to QA reviews)

## Version History

| Date | Change |
|------|--------|
| Mar 02, 2026 | **Pole Install ACK Pipeline** — real-time VLM classify + session track + WA ACK for civil groups |
| Mar 02, 2026 | Bridge downloads civil/optical photos inline (base64 in payload) |
| Mar 02, 2026 | Added Tonga project + 2 civil groups (11 monitored total) |
| Mar 02, 2026 | Migration 229: pole_install_sessions table |
| Feb 20, 2026 | Updated to VPS unified bridge architecture (v2.0.0) |
| Feb 20, 2026 | Updated phone to +27 63 841 2276 |
| Feb 20, 2026 | Added 9 monitored groups with types |
| Feb 20, 2026 | Marked wa-feedback as LEGACY |
| Jan 18, 2026 | Original skill document created |
