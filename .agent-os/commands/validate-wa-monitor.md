# /validate-wa-monitor

Comprehensive end-to-end validation of the WhatsApp Monitor system.

## Overview

This command validates the entire WA Monitor data flow from WhatsApp message capture through to dashboard display and SharePoint sync readiness.

**System Flow Tested**:
```
WhatsApp Message → Bridge Capture → SQLite DB → Monitor Services → Neon PostgreSQL → API → Dashboard → (SharePoint Sync)
```

**Test Coverage**: 15+ individual tests across 9 scenarios
**Expected Duration**: 3-5 minutes
**Pass Criteria**: All critical tests pass (14/15 minimum)

---

## Prerequisites Check

Before running validation tests, verify prerequisites are met:

### 1. Verify VPS Access
```bash
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "echo 'VPS accessible'"
```
**Expected**: "VPS accessible"
**On Failure**: Cannot proceed - VPS unreachable. Check network connection.

### 2. Verify Database Connection String
Database should be: `ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech`
**Critical**: All environments MUST use this database (not ep-damp-credit-a857vku0)

### 3. Verify Required Tools
- sshpass (VPS access)
- psql (database queries)
- curl (API testing)
- jq (JSON parsing)

---

## SCENARIO 1: VPS Services Health

Critical foundation - all services must be running for system to function.

### Test 1.1: wa-monitor-prod Service Status

**Purpose**: Verify production monitor service is active and processing messages

**Command**:
```bash
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "systemctl is-active wa-monitor-prod"
```

**Expected Output**: `active`

**Pass Criteria**:
- Exit code = 0
- Output exactly matches "active"

**Fail Criteria**:
- Exit code ≠ 0
- Output is "inactive", "failed", or any other status

**On Failure - Self-Correction Attempt**:
1. Check service status details:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "systemctl status wa-monitor-prod"
   ```
2. Check recent logs for errors:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "tail -50 /opt/wa-monitor/prod/logs/wa-monitor-prod.log"
   ```
3. Check for Python cache issue:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "ls -la /opt/wa-monitor/prod/modules/__pycache__/*.pyc"
   ```
4. Attempt safe restart (clears Python cache):
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "/opt/wa-monitor/prod/restart-monitor.sh"
   ```
5. Wait 5 seconds for service stabilization
6. Re-test service status
7. Report outcome:
   - If now active: ✅ PASS (with warning: "Service was down, auto-restarted with cache clear")
   - If still inactive: ❌ FAIL "Production monitor service failed to restart. Last error: [from logs]. Manual intervention required."

**Critical**: This is a blocking test - if this fails and cannot auto-recover, remaining tests may be invalid.

---

### Test 1.2: wa-monitor-dev Service Status

**Purpose**: Verify development monitor service is active

**Command**:
```bash
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "systemctl is-active wa-monitor-dev"
```

**Expected Output**: `active`

**Pass Criteria**: Same as 1.1

**Fail Criteria**: Same as 1.1

**On Failure - Self-Correction Attempt**:
1. Check service status:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "systemctl status wa-monitor-dev"
   ```
2. Check logs:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "tail -50 /opt/wa-monitor/dev/logs/wa-monitor-dev.log"
   ```
3. Attempt restart (regular restart OK for dev):
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "systemctl restart wa-monitor-dev"
   ```
4. Wait 5 seconds
5. Re-test
6. Report outcome

**Note**: Dev service failure is less critical - mark as ⚠️ WARNING if production is healthy.

---

### Test 1.3: WhatsApp Bridge Process

**Purpose**: Verify WhatsApp bridge is capturing messages from groups

**Command**:
```bash
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "ps aux | grep whatsapp-bridge | grep -v grep"
```

**Expected Output**: Process line containing `whatsapp-bridge` with PID

**Pass Criteria**:
- Exit code = 0
- Output contains "whatsapp-bridge"
- Output shows process is running (has PID)

**Fail Criteria**:
- Exit code ≠ 0
- No output (process not running)

**On Failure - Diagnostics Only (No Auto-Fix)**:
1. Check if it's a systemd service:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "systemctl status whatsapp-bridge"
   ```
2. Check bridge logs:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "tail -100 /opt/velo-test-monitor/logs/whatsapp-bridge.log"
   ```
3. Check messages.db last update:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "stat /opt/velo-test-monitor/services/whatsapp-bridge/store/messages.db | grep Modify"
   ```
4. Report: ❌ FAIL "WhatsApp bridge is not running. Last messages.db update: [timestamp]. Manual restart required - DO NOT auto-restart (critical service)."

**Critical**: This is a blocking test - without the bridge, no new messages are captured. However, DO NOT auto-restart this service as it handles WhatsApp authentication.

---

## SCENARIO 2: Database Connectivity

### Test 2.1: VPS to Neon Database Connection

**Purpose**: Verify monitor services can reach and query Neon PostgreSQL from VPS

**Command**:
```bash
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "psql 'postgresql://neondb_owner:npg_aRNLhZc1G2CD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require' -c 'SELECT COUNT(*) FROM qa_photo_reviews;'"
```

**Expected Output**:
```
 count
-------
  XXXX
(1 row)
```

**Pass Criteria**:
- Exit code = 0
- Output contains "count" header
- Output contains a number (any count ≥ 0 is valid)
- No error messages
- Response time < 10 seconds (allows for Neon cold start)

**Fail Criteria**:
- Exit code ≠ 0
- Output contains "could not connect"
- Output contains "authentication failed"
- Connection timeout

**On Failure - Diagnostics**:
1. Test VPS internet connectivity:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "ping -c 3 8.8.8.8"
   ```
2. Test DNS resolution:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "nslookup ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech"
   ```
3. Check if monitor config has correct database URL:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "grep -A 2 'NEON_DB_URL' /opt/wa-monitor/prod/modules/database.py | head -3"
   ```
4. Report: ❌ FAIL "VPS cannot reach Neon database. Internet: [ok/failed], DNS: [ok/failed], Database URL in config: [correct/incorrect]. Check VPS networking and Neon database status at console.neon.tech"

**Retry Logic**: If first attempt times out, retry up to 2 more times with 5-second delays (Neon serverless cold start).

---

### Test 2.2: App to Neon Database Connection

**Purpose**: Verify FibreFlow app can query database via API

**Command**:
```bash
curl -s https://app.fibreflow.app/api/wa-monitor-drops | jq '.success'
```

**Expected Output**: `true`

**Pass Criteria**:
- Exit code = 0
- Output is `true`
- Response time < 5 seconds

**Fail Criteria**:
- Exit code ≠ 0
- Output is `false` or `null`
- Response time > 5 seconds
- HTTP 500 error

**On Failure - Diagnostics**:
1. Check full API response:
   ```bash
   curl -s https://app.fibreflow.app/api/wa-monitor-drops | jq .
   ```
2. Look for error message in `.error` field
3. Check if app is responding:
   ```bash
   curl -I https://app.fibreflow.app
   ```
4. If app is down, check PM2 status:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "pm2 status fibreflow-prod"
   ```
5. Report: ❌ FAIL "FibreFlow app cannot reach database. App status: [up/down], Error: [from API response]. Check PM2 logs and app deployment."

---

## SCENARIO 3: Drop Submission Flow (Happy Path)

### Test 3.1: Verify Recent Drop Exists in Database

**Purpose**: Confirm at least one recent drop is in database for testing (validates data is flowing)

**Command**:
```bash
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "psql 'postgresql://neondb_owner:npg_aRNLhZc1G2CD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require' -c \"SELECT drop_number, project, submitted_by, LENGTH(submitted_by) as len FROM qa_photo_reviews ORDER BY whatsapp_message_date DESC LIMIT 1;\""
```

**Expected Output**:
```
 drop_number |  project   | submitted_by | len
-------------+------------+--------------+-----
 DR1234567   | Velo Test  | 27640412391  | 11
(1 row)
```

**Pass Criteria**:
- Exit code = 0
- Output shows at least 1 row
- drop_number matches pattern `DR\d+`
- project is one of: Lawley, Mohadin, Velo Test, Mamelodi
- submitted_by is 11 characters or less (phone number format)
- submitted_by is NOT NULL

**Fail Criteria**:
- No rows returned (database empty or no recent drops)
- submitted_by is > 11 characters (indicates LID not resolved - critical bug!)
- submitted_by is NULL

**On Failure - Diagnostics**:
1. Check total record count:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "psql 'postgresql://...' -c 'SELECT COUNT(*) FROM qa_photo_reviews;'"
   ```
2. If count = 0:
   - Report: ⚠️ WARNING "Database is empty. No drops to validate. This may be expected if testing fresh deployment."
   - Skip remaining drop-specific tests
3. If count > 0 but submitted_by is LID (length > 11):
   - Report: ❌ CRITICAL BUG "LID resolution bug detected! Recent drop has LID instead of phone number. Check monitor service logs and Python cache."
   - Continue with other tests to gather more data
4. If count > 0 but submitted_by is NULL:
   - Report: ❌ FAIL "submitted_by is NULL. Monitor may not be processing phone numbers correctly."

**Store for Later Tests**:
If pass, save the drop_number, project, and submitted_by values for use in tests 3.2 and 3.3.

---

### Test 3.2: API Returns Drop Correctly

**Purpose**: Verify API endpoint returns the test drop with correct data structure

**Command**:
```bash
curl -s "https://app.fibreflow.app/api/wa-monitor-drops" | jq '.data[0] | {dropNumber, project, submittedBy, reviewStatus}'
```

**Expected Output**:
```json
{
  "dropNumber": "DR1234567",
  "project": "Velo Test",
  "submittedBy": "27640412391",
  "reviewStatus": "pending"
}
```

**Pass Criteria**:
- Exit code = 0
- Response contains `.data` array with at least one item
- First drop's `dropNumber` matches database query from 3.1
- `submittedBy` is phone number (11 digits, not LID)
- Response time < 3 seconds

**Fail Criteria**:
- Response has `{ success: false }`
- `.data` is null or empty array
- `submittedBy` is LID format (> 11 chars)
- Response missing required fields
- First drop doesn't match database

**On Failure - Diagnostics**:
1. Check full API response:
   ```bash
   curl -s https://app.fibreflow.app/api/wa-monitor-drops | jq .
   ```
2. Check error in `.error` field if present
3. Compare database count vs API count:
   ```bash
   # Database count (already have from 3.1)
   # API count
   curl -s https://app.fibreflow.app/api/wa-monitor-drops | jq '.data | length'
   ```
4. If counts mismatch:
   - Report: ⚠️ WARNING "API/database count mismatch. Database has X records, API returned Y."
5. If API returns LID:
   - Report: ❌ CRITICAL "API returning LID instead of phone number. Database has correct phone, API transformation issue."
6. Otherwise:
   - Report: ❌ FAIL "API not returning drops correctly. Error: [from .error field]"

---

### Test 3.3: Dashboard Daily Drops Endpoint

**Purpose**: Verify dashboard endpoint returns accurate daily submissions by project

**Command**:
```bash
curl -s "https://app.fibreflow.app/api/wa-monitor-daily-drops" | jq .
```

**Expected Output**:
```json
{
  "success": true,
  "data": {
    "Lawley": 5,
    "Mohadin": 3,
    "Velo Test": 2,
    "Mamelodi": 1
  },
  "meta": {
    "timestamp": "2025-11-24T10:30:00.000Z"
  }
}
```

**Pass Criteria**:
- Exit code = 0
- Response has `success: true`
- Response has `data` object (may be empty if no drops today)
- Response has `meta.timestamp` (ISO format)
- If today has drops, at least one project has count > 0
- Response time < 3 seconds

**Fail Criteria**:
- `success: false`
- `data` is null (should be empty object {} if no drops)
- Missing `meta.timestamp`
- Response structure incorrect

**On Failure - Diagnostics**:
1. Check database for today's drops (verify expected count):
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "psql 'postgresql://...' -c \"SELECT project, COUNT(DISTINCT drop_number) as drops FROM qa_photo_reviews WHERE DATE(whatsapp_message_date AT TIME ZONE 'Africa/Johannesburg') = CURRENT_DATE GROUP BY project;\""
   ```
2. Compare database result vs API result
3. Report: ❌ FAIL "Daily drops API mismatch. Database shows: [project counts], API shows: [project counts]"

**Note**: If run early in the day (before any submissions), data may legitimately be empty `{}`. This is PASS, not FAIL.

---

## SCENARIO 4: Edge Case - Resubmission Handling

### Test 4.1: No Duplicate Drop Numbers

**Purpose**: Ensure resubmitted drops don't create duplicate records (tests ON CONFLICT logic)

**Command**:
```bash
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "psql 'postgresql://neondb_owner:npg_aRNLhZc1G2CD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require' -c \"SELECT drop_number, COUNT(*) as occurrences FROM qa_photo_reviews GROUP BY drop_number HAVING COUNT(*) > 1 LIMIT 10;\""
```

**Expected Output**:
```
 drop_number | occurrences
-------------+-------------
(0 rows)
```

**Pass Criteria**:
- Exit code = 0
- Zero rows returned (no duplicates)

**Fail Criteria**:
- Any rows returned (indicates duplicate drop_number)

**On Failure - Detailed Diagnostics**:
1. List all duplicates with full details:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "psql 'postgresql://...' -c \"SELECT drop_number, id, created_at, updated_at, project FROM qa_photo_reviews WHERE drop_number IN (SELECT drop_number FROM qa_photo_reviews GROUP BY drop_number HAVING COUNT(*) > 1) ORDER BY drop_number, created_at;\""
   ```
2. Check if duplicates are from different projects (shouldn't happen):
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "psql 'postgresql://...' -c \"SELECT drop_number, array_agg(DISTINCT project) as projects FROM qa_photo_reviews GROUP BY drop_number HAVING COUNT(DISTINCT project) > 1;\""
   ```
3. Report: ❌ CRITICAL BUG "Found X duplicate drop number(s): [list]. This indicates resubmission handler ON CONFLICT logic is not working. Duplicates: [detailed list from step 1]"

**Manual Intervention Required**: Duplicates must be manually resolved - decide which records to keep.

---

## SCENARIO 5: Edge Case - LID Resolution

### Test 5.1: All submitted_by Are Phone Numbers (No LIDs)

**Purpose**: Verify all submitted_by values are resolved phone numbers, not LID format

**Command**:
```bash
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "psql 'postgresql://neondb_owner:npg_aRNLhZc1G2CD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require' -c \"SELECT drop_number, submitted_by, LENGTH(submitted_by) as len, whatsapp_message_date FROM qa_photo_reviews WHERE submitted_by IS NOT NULL AND LENGTH(submitted_by) > 11 ORDER BY whatsapp_message_date DESC LIMIT 10;\""
```

**Expected Output**:
```
 drop_number | submitted_by | len | whatsapp_message_date
-------------+--------------+-----+-----------------------
(0 rows)
```

**Pass Criteria**:
- Exit code = 0
- Zero rows returned
- All submitted_by values are ≤ 11 characters (phone number format: 27XXXXXXXXX)

**Fail Criteria**:
- Any rows returned (indicates LID not resolved)

**On Failure - Critical Bug Detected**:
1. Report number of affected drops:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "psql 'postgresql://...' -c \"SELECT COUNT(*) as lid_drops FROM qa_photo_reviews WHERE submitted_by IS NOT NULL AND LENGTH(submitted_by) > 11;\""
   ```
2. Show sample of affected drops (first 5):
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "psql 'postgresql://...' -c \"SELECT drop_number, submitted_by, project, DATE(whatsapp_message_date) as date FROM qa_photo_reviews WHERE LENGTH(submitted_by) > 11 ORDER BY whatsapp_message_date DESC LIMIT 5;\""
   ```
3. Check monitor logs for LID resolution errors:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "grep -i 'lid' /opt/wa-monitor/prod/logs/wa-monitor-prod.log | tail -20"
   ```
4. Check if Python cache may be the issue:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "ls -lah /opt/wa-monitor/prod/modules/__pycache__/*.pyc | head -5"
   ```
5. Report: ❌ CRITICAL BUG "LID resolution bug detected! Found X drops with unresolved LIDs. Sample: [list from step 2]. This is the bug from Nov 11-13, 2025. Likely cause: Python cache not cleared after code update. Recommend: Run /opt/wa-monitor/prod/restart-monitor.sh to clear cache and restart service."

**Historical Context**: This exact bug occurred Nov 11-13, 2025. Code was fixed but Python .pyc cache kept old buggy code running until safe restart script was used.

---

## SCENARIO 6: API Response Standardization

### Test 6.1: /api/wa-monitor-drops Follows Standard Format

**Purpose**: Verify endpoint follows FibreFlow API response standard (uses apiResponse helper)

**Command**:
```bash
curl -s "https://app.fibreflow.app/api/wa-monitor-drops" | jq 'has("success") and has("data") and has("meta") and (.meta | has("timestamp"))'
```

**Expected Output**: `true`

**Pass Criteria**:
- Exit code = 0
- Output is `true`
- Response structure matches: `{ success: boolean, data: any, meta: { timestamp: string } }`

**Fail Criteria**:
- Output is `false`
- Response missing any of: success, data, meta, meta.timestamp

**On Failure - Show Current Structure**:
1. Display actual response structure:
   ```bash
   curl -s "https://app.fibreflow.app/api/wa-monitor-drops" | jq 'keys'
   ```
2. Display meta structure:
   ```bash
   curl -s "https://app.fibreflow.app/api/wa-monitor-drops" | jq '.meta // "missing"'
   ```
3. Report: ❌ FAIL "API response format non-standard. Current keys: [from step 1]. Expected: [success, data, meta]. Meta content: [from step 2]. Fix: Update API to use apiResponse helper from lib/apiResponse.ts"

**Fix Required**: Manual code change to use standardized apiResponse helper.

---

### Test 6.2: /api/wa-monitor-daily-drops Follows Standard Format

**Purpose**: Verify endpoint follows FibreFlow API response standard

**Command**:
```bash
curl -s "https://app.fibreflow.app/api/wa-monitor-daily-drops" | jq 'has("success") and has("data") and has("meta") and (.meta | has("timestamp"))'
```

**Expected Output**: `true`

**Pass Criteria**: Same as 6.1

**Fail Criteria**: Same as 6.1

**On Failure**: Same diagnostics as 6.1

---

## SCENARIO 7: Dual Service Monitoring (Velo Test)

### Test 7.1: Both Prod and Dev Process Velo Test Messages

**Purpose**: Verify both production and development monitors are processing Velo Test group (dual-monitoring setup)

**Commands**:
```bash
# Check prod logs for recent Velo Test processing
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "grep 'Velo Test' /opt/wa-monitor/prod/logs/wa-monitor-prod.log | tail -5"

# Check dev logs for recent Velo Test processing
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "grep 'Velo Test' /opt/wa-monitor/dev/logs/wa-monitor-dev.log | tail -5"
```

**Expected Output**: Both commands return recent log entries (within last 24 hours) mentioning "Velo Test"

**Pass Criteria**:
- Both commands exit with code 0
- Both outputs contain "Velo Test" mentions
- Log timestamps are recent (within last 24 hours)
- Both show message processing activity

**Fail Criteria**:
- Either command returns no results
- Log timestamps are old (> 24 hours ago)
- Only one service is processing

**On Failure - Identify Which Service Failed**:
1. Check production config for Velo Test:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "grep -A 3 'Velo Test' /opt/wa-monitor/prod/config/projects.yaml"
   ```
2. Check dev config for Velo Test:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "grep -A 3 'Velo Test' /opt/wa-monitor/dev/config/projects.yaml"
   ```
3. Check which service has recent activity:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "stat /opt/wa-monitor/prod/logs/wa-monitor-prod.log | grep Modify"
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "stat /opt/wa-monitor/dev/logs/wa-monitor-dev.log | grep Modify"
   ```
4. Report:
   - If prod missing: ⚠️ WARNING "Production monitor not processing Velo Test. Config enabled: [yes/no]. Service active: [checked in 1.1]"
   - If dev missing: ⚠️ WARNING "Development monitor not processing Velo Test. Config enabled: [yes/no]. Service active: [checked in 1.2]"
   - If both missing but services active: ❌ FAIL "Neither monitor processing Velo Test despite services running. Check configs and WhatsApp bridge."

**Note**: This is a warning, not critical failure. Dual monitoring is for testing/comparison purposes.

---

## SCENARIO 8: Incorrect Step Marking (JSONB Fields)

### Test 8.1: incorrect_steps and incorrect_comments Are Valid JSONB

**Purpose**: Verify text-based incorrect marking UI populates JSONB fields correctly

**Command**:
```bash
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "psql 'postgresql://neondb_owner:npg_aRNLhZc1G2CD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require' -c \"SELECT drop_number, incorrect_steps, incorrect_comments, jsonb_array_length(incorrect_steps) as step_count FROM qa_photo_reviews WHERE incorrect_steps IS NOT NULL AND jsonb_array_length(incorrect_steps) > 0 ORDER BY updated_at DESC LIMIT 3;\""
```

**Expected Output**:
```
 drop_number |        incorrect_steps        |                incorrect_comments                | step_count
-------------+-------------------------------+--------------------------------------------------+------------
 DR1234567   | ["step_01_house_photo"]       | {"step_01_house_photo": "Photo is blurry"}       | 1
 DR1234568   | ["step_05_cable_installed"]   | {"step_05_cable_installed": "Not visible"}       | 1
(2 rows)
```

**Pass Criteria**:
- Exit code = 0
- At least 1 row returned (if any drops marked incorrect)
- incorrect_steps is valid JSONB array
- incorrect_comments is valid JSONB object
- No NULL values in these fields for marked drops
- step_count > 0

**Fail Criteria**:
- incorrect_steps is NULL when drop has been marked
- incorrect_comments is NULL when drop has been marked
- JSONB parsing error
- incorrect_steps is empty array [] but drop marked as incorrect

**On Failure - Diagnostics**:
1. Check if ANY drops have been marked incorrect:
   ```bash
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "psql 'postgresql://...' -c \"SELECT COUNT(*) as marked_incorrect FROM qa_photo_reviews WHERE incorrect_steps IS NOT NULL;\""
   ```
2. If count = 0:
   - Report: ℹ️ INFO "No drops have been marked incorrect yet. Cannot validate JSONB fields. This test will be skipped."
   - Mark as SKIPPED, not FAIL
3. If count > 0 but fields are NULL or empty:
   - Report: ❌ FAIL "Incorrect marking UI bug. Found drops marked as incorrect but JSONB fields not populated. This is the Nov 23 bug. Check frontend form submission and API endpoint."
4. If JSONB parsing error:
   - Report: ❌ FAIL "JSONB fields contain invalid JSON. This indicates data corruption or API validation failure."

**Note**: This test only applies if drops have been marked as incorrect. May legitimately return 0 rows if all drops are pending/approved.

---

## SCENARIO 9: Configuration Consistency

### Test 9.1: All Environments Use Same Database (ep-dry-night-a9qyh4sj)

**Purpose**: Verify prod monitor, dev monitor, and app all use the correct Neon database

**Commands**:
```bash
# Check prod monitor database URL
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "grep 'ep-dry-night-a9qyh4sj\|ep-damp-credit' /opt/wa-monitor/prod/modules/database.py"

# Check dev monitor database URL
sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "grep 'ep-dry-night-a9qyh4sj\|ep-damp-credit' /opt/wa-monitor/dev/modules/database.py"

# App database already verified in Test 2.2 (API connection)
```

**Expected Output**: All outputs contain `ep-dry-night-a9qyh4sj`, NONE contain `ep-damp-credit`

**Pass Criteria**:
- All environments reference `ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech`
- NO references to `ep-damp-credit-a857vku0` (old/wrong database)
- App API connection test (2.2) passed

**Fail Criteria**:
- Any environment contains wrong database identifier
- Mismatch between environments
- Any reference to ep-damp-credit (old database)

**On Failure - Critical Configuration Issue**:
1. Show which environment has wrong database:
   ```bash
   # Prod full database URL
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "grep -A 1 'NEON_DB_URL' /opt/wa-monitor/prod/modules/database.py | head -2"

   # Dev full database URL
   sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "grep -A 1 'NEON_DB_URL' /opt/wa-monitor/dev/modules/database.py | head -2"
   ```
2. Report: ❌ CRITICAL CONFIG ERROR "Database configuration mismatch detected!
   - Correct database: ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech
   - Prod monitor: [from step 1]
   - Dev monitor: [from step 1]
   - App: [passed/failed test 2.2]

   This is the Nov 10 bug where different environments used different databases, causing data inconsistencies.

   Fix required: Update database URL in affected environment(s) and restart services."

**Manual Fix Required**: Update configuration files and restart affected services.

---

## Final Report Generation

After all tests complete, generate comprehensive report:

### Report Structure

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
✅ WA MONITOR END-TO-END VALIDATION REPORT
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Validation run completed: [timestamp]
Duration: [X minutes Y seconds]

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCENARIO 1: VPS SERVICES HEALTH
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ 1.1 wa-monitor-prod Service: active
✅ 1.2 wa-monitor-dev Service: active
✅ 1.3 WhatsApp Bridge Process: running (PID 12345)

Status: ✅ PASS (3/3)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCENARIO 2: DATABASE CONNECTIVITY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ 2.1 VPS → Neon: Connected (2,543 records)
✅ 2.2 App → Neon: Connected (API responding)

Status: ✅ PASS (2/2)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCENARIO 3: DROP SUBMISSION FLOW
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ 3.1 Recent Drop Exists: DR1234567 (Velo Test)
✅ 3.2 API Returns Drop: Correct data structure
✅ 3.3 Daily Drops Endpoint: Lawley: 5, Mohadin: 3, Velo Test: 2

Status: ✅ PASS (3/3)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCENARIO 4: RESUBMISSION HANDLING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ 4.1 No Duplicate Drops: 0 duplicates found

Status: ✅ PASS (1/1)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCENARIO 5: LID RESOLUTION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

❌ 5.1 No LIDs in submitted_by: Found 2 drops with LIDs
   → DR1734381 (Lawley): submitted_by length 15
   → DR1857337 (Mohadin): submitted_by length 14
   → Likely cause: Python cache not cleared after code update
   → Recommendation: Run /opt/wa-monitor/prod/restart-monitor.sh

Status: ❌ FAIL (0/1) - CRITICAL BUG DETECTED

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCENARIO 6: API RESPONSE STANDARDIZATION
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ 6.1 /api/wa-monitor-drops: Standard format
✅ 6.2 /api/wa-monitor-daily-drops: Standard format

Status: ✅ PASS (2/2)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCENARIO 7: DUAL SERVICE MONITORING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ 7.1 Prod/Dev Both Process Velo Test: Yes
   → Prod: Last activity 2 hours ago
   → Dev: Last activity 1 hour ago

Status: ✅ PASS (1/1)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCENARIO 8: INCORRECT STEP MARKING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

ℹ️ 8.1 JSONB Fields Valid: SKIPPED (no drops marked incorrect yet)

Status: ℹ️ SKIPPED (0/0)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
SCENARIO 9: CONFIGURATION CONSISTENCY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅ 9.1 All Use Same Database: ep-dry-night-a9qyh4sj
   → Prod monitor: Correct
   → Dev monitor: Correct
   → App: Verified via API test

Status: ✅ PASS (1/1)

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
OVERALL SUMMARY
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Tests Passed: 13/14 (93%)
Tests Failed: 1/14 (7%)
Tests Skipped: 1/15

Critical Issues: 1
- LID Resolution Bug (Scenario 5)

Warnings: 0

Overall Status: ⚠️ VALIDATION FAILED - Action Required

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
REQUIRED ACTIONS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. CRITICAL: Fix LID resolution bug
   → Run: sshpass -p '$VPS_SSH_PASSWORD' ssh -o StrictHostKeyChecking=no root@72.60.17.245 "/opt/wa-monitor/prod/restart-monitor.sh"
   → This will clear Python cache and restart service properly
   → Re-run validation after restart

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
NEXT STEPS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

1. Address all critical issues above
2. Re-run /validate-wa-monitor
3. If all tests pass, safe to deploy
4. Document this run in docs/validation/wa-monitor/results/

Validation completed: [timestamp]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Success Criteria

**Validation PASSES when**:
- All critical tests pass (scenarios 1-6, 9)
- No more than 1 warning
- No critical bugs detected
- Overall pass rate ≥ 90% (13/15 tests minimum)

**Validation FAILS when**:
- Any critical test fails (services down, database unreachable, critical bugs)
- LID resolution bug detected
- Database configuration mismatch
- Overall pass rate < 90%

---

## Known Limitations

This validation does NOT test:
- ⚠️ SharePoint sync (requires waiting for nightly 8pm job)
- ⚠️ WhatsApp message capture (requires posting to real WhatsApp group)
- ⚠️ Python cache clearing mechanism (requires bug injection)
- ⚠️ Service crash recovery (requires intentional crash)

These require manual testing or separate validation processes.

---

## Version History

- **v1.0** (2025-11-24): Initial comprehensive validation command
  - 9 scenarios, 15+ individual tests
  - Self-correction logic for service failures
  - Detailed reporting with actionable next steps

---

## Documentation

Full validation system documentation:
- System overview: `docs/validation/README.md`
- Implementation guide: `docs/validation/IMPLEMENTATION_GUIDE.md`
- Test scenarios: `docs/validation/wa-monitor/test-scenarios.md`
- Known issues: `docs/validation/wa-monitor/known-issues.md`

---

**Ready to validate! Run `/validate-wa-monitor` to begin comprehensive end-to-end testing.**
