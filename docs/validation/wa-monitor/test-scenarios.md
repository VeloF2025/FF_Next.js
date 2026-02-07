# WA Monitor Validation - Test Scenarios

Detailed test cases for end-to-end validation of the WhatsApp Monitor system.

---

## Scenario 1: VPS Services Health Check

### 1.1 - wa-monitor-prod Service Status

**Objective**: Verify production monitor service is running

**Command**:
```bash
ssh root@72.60.17.245 "systemctl is-active wa-monitor-prod"
```

**Expected Output**: `active`

**Pass Criteria**:
- Exit code = 0
- Output exactly matches "active"

**Fail Criteria**:
- Exit code ≠ 0
- Output is "inactive", "failed", or any other status

**On Failure**:
1. Check service status details: `systemctl status wa-monitor-prod`
2. Check recent logs: `tail -50 /opt/wa-monitor/prod/logs/wa-monitor-prod.log`
3. Attempt auto-fix: `/opt/wa-monitor/prod/restart-monitor.sh`
4. Re-test after 5 second wait
5. Report: "Production monitor service is [status]. Last error: [from logs]"

---

### 1.2 - wa-monitor-dev Service Status

**Objective**: Verify development monitor service is running

**Command**:
```bash
ssh root@72.60.17.245 "systemctl is-active wa-monitor-dev"
```

**Expected Output**: `active`

**Pass Criteria**: Same as 1.1

**Fail Criteria**: Same as 1.1

**On Failure**:
1. Check service status: `systemctl status wa-monitor-dev`
2. Check logs: `tail -50 /opt/wa-monitor/dev/logs/wa-monitor-dev.log`
3. Attempt restart: `systemctl restart wa-monitor-dev`
4. Re-test after 5 second wait
5. Report: "Development monitor service is [status]"

---

### 1.3 - WhatsApp Bridge Process

**Objective**: Verify WhatsApp bridge is running and capturing messages

**Command**:
```bash
ssh root@72.60.17.245 "ps aux | grep whatsapp-bridge | grep -v grep"
```

**Expected Output**: Process line containing `whatsapp-bridge`

**Pass Criteria**:
- Exit code = 0
- Output contains "whatsapp-bridge"
- Output shows PID (process is running)

**Fail Criteria**:
- Exit code ≠ 0
- No output (process not running)

**On Failure**:
1. Check systemd service: `systemctl status whatsapp-bridge`
2. Check bridge logs: `tail -100 /opt/velo-test-monitor/logs/whatsapp-bridge.log`
3. Report: "WhatsApp bridge is not running. Manual restart required."
4. **DO NOT auto-restart** (critical service, requires manual intervention)

---

## Scenario 2: Database Connectivity

### 2.1 - VPS to Neon Database

**Objective**: Verify monitor services can reach Neon PostgreSQL from VPS

**Command**:
```bash
ssh root@72.60.17.245 "psql 'postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require' -c 'SELECT COUNT(*) FROM qa_photo_reviews;'"
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
- Output contains a number (any count ≥ 0)
- No error messages

**Fail Criteria**:
- Exit code ≠ 0
- Output contains "could not connect"
- Output contains "authentication failed"
- Connection timeout

**On Failure**:
1. Test VPS internet: `ssh root@72.60.17.245 "ping -c 1 8.8.8.8"`
2. Check Neon database status (cannot automate - external service)
3. Verify DATABASE_URL in monitor configs:
   - `/opt/wa-monitor/prod/config/.env` (if exists)
   - Check hardcoded URL in `/opt/wa-monitor/prod/modules/database.py`
4. Report: "VPS cannot reach Neon database. Error: [specific error]. Check network and Neon status."

---

### 2.2 - App to Neon Database

**Objective**: Verify FibreFlow app can query database

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

**On Failure**:
1. Check API response: `curl -s https://app.fibreflow.app/api/wa-monitor-drops | jq .`
2. Look for error in response
3. Check if app is deployed: `curl -I https://app.fibreflow.app`
4. Report: "API cannot reach database. Error: [from API response]"

---

## Scenario 3: Drop Submission Flow (Happy Path)

### 3.1 - Verify Test Drop Exists in Database

**Objective**: Confirm at least one recent drop is in the database for testing

**Command**:
```bash
ssh root@72.60.17.245 "psql 'postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require' -c \"SELECT drop_number, project, submitted_by FROM qa_photo_reviews ORDER BY whatsapp_message_date DESC LIMIT 1;\""
```

**Expected Output**:
```
 drop_number |  project   | submitted_by
-------------+------------+--------------
 DR1234567   | Velo Test  | 27640412391
(1 row)
```

**Pass Criteria**:
- Exit code = 0
- Output shows at least 1 row
- drop_number format matches `DR\d+`
- project is one of: Lawley, Mohadin, Velo Test, Mamelodi
- submitted_by is 11-digit phone number (NOT LID)

**Fail Criteria**:
- No rows returned
- submitted_by is > 11 characters (indicates LID not resolved)
- submitted_by is NULL

**On Failure**:
1. Check total record count: `SELECT COUNT(*) FROM qa_photo_reviews;`
2. If count = 0: "Database is empty. No drops to validate."
3. If count > 0 but submitted_by is LID: "LID resolution bug detected!"
4. Report with specific issue

**Save for Later Tests**:
Store the drop_number, project, and submitted_by for use in subsequent tests.

---

### 3.2 - API Returns Drop Correctly

**Objective**: Verify API endpoint returns the test drop with correct data

**Command**:
```bash
curl -s "https://app.fibreflow.app/api/wa-monitor-drops" | jq '.data[0]'
```

**Expected Output**:
```json
{
  "id": 123,
  "dropNumber": "DR1234567",
  "project": "Velo Test",
  "submittedBy": "27640412391",
  "reviewStatus": "pending",
  ...
}
```

**Pass Criteria**:
- Exit code = 0
- Response contains `.data` array
- First drop matches database query from 3.1
- `dropNumber` is NOT empty
- `submittedBy` is phone number (11 digits)
- Response follows standard format: `{ success: true, data: [...], meta: {...} }`

**Fail Criteria**:
- Response is `{ success: false }`
- `.data` is null or empty
- `submittedBy` is LID format
- Response missing required fields

**On Failure**:
1. Check full API response: `curl -s https://app.fibreflow.app/api/wa-monitor-drops | jq .`
2. Verify error message in `.error` field
3. Compare database count vs API returned count
4. Report: "API not returning drops correctly. Database has X records, API returned Y."

---

### 3.3 - Dashboard Displays Drop

**Objective**: Verify dashboard endpoint returns today's drops by project

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
- Response has `data` object with project counts
- Response has `meta.timestamp`
- At least one project has count > 0 (if today's date)

**Fail Criteria**:
- `success: false`
- `data` is null or empty object
- Missing `meta.timestamp`

**On Failure**:
1. Check database for today's drops:
   ```sql
   SELECT project, COUNT(DISTINCT drop_number)
   FROM qa_photo_reviews
   WHERE DATE(whatsapp_message_date AT TIME ZONE 'Africa/Johannesburg') = CURRENT_DATE
   GROUP BY project;
   ```
2. Compare database result vs API result
3. Report: "Daily drops API mismatch. DB shows: [X], API shows: [Y]"

**Note**: This test may legitimately return 0 drops if run early in the day before any submissions. Check timestamp is reasonable.

---

## Scenario 4: Edge Case - Resubmission Handling

### 4.1 - Verify No Duplicate Drops

**Objective**: Ensure resubmitted drops don't create duplicates in database

**Command**:
```bash
ssh root@72.60.17.245 "psql 'postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require' -c \"SELECT drop_number, COUNT(*) as count FROM qa_photo_reviews GROUP BY drop_number HAVING COUNT(*) > 1;\""
```

**Expected Output**:
```
 drop_number | count
-------------+-------
(0 rows)
```

**Pass Criteria**:
- Exit code = 0
- Zero rows returned (no duplicates)

**Fail Criteria**:
- Any rows returned (indicates duplicate drop_number)

**On Failure**:
1. List all duplicates with details:
   ```sql
   SELECT drop_number, id, created_at, updated_at
   FROM qa_photo_reviews
   WHERE drop_number IN (
     SELECT drop_number FROM qa_photo_reviews
     GROUP BY drop_number HAVING COUNT(*) > 1
   )
   ORDER BY drop_number, created_at;
   ```
2. Report: "Found X duplicate drop(s): [list drop_numbers]. Resubmission handler may have bug."
3. **Manual intervention required** - decide which records to keep

---

## Scenario 5: Edge Case - LID Resolution

### 5.1 - No LIDs in submitted_by Field

**Objective**: Verify all submitted_by values are phone numbers, not LIDs

**Command**:
```bash
ssh root@72.60.17.245 "psql 'postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require' -c \"SELECT drop_number, submitted_by, LENGTH(submitted_by) as len FROM qa_photo_reviews WHERE submitted_by IS NOT NULL AND LENGTH(submitted_by) > 11 LIMIT 5;\""
```

**Expected Output**:
```
 drop_number | submitted_by | len
-------------+--------------+-----
(0 rows)
```

**Pass Criteria**:
- Exit code = 0
- Zero rows returned
- All submitted_by values are 11 characters or less (phone number format)

**Fail Criteria**:
- Any rows returned (indicates LID not resolved)

**On Failure**:
1. Report: "LID resolution bug detected! Found X drops with unresolved LIDs."
2. List affected drops:
   ```sql
   SELECT drop_number, submitted_by, whatsapp_message_date
   FROM qa_photo_reviews
   WHERE LENGTH(submitted_by) > 11
   ORDER BY whatsapp_message_date DESC;
   ```
3. Check if Python cache needs clearing:
   ```bash
   ssh root@72.60.17.245 "ls -la /opt/wa-monitor/prod/modules/__pycache__/*.pyc"
   ```
4. Suggest: "Check monitor logs for LID resolution errors. May need to restart monitor with cache clearing."

---

## Scenario 6: API Response Standardization

### 6.1 - /api/wa-monitor-drops Format

**Objective**: Verify endpoint follows standardized response format

**Command**:
```bash
curl -s "https://app.fibreflow.app/api/wa-monitor-drops" | jq 'has("success") and has("data") and has("meta") and .meta | has("timestamp")'
```

**Expected Output**: `true`

**Pass Criteria**:
- Exit code = 0
- Output is `true`
- Response structure matches: `{ success: bool, data: any, meta: { timestamp: string } }`

**Fail Criteria**:
- Output is `false`
- Response missing required fields

**On Failure**:
1. Show actual response structure:
   ```bash
   curl -s "https://app.fibreflow.app/api/wa-monitor-drops" | jq 'keys'
   ```
2. Report: "API response format non-standard. Has keys: [actual keys]. Expected: success, data, meta"
3. **Manual fix required** - update API to use `apiResponse` helper from `lib/apiResponse.ts`

---

### 6.2 - /api/wa-monitor-daily-drops Format

**Objective**: Verify endpoint follows standardized response format

**Command**:
```bash
curl -s "https://app.fibreflow.app/api/wa-monitor-daily-drops" | jq 'has("success") and has("data") and has("meta") and .meta | has("timestamp")'
```

**Expected Output**: `true`

**Pass Criteria**: Same as 6.1

**Fail Criteria**: Same as 6.1

**On Failure**: Same as 6.1

---

## Scenario 7: Dual Service Monitoring (Velo Test)

### 7.1 - Both Services Process Velo Test

**Objective**: Verify both prod and dev monitors are processing Velo Test group

**Commands**:
```bash
# Check prod logs for Velo Test
ssh root@72.60.17.245 "grep 'Velo Test' /opt/wa-monitor/prod/logs/wa-monitor-prod.log | tail -5"

# Check dev logs for Velo Test
ssh root@72.60.17.245 "grep 'Velo Test' /opt/wa-monitor/dev/logs/wa-monitor-dev.log | tail -5"
```

**Expected Output**: Both commands return recent log entries mentioning "Velo Test"

**Pass Criteria**:
- Both commands exit with code 0
- Both outputs contain "Velo Test" mentions
- Log timestamps are recent (within last 24 hours)

**Fail Criteria**:
- Either command returns no results
- Log timestamps are old (> 24 hours)

**On Failure**:
1. Check which service is not processing:
   - If prod has no logs: "Production monitor not processing Velo Test"
   - If dev has no logs: "Development monitor not processing Velo Test"
2. Check configs:
   ```bash
   ssh root@72.60.17.245 "grep 'Velo Test' /opt/wa-monitor/prod/config/projects.yaml"
   ssh root@72.60.17.245 "grep 'Velo Test' /opt/wa-monitor/dev/config/projects.yaml"
   ```
3. Report: "[Service] is not processing Velo Test messages. Check config and service status."

---

## Scenario 8: Incorrect Step Marking

### 8.1 - JSONB Fields Populated

**Objective**: Verify incorrect_steps and incorrect_comments are valid JSONB

**Command**:
```bash
ssh root@72.60.17.245 "psql 'postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require' -c \"SELECT drop_number, incorrect_steps, incorrect_comments FROM qa_photo_reviews WHERE incorrect_steps IS NOT NULL AND jsonb_array_length(incorrect_steps) > 0 LIMIT 1;\""
```

**Expected Output**:
```
 drop_number |     incorrect_steps      |              incorrect_comments
-------------+--------------------------+----------------------------------------------
 DR1234567   | ["step_01_house_photo"]  | {"step_01_house_photo": "Photo is blurry"}
(1 row)
```

**Pass Criteria**:
- Exit code = 0
- At least 1 row returned (if any drops have been marked incorrect)
- incorrect_steps is valid JSONB array
- incorrect_comments is valid JSONB object
- No NULL values in these fields for marked drops

**Fail Criteria**:
- incorrect_steps is NULL when it should have data
- incorrect_comments is NULL when it should have data
- JSONB parsing error

**On Failure**:
1. Check if ANY drops have incorrect markings:
   ```sql
   SELECT COUNT(*) FROM qa_photo_reviews
   WHERE incorrect_steps IS NOT NULL;
   ```
2. If count = 0: "No drops have been marked incorrect yet. Cannot validate JSONB fields."
3. If count > 0 but fields are NULL: "Incorrect marking UI bug. Fields not being populated."
4. Report specific issue

**Note**: This test only applies if drops have been marked as incorrect. May legitimately return 0 rows if all drops are pending or approved.

---

## Scenario 9: Configuration Validation

### 9.1 - All Environments Use Same Database

**Objective**: Verify prod, dev, and app all use ep-dry-night-a9qyh4sj database

**Commands**:
```bash
# Check prod monitor database
ssh root@72.60.17.245 "grep -A 5 'NEON_DB_URL' /opt/wa-monitor/prod/modules/database.py | head -1"

# Check dev monitor database
ssh root@72.60.17.245 "grep -A 5 'NEON_DB_URL' /opt/wa-monitor/dev/modules/database.py | head -1"

# Check app database (via successful API call earlier)
# Already validated in Scenario 2.2
```

**Expected Output**: All contain `ep-dry-night-a9qyh4sj`

**Pass Criteria**:
- All outputs contain "ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech"
- NO references to "ep-damp-credit-a857vku0" (old database)

**Fail Criteria**:
- Any output contains wrong database identifier
- Mismatch between environments

**On Failure**:
1. Report which environment has wrong database
2. Show correct database: `ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech`
3. **Manual fix required** - update configuration files
4. After fix: Restart affected service

---

## Summary

**Total Scenarios**: 9 major scenarios, 15+ individual tests

**Coverage**:
- ✅ Service health (3 tests)
- ✅ Database connectivity (2 tests)
- ✅ Drop submission flow (3 tests)
- ✅ Resubmission handling (1 test)
- ✅ LID resolution (1 test)
- ✅ API standardization (2 tests)
- ✅ Dual monitoring (1 test)
- ✅ Incorrect marking (1 test)
- ✅ Configuration validation (1 test)

**Edge Cases Covered**:
- Resubmissions
- LID resolution
- Dual service monitoring
- JSONB field validation
- Database configuration consistency

**Not Covered** (requires manual testing):
- SharePoint sync (nightly job)
- WhatsApp message capture (requires posting to group)
- Python cache clearing (requires bug injection)
- Service crash recovery (requires intentional crash)

---

## Test Execution Order

**Recommended order** (fail fast on critical dependencies):

1. **Foundation** (must pass or rest will fail):
   - 1.1, 1.2, 1.3 - Service health
   - 2.1, 2.2 - Database connectivity

2. **Core Functionality** (main user flows):
   - 3.1, 3.2, 3.3 - Drop submission flow
   - 6.1, 6.2 - API response format

3. **Edge Cases** (specific bug prevention):
   - 4.1 - No duplicates
   - 5.1 - No LIDs
   - 8.1 - JSONB fields valid

4. **Advanced** (dual monitoring, config):
   - 7.1 - Dual service monitoring
   - 9.1 - Database configuration

**Total estimated duration**: 3-5 minutes for all tests
