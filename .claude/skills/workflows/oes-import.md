# OES Import Skill

Import and manage Nokia OES activation reports for FibreFlow.

## Purpose

Handle daily OES (Optical Equipment Supplier) report imports by:
1. Uploading Excel reports via drag-drop UI
2. Tracking new inserts vs updates (upsert behavior)
3. Reconciling against drops table
4. Troubleshooting import issues
5. Managing server restarts

## Quick Reference

| Setting | Value |
|---------|-------|
| **UI URL** | `https://dev.fibreflow.app/activate` (dev) |
| **Production** | `https://app.fibreflow.app/activate` |
| **API Endpoint** | `/api/activate/import-oes` |
| **Database Table** | `oes_activations` |
| **Batch Table** | `oes_import_batches` |
| **Excel Format** | Nokia OES Report (13 columns, Jan 2027+) |

## Slash Commands

### `/oes` or `/oes-import`

Main entry point for OES operations.

**Usage**:
```
/oes                    # Show OES import status
/oes import             # Guide through import process
/oes status             # Check last import stats
/oes debug              # Diagnose import issues
/oes restart            # Restart dev server
```

### `/oes status`

Check current OES data status.

**Response Template**:
```
📊 OES Import Status:

Database Stats:
  Total OES records: [count]
  Matched to drops: [count]
  Last import: [timestamp]

Recent Imports:
  [date]: [filename] - [total] rows ([new] new, [updated] updated)
  [date]: [filename] - [total] rows ([new] new, [updated] updated)

Drops Coverage:
  Total drops: [count]
  OES confirmed: [count] ([percentage]%)
  Pending OES: [count]
```

### `/oes debug`

Diagnose import issues.

**Response Template**:
```
🔧 OES Import Diagnostics:

Server Status:
  Dev (3005): ✅ Running / ❌ Down
  Service: fibreflow-dev.service

API Health:
  /api/activate/import-oes: ✅ 200 / ❌ Error

Database:
  Connection: ✅ OK / ❌ Failed
  oes_activations table: ✅ Exists / ❌ Missing

Recent Errors:
  [error logs if any]

Suggested Actions:
  [based on diagnostics]
```

## When to Activate

### Trigger 1: OES Import Request

**User says**:
- "import OES"
- "upload OES report"
- "OES Excel"
- "activation report"
- "Nokia OES"

**Automatic Actions**:
1. Check dev server status
2. Provide import instructions
3. Guide to correct URL
4. Explain expected results

### Trigger 2: Import Issues

**User says**:
- "OES import stuck"
- "import not finishing"
- "import hanging"
- "wrong insert count"
- "OES not working"

**Automatic Actions**:
1. Check server logs
2. Verify service status
3. Check for port conflicts
4. Diagnose API endpoint
5. Suggest fixes

### Trigger 3: Data Questions

**User says**:
- "how many OES records"
- "OES coverage"
- "which drops have OES"
- "OES stats"

**Automatic Actions**:
1. Query database for counts
2. Calculate coverage percentage
3. Show recent import history
4. Compare against drops table

### Trigger 4: Server Issues

**User says**:
- "restart dev server"
- "dev down"
- "3005 not working"
- "server not responding"

**Automatic Actions**:
1. Check service status
2. Restart if needed
3. Verify HTTP response
4. Report status

## Excel Format Reference

Nokia OES Report structure (13 columns, updated Jan 2027):

| Column | Example | DB Field |
|--------|---------|----------|
| A: Drop Number | DR1858169 | `drop_number` |
| B: Serial Number | ALCLB48CB101 | `serial_number` |
| C: Timestamp | 46037.48 | `activation_date` |
| D: OLT Address | moa.olt.01:1-1-4-3 | `olt_address` |
| E: ONT Rx SIG (dBm) | -19.546 | `ont_rx_sig_dbm` |
| F: Link Budget ONT→OLT | -22.8 | `link_budget_ont_olt_db` |
| G: OLT Rx SIG (dBm) | -23.6 | `olt_rx_sig_dbm` |
| H: Link Budget OLT→ONT | -26.9 | `link_budget_olt_ont_db` |
| I: Status | Active | `status` |
| J: Latitude | -26.7136357 | `latitude` |
| K: Longitude | 27.0277261 | `longitude` |
| L: Current ONT RX | -40 | `current_ont_rx` |
| M: Team | moa1 | `team` |

**Note**: Column C timestamp is Excel serial date (days since 1900-01-01). Converted automatically.

**Format Change History:**
- Jan 2027: Removed "Stack Ref." column (commit `701969e2`) - back to 13 columns
- Jan 2026: Added "Stack Ref." column at position E (commit `79e97a07`) - 14 columns

## Database Schema

### oes_activations Table

```sql
CREATE TABLE oes_activations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  drop_number VARCHAR(20) NOT NULL UNIQUE,  -- Upsert key
  drop_id UUID REFERENCES drops(id),
  serial_number VARCHAR(50),
  activation_date DATE,
  activation_datetime TIMESTAMP,  -- Full timestamp if available
  olt_address VARCHAR(100),
  ont_rx_sig_dbm DECIMAL(6,3),
  link_budget_ont_olt_db DECIMAL(6,3),
  olt_rx_sig_dbm DECIMAL(6,3),
  link_budget_olt_ont_db DECIMAL(6,3),
  status VARCHAR(50),
  latitude DECIMAL(10,7),
  longitude DECIMAL(10,7),
  current_ont_rx DECIMAL(10,6),
  team VARCHAR(50),
  import_batch_id UUID,
  imported_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes
CREATE INDEX idx_oes_drop_number ON oes_activations(drop_number);
CREATE INDEX idx_oes_drop_id ON oes_activations(drop_id);
CREATE INDEX idx_oes_team ON oes_activations(team);
CREATE INDEX idx_oes_import_batch ON oes_activations(import_batch_id);
```

### oes_import_batches Table

```sql
CREATE TABLE oes_import_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  filename VARCHAR(255),
  report_date DATE,
  total_rows INTEGER,
  matched_drops INTEGER,
  unmatched_drops INTEGER,
  imported_by VARCHAR(100),
  imported_at TIMESTAMP DEFAULT NOW()
);
```

## Import Workflow

### Standard Import Flow

```
1. Navigate to: https://dev.fibreflow.app/activate
   (or production: https://app.fibreflow.app/activate)

2. Click "OES Import" tab

3. Drag-drop Excel file or click to upload

4. Select report date (optional, defaults to today)

5. Click "Preview" to verify data
   - Shows first 10 rows
   - Confirms total row count

6. Click "Import" to process
   - Progress indicator shows batches (500 rows each)
   - ~6000 rows takes ~10-15 seconds

7. Results displayed:
   - Total Rows: [count]
   - New Inserts: [count] (new DR numbers)
   - Updated: [count] (existing DR numbers refreshed)
   - Matched Drops: [count] (linked to drops table)
   - Not in Drops: [count] (OES-only, no drops record)
   - Errors: [count] (if any batch failed)
```

### Upsert Behavior

**Key**: `drop_number` is unique constraint

- **New Insert**: DR number not in `oes_activations` → creates new row
- **Update**: DR number exists → updates all fields, sets `updated_at = NOW()`

**Tracking Method** (count-based):
```sql
-- Count before import
SELECT COUNT(*) FROM oes_activations;  -- e.g., 5000

-- Run batch upserts...

-- Count after import
SELECT COUNT(*) FROM oes_activations;  -- e.g., 5500

-- Calculate
inserted = 5500 - 5000 = 500 new records
updated = total_rows - inserted = 6259 - 500 = 5759 updated
```

## Commands Reference

```bash
# Run locally on Velocity as user hein (passwordless sudo)

# Check dev server status
systemctl status fibreflow-dev.service --no-pager | head -15

# Restart dev server (port 3005)
sudo systemctl restart fibreflow-dev.service

# View service logs
sudo journalctl -u fibreflow-dev.service -n 50 --no-pager

# Check what's using port 3005
ss -tlnp | grep 3005

# HTTP health check (dev)
curl -s -o /dev/null -w "%{http_code}" http://100.96.203.105:3005/

# HTTP health check (production)
curl -s -o /dev/null -w "%{http_code}" http://100.96.203.105:3000/

# Pull latest code and rebuild (dev)
cd /home/velo/fibreflow-dev && git pull && npm run build

# Full restart sequence (dev)
cd /home/velo/fibreflow-dev && git pull && npm run build && \
sudo systemctl restart fibreflow-dev.service
```

## Database Queries

```sql
-- OES record count
SELECT COUNT(*) FROM oes_activations;

-- Recent imports
SELECT id, filename, report_date, total_rows, matched_drops, unmatched_drops, imported_at
FROM oes_import_batches
ORDER BY imported_at DESC
LIMIT 5;

-- OES coverage (how many drops have OES confirmation)
SELECT
  COUNT(*) FILTER (WHERE oes_confirmed = true) AS confirmed,
  COUNT(*) FILTER (WHERE oes_confirmed = false OR oes_confirmed IS NULL) AS pending,
  COUNT(*) AS total,
  ROUND(100.0 * COUNT(*) FILTER (WHERE oes_confirmed = true) / COUNT(*), 2) AS coverage_pct
FROM drops;

-- Drops with OES data but not in drops table
SELECT drop_number, serial_number, team, activation_date
FROM oes_activations
WHERE drop_id IS NULL
ORDER BY activation_date DESC
LIMIT 20;

-- Compare OES vs drops for a specific DR
SELECT
  d.drop_number,
  d.oes_confirmed,
  o.serial_number AS oes_serial,
  o.activation_date,
  o.status,
  o.team
FROM drops d
LEFT JOIN oes_activations o ON d.drop_number = o.drop_number
WHERE d.drop_number = 'DR1858169';

-- OES records by team
SELECT team, COUNT(*) as count
FROM oes_activations
GROUP BY team
ORDER BY count DESC;
```

## Troubleshooting

### ISSUE: Import Stuck / Not Finishing

**Symptoms**:
- Progress shows but never completes
- UI shows "Importing..." indefinitely
- No error message

**Root Cause**:
Old code used `RETURNING (xmax = 0)` which caused performance issues with 6000+ rows.

**Fix**:
1. Check server has latest code (run locally on Velocity):
```bash
cd /home/velo/fibreflow-dev && git log -1 --oneline
```

2. Should show commit: `fix(oes-import): use count-based approach`

3. If not, pull and restart:
```bash
cd /home/velo/fibreflow-dev && git pull && npm run build
sudo systemctl restart fibreflow-dev.service
```

---

### ISSUE: Wrong Insert/Update Counts

**Symptoms**:
- Shows "6259 New Inserts, 0 Updated" on re-import
- Counts don't make sense

**Root Cause**:
Old code had hardcoded `updated: 0` or RETURNING clause issues.

**Fix**:
Same as above - ensure latest code is deployed with count-based tracking.

**Verification**:
```sql
-- Check actual record count before/after import
SELECT COUNT(*) FROM oes_activations;
```

---

### ISSUE: Port 3005 Already in Use

**Symptoms**:
- `EADDRINUSE: address already in use :::3005`
- Server won't start

**Fix**:
```bash
# Restart the service (it will take over port 3005) — run locally on Velocity
sudo systemctl restart fibreflow-dev.service
```

**Note**: Don't try to kill processes manually. The systemd service manages port 3005.

---

### ISSUE: 502 Bad Gateway

**Symptoms**:
- Can't access dev URL
- Cloudflare tunnel not working

**Fix**:
```bash
# Check if service is running (run locally on Velocity)
systemctl is-active fibreflow-dev.service

# If not active, restart
sudo systemctl restart fibreflow-dev.service

# Verify local response
curl -s -o /dev/null -w "%{http_code}" http://100.96.203.105:3005/
```

---

### ISSUE: Database Connection Failed

**Symptoms**:
- Import fails with database error
- 500 Internal Server Error

**Check**:
```bash
# Test database connection
PGPASSWORD='$NEON_DB_PASSWORD' psql -h ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech -U neondb_owner -d neondb -c "SELECT COUNT(*) FROM oes_activations;"
```

**Common Causes**:
1. Wrong password in `.env` file
2. Network connectivity
3. Neon serverless cold start (retry usually works)

---

### ISSUE: Excel Parse Error

**Symptoms**:
- "No valid rows found"
- "Failed to parse Excel"

**Checks**:
1. Is file .xlsx format? (not .xls or .csv)
2. Is first row a header row?
3. Does Column A contain DR numbers starting with "DR"?
4. Is first sheet named "OLT DATA" or similar?

**Debug**:
Preview mode will show parsed data before import.

---

### ISSUE: 504 Gateway Timeout on Large Imports

**Symptoms**:
- Import error: "Unexpected token '<', "<!DOCTYPE"... is not valid JSON"
- Browser shows `POST /api/activate/import-oes 504 (Gateway Timeout)`
- Preview works but actual import fails

**Root Cause**:
Nginx proxy_read_timeout too low for large imports (7000+ rows). The `maxDuration` config in Next.js only works on Vercel, not self-hosted.

**Fix**:
Increase nginx proxy timeouts (run locally on Velocity):
```bash
# Check current config
sudo grep proxy_read_timeout /etc/nginx/sites-enabled/dev-fibreflow

# Add timeout settings to dev server block (if missing)
# proxy_connect_timeout 300s;
# proxy_send_timeout 300s;
# proxy_read_timeout 300s;

# Reload nginx
sudo nginx -t && sudo systemctl reload nginx
```

**Required Timeouts**:
| Rows | Recommended Timeout |
|------|---------------------|
| <3000 | 60s (default) |
| 3000-5000 | 120s |
| 5000-8000 | 300s |
| >8000 | 600s |

## Auto-Activation Rules

### DO Automatically:
- ✅ Check server status when import issues reported
- ✅ Show database stats when asked
- ✅ Diagnose import problems
- ✅ Provide SQL queries for investigation

### ASK First:
- ❓ Restarting dev server
- ❓ Running database updates
- ❓ Modifying import code

### DON'T:
- ❌ Delete OES records
- ❌ Modify production data
- ❌ Change database schema

## Port Reference

**IMPORTANT**: Never touch port 3000 (production)!

| Port | Environment | Service | Notes |
|------|-------------|---------|-------|
| 3000 | Production | `fibreflow-production.service` | DO NOT TOUCH |
| 3005 | Development | `fibreflow-dev.service` | Dev and local testing |

## Quick Recovery Checklist

When OES import is broken (run locally on Velocity as user hein):

```bash
# 1. Check service status
systemctl status fibreflow-dev.service --no-pager | head -10

# 2. Pull latest code
cd /home/velo/fibreflow-dev && git pull

# 3. Rebuild
cd /home/velo/fibreflow-dev && npm run build

# 4. Restart service
sudo systemctl restart fibreflow-dev.service

# 5. Verify
sleep 3 && curl -s -o /dev/null -w "%{http_code}" http://100.96.203.105:3005/
```

## Issue Log (Self-Improving)

| Date | Issue | Root Cause | Fix Applied |
|------|-------|------------|-------------|
| 2027-01-27 | Column misalignment (13 cols) | Nokia removed "Stack Ref." column | Updated parser indices (commit `701969e2`) |
| 2027-01-27 | 504 Gateway Timeout on large imports | Nginx proxy_read_timeout too low (60s) | Increased to 300s in nginx config |
| 2026-01-16 | Import stuck/hanging | RETURNING clause with 6000+ rows | Changed to count-based tracking |
| 2026-01-16 | Wrong insert count (6259 New, 0 Updated) | Hardcoded `updated: 0` | Return actual counts |
| 2026-01-16 | Port 3006 in use | Previous process still running | Use systemctl restart |

**Add new issues here as they're discovered and fixed.**

## Success Criteria

Skill is successful when:
- ✅ Daily OES imports complete in <30 seconds
- ✅ Correct new/updated counts displayed
- ✅ Server restart is one command
- ✅ Issues are diagnosed quickly
- ✅ User can self-serve common problems

## Files Reference

| File | Purpose |
|------|---------|
| `pages/api/activate/import-oes.ts` | OES import API endpoint |
| `src/modules/activate/components/OESImportTab.tsx` | Import UI component |
| `src/modules/activate/components/DrListPage.tsx` | Main page with tabs |
| `scripts/migrations/060_site_submission_tracking.sql` | Database schema |

## QField Sync Integration (Jan 2026)

After OES import, data automatically syncs to QFieldCloud for mobile viewing.

### Automatic Trigger

The import API (`/api/activate/import-oes`) triggers QField sync via webhook:
```
POST http://100.96.203.105:8095/sync/oes
```

### Dual-Layer Output

The sync creates two layers in QField:

| Layer | Color | Source |
|-------|-------|--------|
| `OES DD-MM-YY Actual` | 🔵 Blue | OES Excel GPS (where technician was) |
| `OES DD-MM-YY Planned` | 🟢 Green | Drops table GPS (where drop was planned) |

**Visual Comparison:** Offset between blue and green dots shows GPS discrepancy.

### SA Bounds Filtering

Bad GPS coordinates are filtered out:
- Latitude: -35.0 to -22.0
- Longitude: 16.0 to 33.0

### Manual Sync Commands

```bash
# Run locally on Velocity as user hein

# Check sync status
curl -s http://localhost:8095/status

# Trigger manual sync
curl -s -X POST http://localhost:8095/sync/oes -H 'Content-Type: application/json' -d '{"batchId": "manual"}'

# View sync logs
tail -30 /var/log/qfield-oes-sync.log
```

### Sync Script Location

Server: `/opt/qfield-sync/sync_oes_db_to_qfield.py`

## Related Skills

- `/deploy` - Deploy code changes to dev
- `/wa-monitor` - WhatsApp monitoring (sends feedback to groups)
- `/Qfield` - Full QField management commands
