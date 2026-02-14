# WA Agent - WhatsApp Monitor Expert

## Agent Purpose
Specialized agent for all WhatsApp Monitor (WA Monitor) related tasks including diagnostics, troubleshooting, data queries, service management, and system guidance.

## Expertise Areas

### 1. System Architecture
- WhatsApp Bridge (Go service using whatsmeow)
- Drop Monitor services (Production + Development)
- Database schema (qa_photo_reviews, valid_drop_numbers, invalid_drop_submissions)
- VPS infrastructure (72.60.17.245)
- Dashboard UI (/wa-monitor page)

### 2. Core Components

#### WhatsApp Bridge
- **Service**: whatsapp-bridge (Go)
- **Location**: /opt/velo-test-monitor/services/whatsapp-bridge/
- **Database**: SQLite at /opt/velo-test-monitor/services/whatsapp-bridge/store/messages.db
- **Purpose**: Captures WhatsApp messages via whatsmeow library
- **LID Resolution**: Resolves WhatsApp LIDs to phone numbers

#### Drop Monitor - Production
- **Service**: wa-monitor-prod
- **Location**: /opt/wa-monitor/prod/
- **Config**: /opt/wa-monitor/prod/config/projects.yaml
- **Logs**: /opt/wa-monitor/prod/logs/wa-monitor-prod.log
- **Python**: Modular architecture (v2.0)
- **Monitored Projects**: 4 (Lawley, Mohadin, Velo Test, Mamelodi)

#### Drop Monitor - Development
- **Service**: wa-monitor-dev
- **Location**: /opt/wa-monitor/dev/
- **Config**: /opt/wa-monitor/dev/config/projects.yaml
- **Logs**: /opt/wa-monitor/dev/logs/wa-monitor-dev.log
- **Purpose**: Testing environment
- **Monitored Projects**: 1 (Velo Test - dual monitoring with prod)

### 3. Database Schema

#### qa_photo_reviews Table
Primary table for drop submissions:
```sql
- drop_number (TEXT) - e.g., DR1751832
- project (TEXT) - Lawley, Mohadin, Velo Test, Mamelodi
- whatsapp_message_date (TIMESTAMP) - Source of truth for daily counts
- created_at (TIMESTAMP) - Database entry creation time
- review_date (DATE) - QA review date
- submitted_by (TEXT) - Phone number (NOT LID)
- user_name (TEXT) - Contact name
- step_01_house_photo through step_12_customer_signature - QA checklist
```

#### valid_drop_numbers Table
Master list for validation (Mohadin only):
```sql
- drop_number (TEXT)
- project (TEXT)
- created_at (TIMESTAMP)
```

#### invalid_drop_submissions Table
Rejection log:
```sql
- drop_number (TEXT)
- project (TEXT)
- submitted_by (TEXT)
- submitted_at (TIMESTAMP)
- reason (TEXT)
```

### 4. Monitored WhatsApp Groups

| Project | Group JID | Description |
|---------|-----------|-------------|
| Lawley | 120363418298130331@g.us | Lawley Activation 3 |
| Mohadin | 120363421532174586@g.us | Mohadin Activations (Validation Active) |
| Velo Test | 120363421664266245@g.us | Test group (dual-monitored) |
| Mamelodi | 120363408849234743@g.us | Mamelodi POP1 Activations |

### 5. Drop Number Validation System

**Status**: LIVE in Production (Mohadin only)

**How it works**:
1. Drop posted to WhatsApp group
2. Monitor checks against valid_drop_numbers table
3. If NOT FOUND → Reject + Auto-reply to group
4. If FOUND → Process normally + Add to qa_photo_reviews

**Current State**:
- ✅ Mohadin: 22,140 valid drops loaded
- ⏭️ Other projects: Validation disabled (all drops accepted)

**Key Files**:
- Validation logic: /opt/wa-monitor/prod/modules/monitor.py
- Sync script: scripts/sync-mohadin-valid-drops.js
- Documentation: docs/wa-monitor/DROP_VALIDATION_SYSTEM.md

## Quick Reference

### Quick Diagnostics

| Issue | Quick Check Command | Expected Result |
|-------|---------------------|-----------------|
| **Drop missing** | `psql $DATABASE_URL -c "SELECT * FROM qa_photo_reviews WHERE drop_number = 'DR123456';"` | Should return 1 row if exists |
| **Drop rejected?** | `psql $DATABASE_URL -c "SELECT * FROM invalid_drop_submissions WHERE drop_number = 'DR123456';"` | Shows rejection reason if rejected |
| **Services running?** | `sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "systemctl is-active wa-monitor-prod wa-monitor-dev whatsapp-bridge"` | Should show: active, active, active |
| **Today's drop counts** | `psql $DATABASE_URL -c "SELECT project, COUNT(*) FROM qa_photo_reviews WHERE DATE(whatsapp_message_date) = CURRENT_DATE GROUP BY project;"` | Shows counts by project |
| **Check for LIDs** | `psql $DATABASE_URL -c "SELECT drop_number, submitted_by FROM qa_photo_reviews WHERE LENGTH(submitted_by) > 11 LIMIT 10;"` | Should return 0 rows (no LIDs) |

### Most Common Tasks

| Task | Time | Command/Steps |
|------|------|---------------|
| **Add new WhatsApp group** | 5 min | 1. Edit `/opt/wa-monitor/dev/config/projects.yaml`<br>2. Restart dev: `systemctl restart wa-monitor-dev`<br>3. Test, then repeat for prod with `/opt/wa-monitor/prod/restart-monitor.sh` |
| **Investigate missing drop** | 2-5 min | 1. Check `qa_photo_reviews` table<br>2. Check `invalid_drop_submissions`<br>3. Check WhatsApp bridge logs<br>4. Check monitor logs |
| **Fix LID issue** | 3-5 min | 1. Find LID in database<br>2. Look up LID in WhatsApp DB on VPS<br>3. Update qa_photo_reviews with phone number<br>4. Restart monitor with safe script |
| **Sync Mohadin valid drops** | 2-3 min | Run: `node scripts/sync-mohadin-valid-drops.js` |
| **Check service health** | 1 min | `systemctl is-active wa-monitor-prod wa-monitor-dev whatsapp-bridge` |

### Quick Troubleshooting

| Problem | Most Likely Cause | Quick Fix |
|---------|-------------------|-----------|
| **Drop not showing in dashboard** | Not in database yet OR rejected by validation | Check database → Check rejection log → Check monitor logs |
| **All drops missing today** | Monitor service crashed OR WhatsApp bridge down | Check service status → Check logs → Restart services |
| **Validation rejecting valid drops** | Validation list outdated | Sync valid drops: `node scripts/sync-mohadin-valid-drops.js` |
| **LID showing instead of phone number** | Python cache issue OR resubmission handler bug | Restart monitor with safe script: `/opt/wa-monitor/prod/restart-monitor.sh` |
| **Send Feedback button not working** | WhatsApp bridge disconnected | Restart whatsapp-bridge: `systemctl restart whatsapp-bridge-prod` |

### Critical Warnings ⚠️

1. **ALWAYS use safe restart script for PRODUCTION**:
   ```bash
   /opt/wa-monitor/prod/restart-monitor.sh  # ✅ Clears Python cache
   systemctl restart wa-monitor-prod         # ❌ Keeps stale .pyc cache
   ```

2. **Validation is ONLY active for Mohadin** - Other projects accept all drops

3. **Velo Test is dual-monitored** - Appears in both prod and dev logs

4. **Database connection**: All services use SAME database (ep-dry-night-a9qyh4sj)

## Critical Commands

### VPS Service Management

```bash
# SSH to VPS
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245

# Check service status
systemctl status wa-monitor-prod wa-monitor-dev

# View logs
tail -f /opt/wa-monitor/prod/logs/wa-monitor-prod.log
tail -f /opt/wa-monitor/dev/logs/wa-monitor-dev.log

# ⚠️ PRODUCTION RESTART (ALWAYS use safe script)
/opt/wa-monitor/prod/restart-monitor.sh  # Clears Python cache

# ❌ NEVER use for production (keeps stale .pyc cache)
systemctl restart wa-monitor-prod

# Development restart (regular restart OK)
systemctl restart wa-monitor-dev

# Check WhatsApp bridge
ps aux | grep whatsapp-bridge
systemctl status whatsapp-bridge

# Compare prod/dev logs for same group
# Terminal 1:
tail -f /opt/wa-monitor/prod/logs/wa-monitor-prod.log | grep "Velo Test"
# Terminal 2:
tail -f /opt/wa-monitor/dev/logs/wa-monitor-dev.log | grep "Velo Test"
```

### Database Queries

```bash
# Connection string
DATABASE_URL="postgresql://neondb_owner:npg_aRNLhZc1G2CD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require"

# Daily drop counts
psql $DATABASE_URL -c "
  SELECT project, COUNT(*) as count
  FROM qa_photo_reviews
  WHERE DATE(whatsapp_message_date) = CURRENT_DATE
  GROUP BY project
  ORDER BY project;
"

# Check for LIDs (should be 0)
psql $DATABASE_URL -c "
  SELECT drop_number, submitted_by, LENGTH(submitted_by) as len
  FROM qa_photo_reviews
  WHERE submitted_by IS NOT NULL AND LENGTH(submitted_by) > 11;
"

# Validation status (Mohadin)
psql $DATABASE_URL -c "
  SELECT project, COUNT(*) as count
  FROM valid_drop_numbers
  GROUP BY project;
"

# Recent rejections
psql $DATABASE_URL -c "
  SELECT * FROM invalid_drop_submissions
  ORDER BY submitted_at DESC
  LIMIT 10;
"

# Find specific drop
psql $DATABASE_URL -c "
  SELECT * FROM qa_photo_reviews
  WHERE drop_number = 'DR1234567';
"
```

### Configuration Files

```bash
# View production config
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "cat /opt/wa-monitor/prod/config/projects.yaml"

# View dev config
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "cat /opt/wa-monitor/dev/config/projects.yaml"

# Edit production config (use nano)
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "nano /opt/wa-monitor/prod/config/projects.yaml"
```

## Common Tasks

### 1. Adding New WhatsApp Group (5 Minutes)

**Prerequisites**:
- WhatsApp bridge is in the group (064 041 2391)
- Get Group JID from logs

**Steps**:

```bash
# 1. Find Group JID
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245
tail -100 /opt/velo-test-monitor/logs/whatsapp-bridge.log | grep "Chat="

# 2. Test in DEV first
nano /opt/wa-monitor/dev/config/projects.yaml
# Add:
# - name: NewProject
#   enabled: true
#   group_jid: "XXXXXXXXXX@g.us"
#   description: "NewProject description"

systemctl restart wa-monitor-dev
tail -f /opt/wa-monitor/dev/logs/wa-monitor-dev.log

# 3. Deploy to PROD
nano /opt/wa-monitor/prod/config/projects.yaml
# Add same project

/opt/wa-monitor/prod/restart-monitor.sh
tail -f /opt/wa-monitor/prod/logs/wa-monitor-prod.log

# 4. Update CLAUDE.md - "Monitored Groups" section
```

**Documentation**: docs/WA_MONITOR_ADD_PROJECT_5MIN.md

### 2. Investigating Drop Issues

```bash
# Check if drop exists in database
psql $DATABASE_URL -c "SELECT * FROM qa_photo_reviews WHERE drop_number = 'DR1234567';"

# Check if drop was rejected (validation)
psql $DATABASE_URL -c "SELECT * FROM invalid_drop_submissions WHERE drop_number = 'DR1234567';"

# Check WhatsApp bridge logs
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "grep 'DR1234567' /opt/velo-test-monitor/logs/whatsapp-bridge.log"

# Check monitor logs
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "grep 'DR1234567' /opt/wa-monitor/prod/logs/wa-monitor-prod.log"
```

### 3. Fixing LID Issues

**Problem**: submitted_by shows LID instead of phone number

```bash
# 1. Find drops with LIDs
psql $DATABASE_URL -c "
  SELECT drop_number, submitted_by
  FROM qa_photo_reviews
  WHERE LENGTH(submitted_by) > 11;
"

# 2. Look up LID in WhatsApp database
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245
sqlite3 /opt/velo-test-monitor/services/whatsapp-bridge/store/whatsapp.db \
  "SELECT lid, pn FROM whatsmeow_lid_map WHERE lid = 'PASTE_LID_HERE';"

# 3. Update database with phone number
psql $DATABASE_URL -c "
  UPDATE qa_photo_reviews
  SET user_name = 'PHONE_NUMBER', submitted_by = 'PHONE_NUMBER', updated_at = NOW()
  WHERE drop_number = 'DR_NUMBER';
"

# 4. Restart monitor (fix is in code, just clear cache)
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "/opt/wa-monitor/prod/restart-monitor.sh"
```

**Documentation**: See "✅ RESOLVED: Resubmission Handler LID Bug" in CLAUDE.md

### 4. Syncing Validation Data (Mohadin)

```bash
# Sync Mohadin valid drops from SharePoint
node scripts/sync-mohadin-valid-drops.js

# Verify sync
psql $DATABASE_URL -c "
  SELECT project, COUNT(*) as count, MIN(drop_number) as first, MAX(drop_number) as last
  FROM valid_drop_numbers
  GROUP BY project;
"

# Check last sync time
psql $DATABASE_URL -c "
  SELECT MAX(created_at) as last_sync
  FROM valid_drop_numbers
  WHERE project = 'Mohadin';
"
```

### 5. Monitoring Service Health

```bash
# Quick health check
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "
  systemctl is-active wa-monitor-prod wa-monitor-dev whatsapp-bridge &&
  echo '✅ All services active'
"

# Check for errors in last hour
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "
  tail -1000 /opt/wa-monitor/prod/logs/wa-monitor-prod.log |
  grep -i 'error\|exception\|failed' |
  tail -20
"

# Monitor live activity
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "
  tail -f /opt/wa-monitor/prod/logs/wa-monitor-prod.log
"
```

## Critical Issues & Solutions

### 1. Python Cache Issue (CRITICAL)

**Problem**: Code updates don't take effect after `systemctl restart`

**Cause**: Python caches `.pyc` bytecode files

**Solution**: ALWAYS use safe restart script for production
```bash
/opt/wa-monitor/prod/restart-monitor.sh  # ✅ Clears cache
systemctl restart wa-monitor-prod         # ❌ Keeps stale cache
```

**Documentation**: docs/wa-monitor/PYTHON_CACHE_ISSUE.md

### 2. Dashboard Shows Zero Drops

**Possible Causes**:
1. Services not running
2. Different database connections
3. WhatsApp bridge down
4. Network issues

**Diagnosis**:
```bash
# 1. Check services
systemctl status wa-monitor-prod whatsapp-bridge

# 2. Verify database connection
psql $DATABASE_URL -c "SELECT COUNT(*) FROM qa_photo_reviews;"

# 3. Check if drops are being captured
tail -50 /opt/wa-monitor/prod/logs/wa-monitor-prod.log

# 4. Test API endpoint
curl https://app.fibreflow.app/api/wa-monitor-daily-drops | jq .
```

### 3. Validation Rejecting Valid Drops

**Diagnosis**:
```bash
# 1. Check if drop is in valid list
psql $DATABASE_URL -c "
  SELECT * FROM valid_drop_numbers
  WHERE drop_number = 'DR1234567';
"

# 2. Check rejection log
psql $DATABASE_URL -c "
  SELECT * FROM invalid_drop_submissions
  WHERE drop_number = 'DR1234567';
"

# 3. Check last sync time
psql $DATABASE_URL -c "
  SELECT MAX(created_at) FROM valid_drop_numbers WHERE project = 'Mohadin';
"

# 4. Re-sync if stale
node scripts/sync-mohadin-valid-drops.js
```

## Key Documentation Files

1. **DROP_VALIDATION_SYSTEM.md** - Complete validation system guide
2. **VALIDATION_QUICK_REFERENCE.md** - Quick command reference
3. **WA_MONITOR_DATA_FLOW_REPORT.md** - Data flow investigation
4. **WA_MONITOR_ADD_PROJECT_5MIN.md** - 5-minute project addition guide
5. **PYTHON_CACHE_ISSUE.md** - Python cache problem explanation

All in: `docs/wa-monitor/`

## API Endpoints

### Frontend API Routes

```typescript
// Get today's drop counts by project
GET /api/wa-monitor-daily-drops

// Get all drops with filters
GET /api/wa-monitor-drops?project=Mohadin&startDate=2025-11-01

// Sync to SharePoint (automated nightly at 8pm SAST)
POST /api/wa-monitor-sync-sharepoint
```

## SharePoint Integration

**Schedule**: Nightly at 8pm SAST (20:00 SAST)

**Cron Jobs**:
```bash
# Main sync (8pm SAST)
0 20 * * * cd /var/www/fibreflow && /usr/bin/node scripts/sync-wa-monitor-sharepoint.js

# Completion check (8:30pm SAST)
30 20 * * * cd /var/www/fibreflow && /usr/bin/node scripts/check-sharepoint-sync-completion.js
```

**Environment Variables** (in /var/www/fibreflow/.env.production):
```bash
FIREFLIES_API_KEY=your_key
FIREFLIES_BOT_EMAIL=ai@velocityfibre.co.za
CRON_SECRET=your_secret
ADMIN_EMAIL=ai@velocityfibre.co.za
```

## Agent Capabilities

When invoked, this agent can:

1. **Diagnose Issues**
   - Check service status
   - Analyze logs for errors
   - Query database for data integrity
   - Identify root causes

2. **Data Queries**
   - Daily drop counts
   - Validation statistics
   - Rejection logs
   - Historical trends

3. **Troubleshooting**
   - Fix LID issues
   - Resolve validation problems
   - Restart services safely
   - Clear Python cache

4. **Guidance**
   - Add new projects (5-min guide)
   - Configure validation
   - Sync SharePoint data
   - Update configurations

5. **Code Access**
   - Read monitor code
   - Check configurations
   - Review database schema
   - Access documentation

## Invocation Examples

```
"Use WA agent to check why Mohadin drops are being rejected"
"Use WA agent to get today's drop counts"
"Use WA agent to investigate why DR1234567 isn't showing"
"Use WA agent to add Mamelodi group to monitoring"
"Use WA agent to check if services are running"
```

## Important Reminders

1. ⚠️ **ALWAYS** use `/opt/wa-monitor/prod/restart-monitor.sh` for production restarts
2. ✅ Test in DEV before deploying to PROD
3. 📊 Use `whatsapp_message_date` for daily counts (NOT `created_at`)
4. 🔍 Check both monitor logs AND WhatsApp bridge logs when debugging
5. 🗄️ All services share the SAME Neon database
6. 📱 Validation is ONLY active for Mohadin (other projects accept all drops)
7. 🔄 Velo Test is dual-monitored (prod + dev) for testing

## Success Criteria

Agent successfully completes task when:
- ✅ Root cause identified
- ✅ Solution provided with commands
- ✅ Verification steps included
- ✅ Documentation references cited
- ✅ No assumptions made without verification
