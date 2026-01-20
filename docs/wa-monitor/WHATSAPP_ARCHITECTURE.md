# WhatsApp Architecture - Unified Sender System

**Date Created:** November 11, 2025
**Last Updated:** January 20, 2026
**Status:** Production (Unified 082 Number for All Messages)

---

## Current Architecture (Jan 2026)

### Production Setup on Velocity Server (100.96.203.105)

```
Phone Number: +27 82 418 9511 (Unified for ALL messages)
    │
    ├─→ whatsapp-sender.service (Port 8081)
    │       └─→ SENDS feedback with @mentions
    │       └─→ SENDS DR acknowledgments (via Bridge proxy)
    │       └─→ DELETE sent messages (within 1 hour)
    │       └─→ Location: /home/louis/whatsapp-sender/
    │
    └─→ whatsapp-bridge.service (Port 8083)
            └─→ LISTENS to groups (receives DR submissions)
            └─→ ROUTES acks through Sender API (same number)
            └─→ Stores messages in SQLite
            └─→ Location: /home/louis/whatsapp-bridge-go/

Monitor Services (Python)
    ├─→ wa-monitor-prod (Port 8090) - scans 4 projects
    └─→ wa-monitor-dev - development testing

Next.js App (Port 3005)
    └─→ /api/activate/send-feedback → http://localhost:8081/send-message
    └─→ /api/activate/dr-acknowledgment → (Bridge routes through Sender)
```

**Key Change (Jan 2026):** Bridge now routes acknowledgments through Sender API, so ALL messages come from the same 082 number.

---

## Service Details

### Sender Service (Port 8081)

**Location:** `/home/louis/whatsapp-sender/`
**Service:** `whatsapp-sender.service`
**Phone:** +27 82 418 9511

**Endpoints:**
| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check with connection status |
| `/send-message` | POST | Send message with @mention, returns `message_id` |
| `/delete-message` | POST | Delete a sent message (within 1 hour) |
| `/list-recent` | GET | List deletable messages from last hour |

**Send Message Request:**
```json
{
  "group_jid": "120363408849234743@g.us",
  "recipient_jid": "27715844472@s.whatsapp.net",
  "message": "DR1234567 - Upload complete!"
}
```

**Send Message Response:**
```json
{
  "success": true,
  "message_id": "3EB0BE470D512FA941A695",
  "message": "Message sent successfully"
}
```

**Delete Message Request:**
```json
{
  "message_id": "3EB0BE470D512FA941A695",
  "group_jid": "120363408849234743@g.us"
}
```

### Bridge Service (Port 8083)

**Location:** `/home/louis/whatsapp-bridge-go/`
**Service:** `whatsapp-bridge.service`
**Phone:** +27 82 418 9511 (same as Sender - unified number)

**Key Files:**
- `main.go` - Main bridge logic, message handling
- `sender_proxy.go` - Routes acks through Sender API with deduplication

**Ack Message Filter (prevents infinite loop):**
```go
// Skip messages that look like our own ack messages
if strings.Contains(content, "Received!") ||
   strings.Contains(content, "QA review will follow") ||
   strings.HasPrefix(content, "@") {
    fmt.Printf("Skipping ack-like message: %s...\n", content[:50])
    return
}
```

**Deduplication Cache:**
- 10-minute TTL for processed messages
- Key format: `groupJID|recipientJID|msgPrefix30chars`

---

## Monitored WhatsApp Groups

| Project | Group JID | Status |
|---------|-----------|--------|
| Lawley | `120363418298130331@g.us` | Active |
| Mohadin | `120363421532174586@g.us` | Active |
| Velo Test | `120363421664266245@g.us` | Active |
| Mamelodi | `120363408849234743@g.us` | Active |

---

## Service Management

### SSH Access
```bash
ssh velo@100.96.203.105  # Password: velo2026
```

### Check Status
```bash
echo 'velo2026' | sudo -S systemctl status whatsapp-sender.service whatsapp-bridge.service
```

### View Logs
```bash
# Sender logs
tail -f /home/louis/whatsapp-sender/sender.log

# Bridge logs
tail -f /home/louis/whatsapp-bridge-go/bridge.log
```

### Restart Services
```bash
echo 'velo2026' | sudo -S systemctl restart whatsapp-sender.service whatsapp-bridge.service
```

### Test Health
```bash
curl http://localhost:8081/health  # Sender
curl http://localhost:8083/health  # Bridge (may return 404, check logs)
```

---

## Troubleshooting

### Messages Not Sending

1. **Check service status:**
   ```bash
   echo 'velo2026' | sudo -S systemctl status whatsapp-sender.service
   ```

2. **Check sender health:**
   ```bash
   curl http://localhost:8081/health
   # Should show: {"connected":true,"service":"whatsapp-sender","status":"ok"}
   ```

3. **Check logs for errors:**
   ```bash
   tail -50 /home/louis/whatsapp-sender/sender.log
   ```

4. **Restart if needed:**
   ```bash
   echo 'velo2026' | sudo -S systemctl restart whatsapp-sender.service
   ```

### Duplicate Messages

**Symptoms:** Same ack sent multiple times

**Cause:** Bridge processing its own ack messages as new DR submissions

**Fix:** Ensure ack filter is in `main.go`:
```go
// Skip messages that look like our own ack messages
if strings.Contains(content, "Received!") ||
   strings.Contains(content, "QA review will follow") ||
   strings.HasPrefix(content, "@") {
    return
}
```

**Rebuild if needed:**
```bash
cd /home/louis/whatsapp-bridge-go
go build -o whatsapp-bridge *.go
echo 'velo2026' | sudo -S systemctl restart whatsapp-bridge.service
```

### Delete Sent Messages

**Within 1 hour of sending:**
```bash
# List recent deletable messages
curl http://localhost:8081/list-recent

# Delete specific message
curl -X POST http://localhost:8081/delete-message \
  -H "Content-Type: application/json" \
  -d '{"message_id":"3EB0xxx","group_jid":"120363408849234743@g.us"}'
```

### Session/Pairing Issues

If sender loses connection:
```bash
# Check if device is logged in
tail -20 /home/louis/whatsapp-sender/sender.log

# If pairing code shown, link on phone:
# 1. Open WhatsApp on +27 82 418 9511
# 2. Settings → Linked Devices → Link a Device
# 3. Enter pairing code from logs
```

---

## Architecture History

### Jan 2026 - Fully Unified Number Architecture
- **Change:** Bridge re-paired with 082 418 9511 (same as Sender)
- **Result:** Single phone number for ALL WhatsApp operations
- **Previous:** Bridge was paired with 064 041 2391, causing confusion
- **Fix:** Backed up old session store, re-paired bridge with 082 number

### Jan 2026 (Earlier) - Routing via Sender API
- **Change:** Bridge routes acks through Sender API
- **Result:** All outgoing messages from same 082 number
- **Files:** Added `sender_proxy.go`, modified `main.go`

### Nov 2025 - Dual Number Architecture
- Sender (082 number) for feedback with @mentions
- Bridge (064 number) for listening only

### Original - Single Bridge
- Bridge handled both listening and sending
- No @mention support

---

## WhatsApp Portal (Admin UI)

**URL:** `/communications/whatsapp`
**Status:** Production - Dark theme compliant (Jan 2026)

### Overview

Web-based admin interface for managing WhatsApp services, phones, and configuration.

### Tabs

| Tab | Purpose |
|-----|---------|
| **Services** | View service status (Bridge/Sender), restart services, initiate pairing |
| **Groups** | Manage monitored WhatsApp groups |
| **Templates** | Message templates for feedback |
| **Logs** | View message logs with export |
| **Settings** | Service configuration |

### Services Tab Features

- **Service Cards:** Show Bridge and Sender status with CONNECTED/ERROR badges
- **Registered Phone Numbers:** List phones with PRIMARY/paired status
- **Restart Buttons:** Quick service restart
- **Pairing:** Initiate phone pairing for re-authentication

### API Endpoints

**Phones API (Jan 2026):**
```bash
# List all registered phones
GET /api/communications/whatsapp/phones

# Register new phone
POST /api/communications/whatsapp/phones

# Manage specific phone
GET/PUT/DELETE /api/communications/whatsapp/phones/[id]
```

**Pairing API (Jan 2026):**
```bash
# Initiate pairing
POST /api/communications/whatsapp/services/[service]/pair

# Check pairing status
GET /api/communications/whatsapp/services/[service]/pairing-status

# Logout service
POST /api/communications/whatsapp/services/[service]/logout
```

### Frontend Service

```typescript
import { waAdminApi } from '@/modules/communications/whatsapp/services/waAdminApiService';

// Services
await waAdminApi.services.status();
await waAdminApi.services.restart('bridge');
await waAdminApi.services.pair('sender', '+27824189511');
await waAdminApi.services.pairingStatus('sender');
await waAdminApi.services.logout('bridge');

// Phones
await waAdminApi.phones.list();
await waAdminApi.phones.create({ phone_number: '...', service: 'sender', role: 'primary' });
await waAdminApi.phones.setPrimary(phoneId);
```

---

## Related Documentation

- [WA Monitor README](../../src/modules/wa-monitor/README.md)
- [Troubleshooting Guide](../../src/modules/wa-monitor/TROUBLESHOOTING.md)
- [Add New Project (5 Min)](./WA_MONITOR_ADD_PROJECT_5MIN.md)
- [WhatsApp Portal Components](../../src/modules/communications/whatsapp/)

---

**End of Document**
