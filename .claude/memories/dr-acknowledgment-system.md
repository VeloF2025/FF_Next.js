# DR Acknowledgment System

**Created**: 2026-01-16
**Status**: ✅ Active in Production

---

## Overview

When a user submits a DR number to a WhatsApp group, the system immediately sends a threaded reply with:
- Photo count from OneMap
- ONT Serial (extracted from barcode scan)
- UPS Serial
- Warning indicators for missing items

---

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  WhatsApp User  │────▶│   Go Bridge      │────▶│  FibreFlow API  │
│  sends DR123456 │     │  (Velocity VPS)  │     │  (Staging)      │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │                        │
                               │                        ▼
                               │                 ┌─────────────────┐
                               │                 │    OneMap API   │
                               │                 │  192.168.1.150  │
                               │                 └─────────────────┘
                               │                        │
                               ▼                        │
                        ┌──────────────────┐           │
                        │  Threaded Reply  │◀──────────┘
                        │  to User Message │
                        └──────────────────┘
```

---

## Components

### 1. FibreFlow API Endpoint

**File**: `pages/api/activate/dr-acknowledgment.ts`

**Purpose**: Lightweight endpoint that queries OneMap and returns formatted acknowledgment data.

**Request**:
```json
POST /api/activate/dr-acknowledgment
{
  "dropNumber": "DR123456",
  "project": "Lawley"
}
```

**Response**:
```json
{
  "success": true,
  "data": {
    "dropNumber": "DR123456",
    "found": true,
    "photoCount": 6,
    "ontSerial": "ALCLB46BE62E",
    "upsSerial": "GU18W12V2562847",
    "message": "📸 *DR123456 Received!*\n\n✅ Photos: 6\n✅ ONT Serial: ALCLB46BE62E\n✅ UPS Serial: GU18W12V2562847\n\nThank you! QA review will follow shortly."
  }
}
```

**Key Features**:
- 5 second timeout to OneMap
- Does NOT trigger photo downloads (read-only)
- Extracts ONT serial from barcode scan data using regex

### 2. Go Bridge Functions

**File**: `/home/louis/whatsapp-bridge-go/main.go`

#### sendWhatsAppReply()
Sends a WhatsApp message as a threaded reply to another message.

```go
func sendWhatsAppReply(client *whatsmeow.Client, recipient string, message string,
                       replyToID string, replyToSender string, quotedContent string) (bool, string)
```

**Key**: Uses `ContextInfo` with `QuotedMessage` for proper threading:
```go
ContextInfo: &waProto.ContextInfo{
    StanzaID:      proto.String(replyToID),
    Participant:   proto.String(replyToSender),
    QuotedMessage: quotedMsg,
}
```

#### sendDRAcknowledgment()
Async function that calls FibreFlow API and sends reply.

```go
func sendDRAcknowledgment(client *whatsmeow.Client, chatJID string, dropNumber string,
                          project string, messageID string, senderJID string)
```

**Key**: Runs in goroutine to not block main flow.

### 3. processDropNumbers Updates

Updated signature to pass message context:
```go
func processDropNumbers(client *whatsmeow.Client, content, chatJID, sender string,
                        timestamp time.Time, messageID, senderJID string, logger waLog.Logger)
```

Called with:
```go
processDropNumbers(client, content, chatJID, sender, msg.Info.Timestamp,
                   msg.Info.ID, msg.Info.Sender.String(), logger)
```

---

## Message Templates

### DR Found (All Data)
```
📸 *DR123456 Received!*

✅ Photos: 12
✅ ONT Serial: ALCLB46BE62E
✅ UPS Serial: GU18W12V2562847

Thank you! QA review will follow shortly.
```

### DR Found (Missing Items)
```
📸 *DR123456 Received!*

✅ Photos: 8
✅ ONT Serial: ALCLB46BE62E
⚠️ UPS Serial: Not scanned - please upload to 1Map

Thank you! QA review will follow shortly.
```

### DR Not Found in OneMap
```
📸 *DR123456 Received!*

⏳ Photos not yet available in 1Map.
Please ensure photos are uploaded to OneMap.

Thank you! We'll process your submission shortly.
```

---

## ONT Barcode Parsing

OneMap stores full barcode scan data:
```
(S)ALCLB46BE62E(23S)E03DA68BD340(20S)M022515ALU00136108(U)userAdmin(P)nNZFBQnwJ3(ID)ALHN-E62E(KY)nNZFBQnwJ3(N)G-1425G-B
```

**Format**:
- `(S)` - Serial number
- `(23S)` - Secondary serial
- `(20S)` - Tertiary code
- `(U)` - Username
- `(P)` - Password
- `(ID)` - Device ID
- `(KY)` - Key
- `(N)` - Model

**Extraction**:
```typescript
function extractOntSerial(barcodeData: string | null): string | null {
  if (!barcodeData) return null;
  const serialMatch = barcodeData.match(/\(S\)([^(]+)/);
  if (serialMatch && serialMatch[1]) {
    return serialMatch[1].trim();
  }
  return null;
}
```

---

## WhatsApp LID Format

WhatsApp now uses LID (Linked ID) format instead of phone-based JIDs:
- Old: `27123456789@s.whatsapp.net`
- New: `155228775178345@lid` or `155228775178345:37@lid`

**Solution**: Include `QuotedMessage` in `ContextInfo` for reply threading to work with LID format.

---

## Troubleshooting

### Reply Not Threading
1. Check `QuotedMessage` is included in ContextInfo
2. Verify `StanzaID` matches original message ID
3. Check logs for "Reply sent to" confirmation

### ONT Serial Shows Full Barcode
1. Check `extractOntSerial()` function in dr-acknowledgment.ts
2. Redeploy API to staging

### No Acknowledgment Sent
1. Check Go bridge logs: `tail -f /home/louis/whatsapp-bridge-go/bridge.log`
2. Look for `[ACK ERROR]` or `[ACK WARN]` messages
3. Verify API is accessible: `curl -X POST https://vf.fibreflow.app/api/activate/dr-acknowledgment`

---

## Related Files

| File | Purpose |
|------|---------|
| `pages/api/activate/dr-acknowledgment.ts` | Acknowledgment API endpoint |
| `pages/api/activate/process-new-dr.ts` | DR validation & sync |
| `/home/louis/whatsapp-bridge-go/main.go` | Go bridge with reply support |
| `.claude/go_ack_patch.py` | Initial patch script |
| `.claude/reply_fix.py` | QuotedMessage fix |

---

## Testing

```bash
# Test API directly
curl -s -X POST https://vf.fibreflow.app/api/activate/dr-acknowledgment \
  -H "Content-Type: application/json" \
  -d '{"dropNumber":"DR1750922","project":"Lawley"}' | jq .

# Check Go bridge logs
ssh velo@100.96.203.105 "tail -f /home/louis/whatsapp-bridge-go/bridge.log"

# Filter for acknowledgment logs
ssh velo@100.96.203.105 "grep -E '(Sent ack|photos:|ACK)' /home/louis/whatsapp-bridge-go/bridge.log"
```
