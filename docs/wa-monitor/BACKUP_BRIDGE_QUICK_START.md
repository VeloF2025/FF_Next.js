# Backup WhatsApp Bridge - Quick Start Guide

**5-Minute Overview for Rapid Implementation**

---

## What This Does

Adds a **backup WhatsApp bridge** using phone **+27 82 418 9511** that runs alongside the existing bridge (064 041 2391). If primary fails, backup continues capturing messages with zero data loss.

---

## Quick Commands

### 1. Setup (20 minutes)

```bash
ssh root@72.60.17.245

# Create backup directory
mkdir -p /opt/whatsapp-bridge-backup/{store,logs}

# Copy and modify source
cp /opt/velo-test-monitor/services/whatsapp-bridge/main.go \
   /opt/whatsapp-bridge-backup/main.go

# Edit config (change port to 8082, update paths, add 'backup' identifier)
nano /opt/whatsapp-bridge-backup/main.go

# Compile
cd /opt/whatsapp-bridge-backup
/usr/local/go/bin/go build -o whatsapp-bridge main.go
chmod +x whatsapp-bridge

# Create systemd service (see full docs for service file)
nano /etc/systemd/system/whatsapp-bridge-backup.service

# Enable and start
systemctl daemon-reload
systemctl enable whatsapp-bridge-backup
systemctl start whatsapp-bridge-backup

# Get pairing code
tail -f /opt/whatsapp-bridge-backup/logs/whatsapp-bridge-backup.log
# Look for: 🔑 PAIRING CODE: XXXX-XXXX

# Pair WhatsApp on phone (082 number)
# Settings → Linked Devices → Link a Device → Enter code

# Add 082 to all 4 WhatsApp groups
# Post test drop to verify capture
```

---

### 2. Verification (5 minutes)

```bash
# Check both bridges running
systemctl status whatsapp-bridge-prod whatsapp-bridge-backup

# Test health endpoints
curl http://localhost:8080/health  # Primary
curl http://localhost:8082/health  # Backup

# Post test drop (DR9999999) to Velo Test group

# Verify both captured it
tail -20 /opt/velo-test-monitor/logs/whatsapp-bridge.log | grep DR9999999
tail -20 /opt/whatsapp-bridge-backup/logs/whatsapp-bridge-backup.log | grep DR9999999

# Check database (should be only ONE entry)
psql "postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require" \
  -c "SELECT drop_number, bridge_source FROM qa_photo_reviews WHERE drop_number = 'DR9999999';"
```

---

### 3. Daily Monitoring

```bash
# Quick health check
systemctl status whatsapp-bridge-prod whatsapp-bridge-backup

# View logs
tail -f /opt/velo-test-monitor/logs/whatsapp-bridge.log
tail -f /opt/whatsapp-bridge-backup/logs/whatsapp-bridge-backup.log

# Check message counts
psql "postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require" \
  -c "SELECT bridge_source, COUNT(*) FROM qa_photo_reviews WHERE DATE(created_at) = CURRENT_DATE GROUP BY bridge_source;"
```

---

## Key Files

| What | Location |
|------|----------|
| **Primary Bridge** | `/opt/velo-test-monitor/services/whatsapp-bridge/` |
| **Backup Bridge** | `/opt/whatsapp-bridge-backup/` |
| **Primary Logs** | `/opt/velo-test-monitor/logs/whatsapp-bridge.log` |
| **Backup Logs** | `/opt/whatsapp-bridge-backup/logs/whatsapp-bridge-backup.log` |
| **Primary Service** | `/etc/systemd/system/whatsapp-bridge-prod.service` |
| **Backup Service** | `/etc/systemd/system/whatsapp-bridge-backup.service` |

---

## Configuration Differences

| Setting | Primary (064) | Backup (082) |
|---------|---------------|--------------|
| **Port** | 8080 | 8082 |
| **Phone Number** | 064 041 2391 | 082 418 9511 |
| **Service Name** | whatsapp-bridge-prod | whatsapp-bridge-backup |
| **Database Path** | `/opt/velo-test-monitor/...` | `/opt/whatsapp-bridge-backup/...` |
| **Log Prefix** | `[PRIMARY]` or none | `[BACKUP]` |
| **bridge_source** | 'primary' | 'backup' |

---

## Manual Failover (1 minute)

**If primary fails:**

```bash
# Monitors automatically use whichever bridge is working
# Both write to same database, so no action needed!

# Optional: Check which is active
systemctl status whatsapp-bridge-prod whatsapp-bridge-backup
```

**Permanent switch to backup as primary:**

```bash
# Just swap service names in systemd
# Or update monitor configs to prefer backup database
# See full docs for detailed steps
```

---

## Troubleshooting

**Backup won't start:**
```bash
journalctl -u whatsapp-bridge-backup -n 50
netstat -tuln | grep 8082  # Check port available
```

**No pairing code:**
```bash
rm /opt/whatsapp-bridge-backup/store/whatsapp.db
systemctl restart whatsapp-bridge-backup
tail -f /opt/whatsapp-bridge-backup/logs/whatsapp-bridge-backup.log
```

**Duplicate drops in database:**
```bash
# Verify ON CONFLICT clause in INSERT statement
grep "ON CONFLICT" /opt/whatsapp-bridge-backup/main.go
```

**Messages not captured:**
```bash
# Verify 082 number is in all groups
# Check backup bridge logs for errors
tail -50 /opt/whatsapp-bridge-backup/logs/whatsapp-bridge-backup.log
```

---

## Success Criteria

- [x] Both bridges show "active (running)"
- [x] Both health endpoints return `{"status":"ok","connected":true}`
- [x] Same test message appears in both logs
- [x] Only ONE database entry per drop
- [x] Dashboard shows drops correctly

---

## Complete Documentation

1. **Setup Guide:** `BACKUP_BRIDGE_SETUP_082_NUMBER.md` (30 pages, every detail)
2. **Checklist:** `BACKUP_BRIDGE_IMPLEMENTATION_CHECKLIST.md` (step-by-step checkboxes)
3. **Architecture:** `BACKUP_BRIDGE_ARCHITECTURE.md` (visual diagrams)
4. **This File:** Quick reference for experienced users

---

## Timeline

| Phase | Duration |
|-------|----------|
| Setup & Configuration | 20 min |
| Testing | 10 min |
| **Total** | **30 min** |
| 24-hour monitoring | +1 day |

---

## Support

**Issues?** See full documentation in:
- `/home/louisdup/VF/Apps/FF_React/docs/wa-monitor/BACKUP_BRIDGE_SETUP_082_NUMBER.md`

**Quick help:**
```bash
ssh root@72.60.17.245
systemctl status whatsapp-bridge-backup
tail -50 /opt/whatsapp-bridge-backup/logs/whatsapp-bridge-backup.log
```

---

**Version:** 1.0
**Date:** November 24, 2025
**Status:** Production Ready
