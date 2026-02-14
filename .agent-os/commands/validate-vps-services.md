# /validate-vps-services

Comprehensive validation of VPS infrastructure, services, and system health.

## Overview

This command validates the foundational VPS infrastructure that all FibreFlow systems depend on.

**System Tested**:
```
VPS Server (72.60.17.245)
├── System Health (CPU, Memory, Disk, Load)
├── Critical Services (wa-monitor, whatsapp-bridge, nginx)
├── Network (Internet, DNS, HTTPS)
├── PM2 Applications (fibreflow-prod, fibreflow-dev)
└── Configuration (Nginx, SSL, Directories)
```

**Test Coverage**: 20+ individual tests across 7 scenarios
**Expected Duration**: 2-3 minutes
**Pass Criteria**: All critical tests pass (18/21 minimum)

---

## Prerequisites Check

### 1. Verify VPS Access
```bash
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "echo 'VPS accessible'"
```
**Expected**: "VPS accessible"
**On Failure**: Cannot proceed - check network/credentials

---

## SCENARIO 1: System Health

### Test 1.1: CPU Usage

**Purpose**: Verify CPU usage is below critical threshold

**Command**:
```bash
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "top -bn1 | grep 'Cpu(s)' | awk '{print 100 - \$8}' | cut -d. -f1"
```

**Expected Output**: Number 0-100

**Pass Criteria**:
- CPU usage < 80%
- Numeric value

**Fail Criteria**:
- CPU ≥ 80%

**On Failure**:
1. Check top consumers:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "ps aux --sort=-%cpu | head -5"
   ```
2. Report: "CPU usage high ([X]%). Top processes: [list]"

---

### Test 1.2: Memory Usage

**Purpose**: Verify memory usage is below critical threshold

**Command**:
```bash
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "free | grep Mem | awk '{printf \"%.0f\", \$3/\$2 * 100}'"
```

**Expected Output**: Number 0-100

**Pass Criteria**:
- Memory usage < 85%

**Fail Criteria**:
- Memory ≥ 85%

**On Failure**:
1. Show memory details:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "free -h"
   ```
2. Check top consumers:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "ps aux --sort=-%mem | head -5"
   ```
3. Report: "Memory usage high ([X]%). Consider optimization."

---

### Test 1.3: Disk Usage

**Purpose**: Verify disk space is available

**Command**:
```bash
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "df -h / | tail -1 | awk '{print \$5}' | sed 's/%//'"
```

**Expected Output**: Number 0-100

**Pass Criteria**:
- Disk usage < 90%

**Fail Criteria**:
- Disk ≥ 90%

**On Failure**:
1. Check disk breakdown:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "df -h"
   ```
2. Find large directories:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "du -sh /var/log /var/www /opt 2>/dev/null"
   ```
3. Report: "Disk usage high ([X]%). Clean up logs or temp files."

---

### Test 1.4: System Load

**Purpose**: Verify system load is reasonable

**Command**:
```bash
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "cat /proc/loadavg | awk '{print \$1}'"
```

**Expected Output**: Load average number

**Pass Criteria**:
- Load reasonable (< cores × 2)

**Fail Criteria**:
- Load very high (> cores × 3)

**On Failure**:
1. Check CPU cores:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "nproc"
   ```
2. Check uptime:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "uptime"
   ```
3. Report: "Load average [X] on [Y] cores. Investigate if sustained."

**Note**: Mark as WARNING (not FAIL) unless extremely high.

---

## SCENARIO 2: Critical Services

### Test 2.1: wa-monitor-prod Service

**Purpose**: Verify production monitor is running

**Command**:
```bash
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "systemctl is-active wa-monitor-prod"
```

**Expected Output**: `active`

**Pass Criteria**:
- Output = "active"

**Fail Criteria**:
- Output ≠ "active"

**On Failure** (with self-correction):
1. Check status:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "systemctl status wa-monitor-prod"
   ```
2. Attempt safe restart:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "/opt/wa-monitor/prod/restart-monitor.sh"
   ```
3. Wait 5 seconds
4. Re-test
5. Report outcome

**Critical**: Blocking test for WA Monitor functionality.

---

### Test 2.2: wa-monitor-dev Service

**Purpose**: Verify development monitor is running

**Command**:
```bash
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "systemctl is-active wa-monitor-dev"
```

**Expected Output**: `active`

**Pass Criteria**: Same as 2.1

**On Failure**: Same as 2.1 but with `systemctl restart wa-monitor-dev`

**Note**: Mark as WARNING if fails (dev less critical).

---

### Test 2.3: WhatsApp Bridge

**Purpose**: Verify WhatsApp bridge is capturing messages

**Command**:
```bash
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "pgrep -f whatsapp-bridge | wc -l"
```

**Expected Output**: Number > 0

**Pass Criteria**:
- At least 1 process running

**Fail Criteria**:
- No processes (count = 0)

**On Failure** (diagnostics only):
1. Check process details:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "ps aux | grep whatsapp-bridge | grep -v grep"
   ```
2. Report: "WhatsApp bridge not running. Manual restart required (DO NOT auto-restart)."

**Critical**: Blocking test, but DO NOT auto-restart.

---

### Test 2.4: Nginx Web Server

**Purpose**: Verify web server is running

**Command**:
```bash
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "systemctl is-active nginx"
```

**Expected Output**: `active`

**Pass Criteria**:
- Output = "active"

**Fail Criteria**:
- Output ≠ "active"

**On Failure** (with self-correction):
1. Check configuration:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "nginx -t 2>&1"
   ```
2. If config OK, restart:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "systemctl restart nginx"
   ```
3. Wait 3 seconds
4. Re-test
5. Report outcome

**Critical**: Blocking test for web accessibility.

---

## SCENARIO 3: Network Connectivity

### Test 3.1: Internet Access

**Purpose**: Verify VPS can reach external internet

**Command**:
```bash
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "ping -c 3 -W 2 8.8.8.8 | grep 'received' | awk '{print \$4}'"
```

**Expected Output**: `3`

**Pass Criteria**:
- All 3 packets received
- No packet loss

**Fail Criteria**:
- Packet loss
- Timeout

**On Failure**:
1. Check network interfaces:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "ip addr show | grep 'inet '"
   ```
2. Try alternative:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "ping -c 2 1.1.1.1 | grep 'received'"
   ```
3. Report: "No internet connectivity. Check network configuration or contact VPS provider."

**Critical**: Blocking test for external integrations.

---

### Test 3.2: DNS Resolution

**Purpose**: Verify DNS is working

**Command**:
```bash
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "nslookup google.com 2>&1 | grep -A1 'Name:' | tail -1 | grep -c '[0-9]*\.[0-9]*\.[0-9]*\.[0-9]*'"
```

**Expected Output**: `1` (IP found)

**Pass Criteria**:
- DNS resolves successfully
- IP address returned

**Fail Criteria**:
- Resolution fails
- No IP returned

**On Failure**:
1. Check DNS config:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "cat /etc/resolv.conf"
   ```
2. Report: "DNS resolution failing. Check /etc/resolv.conf."

---

### Test 3.3: HTTPS Accessibility

**Purpose**: Verify production site is accessible externally

**Command**:
```bash
curl -s -o /dev/null -w "%{http_code}" --connect-timeout 5 https://app.fibreflow.app
```

**Expected Output**: `200` or `30X`

**Pass Criteria**:
- HTTP status 200-399
- Site responds

**Fail Criteria**:
- Status 500+
- Connection refused
- Timeout

**On Failure**:
1. Check from VPS:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "curl -I localhost:3005 2>&1 | head -1"
   ```
2. Report: "HTTPS not accessible. App: [status], check Nginx and firewall."

---

## SCENARIO 4: PM2 Applications

### Test 4.1: PM2 Running

**Purpose**: Verify PM2 is managing processes

**Command**:
```bash
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "pm2 jlist 2>/dev/null | jq 'length'"
```

**Expected Output**: Number ≥ 2

**Pass Criteria**:
- At least 2 processes
- PM2 responding

**Fail Criteria**:
- PM2 not found
- No processes

**On Failure**:
1. Check PM2:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "which pm2 && pm2 list"
   ```
2. Report: "PM2 not managing processes. Check PM2 installation."

---

### Test 4.2: Production App Online

**Purpose**: Verify fibreflow-prod is running

**Command**:
```bash
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "pm2 jlist 2>/dev/null | jq '.[] | select(.name==\"fibreflow-prod\") | .pm2_env.status' -r"
```

**Expected Output**: `online`

**Pass Criteria**:
- Status = "online"

**Fail Criteria**:
- Status ≠ "online"
- App not found

**On Failure** (with self-correction):
1. Check logs:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "pm2 logs fibreflow-prod --lines 20 --nostream --err"
   ```
2. Attempt restart:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "pm2 restart fibreflow-prod"
   ```
3. Wait 5 seconds
4. Re-test
5. Report outcome

**Critical**: Blocking test for production app.

---

### Test 4.3: Development App Online

**Purpose**: Verify fibreflow-dev is running

**Command**:
```bash
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "pm2 jlist 2>/dev/null | jq '.[] | select(.name==\"fibreflow-dev\") | .pm2_env.status' -r"
```

**Expected Output**: `online`

**Pass Criteria**: Same as 4.2

**On Failure**: Same as 4.2

**Note**: Mark as WARNING if fails (dev less critical).

---

### Test 4.4: Low Restart Counts

**Purpose**: Verify apps aren't crashing frequently

**Command**:
```bash
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "pm2 jlist 2>/dev/null | jq '.[] | select(.name==\"fibreflow-prod\") | .pm2_env.restart_time'"
```

**Expected Output**: Number

**Pass Criteria**:
- Restart count < 5

**Fail Criteria**:
- Restart count > 10

**On Failure**:
1. Check both apps:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "pm2 list"
   ```
2. Report: "App restarting frequently ([X] times). Check logs for crashes."

**Note**: Mark as WARNING (not FAIL) unless extremely high.

---

## SCENARIO 5: Nginx Configuration

### Test 5.1: Config Syntax Valid

**Purpose**: Verify Nginx configuration is syntactically correct

**Command**:
```bash
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "nginx -t 2>&1 | grep -c 'syntax is ok'"
```

**Expected Output**: `1`

**Pass Criteria**:
- Syntax OK message found

**Fail Criteria**:
- Syntax errors

**On Failure**:
1. Show errors:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "nginx -t 2>&1"
   ```
2. Report: "Nginx configuration invalid. Errors: [details]. DO NOT reload Nginx."

---

### Test 5.2: SSL Certificate Valid

**Purpose**: Verify SSL certificates are valid and not expiring soon

**Command**:
```bash
curl --insecure -vvI https://app.fibreflow.app 2>&1 | grep 'expire date' | head -1
```

**Expected Output**: Date string

**Pass Criteria**:
- Certificate valid
- Not expiring in < 7 days

**Fail Criteria**:
- Certificate expired
- Expiring soon (< 7 days)

**On Failure**:
1. Check certbot:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "certbot certificates 2>&1"
   ```
2. Report: "SSL certificate issue. Check expiry and renewal."

**Note**: Mark as WARNING if expiring 7-30 days, FAIL if < 7 days or expired.

---

### Test 5.3: Logs Accessible

**Purpose**: Verify Nginx logs are readable

**Command**:
```bash
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "test -r /var/log/nginx/fibreflow-access.log && echo 'OK' || echo 'FAIL'"
```

**Expected Output**: `OK`

**Pass Criteria**:
- File readable

**Fail Criteria**:
- Permission denied
- File not found

**On Failure**:
1. Check permissions:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "ls -la /var/log/nginx/fibreflow-access.log"
   ```
2. Report: "Cannot access Nginx logs. Check permissions."

---

## SCENARIO 6: Directory Structure

### Test 6.1: Critical Directories Exist

**Purpose**: Verify all expected directories exist

**Command**:
```bash
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "test -d /opt/wa-monitor/prod && test -d /opt/wa-monitor/dev && test -d /var/www/fibreflow && test -d /var/www/fibreflow-dev && echo 'OK' || echo 'MISSING'"
```

**Expected Output**: `OK`

**Pass Criteria**:
- All directories exist

**Fail Criteria**:
- Any directory missing

**On Failure**:
1. Check which missing:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "for dir in /opt/wa-monitor/prod /opt/wa-monitor/dev /var/www/fibreflow /var/www/fibreflow-dev; do test -d \$dir && echo \"\$dir: OK\" || echo \"\$dir: MISSING\"; done"
   ```
2. Report: "Missing directories: [list]. Check deployment."

---

### Test 6.2: Log Directories Writable

**Purpose**: Verify services can write logs

**Command**:
```bash
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "touch /opt/wa-monitor/prod/logs/test.tmp && rm /opt/wa-monitor/prod/logs/test.tmp && echo 'OK' || echo 'FAIL'"
```

**Expected Output**: `OK`

**Pass Criteria**:
- Can write to log directory

**Fail Criteria**:
- Permission denied

**On Failure**:
1. Check permissions:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "ls -ld /opt/wa-monitor/prod/logs"
   ```
2. Report: "Log directory not writable. Fix permissions."

---

## SCENARIO 7: Service Stability

### Test 7.1: Service Restart Counts

**Purpose**: Verify services aren't crashing

**Command**:
```bash
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "systemctl show wa-monitor-prod -p NRestarts --value"
```

**Expected Output**: Number

**Pass Criteria**:
- Restart count < 5

**Fail Criteria**:
- Restart count > 10

**On Failure**:
1. Check journal:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "journalctl -u wa-monitor-prod -n 50 | grep -E 'Failed|Error'"
   ```
2. Report: "Service restarting frequently. Check logs for crash causes."

**Note**: Mark as WARNING (not FAIL) unless extremely high.

---

## Final Report Generation

Generate comprehensive report:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ VPS SERVICES VALIDATION REPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Validation completed: [timestamp]
Duration: [X minutes]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCENARIO 1: SYSTEM HEALTH
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ 1.1 CPU Usage: 45%
✅ 1.2 Memory Usage: 62%
✅ 1.3 Disk Usage: 48%
⚠️ 1.4 System Load: 2.5 (cores: 2)

Status: ✅ PASS (3/4, 1 warning)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCENARIO 2: CRITICAL SERVICES
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ 2.1 wa-monitor-prod: active
✅ 2.2 wa-monitor-dev: active
✅ 2.3 WhatsApp Bridge: running (2 processes)
✅ 2.4 Nginx: active

Status: ✅ PASS (4/4)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCENARIO 3: NETWORK CONNECTIVITY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ 3.1 Internet Access: 0% packet loss
✅ 3.2 DNS Resolution: working
✅ 3.3 HTTPS Access: 200 OK

Status: ✅ PASS (3/3)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCENARIO 4: PM2 APPLICATIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ 4.1 PM2 Running: 2 processes
✅ 4.2 fibreflow-prod: online
✅ 4.3 fibreflow-dev: online
✅ 4.4 Restart Counts: 2 (acceptable)

Status: ✅ PASS (4/4)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCENARIO 5: NGINX CONFIGURATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ 5.1 Config Syntax: valid
✅ 5.2 SSL Certificate: valid (45 days remaining)
✅ 5.3 Logs Accessible: readable

Status: ✅ PASS (3/3)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCENARIO 6: DIRECTORY STRUCTURE
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ 6.1 Critical Directories: all exist
✅ 6.2 Log Directories: writable

Status: ✅ PASS (2/2)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCENARIO 7: SERVICE STABILITY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ 7.1 Service Restarts: low (3 total)

Status: ✅ PASS (1/1)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OVERALL SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Tests Passed: 20/21 (95%)
Warnings: 1
Failures: 0

Overall Status: ✅ VALIDATION PASSED

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NEXT STEPS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ All critical systems healthy
⚠️ Monitor system load (currently acceptable)
📝 Document this run in docs/validation/vps-services/results/

Validation completed: [timestamp]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Success Criteria

**Validation PASSES when**:
- All critical services running
- System resources available
- Network connectivity working
- Applications online
- Pass rate ≥ 90% (19/21 tests)

**Validation FAILS when**:
- Critical service down
- System resources exhausted
- Network connectivity lost
- Applications offline
- Pass rate < 90%

---

## Known Limitations

This validation does NOT test:
- SSL certificate auto-renewal
- Backup systems
- Detailed firewall rules
- Hardware health monitoring
- VPS provider status

---

## Version History

- **v1.0** (2025-11-24): Initial VPS services validation
  - 7 scenarios, 21 individual tests
  - Self-correction for service failures
  - Comprehensive infrastructure checks

---

**Ready to validate! Run `/validate-vps-services` to check VPS infrastructure health.**
