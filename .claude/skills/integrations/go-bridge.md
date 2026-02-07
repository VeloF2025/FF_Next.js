# Go Bridge Skill

WhatsApp Go bridge reference for FibreFlow integration.

## Purpose

Manage and troubleshoot the WhatsApp Go bridge:
1. DR validation and processing
2. Acknowledgment sending with threaded replies
3. LID format handling
4. Service management
5. Log analysis and debugging

## Quick Reference

| Setting | Value |
|---------|-------|
| **Server** | Velocity VPS (100.96.203.105) |
| **Location** | `/home/louis/whatsapp-bridge-go/` |
| **Binary** | `whatsapp-bridge` |
| **Service** | `whatsapp-bridge.service` |
| **Log File** | `/home/louis/whatsapp-bridge-go/bridge.log` |
| **Config** | Environment variables in service |
| **API Base** | `https://vf.fibreflow.app/api/activate` |

## Slash Commands

### `/go-bridge` or `/wa-bridge`

Main entry point for Go bridge operations.

**Usage**:
```
/go-bridge                # Show bridge status
/go-bridge logs           # View recent logs
/go-bridge restart        # Restart service
/go-bridge debug DR123456 # Debug specific DR
```

### `/go-bridge status`

Check bridge service status.

**Response Template**:
```
🔗 WhatsApp Go Bridge Status:

Service: ✅ Active (running for 2h 34m)
Process: whatsapp-bridge (PID 12345)
Memory: 45MB

Last Activity:
  Message received: 2 minutes ago
  DR processed: DR1750922 (5 minutes ago)
  Acknowledgment sent: ✅ Success

Connected Groups: 4
  - Lawley (120363418298130331@g.us)
  - Mohadin (120363421532174586@g.us)
  - Velo Test (120363421664266245@g.us)
  - Mamelodi (120363408849234743@g.us)
```

## When to Activate

### Trigger 1: Bridge Issues

**User says**:
- "go bridge not working"
- "wa bridge down"
- "messages not processing"
- "DR not being received"

**Automatic Actions**:
1. Check service status
2. View recent logs
3. Identify errors
4. Suggest fixes

### Trigger 2: Acknowledgment Problems

**User says**:
- "ack not sending"
- "reply not threading"
- "acknowledgment broken"
- "no reply to DR"

**Automatic Actions**:
1. Check bridge logs for ACK entries
2. Verify API connectivity
3. Check for LID issues
4. Test acknowledgment endpoint

### Trigger 3: Validation Issues

**User says**:
- "DR rejected"
- "project mismatch"
- "validation failing"
- "DR not found error"

**Automatic Actions**:
1. Check validation logs
2. Look up DR in database
3. Verify project mapping
4. Explain rejection reason

### Trigger 4: LID Issues

**User says**:
- "LID format"
- "phone number wrong"
- "sender JID broken"
- "threading not working"

**Automatic Actions**:
1. Explain LID vs phone format
2. Check QuotedMessage implementation
3. Verify ContextInfo structure

## Bridge Architecture

```
┌─────────────────────┐
│  WhatsApp Message   │
│  "DR1234567"        │
└─────────┬───────────┘
          │
          ▼
┌─────────────────────┐
│     Go Bridge       │
│  processDropNumbers │
└─────────┬───────────┘
          │
    ┌─────┴─────┐
    │           │
    ▼           ▼
┌───────┐  ┌───────────────┐
│ DB    │  │ Acknowledgment│
│ Insert│  │ (async)       │
└───────┘  └───────┬───────┘
                   │
                   ▼
           ┌─────────────────┐
           │ POST /api/      │
           │ dr-acknowledgment│
           └───────┬─────────┘
                   │
                   ▼
           ┌─────────────────┐
           │ sendWhatsAppReply│
           │ (threaded)      │
           └─────────────────┘
```

## Key Functions

### processDropNumbers()

Detects and processes DR numbers from messages.

```go
func processDropNumbers(
    client *whatsmeow.Client,
    content string,      // Message text
    chatJID string,      // Group/chat JID
    sender string,       // Sender name
    timestamp time.Time,
    messageID string,    // For reply threading
    senderJID string,    // Sender JID (may be LID)
    logger waLog.Logger,
)
```

### sendDRAcknowledgment()

Async function that fetches acknowledgment data and sends reply.

```go
func sendDRAcknowledgment(
    client *whatsmeow.Client,
    chatJID string,
    dropNumber string,
    project string,
    messageID string,   // Original message to reply to
    senderJID string,   // Original sender
)
```

### sendWhatsAppReply()

Sends a threaded reply to a specific message.

```go
func sendWhatsAppReply(
    client *whatsmeow.Client,
    recipient string,      // Group JID
    message string,        // Reply text
    replyToID string,      // Original message ID
    replyToSender string,  // Original sender JID
    quotedContent string,  // Original message text
) (bool, string)
```

**Critical**: Must include `QuotedMessage` in ContextInfo for proper threading:

```go
ContextInfo: &waProto.ContextInfo{
    StanzaID:      proto.String(replyToID),
    Participant:   proto.String(replyToSender),
    QuotedMessage: quotedMsg,  // REQUIRED for LID format
}
```

## DR Validation Types

### DR_NOT_FOUND

DR number doesn't exist in OneMap.

**Response sent to group**:
```
❌ DR1234567 not found in system.
Please verify the drop number and try again.
```

### PROJECT_MISMATCH

DR exists but belongs to different project.

**Response sent to group**:
```
⚠️ DR1234567 belongs to [OtherProject], not [ThisProject].
Please submit to the correct group.
```

## LID Format

WhatsApp now uses LID (Linked ID) instead of phone numbers:

| Format | Example |
|--------|---------|
| Old (phone) | `27123456789@s.whatsapp.net` |
| New (LID) | `155228775178345@lid` |
| New (with device) | `155228775178345:37@lid` |

**Impact**: Reply threading requires `QuotedMessage` to work with LID format.

## SSH Commands Reference

```bash
# Check service status
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "systemctl status whatsapp-bridge.service --no-pager | head -15"

# Restart bridge
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "echo '$VELO_SSH_PASSWORD' | sudo -S systemctl restart whatsapp-bridge.service"

# View recent logs
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "tail -100 /home/louis/whatsapp-bridge-go/bridge.log"

# Filter for DR processing
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "grep -E 'DR[0-9]{6,7}' /home/louis/whatsapp-bridge-go/bridge.log | tail -30"

# Filter for acknowledgments
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "grep -E '(ACK|Sent ack|photos:)' /home/louis/whatsapp-bridge-go/bridge.log | tail -20"

# Filter for errors
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "grep -iE '(ERROR|WARN|FAIL)' /home/louis/whatsapp-bridge-go/bridge.log | tail -30"

# Filter for validation
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "grep -E '(NOT_FOUND|MISMATCH|validation)' /home/louis/whatsapp-bridge-go/bridge.log | tail -20"

# Check if process is running
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "pgrep -a whatsapp-bridge"

# View service logs via journald
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "echo '$VELO_SSH_PASSWORD' | sudo -S journalctl -u whatsapp-bridge.service -n 50"

# Rebuild bridge (if code changed)
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "cd /home/louis/whatsapp-bridge-go && go build -o whatsapp-bridge main.go"
```

## Log Patterns

### Successful DR Processing
```
[INFO] Message from 27711558396 in 120363418298130331@g.us: DR1750922
[INFO] Detected DR: DR1750922
[INFO] Creating QA photo review for DR1750922
[INFO] Sending acknowledgment for DR1750922
[ACK] Fetching from https://vf.fibreflow.app/api/activate/dr-acknowledgment
[ACK] Response: photos: 6, ONT: ALCLB46BE62E
[INFO] Sent ack reply for DR1750922
```

### Failed Acknowledgment
```
[INFO] Detected DR: DR1750922
[ACK ERROR] Failed to fetch acknowledgment: connection refused
```

### Validation Rejection
```
[INFO] Detected DR: DR1234567
[VALIDATION] DR1234567: NOT_FOUND
[INFO] Sent rejection notice to group
```

### LID Detection
```
[DEBUG] Sender JID: 155228775178345@lid
[DEBUG] Using LID format for reply
```

## Troubleshooting

### ISSUE: Service Won't Start

**Diagnosis**:
```bash
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "echo '$VELO_SSH_PASSWORD' | sudo -S journalctl -u whatsapp-bridge.service -n 50"
```

**Common Causes**:
1. Binary not built: Run `go build`
2. Missing environment variables
3. WhatsApp session expired (need to re-authenticate)

---

### ISSUE: DRs Not Being Processed

**Diagnosis**:
```bash
# Check if bridge is receiving messages
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "grep 'Message from' /home/louis/whatsapp-bridge-go/bridge.log | tail -10"
```

**Common Causes**:
1. Bridge not in group
2. DR pattern not matching
3. Service crashed

---

### ISSUE: Acknowledgment Not Sending

**Diagnosis**:
```bash
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "grep -E 'ACK|ack' /home/louis/whatsapp-bridge-go/bridge.log | tail -20"
```

**Common Causes**:
1. API unreachable (check staging is running)
2. Network timeout to FibreFlow API
3. JSON parsing error in response

**Test API directly**:
```bash
curl -s -X POST https://vf.fibreflow.app/api/activate/dr-acknowledgment \
  -H "Content-Type: application/json" \
  -d '{"dropNumber":"DR1750922","project":"Lawley"}' | jq .
```

---

### ISSUE: Reply Not Threading

**Symptoms**:
- Message sends but not as reply
- No quote of original message

**Root Cause**:
Missing or incorrect ContextInfo fields.

**Required**:
```go
ContextInfo: &waProto.ContextInfo{
    StanzaID:      proto.String(replyToID),
    Participant:   proto.String(senderJID),
    QuotedMessage: &waProto.Message{
        Conversation: proto.String(originalText),
    },
}
```

---

### ISSUE: LID Format Problems

**Symptoms**:
- Threading works with phone JIDs but not LID
- `Participant` field rejected

**Solution**:
Include `QuotedMessage` - WhatsApp uses it for LID resolution.

---

### ISSUE: High Memory Usage

**Diagnosis**:
```bash
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "ps aux | grep whatsapp-bridge"
```

**Fix**:
Restart service to clear memory:
```bash
sshpass -p '$VELO_SSH_PASSWORD' ssh velo@100.96.203.105 "echo '$VELO_SSH_PASSWORD' | sudo -S systemctl restart whatsapp-bridge.service"
```

## Environment Variables

| Variable | Purpose | Example |
|----------|---------|---------|
| `FIBREFLOW_API_BASE` | FibreFlow API URL | `https://vf.fibreflow.app` |
| `DATABASE_URL` | Neon PostgreSQL connection | `postgresql://...` |
| `LOG_LEVEL` | Logging verbosity | `INFO` |

## Project Group Mapping

| Project | Group JID | Phone |
|---------|-----------|-------|
| Lawley | `120363418298130331@g.us` | Bridge: 064 041 2391 |
| Mohadin | `120363421532174586@g.us` | Bridge: 064 041 2391 |
| Velo Test | `120363421664266245@g.us` | Bridge: 064 041 2391 |
| Mamelodi | `120363408849234743@g.us` | Bridge: 064 041 2391 |

## Files Reference

| File | Purpose |
|------|---------|
| `/home/louis/whatsapp-bridge-go/main.go` | Main bridge code |
| `/home/louis/whatsapp-bridge-go/bridge.log` | Log file |
| `/etc/systemd/system/whatsapp-bridge.service` | Systemd service |

## Auto-Activation Rules

### DO Automatically:
- ✅ Check service status
- ✅ View logs
- ✅ Explain error messages
- ✅ Diagnose DR processing issues

### ASK First:
- ❓ Restart service
- ❓ Rebuild binary
- ❓ Modify code

### DON'T:
- ❌ Delete log files
- ❌ Modify service configuration
- ❌ Change environment variables

## Related Skills

- `/activate` - Full Activate module
- `/wa-monitor` - WA Monitor (Python service)
- `/deploy` - Staging deployment

## Success Criteria

Skill is successful when:
- ✅ Bridge issues diagnosed quickly
- ✅ Log analysis identifies root cause
- ✅ Reply threading documented clearly
- ✅ LID format fully explained
- ✅ Common fixes are one-command
