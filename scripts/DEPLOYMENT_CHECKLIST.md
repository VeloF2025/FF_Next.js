# Monitor.py Deployment Checklist

**File:** `/home/louisdup/VF/Apps/FF_React/scripts/monitor-updated.py`
**Target:** `/opt/wa-monitor/prod/modules/monitor.py` (VPS)
**Date:** November 14, 2025

---

## Pre-Deployment Verification ✅

- [x] **Kill switch variable defined** (Line 17)
- [x] **Kill switch check in send function** (Lines 206-209)
- [x] **Mamelodi added to validation list** (Line 302)
- [x] **Skip log message updated** (Line 321)
- [x] **All existing code preserved**
- [x] **Line count acceptable** (368 lines, +9 from original)
- [x] **Diff review completed** (4 changes verified)

---

## Step 1: Backup Current Production File

```bash
ssh root@72.60.17.245 "cp /opt/wa-monitor/prod/modules/monitor.py /opt/wa-monitor/prod/modules/monitor.py.backup-$(date +%Y%m%d-%H%M%S)"
```

**Verify backup created:**
```bash
ssh root@72.60.17.245 "ls -lh /opt/wa-monitor/prod/modules/monitor.py*"
```

Expected output:
```
-rw-r--r-- 1 root root 12K Nov 14 12:00 monitor.py
-rw-r--r-- 1 root root 12K Nov 14 12:09 monitor.py.backup-20251114-120900
```

---

## Step 2: Upload Updated File to VPS

```bash
sshpass -p "$VPS_SSH_PASSWORD" scp \
  /home/louisdup/VF/Apps/FF_React/scripts/monitor-updated.py \
  root@72.60.17.245:/opt/wa-monitor/prod/modules/monitor.py
```

**Verify upload:**
```bash
ssh root@72.60.17.245 "ls -lh /opt/wa-monitor/prod/modules/monitor.py && md5sum /opt/wa-monitor/prod/modules/monitor.py"
```

**Compare local and remote checksums:**
```bash
# Local checksum
md5sum /home/louisdup/VF/Apps/FF_React/scripts/monitor-updated.py

# Remote checksum (from previous command)
# Should match!
```

---

## Step 3: Restart Monitor Service (CRITICAL: Use Safe Restart)

**⚠️ MUST use safe restart script to clear Python bytecode cache!**

```bash
ssh root@72.60.17.245 "/opt/wa-monitor/prod/restart-monitor.sh"
```

**Expected output:**
```
Stopping wa-monitor-prod...
Clearing Python cache...
Starting wa-monitor-prod...
Monitor restarted successfully.
```

**Verify service running:**
```bash
ssh root@72.60.17.245 "systemctl status wa-monitor-prod"
```

Expected status: **active (running)**

---

## Step 4: Verify Deployment in Logs

**Check startup logs (last 50 lines):**
```bash
ssh root@72.60.17.245 "tail -50 /opt/wa-monitor/prod/logs/wa-monitor-prod.log"
```

**Look for:**
- ✅ "📂 Loaded state: X groups tracked"
- ✅ "🔄 Monitoring 4 projects..." (or current count)
- ✅ No error messages
- ✅ Timestamp matches current time

**Watch live logs (Ctrl+C to exit):**
```bash
ssh root@72.60.17.245 "tail -f /opt/wa-monitor/prod/logs/wa-monitor-prod.log"
```

---

## Step 5: Test Kill Switch Behavior (Optional)

**Test in Dev Environment First (Recommended):**

```bash
# SSH to VPS
ssh root@72.60.17.245

# Edit dev systemd service
nano /etc/systemd/system/wa-monitor-dev.service

# Add this line in [Service] section:
# Environment="ENABLE_WHATSAPP_MESSAGES=false"

# Reload and restart
systemctl daemon-reload
systemctl restart wa-monitor-dev

# Post test drop to Velo Test group: DR1111111

# Check logs for kill switch message
tail -f /opt/wa-monitor/dev/logs/wa-monitor-dev.log | grep "Message NOT sent"
```

**Expected log entry:**
```
2025-11-14 12:15:30,123 - WARNING - 🚫 Message NOT sent (kill switch active): ❌ Invalid Drop Number...
```

**Re-enable messages:**
```bash
# Remove Environment line from service file
nano /etc/systemd/system/wa-monitor-dev.service

systemctl daemon-reload
systemctl restart wa-monitor-dev
```

---

## Step 6: Verify Mamelodi Validation (After Loading Valid Drops)

**Prerequisites:**
- Load Mamelodi valid drops to database first (see below)

**Post test drop to Mamelodi group:**
- Valid drop: Should be accepted
- Invalid drop: Should be rejected with WhatsApp reply

**Watch Mamelodi validation logs:**
```bash
ssh root@72.60.17.245 "tail -f /opt/wa-monitor/prod/logs/wa-monitor-prod.log | grep Mamelodi"
```

**Check for:**
- ✅ "📱 Found drop: DRXXXXXX in Mamelodi"
- ✅ "✅ VALIDATED: DRXXXXXX is valid for Mamelodi" (valid drop)
- ❌ "❌ INVALID DROP: DRXXXXXX not in valid list for Mamelodi" (invalid drop)
- ✅ WhatsApp reply sent to submitter

**Check invalid drop submissions:**
```bash
ssh root@72.60.17.245 "psql \$DATABASE_URL -c \"
  SELECT drop_number, project, sender, submitted_at
  FROM invalid_drop_submissions
  WHERE project = 'Mamelodi'
  ORDER BY submitted_at DESC
  LIMIT 5;
\""
```

---

## Step 7: Load Mamelodi Valid Drops (Required for Validation)

**Prerequisites:**
- Export valid drop numbers from SharePoint (Mamelodi project)
- Format as CSV with `drop_number` column

**Option 1: Use existing sync script (if adapted):**
```bash
# Edit script to change project name to 'Mamelodi'
nano /home/louisdup/VF/Apps/FF_React/scripts/sync-mohadin-valid-drops.js

# Change line:
# const PROJECT_NAME = 'Mohadin';
# To:
# const PROJECT_NAME = 'Mamelodi';

# Run script
node /home/louisdup/VF/Apps/FF_React/scripts/sync-mohadin-valid-drops.js
```

**Option 2: Create new Mamelodi-specific script:**
```bash
# Copy Mohadin script as template
cp scripts/sync-mohadin-valid-drops.js scripts/sync-mamelodi-valid-drops.js

# Edit to set project = 'Mamelodi' and SharePoint paths
nano scripts/sync-mamelodi-valid-drops.js

# Run new script
node scripts/sync-mamelodi-valid-drops.js
```

**Verify drops loaded:**
```bash
psql $DATABASE_URL -c "
  SELECT project, COUNT(*) as drop_count
  FROM valid_drop_numbers
  GROUP BY project
  ORDER BY project;
"
```

**Expected output:**
```
  project  | drop_count
-----------+------------
 Lawley    |      XXXX
 Mamelodi  |      XXXX  ← Should appear here
 Mohadin   |     22140
(3 rows)
```

---

## Step 8: Verify All Projects

**Check validation status for all projects:**
```bash
ssh root@72.60.17.245 "tail -100 /opt/wa-monitor/prod/logs/wa-monitor-prod.log | grep -E '(VALIDATED|SKIPPED VALIDATION)'"
```

**Expected behavior:**
- **Mohadin**: "✅ VALIDATED: DRXXXXXX is valid for Mohadin"
- **Lawley**: "✅ VALIDATED: DRXXXXXX is valid for Lawley"
- **Mamelodi**: "✅ VALIDATED: DRXXXXXX is valid for Mamelodi"
- **Velo Test**: "⏭️ SKIPPED VALIDATION: DRXXXXXX (Velo Test passes through)"

---

## Step 9: Monitor Production (24 Hours)

**Set up monitoring alerts (if available):**

```bash
# Watch for errors
ssh root@72.60.17.245 "tail -f /opt/wa-monitor/prod/logs/wa-monitor-prod.log | grep -E '(ERROR|❌)'"

# Watch for rejections
ssh root@72.60.17.245 "tail -f /opt/wa-monitor/prod/logs/wa-monitor-prod.log | grep 'REJECTED'"

# Watch for kill switch triggers (should be none if disabled)
ssh root@72.60.17.245 "tail -f /opt/wa-monitor/prod/logs/wa-monitor-prod.log | grep 'kill switch'"
```

**Check hourly for first 4 hours, then daily for 1 week.**

---

## Rollback Procedure (If Issues Occur)

**If deployment causes problems:**

```bash
# SSH to VPS
ssh root@72.60.17.245

# Restore backup
cp /opt/wa-monitor/prod/modules/monitor.py /opt/wa-monitor/prod/modules/monitor.py.failed
cp /opt/wa-monitor/prod/modules/monitor.py.backup-YYYYMMDD-HHMMSS /opt/wa-monitor/prod/modules/monitor.py

# Restart with safe script
/opt/wa-monitor/prod/restart-monitor.sh

# Verify rollback
tail -50 /opt/wa-monitor/prod/logs/wa-monitor-prod.log
```

---

## Success Criteria ✅

Deployment is successful when:

- [ ] Service restarts without errors
- [ ] All 4 projects appear in logs
- [ ] Mohadin validation still working (22,140 drops)
- [ ] Lawley validation still working
- [ ] Mamelodi validation active (after loading drops)
- [ ] Velo Test bypasses validation (unchanged)
- [ ] Kill switch can be toggled (tested in dev)
- [ ] No unexpected errors in logs for 24 hours

---

## Troubleshooting

### Issue: Service won't start

**Solution:**
```bash
# Check for Python syntax errors
ssh root@72.60.17.245 "python3 -m py_compile /opt/wa-monitor/prod/modules/monitor.py"

# Check service status
ssh root@72.60.17.245 "systemctl status wa-monitor-prod -l"

# Check logs
ssh root@72.60.17.245 "journalctl -u wa-monitor-prod -n 50"
```

### Issue: Validation not working for Mamelodi

**Solution:**
```bash
# Verify drops loaded
psql $DATABASE_URL -c "SELECT COUNT(*) FROM valid_drop_numbers WHERE project = 'Mamelodi';"

# Check validation code path
ssh root@72.60.17.245 "grep -n \"in \['Mohadin\" /opt/wa-monitor/prod/modules/monitor.py"
# Should show: if project_name in ['Mohadin', 'Lawley', 'Mamelodi']:
```

### Issue: Kill switch not working

**Solution:**
```bash
# Check environment variable
ssh root@72.60.17.245 "systemctl show wa-monitor-prod | grep ENABLE_WHATSAPP_MESSAGES"

# Check code has kill switch
ssh root@72.60.17.245 "grep -n ENABLE_WHATSAPP_MESSAGES /opt/wa-monitor/prod/modules/monitor.py"
# Should show: Line 17 (definition) and Line 208 (check)
```

---

## Post-Deployment Documentation

**After successful deployment:**

1. Update `CLAUDE.md` - Add Mamelodi to monitored groups list
2. Update `docs/wa-monitor/DROP_VALIDATION_SYSTEM.md` - Add Mamelodi to validation table
3. Update `docs/wa-monitor/README.md` - Document kill switch feature
4. Create deployment log entry in `docs/VPS/DEPLOYMENT_HISTORY.md`

**Example log entry:**
```markdown
### November 14, 2025 - Monitor.py v2.1 Update

**Changes:**
- Added global kill switch for WhatsApp messages (ENABLE_WHATSAPP_MESSAGES env var)
- Added Mamelodi to drop validation system
- Updated skip validation log message

**Files Changed:**
- `/opt/wa-monitor/prod/modules/monitor.py` (368 lines, +9 from v2.0)

**Testing:**
- [x] Kill switch tested in dev environment
- [x] Mamelodi validation active in production
- [x] All 4 projects monitored successfully

**Status:** ✅ Deployed successfully
```

---

## Files Generated During Update

1. **Updated monitor:** `/home/louisdup/VF/Apps/FF_React/scripts/monitor-updated.py`
2. **Change report:** `/home/louisdup/VF/Apps/FF_React/scripts/MONITOR_UPDATE_REPORT.md`
3. **Changes summary:** `/home/louisdup/VF/Apps/FF_React/scripts/CHANGES_SUMMARY.txt`
4. **Unified diff:** `/home/louisdup/VF/Apps/FF_React/scripts/monitor-changes.diff`
5. **This checklist:** `/home/louisdup/VF/Apps/FF_React/scripts/DEPLOYMENT_CHECKLIST.md`

---

## Contact & Support

**Documentation:**
- Full guide: `docs/wa-monitor/DROP_VALIDATION_SYSTEM.md`
- Quick reference: `docs/wa-monitor/VALIDATION_QUICK_REFERENCE.md`
- VPS management: `docs/VPS/DEPLOYMENT.md`

**Quick Commands Reference:**
```bash
# View logs
ssh root@72.60.17.245 "tail -f /opt/wa-monitor/prod/logs/wa-monitor-prod.log"

# Restart service
ssh root@72.60.17.245 "/opt/wa-monitor/prod/restart-monitor.sh"

# Check validation data
psql $DATABASE_URL -c "SELECT project, COUNT(*) FROM valid_drop_numbers GROUP BY project;"

# Check rejections
psql $DATABASE_URL -c "SELECT * FROM invalid_drop_submissions ORDER BY submitted_at DESC LIMIT 10;"
```

---

**Deployment Checklist Version:** 1.0
**Last Updated:** November 14, 2025
**Status:** ✅ Ready for production deployment
