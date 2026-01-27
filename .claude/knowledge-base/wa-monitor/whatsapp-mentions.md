# WhatsApp Mentions Architecture

> How @mentions work in the FibreFlow WhatsApp integration

## Overview

WhatsApp @mentions require TWO components:
1. **Text prefix** - The `@user` text that appears in the message
2. **MentionedJID context** - Metadata that tells WhatsApp which contact to display

The **Unified Bridge** (VPS:8083) handles BOTH. FibreFlow APIs should NOT add @mention text.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          MESSAGE FLOW                                        │
└─────────────────────────────────────────────────────────────────────────────┘

FibreFlow API                    wa-feedback-service              Unified Bridge
(send-feedback.ts)          →    (Velocity:8092)             →    (VPS:8083)
                                                                      │
Sends:                           Forwards:                           Creates:
• message (plain text)           • group_jid                        • @user + message (text)
• recipient_jid                  • recipient_jid                    • MentionedJID context
• group_jid                      • message
                                                                      │
                                                                      ▼
                                                              WhatsApp displays:
                                                              "@Contact Name message"
```

## The Bridge's Responsibility

The WhatsApp bridge (Go code) is responsible for:

1. **Adding @user prefix** to the message text
2. **Setting MentionedJID context** in the WhatsApp protobuf message

```go
// whatsapp-bridge-go: main.go
func sendGroupMessage(recipient_jid string, message string) {
    // Bridge adds @user prefix
    messageText := fmt.Sprintf("@%s %s", recipientJID.User, message)

    // Bridge sets MentionedJID context
    msg := &waProto.Message{
        ExtendedTextMessage: &waProto.ExtendedTextMessage{
            Text: proto.String(messageText),
            ContextInfo: &waProto.ContextInfo{
                MentionedJID: []string{recipient_jid},
            },
        },
    }
}
```

## FibreFlow API Pattern

### WRONG - Causes Double Mentions

```typescript
// ❌ BAD - FibreFlow adds @phone, bridge adds @user = double mention
const mentionParts: string[] = [];
if (review.wa_sender_jid) {
  mentionParts.push(`@${extractPhoneFromJid(review.wa_sender_jid)}`);
}
const groupMessage = `${mentionParts.join(' ')} ${feedbackMessage}`;

// Result: "@phone @user DR1234 - PASSED" (double mention!)
```

### CORRECT - Bridge Handles Mention

```typescript
// ✅ GOOD - FibreFlow sends plain message, bridge adds @mention
const groupMessage = feedbackMessage;  // No @phone prefix!

await sendToWaFeedback({
  recipient: groupJid,
  recipient_jid: review.wa_sender_jid,  // Bridge uses this for @mention
  message: groupMessage,                 // Plain message
});

// Result: "@Contact Name DR1234 - PASSED" (single mention with name)
```

## Why MentionedJID Matters

Without `MentionedJID` context:
- WhatsApp shows raw text: `@27631234567 DR1234 - PASSED`

With `MentionedJID` context:
- WhatsApp resolves to contact name: `@Contact Name DR1234 - PASSED`
- Mention becomes clickable
- Recipient gets notification

## JID Formats

WhatsApp uses different JID formats:

| Format | Example | Usage |
|--------|---------|-------|
| Phone JID | `27631234567@s.whatsapp.net` | Individual chats |
| LID (Linked ID) | `117004203770105@lid` | Group mentions |
| Group JID | `120363418298130331@g.us` | Group chats |

The bridge accepts either format for `recipient_jid`.

## Key Files

| File | Purpose |
|------|---------|
| `pages/api/activate/send-feedback.ts` | QA feedback - sends to wa-feedback |
| `pages/api/wa-monitor-send-feedback.ts` | Generic send - routes to wa-feedback |
| `/home/louis/wa-feedback-service/wa-feedback-service.js` (Velocity) | Proxy to VPS bridge |
| `/opt/whatsapp-bridge/whatsapp-bridge` (VPS) | Go binary that sends messages |

## Troubleshooting

### Double Mentions

**Symptom:** `@Name @Name message` appears in WhatsApp

**Cause:** FibreFlow API adding @phone AND bridge adding @user

**Fix:** Remove `@phone` prefix from FibreFlow API, let bridge handle it

### Raw Number Instead of Name

**Symptom:** `@27631234567 message` instead of `@Contact Name message`

**Cause:** `MentionedJID` context not set (bridge issue) or invalid JID format

**Fix:** Verify `recipient_jid` is being forwarded through wa-feedback-service to bridge

### No Mention At All

**Symptom:** Plain message with no @ at all

**Cause:** `recipient_jid` not being sent or is empty/invalid

**Fix:** Check wa-feedback-service is forwarding `recipient_jid` or `mentionJIDs[0]`

## Direct Bridge API

To send messages directly to the WhatsApp bridge (bypassing FibreFlow APIs):

```bash
curl -X POST "http://72.61.197.178:8083/send-message" \
  -H "Content-Type: application/json" \
  -d '{
    "group_jid": "120363408849234743@g.us",
    "message": "Your message here",
    "mention_jid": "141652383526991@lid"
  }'
```

**Field Names (snake_case, NOT camelCase):**

| Field | Description | Example |
|-------|-------------|---------|
| `group_jid` | WhatsApp group JID | `120363408849234743@g.us` |
| `message` | Message text (bridge adds @mention prefix) | `✅ *DR123 Received!*` |
| `mention_jid` | JID to @mention (optional) | `141652383526991@lid` |

**Response:**
```json
{
  "success": true,
  "message": "Message sent successfully",
  "message_id": "3EB002F8C2BE43AE8C4296"
}
```

**Common Mistake:** Using camelCase (`groupJid`) instead of snake_case (`group_jid`) returns:
```json
{"error": "Missing group_jid or message", "success": false}
```

## Related Commits

- `546f3c77` - fix(whatsapp): display user name instead of raw JID in @mentions
