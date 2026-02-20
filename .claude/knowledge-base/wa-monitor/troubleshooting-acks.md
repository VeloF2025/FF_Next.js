# WA Monitor: ACK Message Troubleshooting

## Bridge Reliability Fixes (2026-02-10)

### Investigation: DR474666 Missing Acknowledgment

**Root Cause:** Google Sheets write error (Mamelodi project had no tab configured) cascaded into 500 error on `/api/activate/dr-acknowledgment`, causing bridge to exit without sending ack.

**Secondary Issue:** Dedup TTL (10 min) blocked legitimate resubmission acks (e.g., DR1730948 blocked after 2m20s).

### Three Fixes Deployed

**1. Ack Retry Logic** (`main.go` - `sendDRAcknowledgment()`)
```go
// Previously: single attempt, exit on any error
// Now: 3 attempts with exponential backoff (2s, 4s, 8s)
```
- Logs `[ACK RETRY X/3]` on failed attempts
- Logs `[ACK FAILED]` after all retries exhausted
- Handles transient errors: Cloudflare 530/520, temporary 500s, Neon timeouts

**2. Google Sheets Removal** (`main.go`)
- Removed all 3 Sheets call sites:
  - `writeToGoogleSheets()` after new DR processing
  - `updateSheetsForResubmission()` on resubmissions
  - `checkRecentCompletions()` in receipt handler
- Root cause of DR474666: Sheets error → API 500 → no ack
- Functions still exist as dead code, just not called

**3. Dedup TTL Reduction** (removed in unified bridge)
- Unified bridge handles deduplication internally
- No separate sender proxy needed

### Weekly Stats (Feb 3-10, 2026)
- **13 real DRs** missed acks (excluding DR474666 now fixed)
- **Causes:** Cloudflare 530/520 (5), Server 500 (2), No ack/not on 1Map (6)
- **Projects:** Mamelodi (5), Lawley (6), Mohadin (2)
- **44 additional failures** were invalid DR numbers (WhatsApp typos)

### Bridge Deployment Notes
1. **ALWAYS stop service before copying binary** (Text file busy error)
2. **Bridge log has no date stamps** - cross-reference with `qa_photo_reviews.created_at`
3. **Manual ack endpoint:** POST to bridge `/send-message` with `group_jid` and `message`

---

## Serial Number Warning Format (2026-02-10)

### Improved Visibility in ACK Messages

**Changes in commit cb8d64c3:**
- **Mismatch warnings:** Changed from subtle `⚠️` to bold `🔴 *MISMATCH:*` with 1Map vs Sticker comparison
- **Missing serials:** Now show `🔴 *NOT SCANNED*` instead of subtle warning emoji
- **Duplicate detection:** Checks if same ONT/UPS serial used on multiple DRs (parallel with photo polling, 0ms latency)

### Warning Format Examples
```
🔴 *MISMATCH: ONT*
1Map: ZTEM12345678
Sticker: ZTEM87654321

🔴 *NOT SCANNED: UPS*
Serial sticker not visible

🔴 *DUPLICATE SERIAL: ONT*
ZTEM12345678 also on DR123456, DR234567
```

### Implementation Notes
- `checkDuplicateSerials()` queries `dr_photo_unified_reviews` with case-insensitive UPPER() lookups
- `buildSerialWarningLines()` shared helper for both new DRs and resubmissions
- Migration 174: Added 3 indexes on `UPPER(ont_serial_scanned)`, `UPPER(ups_serial_scanned)`, `UPPER(oes_serial)` for performance
- Duplicate info included in JSON response (`duplicateSerials` field) - Go Bridge ignores unknown fields

### Database Indexes
```sql
-- Migration 174
CREATE INDEX idx_dr_unified_ont_upper ON dr_photo_unified_reviews (UPPER(ont_serial_scanned));
CREATE INDEX idx_dr_unified_ups_upper ON dr_photo_unified_reviews (UPPER(ups_serial_scanned));
CREATE INDEX idx_dr_unified_oes_upper ON dr_photo_unified_reviews (UPPER(oes_serial));
```

---

## Error Code 1033 - Neon Database Timeout

**Update (Feb 2026):** Bridge now auto-retries with exponential backoff. If all 3 retries fail, follow manual steps below.

### Symptoms
- Bridge logs show: `[ACK WARN] Acknowledgment API returned 530 for DR123456: error code: 1033`
- DR submissions recorded in `qa_photo_reviews` but no ack sent to WhatsApp
- `feedback_sent = null` and `wa_group_jid = null` in database records

### Root Cause
Neon PostgreSQL transient connection timeout. The `/api/activate/dr-acknowledgment` endpoint fails to respond within the bridge's timeout window.

### Diagnosis
```bash
# Check bridge logs for 530 errors
ssh root@72.61.197.178 "tail -200 /opt/whatsapp-bridge/bridge.log | grep -E 'ACK WARN|530|1033'"

# Check if API is responding now
curl -s -X POST "https://app.fibreflow.app/api/activate/dr-acknowledgment" \
  -H "Content-Type: application/json" \
  -d '{"dropNumber":"DR123456"}' | jq .

# Check FibreFlow health
curl -s "https://app.fibreflow.app/api/health" | jq '.checks.database'
```

### Resolution

#### 1. Restart Bridge (clears stale connections)
```bash
ssh root@72.61.197.178 "systemctl restart whatsapp-bridge"
```

#### 2. Find Missed Submissions
```bash
node -e "
const { neon } = require('@neondatabase/serverless');
const sql = neon('postgresql://neondb_owner:$NEON_DB_PASSWORD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require');
(async () => {
  const records = await sql\`
    SELECT drop_number, created_at, user_name, project
    FROM qa_photo_reviews
    WHERE project = 'Lawley'  -- Change project as needed
    AND created_at > NOW() - INTERVAL '24 hours'
    AND feedback_sent IS NULL
    ORDER BY created_at DESC
  \`;
  console.log('Missed submissions:');
  records.forEach(r => console.log(\`\${r.drop_number} @ \${r.created_at} by \${r.user_name}\`));
})();
"
```

#### 3. Send Manual ACKs
```bash
# Get ack message from API
ACK=$(curl -s -X POST "https://app.fibreflow.app/api/activate/dr-acknowledgment" \
  -H "Content-Type: application/json" \
  -d '{"dropNumber":"DR123456","project":"Lawley"}')

# Extract message
echo "$ACK" | jq -r '.data.message'

# Send via bridge
ssh root@72.61.197.178 "curl -s http://localhost:8083/send-message -X POST \
  -H 'Content-Type: application/json' \
  -d '{
    \"group_jid\": \"120363418298130331@g.us\",
    \"recipient_jid\": \"0@s.whatsapp.net\",
    \"message\": \"📸 *DR123456 Received!*\\n\\nThank you! QA review will follow shortly.\"
  }'"
```

### Group JID Reference
| Project | Group JID |
|---------|-----------|
| Lawley | `120363418298130331@g.us` |
| Mohadin | `120363421532174586@g.us` |
| Mamelodi | `120363408849234743@g.us` |
| Marketing Activations | `120363422808656601@g.us` |
| Mamelodi Internal | `120363425029043207@g.us` |
| Mohadin Maintenance | `120363424360693693@g.us` |
| Lawley Maintenance | `120363423947610853@g.us` |
| Mohadin Pre-Provision | `120363423163566226@g.us` |
| Velo Server | `120363423864087150@g.us` |

---

## Unified Bridge Architecture (Feb 2026)

### Bridge Service Endpoint

**Note**: Unified bridge on VPS 72.61.197.178 port 8083 handles ALL WhatsApp operations.

### Health Check
```bash
curl http://72.61.197.178:8083/health
```

### Send Message
```bash
POST http://72.61.197.178:8083/send-message
Content-Type: application/json

{
  "group_jid": "120363418298130331@g.us",
  "recipient_jid": "0@s.whatsapp.net",
  "message": "Your message here"
}
```

**Required fields:**
- `group_jid` - WhatsApp group JID (from table above)
- `recipient_jid` - User's JID or `0@s.whatsapp.net` for broadcast
- `message` - Message content (supports markdown-like formatting with `*bold*`)

### Response
```json
{
  "success": true,
  "message": "Message sent successfully"
}
```

---

## WebSocket Disconnection Errors

### Symptoms
```
[Client/Socket ERROR] Error reading from websocket: failed to get reader: failed to read frame header: EOF
[Client WARN] Got 503 stream error, assuming automatic reconnect will handle it
```

### Cause
Normal WhatsApp Web protocol behavior - connection drops happen periodically and auto-reconnect handles them.

### When to Worry
- If errors are constant (every few seconds)
- If `systemctl status whatsapp-bridge` shows frequent restarts
- If messages are not being delivered

### Resolution
```bash
# Restart bridge to establish fresh connection
ssh root@72.61.197.178 "systemctl restart whatsapp-bridge"

# Check if healthy after restart
sleep 10 && ssh root@72.61.197.178 "curl -s http://localhost:8083/health"
```

---

## Failed Retry Receipt Errors

### Symptoms
```
[Client ERROR] Failed to handle retry receipt for 120363421664266245@g.us/3EB0xxx from USER@lid: couldn't find message 3EB0xxx
```

### Cause
When WhatsApp recipients request message re-encryption (retry receipt), but the bridge's message store no longer has the original message. This happens when:
- Bridge service was restarted
- Message store was cleared
- Message is older than store retention

### Impact
Recipients may not be able to decrypt/view certain messages sent before a restart.

### Resolution
No action needed - these are informational errors about past messages. New messages will work correctly.

---

## Version History

| Date | Change |
|------|--------|
| Feb 20, 2026 | Updated for unified VPS bridge architecture |
| Feb 10, 2026 | Ack retry logic, serial warnings, dedup TTL fixes |
| Jan 31, 2026 | Initial troubleshooting guide created |
