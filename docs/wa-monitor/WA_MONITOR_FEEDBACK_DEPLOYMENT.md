# WA Monitor Group Feedback Feature - Deployment Guide

## Feature Summary

**What it does:** Sends QA feedback messages to WhatsApp groups with mentions, so the person who posted the drop gets notified.

**Example:**
```
User posts: DR1234567

System replies in group:
@27640412391 ✅ DR1234567 APPROVED
✓ House photo
✓ Cable from pole
✓ Cable entry (outside)
... (all 12 steps)
```

**Benefits:**
- ✅ User gets push notification (hard to miss)
- ✅ Everyone in group sees feedback (transparency)
- ✅ Manual send button (QA reviewer controls when to send)

---

## What's Already Done ✅

### 1. Database
- ✅ Added `submitted_by` column to `qa_photo_reviews` table
- ✅ Column type: `VARCHAR(255)`
- ✅ Stores WhatsApp JID (e.g., `27640412391@s.whatsapp.net`)

### 2. API Endpoint
- ✅ Updated `/api/wa-monitor-send-feedback`
- ✅ Fetches QA review data including `submitted_by`
- ✅ Formats checklist message
- ✅ Sends mention to WhatsApp bridge

### 3. Dashboard UI
- ✅ "Send Feedback" button already exists in `QaReviewCard`
- ✅ Auto-generate feedback button
- ✅ Custom message field
- ✅ Wired to API endpoint

---

## What Needs Deployment 🚀

### WhatsApp Bridge (Go) Updates

**File:** `/opt/velo-test-monitor/services/whatsapp-bridge/main.go`

**Changes needed:**
1. Update INSERT to capture sender JID
2. Add HTTP server for send message API
3. Add send message with mention function

**Guide:** See `/home/louisdup/VF/Apps/FF_React/scripts/wa-monitor/bridge-updates.go` for detailed code changes

---

## Deployment Steps

### Step 1: Backup Current Bridge

```bash
ssh root@72.60.17.245

# Backup current code
cp /opt/velo-test-monitor/services/whatsapp-bridge/main.go \
   /opt/velo-test-monitor/services/whatsapp-bridge/main.go.backup.feedback_$(date +%Y%m%d_%H%M%S)

# Verify backup
ls -lh /opt/velo-test-monitor/services/whatsapp-bridge/*.backup*
```

### Step 2: Apply Code Changes

Open the bridge code for editing:
```bash
nano /opt/velo-test-monitor/services/whatsapp-bridge/main.go
```

**Apply the 3 changes from:**
`/home/louisdup/VF/Apps/FF_React/scripts/wa-monitor/bridge-updates.go`

**Summary of changes:**
1. **Line ~1165-1175:** Update INSERT to include `submitted_by`
   ```go
   INSERT INTO qa_photo_reviews (
     drop_number, user_name, project, review_date, comment, submitted_by
   ) VALUES (
     $1, $2, $3, $4, $5, $6
   )

   // Add evt.Info.Sender.String() as 6th parameter
   ```

2. **Add HTTP server functions** (after message handler):
   - `SendMessageRequest` struct
   - `SendMessageResponse` struct
   - `startHTTPServer()` function
   - `handleSendMessage()` function

3. **Update main():** Start HTTP server
   ```go
   // After WhatsApp client connects:
   go startHTTPServer()
   ```

### Step 3: Add Required Go Imports

Ensure these imports are at the top of main.go:
```go
import (
    "net/http"
    "encoding/json"
    "io/ioutil"
    // ... other existing imports
)
```

### Step 4: Recompile Bridge

```bash
cd /opt/velo-test-monitor/services/whatsapp-bridge

# Compile new binary
/usr/local/go/bin/go build -o whatsapp-bridge-new main.go

# Check for errors
echo $?
# Should output: 0 (success)
```

If compilation fails:
- Check syntax errors
- Verify imports
- Compare with backup

### Step 5: Stop Current Bridge

```bash
# Find bridge process
ps aux | grep whatsapp-bridge

# Stop it
pkill whatsapp-bridge

# Verify stopped
ps aux | grep whatsapp-bridge
# Should show nothing
```

### Step 6: Replace Binary

```bash
cd /opt/velo-test-monitor/services/whatsapp-bridge

# Keep old binary
mv whatsapp-bridge whatsapp-bridge.old

# Install new binary
mv whatsapp-bridge-new whatsapp-bridge

# Make executable
chmod +x whatsapp-bridge
```

### Step 7: Start New Bridge

```bash
nohup ./whatsapp-bridge > /opt/velo-test-monitor/logs/whatsapp-bridge.log 2>&1 &

# Get process ID
echo $!
```

### Step 8: Verify Bridge Running

```bash
# Check process
ps aux | grep whatsapp-bridge

# Check logs
tail -50 /opt/velo-test-monitor/logs/whatsapp-bridge.log

# Look for:
# ✓ Connected to WhatsApp!
# 🌐 Starting HTTP server on port 8080...
```

### Step 9: Test HTTP Endpoint

```bash
# Test send message endpoint
curl -X POST http://localhost:8080/send-message \
  -H "Content-Type: application/json" \
  -d '{
    "group_jid": "120363421664266245@g.us",
    "recipient_jid": "27640412391@s.whatsapp.net",
    "message": "Test message - ignore"
  }'

# Should return:
# {"success":true,"message":"Message sent successfully"}
```

### Step 10: Deploy Next.js App

```bash
# Deploy to DEV first (for testing)
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 \
  "cd /var/www/fibreflow-dev && git pull && npm ci && npm run build && pm2 restart fibreflow-dev"

# Test at: https://dev.fibreflow.app/wa-monitor
```

### Step 11: End-to-End Test

1. **Post test drop to WhatsApp group:**
   - Use Velo Test group: `120363421664266245@g.us`
   - Post format: `DR9999999`

2. **Verify drop captured:**
   - Check dashboard: https://dev.fibreflow.app/wa-monitor
   - Should see DR9999999 listed
   - Click "Edit" button

3. **Complete QA review:**
   - Check some boxes (not all - we want to test rejection)
   - Leave some unchecked
   - Click "Save"

4. **Send feedback:**
   - Click "Auto-Generate" button (generates checklist message)
   - Add custom message (optional): "Please fix and resubmit"
   - Click "Send Feedback" button

5. **Verify in WhatsApp:**
   - Open Velo Test group
   - Should see message: `@27640412391 ❌ DR9999999 REJECTED`
   - With checklist of what passed/failed
   - Sender should get notification

6. **Check database:**
   ```bash
   psql 'postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require' \
     -c "SELECT drop_number, submitted_by, feedback_sent FROM qa_photo_reviews WHERE drop_number = 'DR9999999';"

   # Should show:
   # - submitted_by: 27640412391@s.whatsapp.net
   # - feedback_sent: [timestamp]
   ```

### Step 12: Deploy to Production

**Only after dev testing passes!**

```bash
# Merge to master
git checkout master
git merge develop
git push origin master

# Deploy to production
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 \
  "cd /var/www/fibreflow && git pull && npm ci && npm run build && pm2 restart fibreflow-prod"

# Test at: https://app.fibreflow.app/wa-monitor
```

---

## Troubleshooting

### Bridge Not Sending Messages

**Check HTTP server:**
```bash
curl http://localhost:8080/send-message
```

If connection refused:
- Bridge HTTP server not started
- Check logs for startup errors
- Verify `go startHTTPServer()` is in main()

### Drop Has No submitted_by

**Cause:** Drop was created before feature was deployed

**Solution:** Only new drops (after deployment) will have sender info

**Check:**
```sql
SELECT drop_number, submitted_by, created_at
FROM qa_photo_reviews
ORDER BY created_at DESC
LIMIT 10;
```

### Message Sent But No Mention

**Cause:** Mention format incorrect in Go code

**Check logs:**
```bash
tail -100 /opt/velo-test-monitor/logs/whatsapp-bridge.log | grep "Sent feedback"
```

**Verify mention format:**
```go
ExtendedTextMessage: &waProto.ExtendedTextMessage{
  Text: proto.String(fmt.Sprintf("@%s %s", mentionedJID.User, req.Message)),
  ContextInfo: &waProto.ContextInfo{
    MentionedJid: []string{req.RecipientJID},
  },
}
```

### API Returns 400: Missing submitted_by

**Cause:** Drop was created before feature deployed

**Fix:** Only send feedback for new drops, OR manually update old drops:
```sql
-- Manually set submitted_by for old drops (if you know the sender)
UPDATE qa_photo_reviews
SET submitted_by = '27640412391@s.whatsapp.net'
WHERE drop_number = 'DR1234567';
```

---

## Rollback Process

If something goes wrong:

```bash
ssh root@72.60.17.245

# Stop new bridge
pkill whatsapp-bridge

# Restore old bridge
cd /opt/velo-test-monitor/services/whatsapp-bridge
mv whatsapp-bridge whatsapp-bridge.broken
mv whatsapp-bridge.old whatsapp-bridge

# OR restore from backup
cp main.go.backup.feedback_* main.go
/usr/local/go/bin/go build -o whatsapp-bridge main.go

# Start old bridge
nohup ./whatsapp-bridge > /opt/velo-test-monitor/logs/whatsapp-bridge.log 2>&1 &

# Verify
tail -f /opt/velo-test-monitor/logs/whatsapp-bridge.log
```

---

## Configuration Reference

### Project to Group JID Mapping

**In API:** `/pages/api/wa-monitor-send-feedback.ts` (lines 16-33)

```typescript
const PROJECT_GROUPS: Record<string, { jid: string; name: string }> = {
  'Velo Test': {
    jid: '120363421664266245@g.us',
    name: 'Velo Test'
  },
  'Lawley': {
    jid: '120363418298130331@g.us',
    name: 'Lawley Activation 3'
  },
  'Mohadin': {
    jid: '120363421532174586@g.us',
    name: 'Mohadin Activations 🥳'
  },
  'Mamelodi': {
    jid: '120363408849234743@g.us',
    name: 'Mamelodi POP1 Activations'
  }
};
```

### WhatsApp Bridge Port

- **Port:** 8080
- **Endpoint:** `http://localhost:8080/send-message`
- **Method:** POST
- **Body:** JSON with `group_jid`, `recipient_jid`, `message`

---

## Files Modified

| File | Location | Change |
|------|----------|--------|
| Database | `qa_photo_reviews` table | Added `submitted_by` column |
| API | `/pages/api/wa-monitor-send-feedback.ts` | Updated to use mentions |
| Bridge | `/opt/velo-test-monitor/services/whatsapp-bridge/main.go` | Added HTTP server + send capability |

---

## Next Steps (After Deployment)

1. **Monitor usage:** Watch how QA reviewers use the feature
2. **Gather feedback:** Are messages clear? Useful?
3. **Phase 2 ideas:**
   - Auto-send toggle (optional automatic feedback)
   - Custom templates (save common messages)
   - Feedback history (track what was sent)
   - Analytics (how many approvals vs rejections)

---

**Last Updated:** November 10, 2025
**Created By:** Claude Code
**Status:** Ready for deployment
