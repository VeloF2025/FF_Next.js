# WhatsApp Backup Bridge Setup - +27 82 418 9511

**Date Created:** November 24, 2025
**Status:** Implementation Ready
**Purpose:** Backup WhatsApp bridge for failover redundancy

---

## Executive Summary

This document provides a complete plan to set up a **backup WhatsApp bridge** using phone number **+27 82 418 9511** alongside the existing production bridge (064 041 2391). The backup will be ready to take over if the primary bridge fails, and can optionally become the primary if it proves more reliable.

**Key Benefits:**
- ✅ **Zero-downtime failover** - Automatic or manual switchover
- ✅ **Redundancy** - Continue operations if primary bridge fails
- ✅ **Testing** - Validate backup without disrupting production
- ✅ **Flexibility** - Easy to swap primary/backup roles

---

## Current Infrastructure Analysis

### Existing Setup (Production)

```
Phone Number: 064 041 2391
    ↓
whatsapp-bridge-prod (Port 8080)
    ├─→ Captures WhatsApp messages from 4 groups
    ├─→ Stores in SQLite: /opt/velo-test-monitor/services/whatsapp-bridge/store/messages.db
    ├─→ Inserts drops to Neon PostgreSQL
    └─→ REST API for sending messages

Systemd Service: whatsapp-bridge-prod
Working Directory: /opt/velo-test-monitor/services/whatsapp-bridge
Binary: /opt/velo-test-monitor/services/whatsapp-bridge/whatsapp-bridge
Logs: /opt/velo-test-monitor/logs/whatsapp-bridge.log
```

**Monitored Groups:**
1. Lawley Activation 3 - `120363418298130331@g.us`
2. Mohadin Activations - `120363421532174586@g.us`
3. Velo Test - `120363421664266245@g.us`
4. Mamelodi POP1 Activations - `120363408849234743@g.us`

**Dependencies:**
- Drop Monitor Prod (`wa-monitor-prod`) - Reads from messages.db
- Drop Monitor Dev (`wa-monitor-dev`) - Reads from messages.db (Velo Test only)
- WhatsApp Sender (`whatsapp-sender`) - Uses +27 71 155 8396 for feedback

---

## Architecture Decision: Dual Bridge Strategy

### Option 1: Hot Standby (RECOMMENDED) ⭐

**Architecture:**
```
┌─────────────────────┐
│  WhatsApp Groups    │
│  (4 groups)         │
└──────────┬──────────┘
           │
           ├──────────────────────────┐
           │                          │
    ┌──────▼──────┐          ┌───────▼──────┐
    │ PRIMARY     │          │  BACKUP      │
    │ 064 041     │          │  082 418     │
    │ Port 8080   │          │  Port 8082   │
    └──────┬──────┘          └───────┬──────┘
           │                          │
           ├──────────────┬───────────┤
           │              │           │
    ┌──────▼──────┐ ┌────▼────┐ ┌───▼──────┐
    │ messages.db │ │ backup  │ │ backup   │
    │ (primary)   │ │ msgs.db │ │ neon.db  │
    └──────┬──────┘ └─────────┘ └──────────┘
           │
    ┌──────▼──────────────┐
    │  Drop Monitors      │
    │  Read from primary  │
    │  OR backup (config) │
    └─────────────────────┘
```

**How It Works:**
- Both bridges listen to all 4 groups simultaneously
- Both capture messages independently
- Monitors configured to read from PRIMARY by default
- On failure: Switch monitor config to BACKUP database
- No message loss during failover

**Pros:**
- ✅ **Zero message loss** - Both bridges capture in parallel
- ✅ **Instant failover** - Just change config pointer
- ✅ **Independent validation** - Compare databases to ensure reliability
- ✅ **Easy testing** - Test backup without affecting primary

**Cons:**
- ⚠️ Double storage (2 SQLite databases)
- ⚠️ Need to keep both numbers in all groups

---

### Option 2: Cold Standby (Simpler)

**Architecture:**
```
PRIMARY (064) → Active
BACKUP (082) → Stopped (service disabled)

On failure:
1. systemctl stop whatsapp-bridge-prod
2. systemctl start whatsapp-bridge-backup
```

**Pros:**
- ✅ Simpler setup
- ✅ Less resource usage

**Cons:**
- ❌ Message loss during failover window
- ❌ Requires manual intervention
- ❌ Can't test without stopping primary

**Decision: Use Option 1 (Hot Standby) for production reliability**

---

## Implementation Plan

### Phase 1: Directory Structure Setup (5 minutes)

Create isolated backup bridge directory:

```bash
ssh root@72.60.17.245

# Create backup bridge directory structure
mkdir -p /opt/whatsapp-bridge-backup/{store,logs}

# Copy main.go source code from primary
cp /opt/velo-test-monitor/services/whatsapp-bridge/main.go \
   /opt/whatsapp-bridge-backup/main.go

# Create empty databases
touch /opt/whatsapp-bridge-backup/store/messages.db
touch /opt/whatsapp-bridge-backup/store/whatsapp.db
```

**Directory Structure:**
```
/opt/whatsapp-bridge-backup/
├── main.go                    # Go source code (identical to primary)
├── whatsapp-bridge           # Compiled binary (after build)
├── store/
│   ├── messages.db           # Message storage (backup)
│   └── whatsapp.db           # WhatsApp session data (backup)
└── logs/
    └── whatsapp-bridge-backup.log
```

---

### Phase 2: Configuration Changes (10 minutes)

**Update main.go for backup configuration:**

```bash
cd /opt/whatsapp-bridge-backup
nano main.go
```

**Changes needed (lines to modify):**

```go
// Line ~50: Update port
const DEFAULT_PORT = "8082"  // Was 8080 (avoid conflict)

// Line ~85: Update database paths
const DEFAULT_MESSAGES_DB = "/opt/whatsapp-bridge-backup/store/messages.db"
const DEFAULT_WHATSAPP_DB = "/opt/whatsapp-bridge-backup/store/whatsapp.db"

// Line ~1200: Update Neon connection (same database)
NEON_DB_URL := os.Getenv("NEON_DATABASE_URL",
  "postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require")

// Line ~60: Add identifier to logs
log.Println("🔄 [BACKUP] WhatsApp Bridge starting...")
```

**Why these changes:**
- **Port 8082**: Avoids conflict with primary (8080) and sender (8081)
- **Separate SQLite databases**: Independent message storage
- **Same Neon database**: Both write to same PostgreSQL (deduplication handled)
- **Log identifier**: Easy to distinguish backup logs from primary

---

### Phase 3: Compile Backup Bridge (5 minutes)

```bash
cd /opt/whatsapp-bridge-backup

# Compile the backup bridge
/usr/local/go/bin/go build -o whatsapp-bridge main.go

# Verify binary created
ls -lh whatsapp-bridge
# Should show: ~30MB executable

# Set executable permissions
chmod +x whatsapp-bridge
```

---

### Phase 4: Create Systemd Service (10 minutes)

```bash
nano /etc/systemd/system/whatsapp-bridge-backup.service
```

**Service Configuration:**

```ini
[Unit]
Description=WhatsApp Bridge - BACKUP (082 418 9511)
After=network.target
StartLimitIntervalSec=0

[Service]
Type=simple
User=root
WorkingDirectory=/opt/whatsapp-bridge-backup
ExecStart=/opt/whatsapp-bridge-backup/whatsapp-bridge
Restart=always
RestartSec=10
StandardOutput=append:/opt/whatsapp-bridge-backup/logs/whatsapp-bridge-backup.log
StandardError=append:/opt/whatsapp-bridge-backup/logs/whatsapp-bridge-backup.log

# Environment variables
Environment="NEON_DATABASE_URL=postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require"
Environment="PORT=8082"
Environment="MESSAGES_DB=/opt/whatsapp-bridge-backup/store/messages.db"
Environment="WHATSAPP_DB=/opt/whatsapp-bridge-backup/store/whatsapp.db"

[Install]
WantedBy=multi-user.target
```

**Enable and start the service:**

```bash
# Reload systemd
systemctl daemon-reload

# Enable service (auto-start on boot)
systemctl enable whatsapp-bridge-backup

# Start the service
systemctl start whatsapp-bridge-backup

# Check status
systemctl status whatsapp-bridge-backup
```

---

### Phase 5: WhatsApp Pairing (5 minutes)

**Get the pairing code:**

```bash
# Watch logs for pairing code
tail -f /opt/whatsapp-bridge-backup/logs/whatsapp-bridge-backup.log

# You should see:
# 🔑 PAIRING CODE: XXXX-XXXX
# Valid for 10 minutes
```

**Pair the phone:**

1. Open WhatsApp on phone with **+27 82 418 9511**
2. Go to: **Settings** → **Linked Devices** → **Link a Device**
3. Enter the **XXXX-XXXX** pairing code from logs
4. Wait for confirmation

**Verify connection:**

```bash
# Check logs for success
tail -20 /opt/whatsapp-bridge-backup/logs/whatsapp-bridge-backup.log

# Should show:
# ✓ Connected to WhatsApp!
# ✓ Logged in as 27824189511
```

---

### Phase 6: Add Backup Number to WhatsApp Groups (15 minutes)

**CRITICAL: The backup number MUST be added to all 4 groups to capture messages.**

**Groups to update:**

1. **Lawley Activation 3** (`120363418298130331@g.us`)
   - Add participant: **+27 82 418 9511**

2. **Mohadin Activations** (`120363421532174586@g.us`)
   - Add participant: **+27 82 418 9511**

3. **Velo Test** (`120363421664266245@g.us`)
   - Add participant: **+27 82 418 9511**

4. **Mamelodi POP1 Activations** (`120363408849234743@g.us`)
   - Add participant: **+27 82 418 9511**

**Verification after adding:**

```bash
# Post a test drop to Velo Test group
# Check backup logs to confirm it captured the message

tail -f /opt/whatsapp-bridge-backup/logs/whatsapp-bridge-backup.log | grep "DR"

# Should show:
# [BACKUP] Received message: DR1234567 from 27715844472
```

---

### Phase 7: Database Deduplication Strategy

**Problem:** Both bridges write to same Neon database - need to prevent duplicate drops.

**Solution: Add bridge_source column**

```sql
-- Run this migration on Neon database
ALTER TABLE qa_photo_reviews
ADD COLUMN IF NOT EXISTS bridge_source VARCHAR(20) DEFAULT 'primary';

CREATE INDEX IF NOT EXISTS idx_drop_bridge
ON qa_photo_reviews(drop_number, bridge_source);
```

**Update both bridges' INSERT statement:**

**Primary Bridge (064):**
```sql
INSERT INTO qa_photo_reviews (
  drop_number, user_name, project, review_date, comment, bridge_source
) VALUES (
  $1, $2, $3, $4, $5, 'primary'
)
ON CONFLICT (drop_number) DO NOTHING;
```

**Backup Bridge (082):**
```sql
INSERT INTO qa_photo_reviews (
  drop_number, user_name, project, review_date, comment, bridge_source
) VALUES (
  $1, $2, $3, $4, $5, 'backup'
)
ON CONFLICT (drop_number) DO NOTHING;
```

**Benefits:**
- ✅ Only first bridge to see drop writes to database
- ✅ No duplicates
- ✅ Can track which bridge captured each drop
- ✅ Useful for reliability analysis

---

## Failover Configuration

### Automatic Failover (Recommended)

**Create failover monitoring script:**

```bash
nano /opt/whatsapp-bridge-backup/failover-monitor.sh
```

```bash
#!/bin/bash
# WhatsApp Bridge Failover Monitor
# Checks primary bridge health and switches to backup if needed

PRIMARY_HEALTH="http://localhost:8080/health"
BACKUP_HEALTH="http://localhost:8082/health"
CONFIG_FILE="/opt/wa-monitor/prod/config/bridge.yaml"

while true; do
  # Check primary health
  if ! curl -s -f "$PRIMARY_HEALTH" > /dev/null 2>&1; then
    echo "[$(date)] ⚠️ PRIMARY BRIDGE DOWN - Switching to backup"

    # Update monitor config to use backup
    sed -i 's|messages_db: /opt/velo-test-monitor/services/whatsapp-bridge/store/messages.db|messages_db: /opt/whatsapp-bridge-backup/store/messages.db|g' "$CONFIG_FILE"

    # Restart monitors to pick up new config
    systemctl restart wa-monitor-prod
    systemctl restart wa-monitor-dev

    echo "[$(date)] ✅ Switched to BACKUP bridge"
  else
    echo "[$(date)] ✓ Primary bridge healthy"
  fi

  sleep 60  # Check every minute
done
```

**Create systemd service for failover monitor:**

```bash
nano /etc/systemd/system/bridge-failover-monitor.service
```

```ini
[Unit]
Description=WhatsApp Bridge Failover Monitor
After=whatsapp-bridge-prod.service whatsapp-bridge-backup.service

[Service]
Type=simple
ExecStart=/opt/whatsapp-bridge-backup/failover-monitor.sh
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

**Enable failover monitoring:**

```bash
chmod +x /opt/whatsapp-bridge-backup/failover-monitor.sh
systemctl enable bridge-failover-monitor
systemctl start bridge-failover-monitor
```

---

### Manual Failover

**Switch to backup bridge manually:**

```bash
# 1. Update drop monitor config
nano /opt/wa-monitor/prod/config/bridge.yaml

# Change:
# messages_db: /opt/velo-test-monitor/services/whatsapp-bridge/store/messages.db
# To:
# messages_db: /opt/whatsapp-bridge-backup/store/messages.db

# 2. Restart monitors
systemctl restart wa-monitor-prod
systemctl restart wa-monitor-dev

# 3. Verify
tail -f /opt/wa-monitor/prod/logs/wa-monitor-prod.log
# Should show: [INFO] Connected to backup bridge database
```

**Switch back to primary:**

```bash
# Reverse the config change
nano /opt/wa-monitor/prod/config/bridge.yaml

# Change back to:
# messages_db: /opt/velo-test-monitor/services/whatsapp-bridge/store/messages.db

# Restart monitors
systemctl restart wa-monitor-prod
systemctl restart wa-monitor-dev
```

---

## Making 082 the Primary (Migration Plan)

**If backup bridge (082) proves more reliable and you want to make it primary:**

### Option A: Swap Service Names (Clean)

```bash
# 1. Stop both services
systemctl stop whatsapp-bridge-prod
systemctl stop whatsapp-bridge-backup

# 2. Rename systemd services
mv /etc/systemd/system/whatsapp-bridge-prod.service \
   /etc/systemd/system/whatsapp-bridge-prod-064.service

mv /etc/systemd/system/whatsapp-bridge-backup.service \
   /etc/systemd/system/whatsapp-bridge-prod.service

# 3. Update configs to reflect new roles
nano /etc/systemd/system/whatsapp-bridge-prod.service
# Update Description: "PRIMARY (082 418 9511)"
# Update WorkingDirectory: /opt/whatsapp-bridge-backup

nano /etc/systemd/system/whatsapp-bridge-prod-064.service
# Update Description: "BACKUP (064 041 2391)"
# Keep WorkingDirectory: /opt/velo-test-monitor/services/whatsapp-bridge

# 4. Reload and restart
systemctl daemon-reload
systemctl start whatsapp-bridge-prod
systemctl start whatsapp-bridge-prod-064

# 5. Update monitor configs
nano /opt/wa-monitor/prod/config/bridge.yaml
# messages_db: /opt/whatsapp-bridge-backup/store/messages.db (now primary)

# 6. Restart monitors
systemctl restart wa-monitor-prod
systemctl restart wa-monitor-dev
```

### Option B: Update Pointers (Quick)

```bash
# Just update monitor configs to point to 082's database
nano /opt/wa-monitor/prod/config/bridge.yaml
nano /opt/wa-monitor/dev/config/bridge.yaml

# Change messages_db to backup location
messages_db: /opt/whatsapp-bridge-backup/store/messages.db

# Restart monitors
systemctl restart wa-monitor-prod
systemctl restart wa-monitor-dev

# Keep service names as-is (backup is now "primary" in practice)
```

---

## Testing Plan

### Pre-Deployment Testing

**1. Test backup bridge locally (before pairing):**

```bash
# Run manually to test compilation
cd /opt/whatsapp-bridge-backup
./whatsapp-bridge

# Should start and show pairing code
# Press Ctrl+C to stop
```

**2. Test port availability:**

```bash
# Verify port 8082 is free
netstat -tuln | grep 8082
# Should return nothing (port available)
```

**3. Test database connections:**

```bash
# Test Neon connection
psql "postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require" \
  -c "SELECT COUNT(*) FROM qa_photo_reviews;"

# Should return current count
```

### Post-Deployment Testing

**1. Verify both bridges running:**

```bash
systemctl status whatsapp-bridge-prod
systemctl status whatsapp-bridge-backup

# Both should show: active (running)
```

**2. Test health endpoints:**

```bash
curl http://localhost:8080/health  # Primary
curl http://localhost:8082/health  # Backup

# Both should return: {"status":"ok","connected":true}
```

**3. Test message capture (parallel monitoring):**

```bash
# Post test drop to Velo Test group: DR9999999

# Check both logs
tail -20 /opt/velo-test-monitor/logs/whatsapp-bridge.log | grep "DR9999999"
tail -20 /opt/whatsapp-bridge-backup/logs/whatsapp-bridge-backup.log | grep "DR9999999"

# Both should show the message
```

**4. Test database insertion:**

```bash
# Check Neon database
psql $DATABASE_URL -c "
  SELECT drop_number, bridge_source, created_at
  FROM qa_photo_reviews
  WHERE drop_number = 'DR9999999';
"

# Should show only ONE entry (first bridge wins via ON CONFLICT)
```

**5. Test failover:**

```bash
# Simulate primary failure
systemctl stop whatsapp-bridge-prod

# Post another test drop: DR9999998

# Check backup captured it
tail -20 /opt/whatsapp-bridge-backup/logs/whatsapp-bridge-backup.log | grep "DR9999998"

# Check database
psql $DATABASE_URL -c "
  SELECT drop_number, bridge_source
  FROM qa_photo_reviews
  WHERE drop_number = 'DR9999998';
"

# Should show: DR9999998 | backup

# Restart primary
systemctl start whatsapp-bridge-prod
```

---

## Monitoring & Alerts

### Health Check Dashboard

**Create monitoring script:**

```bash
nano /opt/whatsapp-bridge-backup/health-check.sh
```

```bash
#!/bin/bash
# WhatsApp Bridges Health Monitor

PRIMARY_HEALTH="http://localhost:8080/health"
BACKUP_HEALTH="http://localhost:8082/health"

echo "========================================="
echo "WhatsApp Bridges Health Check"
echo "========================================="
echo ""

# Check primary
echo "PRIMARY (064 041 2391):"
if curl -s -f "$PRIMARY_HEALTH" > /dev/null 2>&1; then
  echo "  Status: ✅ ONLINE"
  echo "  Port: 8080"
  PRIMARY_UP=true
else
  echo "  Status: ❌ OFFLINE"
  PRIMARY_UP=false
fi

echo ""

# Check backup
echo "BACKUP (082 418 9511):"
if curl -s -f "$BACKUP_HEALTH" > /dev/null 2>&1; then
  echo "  Status: ✅ ONLINE"
  echo "  Port: 8082"
  BACKUP_UP=true
else
  echo "  Status: ❌ OFFLINE"
  BACKUP_UP=false
fi

echo ""

# Overall status
if [ "$PRIMARY_UP" = true ] && [ "$BACKUP_UP" = true ]; then
  echo "Overall: ✅ REDUNDANT (Both bridges operational)"
elif [ "$PRIMARY_UP" = true ]; then
  echo "Overall: ⚠️ DEGRADED (Primary only)"
elif [ "$BACKUP_UP" = true ]; then
  echo "Overall: ⚠️ DEGRADED (Backup only)"
else
  echo "Overall: ❌ CRITICAL (No bridges operational)"
fi

echo "========================================="
```

**Run health check:**

```bash
chmod +x /opt/whatsapp-bridge-backup/health-check.sh
/opt/whatsapp-bridge-backup/health-check.sh
```

---

## Service Management Commands

### Quick Reference

```bash
# === PRIMARY BRIDGE (064 041 2391) ===

# Status
systemctl status whatsapp-bridge-prod

# Logs
tail -f /opt/velo-test-monitor/logs/whatsapp-bridge.log

# Restart
systemctl restart whatsapp-bridge-prod

# Stop/Start
systemctl stop whatsapp-bridge-prod
systemctl start whatsapp-bridge-prod


# === BACKUP BRIDGE (082 418 9511) ===

# Status
systemctl status whatsapp-bridge-backup

# Logs
tail -f /opt/whatsapp-bridge-backup/logs/whatsapp-bridge-backup.log

# Restart
systemctl restart whatsapp-bridge-backup

# Stop/Start
systemctl stop whatsapp-bridge-backup
systemctl start whatsapp-bridge-backup


# === BOTH BRIDGES ===

# Status both
systemctl status whatsapp-bridge-prod whatsapp-bridge-backup

# Restart both
systemctl restart whatsapp-bridge-prod whatsapp-bridge-backup

# Health check
/opt/whatsapp-bridge-backup/health-check.sh

# Compare logs (same message in both)
diff <(tail -50 /opt/velo-test-monitor/logs/whatsapp-bridge.log) \
     <(tail -50 /opt/whatsapp-bridge-backup/logs/whatsapp-bridge-backup.log)


# === DROP MONITORS ===

# Status
systemctl status wa-monitor-prod wa-monitor-dev

# Which bridge are they using?
grep "messages_db" /opt/wa-monitor/prod/config/bridge.yaml
grep "messages_db" /opt/wa-monitor/dev/config/bridge.yaml
```

---

## Risk Assessment

### Risks & Mitigations

| Risk | Impact | Likelihood | Mitigation |
|------|--------|------------|------------|
| **Both bridges fail simultaneously** | High | Low | Implement watchdog for auto-restart |
| **Backup phone number suspended** | Medium | Low | Use established business number with proper registration |
| **Port conflict (8082 in use)** | Low | Low | Check port availability before deployment |
| **Database duplication despite ON CONFLICT** | Medium | Low | Add unique constraint on `drop_number` |
| **Configuration drift (primary vs backup)** | Medium | Medium | Use Git for both bridge configs, document all changes |
| **Failover monitor fails** | Medium | Low | Add watchdog for failover monitor itself |
| **Wrong bridge set as active in monitors** | Low | Medium | Color-code logs, add bridge identifier to all log messages |

### Rollback Plan

**If backup bridge causes issues:**

```bash
# 1. Stop backup bridge
systemctl stop whatsapp-bridge-backup
systemctl disable whatsapp-bridge-backup

# 2. Verify monitors using primary
grep "messages_db" /opt/wa-monitor/prod/config/bridge.yaml
# Should show: /opt/velo-test-monitor/services/whatsapp-bridge/store/messages.db

# 3. Restart primary if needed
systemctl restart whatsapp-bridge-prod

# 4. Remove backup number from WhatsApp groups (optional)
# Open each group, remove +27 82 418 9511

# 5. Archive backup setup
mv /opt/whatsapp-bridge-backup /opt/whatsapp-bridge-backup.disabled
```

---

## Success Criteria

Deployment is successful when:

- ✅ Both bridges show `active (running)` in systemctl status
- ✅ Both health endpoints return `{"status":"ok","connected":true}`
- ✅ Same test drop appears in BOTH bridge logs
- ✅ Only ONE entry in database (deduplication working)
- ✅ Failover test succeeds (primary stopped → backup continues)
- ✅ Dashboard shows drops correctly regardless of which bridge captured them
- ✅ No 404 or 500 errors in monitor logs
- ✅ Health check script shows "REDUNDANT (Both bridges operational)"

---

## Timeline Estimate

| Phase | Task | Duration |
|-------|------|----------|
| 1 | Directory structure setup | 5 min |
| 2 | Configuration changes | 10 min |
| 3 | Compile backup bridge | 5 min |
| 4 | Create systemd service | 10 min |
| 5 | WhatsApp pairing | 5 min |
| 6 | Add to WhatsApp groups | 15 min |
| 7 | Database deduplication | 10 min |
| 8 | Failover setup | 15 min |
| 9 | Testing | 30 min |
| **Total** | | **~2 hours** |

---

## Next Steps

1. **Immediate:**
   - [ ] Review this document with user
   - [ ] Confirm phone number +27 82 418 9511 is available
   - [ ] Verify phone has WhatsApp installed

2. **Pre-Implementation:**
   - [ ] Backup current primary bridge config
   - [ ] Test database migration (add bridge_source column)
   - [ ] Document current primary bridge performance baseline

3. **Implementation:**
   - [ ] Follow Phase 1-9 in sequence
   - [ ] Document any deviations or issues
   - [ ] Take screenshots of pairing process

4. **Post-Implementation:**
   - [ ] Monitor both bridges for 24 hours
   - [ ] Compare message capture rates
   - [ ] Decide if 082 should become primary

---

## Support & Troubleshooting

### Common Issues

**Issue: Backup bridge won't start**
```bash
# Check logs
journalctl -u whatsapp-bridge-backup -n 50

# Verify port available
netstat -tuln | grep 8082

# Check binary permissions
ls -l /opt/whatsapp-bridge-backup/whatsapp-bridge
```

**Issue: Pairing code not appearing**
```bash
# Check if already paired
cat /opt/whatsapp-bridge-backup/store/whatsapp.db

# If old session exists, clear it
rm /opt/whatsapp-bridge-backup/store/whatsapp.db
systemctl restart whatsapp-bridge-backup
```

**Issue: Duplicate drops in database**
```bash
# Check if ON CONFLICT is working
psql $DATABASE_URL -c "
  SELECT drop_number, COUNT(*)
  FROM qa_photo_reviews
  GROUP BY drop_number
  HAVING COUNT(*) > 1;
"

# If duplicates found, add unique constraint
psql $DATABASE_URL -c "
  ALTER TABLE qa_photo_reviews
  ADD CONSTRAINT unique_drop_number UNIQUE (drop_number);
"
```

---

## Related Documentation

- [WA Monitor Architecture v2](./WA_MONITOR_ARCHITECTURE_V2.md)
- [WhatsApp Architecture](./WHATSAPP_ARCHITECTURE.md)
- [Bridge Fix Nov 2025](./WA_MONITOR_BRIDGE_FIX_NOV2025.md)
- [Add Project 5 Min Guide](./WA_MONITOR_ADD_PROJECT_5MIN.md)

---

## Appendix: Configuration Files

### A. Primary Bridge Service (Current)

**Location:** `/etc/systemd/system/whatsapp-bridge-prod.service`

```ini
[Unit]
Description=WhatsApp Bridge - PRIMARY (064 041 2391)
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/velo-test-monitor/services/whatsapp-bridge
ExecStart=/opt/velo-test-monitor/services/whatsapp-bridge/whatsapp-bridge
Restart=always
RestartSec=10
StandardOutput=append:/opt/velo-test-monitor/logs/whatsapp-bridge.log
StandardError=append:/opt/velo-test-monitor/logs/whatsapp-bridge.log
Environment="NEON_DATABASE_URL=postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require"
Environment="PORT=8080"

[Install]
WantedBy=multi-user.target
```

### B. Backup Bridge Service (New)

**Location:** `/etc/systemd/system/whatsapp-bridge-backup.service`

(See Phase 4 above for full configuration)

### C. Drop Monitor Bridge Config (New)

**Location:** `/opt/wa-monitor/prod/config/bridge.yaml`

```yaml
# WhatsApp Bridge Configuration
# Which bridge database to read from

# PRIMARY (default)
messages_db: /opt/velo-test-monitor/services/whatsapp-bridge/store/messages.db
bridge_health_url: http://localhost:8080/health

# BACKUP (switch to this on primary failure)
# messages_db: /opt/whatsapp-bridge-backup/store/messages.db
# bridge_health_url: http://localhost:8082/health

# Failover settings
failover_enabled: true
health_check_interval: 60  # seconds
max_failures_before_switch: 3
```

---

**Document Version:** 1.0
**Last Updated:** November 24, 2025
**Author:** Claude Code (AI Assistant)
**Reviewed By:** Pending
**Status:** Ready for Implementation
