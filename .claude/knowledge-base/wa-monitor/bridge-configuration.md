# Go WhatsApp Bridge Configuration

> **Last updated:** 2026-05-26  
> **Architecture:** VPS unified bridge v2.0.0

## Overview

Deep reference for VPS bridge configuration, compilation, and deployment. The bridge handles ALL WhatsApp operations from a single VPS service.

## URL Configuration

Bridge API target URLs are driven by the `FIBREFLOW_URL` environment variable:

```go
func getEnvOrDefault(key, defaultVal string) string {
    if val := os.Getenv(key); val != "" {
        return val
    }
    return defaultVal
}

var fibreflowBaseURL = getEnvOrDefault("FIBREFLOW_URL", "https://app.fibreflow.app")
var FIBREFLOW_API_URL = fibreflowBaseURL + "/api/activate/process-new-dr"
var FIBREFLOW_ACK_API_URL = fibreflowBaseURL + "/api/activate/dr-acknowledgment"
var MAINTENANCE_WA_API_URL = fibreflowBaseURL + "/api/maintenance/wa-message"
```

The systemd service sets: `Environment=FIBREFLOW_URL=https://app.fibreflow.app`

### Verification

To verify which URLs are compiled into the binary:
```bash
ssh root@72.61.197.178 "strings /opt/whatsapp-bridge/whatsapp-bridge | grep fibreflow.app"
# Should show: app.fibreflow.app (1 occurrence)
# Should NOT show: vf.fibreflow.app (0 occurrences)

ssh root@72.61.197.178 "strings /opt/whatsapp-bridge/whatsapp-bridge | grep FIBREFLOW_URL"
# Should show: FIBREFLOW_URL (confirms env var is read)
```

## Message Routing by Group Type

```
handleMessage()
  ├── groupType == "dr_submission"          (the 10 activation feeds)
  │     ├── processDropNumbers()  → DR regex extraction → QA review + photo
  │     ├── sendDRAcknowledgment() → /api/activate/dr-acknowledgment   ← ACK SENT
  │     └── syncToFibreFlow()     → /api/activate/process-new-dr
  │
  ├── groupType == "maintenance"
  │     ├── processDropNumbers()  → SKIPS (returns early — no DR processing)
  │     └── forwardToMaintenanceAPI() → /api/maintenance/wa-message
  │
  ├── groupType == "pre_provision" / "civil" / "optical"
  │     ├── processDropNumbers()  → DR still extracted, QA review + photo stored
  │     ├── (NO ACK — see allowlist below)
  │     └── civil/optical also → forwardToFieldOpsAPI() (photo_base64)
  │
  └── groupType == "admin"
        ├── processDropNumbers()  → DR still extracted + stored if a DR appears
        ├── (NO ACK)
        └── Command bot only (wa-command-bot:8086)
```

**Critical — ACK is an allowlist, not a denylist (2026-05-26).** `sendDRAcknowledgment()`
fires **only** when `groupType == "dr_submission"`. The gate is:

```go
if groupType == "dr_submission" {
    sendDRAcknowledgment(...)
} else {
    fmt.Printf("Skipping ACK for %s (group_type=%s, %s)\n", dropNumber, groupType, chatJID)
}
```

This deliberately captures DRs/ONT serials that surface in *any* monitored group
(pre_provision, civil, optical, admin) — they still create/update a `qa_photo_reviews`
row so the data feeds DR history and ONT lifecycle — but **no "Received!" ACK reply is
sent** outside the 10 `dr_submission` activation feeds. (Before this date the gate was
`!= "pre_provision"`, which leaked ACKs into civil/optical/admin groups whenever a DR was
posted there.) `maintenance` returns early in `processDropNumbers()` so it neither stores
nor ACKs.

**Source-group traceability:** `createQAPhotoReview()` writes `qa_photo_reviews.wa_group_jid =
chatJID` on every new capture, and the resubmission UPDATE path backfills it
(`COALESCE(NULLIF(wa_group_jid,''), $chatJID)`) plus records the source group in the
comment trail — so you can tell which group each DR sighting came from.

## Maintenance API Authentication

The `/api/maintenance/wa-message` endpoint uses bridge secret authentication:
- Secret: `fibreflow-bridge-2026` (same as `/api/communications/whatsapp/inbound`)
- Passed in request body as `secret` field
- Does NOT use `withAuth` (bridge has no user session)

Known maintenance group JIDs:
- `120363424360693693@g.us` — Mohadin Maintenance
- `120363423947610853@g.us` — Lawley Maintenance

## Compilation & Deployment

### Source Location
- **Server**: Velocity (`100.96.203.105`)
- **Path**: `/home/velo/whatsapp-bridge/main.go`
- **User**: `velo`

### Target Location
- **Server**: VPS (`72.61.197.178`)
- **Path**: `/opt/whatsapp-bridge/whatsapp-bridge`
- **Service**: `whatsapp-bridge.service`

### Compile on Velocity (run locally)
```bash
cd /home/velo/whatsapp-bridge
go build -o whatsapp-bridge .
```

### Deploy to VPS

**From Velocity (direct SCP to VPS):**
```bash
# 1. Copy compiled binary to VPS
scp /home/velo/whatsapp-bridge/whatsapp-bridge root@72.61.197.178:/opt/whatsapp-bridge/whatsapp-bridge

# 2. Restart on VPS
ssh root@72.61.197.178 "systemctl restart whatsapp-bridge"

# 3. Verify
ssh root@72.61.197.178 "systemctl status whatsapp-bridge && tail -5 /opt/whatsapp-bridge/bridge.log"
```

## Systemd Service (VPS)

**File**: `/etc/systemd/system/whatsapp-bridge.service`

```ini
[Unit]
Description=WhatsApp Bridge v2.0
After=network.target

[Service]
Type=simple
ExecStart=/opt/whatsapp-bridge/whatsapp-bridge
WorkingDirectory=/opt/whatsapp-bridge
Environment=FIBREFLOW_URL=https://app.fibreflow.app
Environment=DATABASE_URL=postgresql://neondb_owner:...@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require
Environment=SENDER_URL=http://localhost:1
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

**Key Environment Variables:**
- `FIBREFLOW_URL` - FibreFlow API base URL
- `DATABASE_URL` - Neon PostgreSQL connection string
- `SENDER_URL` - Set to `http://localhost:1` (disabled, bridge sends directly)

**Binary**: `/opt/whatsapp-bridge/whatsapp-bridge`  
**Logs**: `/opt/whatsapp-bridge/bridge.log`  
**Store**: `/opt/whatsapp-bridge/store/` (SQLite session + message DB)  
**Version**: 2.0.0  
**Phone**: +27 63 841 2276 (27638412276@s.whatsapp.net)

### Service Commands

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

# Enable on boot
systemctl enable whatsapp-bridge
```

## Group Configuration

Groups are loaded from `wa_monitored_groups` table in Neon database.

**Current Count:** 9 groups (as of Feb 2026)

**Group Types:**
- `dr_submission` (4) - DR photo submissions
- `maintenance` (2) - Maintenance photos
- `pre_provision` (1) - Pre-provisioning tasks
- `admin` (1) - Admin commands (for wa-command-bot)

**Reload without restart:**
```bash
curl http://72.61.197.178:8083/reload-groups
```

**List current groups:**
```bash
curl http://72.61.197.178:8083/groups | jq .
```

**Add new group (via database):**
```sql
INSERT INTO wa_monitored_groups
  (group_jid, group_name, project_name, group_type, description, is_active)
VALUES
  ('120363XXXXXXXXXX@g.us', 'Group Name', 'Project', 'dr_submission', 'Description', true);
```

Then reload: `curl http://72.61.197.178:8083/reload-groups`

## Unified Bridge Architecture (v2.0.0)

**Current Architecture (Feb 2026):**

```
VPS: 72.61.197.178
Phone: +27 63 841 2276
    │
    └─→ whatsapp-bridge.service (Port 8083)
            ├─→ RECEIVES messages from 9 monitored groups
            ├─→ SENDS DR acknowledgments directly
            ├─→ SENDS QA feedback directly
            ├─→ SENDS maintenance messages directly
            └─→ Writes to Neon PostgreSQL + SQLite store
```

**Key Features:**
- Single service handles ALL WhatsApp operations
- No separate sender service needed
- Direct message sending via whatsmeow library
- Unified phone number for all operations
- Hot-reload groups from database without restart

**Previous Architecture** (deprecated as of Feb 2026):
- ~~whatsapp-bridge.service on port 8083 (receive only)~~ - Now unified
- ~~Two different phone numbers~~ - Now single number

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Service health, connection status, monitored groups |
| `/groups` | GET | List all monitored groups from database |
| `/reload-groups` | GET | Reload groups from Neon (no restart) |
| `/send-message` | POST | Send message to group |

**Health Response:**
```json
{
  "status": "ok",
  "service": "whatsapp-bridge",
  "version": "2.0.0",
  "connected": true,
  "phone": "27638412276@s.whatsapp.net",
  "monitored_groups": 9,
  "pairing_state": "connected",
  "needs_auth": false
}
```

**Send Message Request:**
```json
{
  "group_jid": "120363408849234743@g.us",
  "recipient_jid": "27715844472@s.whatsapp.net",
  "message": "DR1234567 - QA review complete!"
}
```

## Database Connection

**Neon PostgreSQL:**
```
Host: ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech
Database: neondb
SSL: Required
Connection String: In DATABASE_URL env var
```

**Tables Used:**
- `wa_monitored_groups` - Group configuration (loaded on startup + reload)
- `qa_photo_reviews` - DR submissions and QA status
- `dr_photo_unified_reviews` - VLM categorization data

**SQLite Store (local on VPS):**
```
/opt/whatsapp-bridge/store/whatsapp.db - whatsmeow session data
/opt/whatsapp-bridge/store/messages.db - Message history backup
```

## Troubleshooting

### Binary Not Updating After Deployment

**Symptoms:** Changes to main.go not reflected after build + deploy + restart

**Diagnosis:**
```bash
# Check binary modification time
ssh root@72.61.197.178 "ls -l /opt/whatsapp-bridge/whatsapp-bridge"

# Check if service is using the binary
ssh root@72.61.197.178 "systemctl status whatsapp-bridge | grep PID"

# Verify compiled URLs
ssh root@72.61.197.178 "strings /opt/whatsapp-bridge/whatsapp-bridge | grep fibreflow"
```

**Fix:**
1. Ensure binary was actually copied: `scp` with `-v` verbose flag
2. Restart service: `systemctl restart whatsapp-bridge`
3. Check process: `ps aux | grep whatsapp-bridge`
4. If still old, try full stop/start: `systemctl stop whatsapp-bridge && systemctl start whatsapp-bridge`

### Groups Not Loading After Database Update

**Symptoms:** Added group to wa_monitored_groups but bridge doesn't see it

**Fix:**
```bash
# Reload groups from database (no restart needed)
curl http://72.61.197.178:8083/reload-groups

# Verify group appears
curl http://72.61.197.178:8083/groups | jq '.[] | select(.project_name=="YourProject")'

# Check logs for reload confirmation
ssh root@72.61.197.178 "tail -20 /opt/whatsapp-bridge/bridge.log | grep reload"
```

### Connection Lost / Needs Re-pairing

**Symptoms:** Health check shows `needs_auth: true` or `connected: false`

**Diagnosis:**
```bash
ssh root@72.61.197.178
curl http://localhost:8083/health | jq '.connected, .needs_auth, .pairing_state'
tail -50 /opt/whatsapp-bridge/bridge.log | grep -i "pair\|connect\|session"
```

**Fix:**
1. Check logs for pairing code
2. If code present, link device on phone (+27 63 841 2276)
3. If no code, restart service: `systemctl restart whatsapp-bridge`
4. Monitor logs: `tail -f /opt/whatsapp-bridge/bridge.log`

## Security Notes

1. **VPS Access:** SSH key-based only (root@72.61.197.178)
2. **Database:** SSL required (`sslmode=require`)
3. **Credentials:** Never hardcode in source, use env vars
4. **Store Directory:** Contains WhatsApp session secrets, protect access
5. **Bridge Secret:** Used for maintenance API auth (`fibreflow-bridge-2026`)

## Version History

| Date | Change |
|------|--------|
| Feb 20, 2026 | Unified VPS architecture, v2.0.0, single phone number |
| Jan 31, 2026 | URL configuration via environment variables |
| Jan 26, 2026 | Maintenance group routing added |
| Jan 18, 2026 | Initial bridge documentation |
