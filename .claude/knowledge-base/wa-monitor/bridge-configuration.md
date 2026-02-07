# Go WhatsApp Bridge Configuration

> Deep reference for bridge URL configuration, compilation, and deployment

## URL Configuration (2026-01-31)

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

### History

Before 2026-01-31, all 4 URLs were hardcoded `const` values pointing to staging (`vf.fibreflow.app`). The `FIBREFLOW_URL` env var existed in the systemd service but the Go code never called `os.Getenv()` to read it.

### Verification

To verify which URLs are compiled into the binary:
```bash
strings /opt/whatsapp-bridge/whatsapp-bridge | grep fibreflow.app
# Should show: app.fibreflow.app (1 occurrence)
# Should NOT show: vf.fibreflow.app (0 occurrences)

strings /opt/whatsapp-bridge/whatsapp-bridge | grep FIBREFLOW_URL
# Should show: FIBREFLOW_URL (confirms env var is read)
```

## Message Routing by Group Type

```
handleMessage()
  ├── groupType == "dr_submission"
  │     ├── processDropNumbers()  → DR regex extraction → API calls
  │     ├── sendDRAcknowledgment() → /api/activate/dr-acknowledgment
  │     └── syncToFibreFlow()     → /api/activate/process-new-dr
  │
  ├── groupType == "maintenance"
  │     ├── processDropNumbers()  → SKIPS (returns early)
  │     └── forwardToMaintenanceAPI() → /api/maintenance/wa-message
  │
  └── groupType == "admin"
        └── Command bot only (wa-command-bot:8086)
```

**Critical:** `processDropNumbers()` must check `groupType` and return early for maintenance groups. Without this check, activation ack messages ("DR1234567 Received!") get sent to maintenance groups.

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
- Server: Velocity (`100.96.203.105`)
- Path: `/home/louis/whatsapp-bridge-go/main.go`
- User: `louis` (or compile with `sudo`)

### Compile
```bash
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105
cd /home/louis/whatsapp-bridge-go
go build -o whatsapp-bridge .
```

### Deploy (SCP Relay)
Velocity and VPS cannot SSH to each other. Must relay via local machine:
```bash
# 1. Copy from Velocity to local
sshpass -p '$VELO_SSH_PASSWORD' scp velo@100.96.203.105:/home/louis/whatsapp-bridge-go/whatsapp-bridge /tmp/whatsapp-bridge

# 2. Copy from local to VPS
scp /tmp/whatsapp-bridge root@72.61.197.178:/opt/whatsapp-bridge/whatsapp-bridge

# 3. Restart on VPS
ssh root@72.61.197.178 "systemctl restart whatsapp-bridge"

# 4. Verify
ssh root@72.61.197.178 "systemctl status whatsapp-bridge && tail -5 /opt/whatsapp-bridge/bridge.log"
```

### Shell Escaping Pitfall
When editing Go source via SSH, sed and heredocs lose double quotes. Use base64-encoded Python scripts:
```bash
# Write Python fix locally
cat > /tmp/fix.py << 'PYEOF'
with open('/home/louis/whatsapp-bridge-go/main.go', 'r') as f:
    content = f.read()
content = content.replace('old_string', 'new_string')
with open('/home/louis/whatsapp-bridge-go/main.go', 'w') as f:
    f.write(content)
PYEOF

# Base64 encode and execute remotely
B64=$(base64 -w0 /tmp/fix.py)
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "echo '$B64' | base64 -d | python3"
```

## Systemd Service (VPS)

File: `/etc/systemd/system/whatsapp-bridge.service`

Key environment variables:
- `FIBREFLOW_URL=https://app.fibreflow.app`
- `DATABASE_URL=postgresql://...` (Neon DB connection)

Binary: `/opt/whatsapp-bridge/whatsapp-bridge`
Logs: `/opt/whatsapp-bridge/bridge.log`
