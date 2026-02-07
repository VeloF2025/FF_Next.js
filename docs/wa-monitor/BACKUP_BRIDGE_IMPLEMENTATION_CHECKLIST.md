# Backup Bridge Implementation Checklist - +27 82 418 9511

**Quick Reference:** Use this checklist during implementation
**Full Documentation:** See `BACKUP_BRIDGE_SETUP_082_NUMBER.md`

---

## Pre-Flight Checklist

- [ ] Phone +27 82 418 9511 has WhatsApp installed
- [ ] Phone is charged and ready for pairing
- [ ] VPS SSH access confirmed: `ssh root@72.60.17.245`
- [ ] Database credentials verified
- [ ] Current primary bridge is stable (check logs)
- [ ] Backup of primary bridge config taken

---

## Implementation Steps (2 Hours)

### Phase 1: Directory Setup (5 min)

```bash
ssh root@72.60.17.245

# Create directories
mkdir -p /opt/whatsapp-bridge-backup/{store,logs}

# Copy source code
cp /opt/velo-test-monitor/services/whatsapp-bridge/main.go \
   /opt/whatsapp-bridge-backup/main.go

# Verify
ls -la /opt/whatsapp-bridge-backup/
```

**Checklist:**
- [ ] Directory created at `/opt/whatsapp-bridge-backup/`
- [ ] `main.go` copied successfully
- [ ] `store/` and `logs/` subdirectories exist

---

### Phase 2: Configuration (10 min)

```bash
cd /opt/whatsapp-bridge-backup
nano main.go
```

**Changes to make:**

1. **Line ~50:** Change port
   ```go
   const DEFAULT_PORT = "8082"  // Was 8080
   ```

2. **Line ~85:** Update database paths
   ```go
   const DEFAULT_MESSAGES_DB = "/opt/whatsapp-bridge-backup/store/messages.db"
   const DEFAULT_WHATSAPP_DB = "/opt/whatsapp-bridge-backup/store/whatsapp.db"
   ```

3. **Line ~60:** Add identifier
   ```go
   log.Println("🔄 [BACKUP] WhatsApp Bridge starting...")
   ```

4. **Search for INSERT statement (~line 1165):** Add bridge_source
   ```sql
   INSERT INTO qa_photo_reviews (
     drop_number, user_name, project, review_date, comment, bridge_source
   ) VALUES (
     $1, $2, $3, $4, $5, 'backup'
   )
   ON CONFLICT (drop_number) DO NOTHING;
   ```

**Checklist:**
- [ ] Port changed to 8082
- [ ] Database paths updated
- [ ] Log identifier added
- [ ] Bridge source set to 'backup'
- [ ] ON CONFLICT clause added

---

### Phase 3: Compile (5 min)

```bash
cd /opt/whatsapp-bridge-backup

# Compile
/usr/local/go/bin/go build -o whatsapp-bridge main.go

# Verify
ls -lh whatsapp-bridge

# Set permissions
chmod +x whatsapp-bridge
```

**Checklist:**
- [ ] Compilation completed without errors
- [ ] Binary size ~30MB
- [ ] Executable permissions set

---

### Phase 4: Systemd Service (10 min)

```bash
nano /etc/systemd/system/whatsapp-bridge-backup.service
```

**Paste this configuration:**

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

Environment="NEON_DATABASE_URL=postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require"
Environment="PORT=8082"
Environment="MESSAGES_DB=/opt/whatsapp-bridge-backup/store/messages.db"
Environment="WHATSAPP_DB=/opt/whatsapp-bridge-backup/store/whatsapp.db"

[Install]
WantedBy=multi-user.target
```

**Enable and start:**

```bash
systemctl daemon-reload
systemctl enable whatsapp-bridge-backup
systemctl start whatsapp-bridge-backup
systemctl status whatsapp-bridge-backup
```

**Checklist:**
- [ ] Service file created
- [ ] Service enabled
- [ ] Service started successfully
- [ ] Status shows "active (running)"

---

### Phase 5: WhatsApp Pairing (5 min)

```bash
# Watch for pairing code
tail -f /opt/whatsapp-bridge-backup/logs/whatsapp-bridge-backup.log
```

**Look for:**
```
🔑 PAIRING CODE: XXXX-XXXX
Valid for 10 minutes
```

**Pairing steps:**
1. Open WhatsApp on phone with +27 82 418 9511
2. Go to: Settings → Linked Devices
3. Tap: Link a Device
4. Enter the XXXX-XXXX code from logs
5. Wait for confirmation

**Verify connection:**
```bash
tail -20 /opt/whatsapp-bridge-backup/logs/whatsapp-bridge-backup.log | grep "Connected"
```

**Checklist:**
- [ ] Pairing code appeared in logs
- [ ] Code entered in WhatsApp within 10 minutes
- [ ] Log shows "✓ Connected to WhatsApp!"
- [ ] Log shows "✓ Logged in as 27824189511"

---

### Phase 6: Add to WhatsApp Groups (15 min)

**Add +27 82 418 9511 to each group:**

1. **Lawley Activation 3**
   - Group JID: `120363418298130331@g.us`
   - [ ] Number added
   - [ ] Test message sent
   - [ ] Backup log shows message received

2. **Mohadin Activations**
   - Group JID: `120363421532174586@g.us`
   - [ ] Number added
   - [ ] Test message sent
   - [ ] Backup log shows message received

3. **Velo Test**
   - Group JID: `120363421664266245@g.us`
   - [ ] Number added
   - [ ] Test message sent
   - [ ] Backup log shows message received

4. **Mamelodi POP1 Activations**
   - Group JID: `120363408849234743@g.us`
   - [ ] Number added
   - [ ] Test message sent
   - [ ] Backup log shows message received

**Verification command:**
```bash
tail -f /opt/whatsapp-bridge-backup/logs/whatsapp-bridge-backup.log | grep "Received"
```

---

### Phase 7: Database Deduplication (10 min)

```bash
# Run database migration
psql "postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require" <<EOF
ALTER TABLE qa_photo_reviews
ADD COLUMN IF NOT EXISTS bridge_source VARCHAR(20) DEFAULT 'primary';

CREATE INDEX IF NOT EXISTS idx_drop_bridge
ON qa_photo_reviews(drop_number, bridge_source);
EOF
```

**Verify migration:**
```bash
psql "postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require" \
  -c "\d qa_photo_reviews" | grep bridge_source
```

**Update primary bridge INSERT statement:**

```bash
nano /opt/velo-test-monitor/services/whatsapp-bridge/main.go

# Find INSERT statement (~line 1165)
# Change to:
INSERT INTO qa_photo_reviews (
  drop_number, user_name, project, review_date, comment, bridge_source
) VALUES (
  $1, $2, $3, $4, $5, 'primary'
)
ON CONFLICT (drop_number) DO NOTHING;

# Recompile primary
cd /opt/velo-test-monitor/services/whatsapp-bridge
/usr/local/go/bin/go build -o whatsapp-bridge-new main.go
mv whatsapp-bridge whatsapp-bridge.old
mv whatsapp-bridge-new whatsapp-bridge
systemctl restart whatsapp-bridge-prod
```

**Checklist:**
- [ ] Column `bridge_source` added
- [ ] Index created
- [ ] Primary bridge updated and recompiled
- [ ] Primary bridge restarted
- [ ] Both bridges running

---

### Phase 8: Failover Setup (15 min)

**Create failover monitor script:**

```bash
nano /opt/whatsapp-bridge-backup/failover-monitor.sh
```

**Paste script:** (see full documentation for complete script)

```bash
chmod +x /opt/whatsapp-bridge-backup/failover-monitor.sh
```

**Create systemd service:**

```bash
nano /etc/systemd/system/bridge-failover-monitor.service
```

**Enable service:**

```bash
systemctl daemon-reload
systemctl enable bridge-failover-monitor
systemctl start bridge-failover-monitor
systemctl status bridge-failover-monitor
```

**Checklist:**
- [ ] Failover script created
- [ ] Script executable
- [ ] Systemd service created
- [ ] Service enabled and started

---

### Phase 9: Testing (30 min)

#### Test 1: Both Bridges Running

```bash
systemctl status whatsapp-bridge-prod whatsapp-bridge-backup
```

**Expected:** Both show "active (running)"

**Checklist:**
- [ ] Primary: active (running)
- [ ] Backup: active (running)

---

#### Test 2: Health Endpoints

```bash
curl http://localhost:8080/health
curl http://localhost:8082/health
```

**Expected:** Both return `{"status":"ok","connected":true}`

**Checklist:**
- [ ] Primary health OK
- [ ] Backup health OK

---

#### Test 3: Parallel Message Capture

**Post test drop to Velo Test:** `DR9999901`

```bash
# Check primary log
tail -20 /opt/velo-test-monitor/logs/whatsapp-bridge.log | grep "DR9999901"

# Check backup log
tail -20 /opt/whatsapp-bridge-backup/logs/whatsapp-bridge-backup.log | grep "DR9999901"
```

**Expected:** Both logs show the message

**Checklist:**
- [ ] Message appears in primary log
- [ ] Message appears in backup log
- [ ] Timestamps within 1 second

---

#### Test 4: Database Deduplication

```bash
psql "postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require" -c "
  SELECT drop_number, bridge_source, created_at
  FROM qa_photo_reviews
  WHERE drop_number = 'DR9999901';
"
```

**Expected:** Only ONE entry (first bridge wins)

**Checklist:**
- [ ] Only 1 row returned
- [ ] `bridge_source` is either 'primary' or 'backup'
- [ ] No duplicate entries

---

#### Test 5: Failover

**Simulate primary failure:**

```bash
systemctl stop whatsapp-bridge-prod
```

**Post another test drop:** `DR9999902`

```bash
# Check backup captured it
tail -20 /opt/whatsapp-bridge-backup/logs/whatsapp-bridge-backup.log | grep "DR9999902"

# Check database
psql "postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require" -c "
  SELECT drop_number, bridge_source
  FROM qa_photo_reviews
  WHERE drop_number = 'DR9999902';
"
```

**Expected:** Message captured by backup, database shows `bridge_source = 'backup'`

**Restart primary:**

```bash
systemctl start whatsapp-bridge-prod
```

**Checklist:**
- [ ] Backup captured message during primary outage
- [ ] Database shows correct bridge_source
- [ ] Primary restarted successfully
- [ ] Both bridges now active

---

#### Test 6: Dashboard Verification

```bash
curl https://app.fibreflow.app/api/wa-monitor-daily-drops | jq .
```

**Expected:** Test drops appear in today's count

**Checklist:**
- [ ] Dashboard accessible
- [ ] Today's drop count includes test drops
- [ ] No errors in API response

---

## Post-Implementation Monitoring (24 Hours)

### Hour 1: Immediate Monitoring

```bash
# Watch both logs
tmux new-session \; \
  split-window -h \; \
  send-keys "tail -f /opt/velo-test-monitor/logs/whatsapp-bridge.log" C-m \; \
  select-pane -t 0 \; \
  send-keys "tail -f /opt/whatsapp-bridge-backup/logs/whatsapp-bridge-backup.log" C-m
```

**Checklist:**
- [ ] No errors in either log
- [ ] Both bridges capturing messages
- [ ] No duplicate database entries

---

### Hour 6: Performance Check

```bash
# Compare message counts
psql "postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require" -c "
  SELECT bridge_source, COUNT(*) as message_count
  FROM qa_photo_reviews
  WHERE DATE(created_at) = CURRENT_DATE
  GROUP BY bridge_source;
"
```

**Expected:** Roughly 50/50 split (depends on timing)

**Checklist:**
- [ ] Both bridges capturing messages
- [ ] No significant performance issues
- [ ] CPU/memory usage normal

---

### Hour 24: Full Evaluation

```bash
# Health check
/opt/whatsapp-bridge-backup/health-check.sh

# Daily statistics
psql "postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require" -c "
  SELECT
    DATE(created_at) as date,
    bridge_source,
    COUNT(*) as drops
  FROM qa_photo_reviews
  WHERE created_at >= NOW() - INTERVAL '24 hours'
  GROUP BY DATE(created_at), bridge_source
  ORDER BY date DESC, bridge_source;
"
```

**Checklist:**
- [ ] Both bridges operational for 24 hours
- [ ] No unexpected restarts
- [ ] Message capture rate acceptable
- [ ] No database issues

---

## Success Criteria

**All must be checked:**

- [ ] Both bridges show "active (running)"
- [ ] Both health endpoints return OK
- [ ] Same messages appear in both logs
- [ ] Only one database entry per drop (deduplication works)
- [ ] Failover test passed (backup took over when primary stopped)
- [ ] Dashboard shows drops correctly
- [ ] No errors in monitor logs
- [ ] Health check shows "REDUNDANT (Both bridges operational)"
- [ ] 24-hour monitoring completed without issues

---

## Rollback Procedure

**If something goes wrong:**

```bash
# 1. Stop backup bridge
systemctl stop whatsapp-bridge-backup
systemctl disable whatsapp-bridge-backup

# 2. Stop failover monitor
systemctl stop bridge-failover-monitor
systemctl disable bridge-failover-monitor

# 3. Verify primary is working
systemctl status whatsapp-bridge-prod
curl http://localhost:8080/health

# 4. Check monitors using primary
tail -f /opt/wa-monitor/prod/logs/wa-monitor-prod.log

# 5. Archive backup setup
mv /opt/whatsapp-bridge-backup /opt/whatsapp-bridge-backup.disabled

# 6. Document what went wrong
nano /opt/whatsapp-bridge-backup.disabled/ROLLBACK_REASON.txt
```

---

## Decision Point: Make 082 Primary?

**After 24-hour monitoring, evaluate:**

**Make 082 Primary if:**
- ✅ Backup bridge more stable (fewer disconnects)
- ✅ Backup captures more messages
- ✅ No unexpected issues during testing

**Keep 064 Primary if:**
- ✅ Primary bridge performing well
- ✅ No clear advantage to switching
- ✅ Prefer stability over change

**Decision Date:** _____________

**Decision:** [ ] Keep 064 Primary  [ ] Switch to 082 Primary

**Implemented By:** _____________

---

## Contact & Support

**Issues During Implementation?**

1. Check logs: `tail -100 /opt/whatsapp-bridge-backup/logs/whatsapp-bridge-backup.log`
2. Check systemd: `journalctl -u whatsapp-bridge-backup -n 50`
3. Verify compilation: `file /opt/whatsapp-bridge-backup/whatsapp-bridge`
4. Test health: `curl http://localhost:8082/health`

**Common Issues:**
- **Pairing code not appearing:** Clear old session and restart service
- **Port conflict:** Check if 8082 in use: `netstat -tuln | grep 8082`
- **Database errors:** Verify Neon connection string and credentials
- **Messages not captured:** Verify number added to all groups

---

**Checklist Version:** 1.0
**Last Updated:** November 24, 2025
**Estimated Time:** 2 hours + 24 hour monitoring
**Difficulty:** Intermediate
