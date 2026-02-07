# WA Monitor: ACK Message Troubleshooting

## Error Code 1033 - Neon Database Timeout

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

#### 1. Restart Services (clears stale connections)
```bash
ssh root@72.61.197.178 "systemctl restart whatsapp-sender.service whatsapp-bridge.service"
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

# Send via sender service (use user_name from qa_photo_reviews + @lid)
ssh root@72.61.197.178 "curl -s http://localhost:8081/send-message -X POST \
  -H 'Content-Type: application/json' \
  -d '{
    \"group_jid\": \"120363418298130331@g.us\",
    \"recipient_jid\": \"USER_ID_HERE@lid\",
    \"message\": \"📸 *DR123456 Received!*\\n\\nThank you! QA review will follow shortly.\"
  }'"
```

### Group JID Reference
| Project | Group JID |
|---------|-----------|
| Lawley | `120363418298130331@g.us` |
| Mohadin | `120363421532174586@g.us` |
| Mamelodi | `120363408849234743@g.us` |
| Mamelodi Internal | `120363425029043207@g.us` |
| Velo Test | `120363421664266245@g.us` |

---

## WA Sender Service Endpoints

**Note**: Despite module docs showing sender as "DISABLED", `whatsapp-sender.service` on port 8081 is still active and separate from bridge.

### Health Check
```bash
curl http://72.61.197.178:8081/health
```

### Send Message
```bash
POST http://72.61.197.178:8081/send-message
Content-Type: application/json

{
  "group_jid": "120363418298130331@g.us",
  "recipient_jid": "206798481035291@lid",
  "message": "Your message here"
}
```

**Required fields:**
- `group_jid` - WhatsApp group JID (from table above)
- `recipient_jid` - User's LID (from `qa_photo_reviews.user_name` + `@lid`)
- `message` - Message content (supports markdown-like formatting with `*bold*`)

### Response
```json
{
  "success": true,
  "message_id": "3EB015C823AEA99C9EECFB",
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
- If `systemctl status whatsapp-sender` shows frequent restarts
- If messages are not being delivered

### Resolution
```bash
# Restart sender to establish fresh connection
ssh root@72.61.197.178 "systemctl restart whatsapp-sender.service"

# Check if healthy after restart
sleep 10 && ssh root@72.61.197.178 "curl -s http://localhost:8081/health"
```

---

## Failed Retry Receipt Errors

### Symptoms
```
[Client ERROR] Failed to handle retry receipt for 120363421664266245@g.us/3EB0xxx from USER@lid: couldn't find message 3EB0xxx
```

### Cause
When WhatsApp recipients request message re-encryption (retry receipt), but the sender's message store no longer has the original message. This happens when:
- Sender service was restarted
- Message store was cleared
- Message is older than store retention

### Impact
Recipients may not be able to decrypt/view certain messages sent before a restart.

### Resolution
No action needed - these are informational errors about past messages. New messages will work correctly.
