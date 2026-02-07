# WA Monitor Database Configuration Guide

**Date Created:** 2025-11-09
**Last Updated:** 2025-11-09

## Purpose

This document ensures the WhatsApp Monitor (Drop Monitor) and FibreFlow production app ALWAYS use the same Neon PostgreSQL database.

## Critical Rule

**THE APP AND DROP MONITOR MUST USE THE SAME DATABASE AT ALL TIMES**

## Single Source of Truth Database

**Production Database (CORRECT):**
```
Host: ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech
Database: neondb
User: neondb_owner
Password: $NEON_DB_PASSWORD_OLD
Full URL: postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require
```

**Old Database (DEPRECATED - DO NOT USE):**
```
Host: ep-damp-credit-a857vku0-pooler.eastus2.azure.neon.tech ❌
```

## Configuration Files (Must All Match)

### 1. Drop Monitor Python Script

**File:** `/opt/velo-test-monitor/services/realtime_drop_monitor.py`
**Line:** 66

```python
NEON_DB_URL = os.getenv('NEON_DATABASE_URL', 'postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require')
```

**How to verify:**
```bash
ssh root@72.60.17.245 "grep -n 'NEON_DB_URL = os.getenv' /opt/velo-test-monitor/services/realtime_drop_monitor.py"
```

### 2. Drop Monitor Systemd Service

**File:** `/etc/systemd/system/drop-monitor.service`
**Section:** `[Service]`

```ini
Environment="NEON_DATABASE_URL=postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require"
```

**How to verify:**
```bash
ssh root@72.60.17.245 "cat /etc/systemd/system/drop-monitor.service | grep -A 1 Environment"
```

### 3. WhatsApp Bridge SQLite Path

**File:** `/opt/velo-test-monitor/services/realtime_drop_monitor.py`
**Line:** 65

```python
MESSAGES_DB_PATH = os.getenv('WHATSAPP_DB_PATH', '/opt/velo-test-monitor/services/whatsapp-bridge/store/messages.db')
```

**How to verify:**
```bash
ssh root@72.60.17.245 "ls -lh /opt/velo-test-monitor/services/whatsapp-bridge/store/messages.db"
```

### 4. FibreFlow Production App

**File:** `/var/www/fibreflow/.env.production`

```bash
DATABASE_URL=postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require&channel_binding=require
```

**How to verify:**
```bash
ssh root@72.60.17.245 "grep DATABASE_URL /var/www/fibreflow/.env.production"
```

## Full Verification Checklist

Run this complete verification to ensure everything is configured correctly:

```bash
#!/bin/bash
echo "=== WA Monitor Database Configuration Check ==="
echo ""

echo "1. Drop Monitor Script Database URL:"
ssh root@72.60.17.245 "grep 'NEON_DB_URL = os.getenv' /opt/velo-test-monitor/services/realtime_drop_monitor.py"
echo ""

echo "2. Drop Monitor Systemd Environment:"
ssh root@72.60.17.245 "systemctl show drop-monitor --property=Environment"
echo ""

echo "3. WhatsApp Bridge SQLite Path:"
ssh root@72.60.17.245 "grep 'MESSAGES_DB_PATH' /opt/velo-test-monitor/services/realtime_drop_monitor.py | head -1"
echo ""

echo "4. Production App Database URL:"
ssh root@72.60.17.245 "grep DATABASE_URL /var/www/fibreflow/.env.production"
echo ""

echo "5. Drop Monitor Service Status:"
ssh root@72.60.17.245 "systemctl status drop-monitor --no-pager | head -10"
echo ""

echo "6. Test Dashboard API:"
curl -s "https://app.fibreflow.app/api/wa-monitor-daily-drops" | jq '.data.drops'
echo ""

echo "=== Verification Complete ==="
```

## After Changing Database Configuration

**CRITICAL:** If you change the database URL in ANY configuration file, you MUST:

### Step 1: Update All 4 Configuration Files
Ensure all files listed above point to the same database.

### Step 2: Restart Drop Monitor
```bash
ssh root@72.60.17.245 "systemctl daemon-reload && systemctl restart drop-monitor"

# Verify it started successfully
ssh root@72.60.17.245 "systemctl status drop-monitor --no-pager"

# Check logs for "✅ Neon database connection OK"
ssh root@72.60.17.245 "tail -30 /opt/velo-test-monitor/logs/drop_monitor.log | grep 'Neon database'"
```

### Step 3: Rebuild Production App
Next.js bakes environment variables at build time, so you MUST rebuild:

```bash
ssh root@72.60.17.245 "cd /var/www/fibreflow && npm run build"
```

### Step 4: Restart Production App
```bash
ssh root@72.60.17.245 "pm2 restart fibreflow-prod"

# Wait for app to start
sleep 5

# Verify app is online
ssh root@72.60.17.245 "pm2 list | grep fibreflow-prod"
```

### Step 5: Verify Both Services Use Same Database
```bash
# Test dashboard API
curl -s "https://app.fibreflow.app/api/wa-monitor-daily-drops" | jq '.data'

# Check drop monitor logs
ssh root@72.60.17.245 "tail -20 /opt/velo-test-monitor/logs/drop_monitor.log"

# Direct database query to confirm
ssh root@72.60.17.245 "psql 'postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require' -c 'SELECT COUNT(*) as total_drops FROM qa_photo_reviews;'"
```

## Troubleshooting

### Issue: Dashboard shows different data than drop monitor logs

**Cause:** App and drop monitor are using different databases.

**Fix:**
1. Run verification checklist above
2. Find which configuration file has wrong database URL
3. Update it to match the correct database (ep-dry-night)
4. Follow "After Changing Database Configuration" steps

### Issue: Drop monitor fails to start with "relation 'installations' does not exist"

**Cause:** Script is trying to insert into wrong table or database doesn't have schema.

**Fix:**
1. Verify database URL is correct (ep-dry-night)
2. Check the NEW database has `qa_photo_reviews` table:
   ```bash
   ssh root@72.60.17.245 "psql 'postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require' -c '\dt qa_photo_reviews'"
   ```

### Issue: Drop monitor can't find WhatsApp database (/app/store/messages.db)

**Cause:** Hardcoded path is wrong (from old Docker setup).

**Fix:**
Update line 65 in `/opt/velo-test-monitor/services/realtime_drop_monitor.py`:
```python
MESSAGES_DB_PATH = os.getenv('WHATSAPP_DB_PATH', '/opt/velo-test-monitor/services/whatsapp-bridge/store/messages.db')
```

Then restart: `systemctl restart drop-monitor`

## Testing New Drops

After configuration changes, test with a new drop number in each WhatsApp group:

1. **Lawley** (120363418298130331@g.us): Send `DRTEST001`
2. **Mohadin** (120363421532174586@g.us): Send `DRTEST002`
3. **Velo Test** (120363421664266245@g.us): Send `DRTEST003`

Wait 15 seconds (drop monitor scan interval), then check:
```bash
curl -s "https://app.fibreflow.app/api/wa-monitor-daily-drops" | jq '.data.drops'
```

All 3 should appear in the dashboard.

## Related Documentation

- **Main Guide:** `CLAUDE.md` - Section "WhatsApp Monitor Integration"
- **Changelog:** `docs/CHANGELOG.md` - Entry "2025-11-09 - Complete Database Consolidation"
- **VPS Deployment:** `docs/VPS/DEPLOYMENT.md`
