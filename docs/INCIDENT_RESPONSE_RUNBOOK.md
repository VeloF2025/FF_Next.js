# Incident Response Runbook — FibreFlow

**Last Updated:** 2026-03-12  
**Owner:** Scribe  
**Cadence:** Review quarterly, update after each incident

---

## TLDR: Incident Decision Tree

| Symptom | Go To |
|---------|-------|
| **App is down / 500 errors** | [App Crash](#app-crash) |
| **WA Monitor not receiving messages** | [WA Monitor Down](#wa-monitor-down) |
| **Database slow / queries timing out** | [Database Performance](#database-performance) |
| **No outbound messages to WhatsApp** | [WA Send Failure](#wa-send-failure) |
| **Field users can't connect / sync fails** | [Field Connectivity](#field-connectivity) |
| **Data corruption / inconsistent state** | [Data Integrity](#data-integrity) |

---

## 1. App Crash

**Symptoms:** 500 errors, app won't start, logs are screaming  
**Impact:** Full system down, WA integration stalled  
**Time to resolve:** 5–15 min

### Step 1: Confirm status
```bash
# SSH to production server
ssh velo@production

# Check app process
pm2 status

# Check recent logs
tail -100 /var/log/fibreflow/app.log | grep ERROR
```

### Step 2: Check common causes
- **Out of memory:** `free -h` — if <500MB, restart app
- **Port conflict:** `lsof -i :3000` — kill conflicting process
- **Database unreachable:** `psql -h $DB_HOST -U $DB_USER -d fibreflow -c "SELECT 1"` — if fails, check DB server
- **Missing env var:** `grep CRITICAL app.log` — check `.env` file matches deployment

### Step 3: Recovery
```bash
# If restart fixes it
pm2 restart fibreflow

# If that doesn't work, check deployment
cd /home/velo/fibreflow-production
git status  # Check for uncommitted changes
pm2 logs fibreflow | tail -50  # Full context
```

### Step 4: Escalate if needed
- If DB is down → escalate to Infrastructure (Elon)
- If logs show code error → escalate to Dev (Elon)
- If unknown → capture logs and create issue

**Post-incident:** Update this runbook with what you found.

---

## 2. WA Monitor Down

**Symptoms:** WA webhook not triggering, messages stuck in queue, no incoming messages  
**Impact:** Field team can't contact HQ, procurement orders delayed  
**Time to resolve:** 10–20 min

### Step 1: Check WA Monitor service
```bash
ssh velo@production
pm2 status  # Look for "wa-monitor" service

# If crashed, restart
pm2 restart wa-monitor

# Check logs
pm2 logs wa-monitor | tail -50
```

### Step 2: Check WhatsApp Business API credential
- Is the token expired? Check `.env` → `WHATSAPP_TOKEN`
- Is the phone number linked? Log into Meta Business Manager and verify
- Is the webhook URL registered? In Meta Business Manager → Settings → Webhooks

**Common issues:**
- Token refreshed without updating `.env` → update and restart
- Phone number deregistered → re-register in Meta portal
- Webhook URL changed but not updated in Meta → go to Meta portal, update to current production URL

### Step 3: Send test message
```bash
# From app container
curl -X POST https://graph.instagram.com/v18.0/YOUR_PHONE_ID/messages \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "messaging_product": "whatsapp",
    "recipient_type": "individual",
    "to": "YOUR_TEST_PHONE",
    "type": "text",
    "text": { "preview_url": false, "body": "Test" }
  }'
```

If 200 → WA API is alive. If 401/403 → token is bad.

### Step 4: Check webhook logs
- Are incoming messages being received by the app? Check `/var/log/fibreflow/webhook.log`
- If webhook is unreachable, check firewall/reverse proxy (nginx config)

**Post-incident:** If it was a token issue, add token rotation check to deployment checklist.

---

## 3. Database Performance

**Symptoms:** Queries taking 10+ seconds, app hanging, timeouts  
**Impact:** Field users get stuck loading, orders slow to process  
**Time to resolve:** 5–20 min

### Step 1: Check DB connection pool
```bash
# From production server
psql -h $DB_HOST -U $DB_USER -d fibreflow -c "\d pg_stat_activity" | grep idle
```

If many idle connections → connection leak. Restart app.

### Step 2: Find slow queries
```bash
psql -h $DB_HOST -U $DB_USER -d fibreflow -c "
  SELECT query, mean_time, calls
  FROM pg_stat_statements
  ORDER BY mean_time DESC
  LIMIT 10;
"
```

### Step 3: Quick fixes
- **Missing index?** Check if the slow query is on a non-indexed column → create index
- **Table bloat?** Run `VACUUM ANALYZE` on slow table
- **Too many rows?** Check partition strategy (daily reports table growing unbounded?)

### Step 4: Escalate
If none of the above → escalate to Elon with the slow query output.

**Post-incident:** Document the fix (index, partition, code change).

---

## 4. WA Send Failure

**Symptoms:** Messages queued but never sent, no error in logs  
**Impact:** Outgoing notifications fail silently, users don't get order updates  
**Time to resolve:** 10–15 min

### Step 1: Check message queue
```bash
# From app container
SELECT id, to_phone, status, created_at, error
FROM wamessages
WHERE status = 'queued' OR status = 'failed'
ORDER BY created_at DESC
LIMIT 20;
```

### Step 2: Check WA API quota
- Log into Meta Business Manager → Apps → Whatsapp → Dashboard
- Look for "Rate Limit" or "Message Sending" quota
- If hit limit → wait 1 hour or request quota increase

### Step 3: Check recipient phone number format
- Must include country code: `+1234567890` (not `1234567890`)
- Check: `SELECT DISTINCT to_phone FROM wamessages WHERE status='failed' LIMIT 5;`

### Step 4: Retry messages
```bash
UPDATE wamessages
SET status = 'pending'
WHERE status = 'failed' AND created_at > now() - interval '1 hour';

-- Trigger app to retry
pm2 restart fibreflow
```

**Post-incident:** Check if this was rate limiting or phone format — add validation.

---

## 5. Field Connectivity

**Symptoms:** QField can't sync, offline mode stuck, data not uploading  
**Impact:** Field team data lost / lost productivity  
**Time to resolve:** 5–10 min

### Step 1: Check server uptime
```bash
ssh velo@production
uptime
df -h  # Check disk space
```

If disk full (>90%) → clean up logs or old database backups.

### Step 2: Check sync API
```bash
curl -X GET https://production.fibreflow.app/api/sync/status \
  -H "Authorization: Bearer TOKEN"
```

Should return 200 with sync status. If 500 → app is down ([see App Crash](#app-crash)).

### Step 3: Check QField configuration
- Field users: confirm your `.env` points to correct production URL
- Check DNS: `nslookup production.fibreflow.app`

### Step 4: Check network
- From field device: can you ping the server? `ping production.fibreflow.app`
- If no → network issue on field side (ISP, WiFi, etc.)

**Post-incident:** Document which field users were affected and recovery time.

---

## 6. Data Integrity

**Symptoms:** Duplicate records, missing data, inconsistent state (e.g., PO says approved but status says pending)  
**Impact:** Audit risk, business logic breaks, user trust damaged  
**Time to resolve:** 15–30 min + manual investigation

### Step 1: STOP all writes
```bash
# Immediately pause all data writes to prevent further corruption
# For FibreFlow: stop field sync, stop WA processing
pm2 stop fibreflow
pm2 stop wa-monitor

# Notify team immediately on comms-bridge
```

### Step 2: Identify the scope
```bash
# Which table is affected?
SELECT schemaname, tablename, n_live_tup, n_dead_tup
FROM pg_stat_user_tables
WHERE n_dead_tup > 10000  -- Bloated?
ORDER BY n_dead_tup DESC;
```

### Step 3: Backup immediately
```bash
pg_dump -h $DB_HOST -U $DB_USER fibreflow > /backup/fibreflow-corrupted-$(date +%s).sql
```

### Step 4: Investigate root cause
- Check app logs for unhandled exceptions during writes
- Check database triggers for bugs
- Check migration history — was a bad migration deployed?

### Step 5: Recovery strategy
- **Small scope (1–100 rows):** Manual fix in database
- **Large scope:** Restore from backup, replay clean transactions only
- **Code bug:** Fix code, redeploy, run recovery migration

**ESCALATE IMMEDIATELY:** This is critical. Message Elon.

---

## Incident Communication Template

Use this for quick team updates during any incident:

```
🚨 INCIDENT: [Brief title]
Status: [INVESTIGATING | IN PROGRESS | RESOLVED]
Impact: [What users can't do]
ETA: [Expected resolution time]
Owner: [Your name]

Details:
- What: [What's broken]
- When: [When did it start]
- Why: [Root cause if known]
- Next: [What we're doing now]

Updates every 5 min.
```

---

## Escalation Chain

| Severity | Owner | Contact |
|----------|-------|---------|
| App/DB down | Elon (CTO) | sessions_send → elon |
| WA integration broken | Elon (CTO) | sessions_send → elon |
| Data corruption | Elon (CTO) + Hein (Owner) | escalate immediately |
| Field connectivity | Elon (CTO) | sessions_send → elon |
| Unknown | Start with Elon | sessions_send → elon |

---

## Post-Incident Checklist

After each incident:

- [ ] Root cause documented
- [ ] Runbook updated with new scenario or fix
- [ ] This incident added to CHANGELOG.md
- [ ] Team debriefed (if serious)
- [ ] Preventive measure added to deployment checks

---

## Version History

| Date | Change | Author |
|------|--------|--------|
| 2026-03-12 | Initial runbook (v1) | Scribe |

---

**Questions?** Ask in comms or update this doc. Better runbook = faster recovery = less stress.
