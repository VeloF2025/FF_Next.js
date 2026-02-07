# VPS Configuration Backup - November 9, 2025

## Backup Date
**Created:** 2025-11-09 18:20 UTC
**Git Commit:** 5bc82ab
**Git Tag:** v2.1.0-wa-resubmission
**Feature:** WA Monitor Resubmission Tracking

## What's Backed Up

### 1. **resubmission_handler.py**
- **Location:** `/opt/velo-test-monitor/services/resubmission_handler.py`
- **Purpose:** Handles drop number resubmissions
- **Key Configuration:**
  - Database URL: Correct Neon PostgreSQL connection
  - Sets `resubmitted=TRUE` on resubmission
  - Updates comment log
  - Clears incomplete flag

### 2. **ecosystem.config.js**
- **Location:** `/var/www/ecosystem.config.js`
- **Purpose:** PM2 process manager configuration
- **Key Configuration:**
  - `fibreflow-prod`: Port 3005, production app
  - `fibreflow-dev`: Port 3006, development app
  - **DATABASE_URL:** Correct Neon PostgreSQL connection string

### 3. **DATABASE_SCHEMA_CHANGES.md**
- Complete documentation of database schema changes
- Migration scripts for replicating to other databases
- Rollback procedures

## How to Restore

### If VPS Resubmission Handler Breaks:

```bash
# SSH into VPS
ssh root@72.60.17.245

# Backup current (broken) version
cp /opt/velo-test-monitor/services/resubmission_handler.py /opt/velo-test-monitor/services/resubmission_handler.py.broken

# From local machine, upload backup:
scp docs/VPS/backups/2025-11-09/resubmission_handler.py root@72.60.17.245:/opt/velo-test-monitor/services/

# Restart drop monitor
systemctl restart drop-monitor
systemctl status drop-monitor
```

### If PM2 Configuration Breaks:

```bash
# SSH into VPS
ssh root@72.60.17.245

# Backup current (broken) version
cp /var/www/ecosystem.config.js /var/www/ecosystem.config.js.broken

# From local machine, upload backup:
scp docs/VPS/backups/2025-11-09/ecosystem.config.js root@72.60.17.245:/var/www/

# Restart PM2 apps
pm2 delete all
pm2 start /var/www/ecosystem.config.js
pm2 save
```

### If Database Schema Needs Restoration:

See `DATABASE_SCHEMA_CHANGES.md` for:
- Column addition SQL
- Migration scripts
- Rollback procedures

## Critical Configuration Values

### Database Connection (Correct)
```
postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require&channel_binding=require
```

### VPS Paths
- Drop Monitor: `/opt/velo-test-monitor/services/realtime_drop_monitor.py`
- Resubmission Handler: `/opt/velo-test-monitor/services/resubmission_handler.py`
- WhatsApp Bridge: `/opt/velo-test-monitor/services/whatsapp-bridge/`
- Logs: `/opt/velo-test-monitor/logs/`
- Production App: `/var/www/fibreflow/`
- Dev App: `/var/www/fibreflow-dev/`

### PM2 Process Names
- `fibreflow-prod` - Production (port 3005)
- `fibreflow-dev` - Development (port 3006)
- `drop-monitor` - Systemd service (not PM2)

## Verification Commands

### Check Everything is Working:

```bash
# 1. Check drop monitor is running
systemctl status drop-monitor

# 2. Check PM2 apps
pm2 list

# 3. Test database connection
psql 'postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require' -c "SELECT COUNT(*) FROM qa_photo_reviews WHERE resubmitted=TRUE;"

# 4. Check production app
curl -s https://app.fibreflow.app/api/wa-monitor-drops | jq '.data[0] | {dropNumber, resubmitted}'

# 5. Check dashboard
curl -s https://app.fibreflow.app/wa-monitor | grep -o "Resubmission"
```

## Related Documentation

- **Main Docs:** `CLAUDE.md` - Complete system documentation
- **Deployment History:** `docs/VPS/DEPLOYMENT_HISTORY.md`
- **Database Setup:** `docs/WA_MONITOR_DATABASE_SETUP.md`
- **Adding Groups:** `docs/WA_MONITOR_ADD_GROUP.md`

## Next Steps After Restore

1. Restart all services
2. Test resubmission flow with a drop number
3. Verify dashboard shows resubmission badge
4. Check logs for errors
5. Confirm database updates correctly

## Contact

If you need to restore from this backup and encounter issues, check:
- Logs: `/opt/velo-test-monitor/logs/drop_monitor.log`
- PM2 logs: `pm2 logs`
- System logs: `journalctl -u drop-monitor -n 100`
