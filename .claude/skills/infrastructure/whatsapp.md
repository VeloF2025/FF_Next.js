# WhatsApp Infrastructure Skill

## Overview

Comprehensive documentation of the WhatsApp communication infrastructure for FibreFlow DR photo processing.

## Quick Reference

| Component | Port | Service | Location |
|-----------|------|---------|----------|
| **Go WhatsApp Bridge** | 8083 | `whatsapp-bridge.service` | `/home/louis/whatsapp-bridge-go/` |
| **WA Feedback Service** | 8090 | Docker: `drop-number-api` | Docker container |
| **Node.js WA Feedback** | 8092 | `wa-feedback.service` | `/home/louis/wa-feedback-service/` |
| **VLM Server** | 8100 | `vllm-qwen.service` | systemd service |
| **OneMap API** | 8003 | Docker: `dr-photo-api` | Docker container |

## Phone Numbers

| Purpose | Number | Format | Notes |
|---------|--------|--------|-------|
| **Primary Bridge** | +27 71 179 6125 | `27711796125@s.whatsapp.net` | Go Bridge - receives DRs, sends acks |
| **Sender (Mentions)** | +27 71 155 8396 | N/A | Sends feedback with @mentions |

## WhatsApp Groups (Projects)

| Project | Group JID | Description |
|---------|-----------|-------------|
| **Lawley** | `120363418298130331@g.us` | Lawley Activation 3 |
| **Mohadin** | `120363421532174586@g.us` | Mohadin Activations |
| **Velo Test** | `120363421664266245@g.us` | Testing group |
| **Mamelodi** | `120363408849234743@g.us` | Mamelodi POP1 Activations |
| **Marketing** | `120363422808656601@g.us` | Lawley Marketing Activations |

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        VELOCITY SERVER (100.96.203.105)                  │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌──────────────────┐    ┌──────────────────┐    ┌──────────────────┐  │
│  │  WhatsApp User   │    │  Go WA Bridge    │    │  FibreFlow API   │  │
│  │  (Field Agent)   │───▶│  (Port 8083)     │───▶│  (vf.fibreflow)  │  │
│  │                  │    │                  │    │                  │  │
│  │  Sends: DR123456 │    │  - whatsmeow lib │    │  process-new-dr  │  │
│  └──────────────────┘    │  - SQLite store  │    │  dr-acknowledgment│  │
│         ▲                │  - Neon DB write │    └────────┬─────────┘  │
│         │                └────────┬─────────┘             │            │
│         │                         │                       │            │
│         │    ┌────────────────────┼───────────────────────┘            │
│         │    │                    │                                     │
│         │    ▼                    ▼                                     │
│  ┌──────┴───────────┐    ┌──────────────────┐    ┌──────────────────┐  │
│  │  Threaded Reply  │    │   OneMap API     │    │  Neon Database   │  │
│  │  (Acknowledgment)│    │  (Port 8003)     │    │  (PostgreSQL)    │  │
│  │                  │    │                  │    │                  │  │
│  │  📸 DR123456     │    │  Photo storage   │    │  qa_photo_reviews│  │
│  │  ✅ Photos: 12   │    │  Serial lookup   │    │  dr_photo_unified│  │
│  │  ✅ ONT: ABC123  │    │                  │    │  wa_monitor_drops│  │
│  └──────────────────┘    └──────────────────┘    └──────────────────┘  │
│                                                                          │
│  ┌──────────────────┐    ┌──────────────────┐                          │
│  │  WA Feedback     │    │  VLM Server      │                          │
│  │  (Port 8090)     │    │  (Port 8100)     │                          │
│  │                  │    │                  │                          │
│  │  QA Review       │    │  Qwen3-VL-8B     │                          │
│  │  Feedback msgs   │    │  Photo categorize│                          │
│  └──────────────────┘    └──────────────────┘                          │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

## Message Flow

### 1. Incoming DR Message (Field Agent → System)

```
Field Agent sends "DR1730468" to WhatsApp group
         │
         ▼
Go Bridge receives via whatsmeow event handler
         │
         ├──▶ Extract DR pattern: DR[0-9]+
         │
         ├──▶ Write to SQLite (local messages.db)
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
Send threaded reply to original message
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
POST /api/wa-monitor-send-feedback
         │
         ├──▶ Get drop details from database
         │
         ├──▶ Determine WhatsApp group by project
         │
         ├──▶ Format feedback message
         │
         ▼
If sender_phone exists:
    └──▶ Send via WA Sender (port 8081) with @mention
Else:
    └──▶ Send via WA Bridge (port 8083) without @mention
         │
         ▼
Update feedback_sent timestamp in database
```

## Go WhatsApp Bridge

### Location
```
/home/louis/whatsapp-bridge-go/
├── main.go              # Main application (70KB)
├── whatsapp-bridge      # Compiled binary
├── bridge.log           # Application logs
├── store/
│   ├── messages.db      # SQLite message history
│   ├── whatsapp.db      # whatsmeow session data
│   └── store.db         # Additional storage
├── go.mod               # Go module definition
└── bridge_db_proxy.py   # Database proxy script
```

### Key Features
- Uses `whatsmeow` library (go.mau.fi/whatsmeow)
- Stores session in SQLite (`whatsapp.db`)
- Writes directly to Neon PostgreSQL
- Optional Google Sheets sync (credentials not configured)
- HTTP API on port 8083

### Configuration (in main.go)
```go
var PROJECTS = map[string]map[string]string{
    "Lawley": {
        "group_jid": "120363418298130331@g.us",
        "project_name": "Lawley",
    },
    // ... other projects
}

const NEON_DB_URL = "postgresql://neondb_owner:$NEON_DB_PASSWORD@..."
const FIBREFLOW_API_URL = "https://vf.fibreflow.app/api/activate/process-new-dr"
const FIBREFLOW_ACK_API_URL = "https://vf.fibreflow.app/api/activate/dr-acknowledgment"
```

### API Endpoints
| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/send` | POST | Send message to group |
| `/api/download` | POST | Download media |

### Service Management
```bash
# Service config
/etc/systemd/system/whatsapp-bridge.service

# Check status
echo '$VELO_SSH_PASSWORD' | sudo -S systemctl status whatsapp-bridge.service

# Restart
echo '$VELO_SSH_PASSWORD' | sudo -S systemctl restart whatsapp-bridge.service

# View logs
tail -f /home/louis/whatsapp-bridge-go/bridge.log
```

## WA Feedback Service

### Node.js Service (Port 8092 - systemd config, 8090 default)
```
/home/louis/wa-feedback-service/
├── wa-feedback-service.js   # Main application
├── package.json
└── node_modules/
```

### Key Endpoints
```javascript
// Health check
GET /health
// Returns: { status: "healthy", service: "wa-feedback-service" }

// Send feedback
POST /send-feedback
// Body: { message, dropId, drNumber, recipient, useMention }
```

### Docker Container (Port 8090)
The `drop-number-api` container also runs on port 8090:
```bash
docker inspect drop-number-api
# Health endpoint returns: { status: "healthy", database: "connected" }
```

## Database Tables

### qa_photo_reviews
Primary table for WhatsApp QA drops:
```sql
CREATE TABLE qa_photo_reviews (
  id UUID PRIMARY KEY,
  drop_number TEXT UNIQUE NOT NULL,
  project TEXT,
  user_name TEXT,
  sender_phone VARCHAR(20),  -- WhatsApp sender JID
  submitted_by TEXT,

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

### dr_photo_unified_reviews
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

### wa_monitor_drops
Legacy/secondary drop tracking:
```sql
CREATE TABLE wa_monitor_drops (
  id UUID PRIMARY KEY,
  drop_number VARCHAR(20) UNIQUE,
  project VARCHAR(100),
  sender_phone VARCHAR(20),
  created_at TIMESTAMP DEFAULT NOW()
);
```

## FibreFlow API Endpoints

### DR Acknowledgment
```
POST /api/activate/dr-acknowledgment
```
Called by Go Bridge to get acknowledgment data:
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
Called by Dashboard to send QA feedback:
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
    sentAt: "2026-01-18T..."
  }
}
```

### Process New DR
```
POST /api/activate/process-new-dr
```
Called to validate and process new DR submissions.

## SSH Commands

```bash
# Connect to server
ssh velo@100.96.203.105  # Password: $VELO_SSH_PASSWORD

# Check all WhatsApp services
echo '$VELO_SSH_PASSWORD' | sudo -S systemctl status whatsapp-bridge.service
echo '$VELO_SSH_PASSWORD' | sudo -S systemctl status wa-feedback.service

# View bridge logs
tail -f /home/louis/whatsapp-bridge-go/bridge.log

# Filter for DR processing
grep -E 'DR[0-9]+|Ack|acknowledgment' /home/louis/whatsapp-bridge-go/bridge.log | tail -30

# Restart bridge
echo '$VELO_SSH_PASSWORD' | sudo -S systemctl restart whatsapp-bridge.service

# Check ports
netstat -tlnp | grep -E '(8081|8083|8090|8092)'

# Docker services
docker ps | grep -E '(drop-number|dr-photo)'
```

## Troubleshooting

### Issue: Acknowledgments not sending
**Symptoms:** Field agent sends DR, no reply received

**Diagnosis:**
```bash
# Check bridge logs for errors
grep -E 'ACK|ERROR|FAILED' /home/louis/whatsapp-bridge-go/bridge.log | tail -20

# Test acknowledgment API directly
curl -X POST https://vf.fibreflow.app/api/activate/dr-acknowledgment \
  -H "Content-Type: application/json" \
  -d '{"dropNumber":"DR1730468","project":"Lawley"}'
```

**Common causes:**
- FibreFlow API unreachable
- OneMap timeout (5 second limit)
- Bridge service crashed

**Fix:**
```bash
echo '$VELO_SSH_PASSWORD' | sudo -S systemctl restart whatsapp-bridge.service
```

### Issue: Feedback not sending
**Symptoms:** "Send Feedback" button fails

**Diagnosis:**
```bash
# Check wa-feedback health
curl http://100.96.203.105:8090/health

# Check Docker container
docker logs drop-number-api --tail 50
```

**Fix:**
```bash
# Restart wa-feedback service
echo '$VELO_SSH_PASSWORD' | sudo -S systemctl restart wa-feedback.service

# Or restart Docker container
docker restart drop-number-api
```

### Issue: WhatsApp disconnected
**Symptoms:** All WhatsApp operations fail, bridge.log shows reconnection attempts

**Diagnosis:**
```bash
# Check bridge status
tail -50 /home/louis/whatsapp-bridge-go/bridge.log | grep -E 'connect|disconnect|error'
```

**Fix:**
1. Restart the bridge service
2. If persistent, may need to re-scan QR code (rare)

### Issue: Messages going to wrong group
**Check project mapping in:**
1. Go bridge: `/home/louis/whatsapp-bridge-go/main.go` - `PROJECTS` map
2. FibreFlow: `pages/api/wa-monitor-send-feedback.ts` - `PROJECT_GROUPS`

Both must have matching JIDs for each project.

## Adding a New WhatsApp Group

### 1. Update Go Bridge
Edit `/home/louis/whatsapp-bridge-go/main.go`:
```go
var PROJECTS = map[string]map[string]string{
    // ... existing projects ...
    "NewProject": {
        "group_jid":          "123456789012345@g.us",  // Get from WhatsApp
        "project_name":       "NewProject",
        "group_description": "New Project Activations",
    },
}
```

### 2. Rebuild and restart
```bash
cd /home/louis/whatsapp-bridge-go
go build -o whatsapp-bridge main.go
echo '$VELO_SSH_PASSWORD' | sudo -S systemctl restart whatsapp-bridge.service
```

### 3. Update FibreFlow API
Edit `pages/api/wa-monitor-send-feedback.ts`:
```typescript
const PROJECT_GROUPS: Record<string, { jid: string; name: string }> = {
  // ... existing projects ...
  'NewProject': {
    jid: '123456789012345@g.us',
    name: 'New Project Activations'
  }
};
```

### 4. Deploy FibreFlow
```bash
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 \
  "cd /home/louis/apps/fibreflow && git pull && npm ci && npm run build && echo '$VELO_SSH_PASSWORD' | sudo -S systemctl restart fibreflow.service"
```

## Security Considerations

1. **Phone numbers stored as JIDs** - Not plain numbers
2. **Messages stored in SQLite** - Local backup on server
3. **Neon connection uses SSL** - `sslmode=require`
4. **Arcjet protection** on feedback API - Rate limiting, bot detection
5. **No credentials in code** - Uses environment variables

## Related Skills

- `/activate` - DR photo review and VLM categorization
- `/vlm` - VLM infrastructure and configuration
- `/wa-monitor` - WA Monitor dashboard troubleshooting
- `/deploy` - Deployment procedures

## Version History

| Date | Change |
|------|--------|
| Jan 16, 2026 | wa-feedback service created (port 8090) |
| Jan 18, 2026 | Health check fixed for wa-feedback |
| Jan 18, 2026 | This skill document created |
