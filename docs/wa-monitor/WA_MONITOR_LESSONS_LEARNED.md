# WA Monitor: Lessons Learned

## Recent Incidents

### November 10, 2025: Multi-User Locking System Implementation

**Date:** November 10, 2025
**Issue:** Auto-refresh wiping user's checkbox selections while editing
**Impact:** Lost work, user frustration
**Solution:** Multi-user locking system with Edit mode

#### The Problem
User reported:
> "die WA Monitor sal elke nou en dan my selection van tickboxes wipe terwyl ek nog besig is met die selection"

- Auto-refresh runs every 30 seconds
- Fetches new data from database and updates React state
- Overwrites user's local checkbox selections
- User loses their work mid-review

#### The Solution (3-Phase Implementation)
**Phase 1: Database + API**
- Added `locked_by VARCHAR(255)` and `locked_at TIMESTAMP` columns
- Created lock/unlock API endpoints
- 5-minute timeout for abandoned locks
- Lock conflict detection (409 status)

**Phase 2: Frontend UI**
- Checkboxes disabled by default (read-only mode)
- Edit button acquires database lock
- Save/Cancel buttons release lock
- Blue alert: "Editing mode active - Auto-refresh disabled"
- Lock status warnings when someone else editing

**Phase 3: Auto-Refresh Skip**
- Dashboard preserves local state for locked drops
- Auto-refresh still runs every 30s
- But skips drops locked by current user
- Other users see real-time updates

#### Results
- ✅ Checkbox selections preserved while editing
- ✅ Multi-user conflict prevention working
- ✅ Auto-cleanup on browser close
- ✅ No more lost work

#### Key Lessons
1. **Edit Mode as Explicit State:** Clear UI pattern (Edit → Save/Cancel)
2. **Lock Timeout Balance:** 5 minutes = sweet spot (enough time to work, auto-expires if stuck)
3. **Conditional Refresh:** Skip refresh for locked items, preserve for others
4. **Neon SQL Limitation:** Can't use template literals in INTERVAL - hardcode instead
   ```typescript
   // ❌ Doesn't work
   INTERVAL '${LOCK_TIMEOUT_MINUTES} minutes'

   // ✅ Works
   INTERVAL '5 minutes'
   ```

5. **Cleanup Effects Important:** Auto-unlock on component unmount prevents stuck locks

#### Statistics
- 470 lines of code
- 7 files modified
- 2 database columns
- 2 API endpoints
- 3 git commits

**Full Documentation:** See `WA_MONITOR_LOCKING_SYSTEM.md`

---

### November 10, 2025: WhatsApp Bridge Failure (21 Hours Downtime)

**Date:** November 10, 2025
**Duration:** 21 hours (Nov 9, 1:17 PM → Nov 10, 7:34 AM)
**Impact:** ALL WhatsApp drops failed to insert into database
**Root Cause:** Overcomplicated INSERT statement + Wrong column names after recompilation

#### The Problem
Someone recompiled the WhatsApp bridge on Nov 9 at 1:17 PM with old source code that had:
- Wrong column names (`step_01_property_frontage` instead of `step_01_house_photo`)
- Overcomplicated INSERT trying to set all 12 QA step columns explicitly
- Should have let database defaults handle the QA steps

#### The Fix
- Simplified INSERT from 14 columns to 5 columns
- Database auto-fills 12 QA step columns (all have `DEFAULT false`)
- Installed Go on VPS (`/usr/local/go/bin/go`)
- Recompiled with corrected code
- **Time to fix:** 45 minutes

#### Key Lessons
1. **Keep It Simple:** Bridge should ONLY insert drop number, let database handle defaults
2. **Version Control:** Created backup of working code (`main.go.backup.20251110_073000`)
3. **Test Before Deploy:** Always test INSERT statement manually before recompiling
4. **Monitoring Needed:** Issue took 21 hours to detect - need alerts

**Full Documentation:** See `WA_MONITOR_BRIDGE_FIX_NOV2025.md`

---

### November 10, 2025: Timezone Fix (SAST Timestamps)

**Date:** November 10, 2025 (09:45 AM SAST)
**Issue:** All WhatsApp QA comments showed UTC timestamps instead of South African time
**User Impact:** 2-hour time difference caused confusion for QA reviewers

#### The Problem
- VPS server timezone was set to UTC
- Go code used `time.Now()` without explicit timezone
- Comments showed: `Auto-created from WhatsApp on 2025-11-10 07:37:59` (UTC)
- Users expected: `Auto-created from WhatsApp on 2025-11-10 09:37:59 SAST`

#### The Fix (Two-Part Solution)
1. **Set VPS timezone to Africa/Johannesburg**
   ```bash
   sudo timedatectl set-timezone Africa/Johannesburg
   ```
   - Ensures ALL services use SAST by default

2. **Update Go code to explicitly use SAST**
   ```go
   // Load South African timezone
   loc, locErr := time.LoadLocation("Africa/Johannesburg")
   if locErr != nil {
       loc = time.UTC // Fallback
   }
   nowSAST := time.Now().In(loc)

   // Use in comment
   fmt.Sprintf("Auto-created from WhatsApp on %s SAST", nowSAST.Format("2006-01-02 15:04:05"))
   ```

#### Key Lessons
1. **Two-Layer Timezone Strategy:** Set BOTH system timezone AND explicit timezone in code
2. **Add Timezone Suffix:** Always include "SAST" in user-facing timestamps for clarity
3. **Database vs Display:** Store in UTC (database), display in SAST (users)
4. **Explicit is Better:** Don't rely on system timezone - load explicitly in code
5. **Test with Real Data:** Verified with DR0000021 - timestamp matched perfectly

#### Results
- ✅ All timestamps now show SAST with clear suffix
- ✅ VPS timezone permanently set to Africa/Johannesburg
- ✅ Bridge logs show "+0200 SAST"
- ✅ Tested with DR0000021: `Auto-created from WhatsApp on 2025-11-10 10:05:47 SAST`

**Full Documentation:** See `WA_MONITOR_TIMEZONE_FIX_NOV2025.md`

---

### November 9, 2025: Adding Mamelodi Project (4 Hours)

**Task:** Add Mamelodi POP1 Activations group to WA Monitor
**Expected Time:** 5 minutes
**Actual Time:** 4 hours

**Why it took 4 hours:** Configuration scattered across 7+ locations, multiple database connections, undocumented dependencies, and lack of clear process.

---

## What We Did (Step-by-Step)

### Step 1: Added Group to Python Configuration (5 minutes)
**File:** `/opt/velo-test-monitor/services/realtime_drop_monitor.py`

```python
PROJECTS = {
    'Lawley': {...},
    'Velo Test': {...},
    'Mohadin': {...},
    'Mamelodi': {  # ADDED THIS
        'group_jid': '120363408849234743@g.us',
        'project_name': 'Mamelodi',
        'group_description': 'Mamelodi POP1 Activations group'
    }
}
```

**Result:** ✅ Easy, worked immediately

---

### Step 2: Restarted Drop Monitor (1 minute)
```bash
systemctl restart drop-monitor
```

**Result:** ✅ Service started monitoring Mamelodi group

---

### Step 3: Posted Test Drop (DR20000001) - Then Hell Began (3 hours 54 minutes)

#### **Problem 1: "Tuple Index Out of Range" Error (45 minutes)**
**Issue:** Python INSERT statement had mismatched placeholders
- INSERT had 19 columns
- VALUES had only 5 placeholders (%s)
- Error: `tuple index out of range`

**Root Cause:** Code was edited previously to add `whatsapp_message_date` column but VALUES section was corrupted

**Files Affected:**
- `/opt/velo-test-monitor/services/realtime_drop_monitor.py` lines 626-656

**Attempts to Fix:**
1. First attempt: Used `sed` to add placeholders → Created syntax errors
2. Second attempt: Python script to replace function → Deleted Mamelodi config
3. Third attempt: Restored backup → Backup also had broken code
4. Fourth attempt: Copied from older backup → Used wrong database

**Final Fix:** Manually rewrote `insert_drop_numbers_to_neon()` function with clean code

**Time Lost:** 45 minutes debugging, 6 failed attempts

---

#### **Problem 2: Wrong Database URL (Old vs New) (1 hour 30 minutes)**

**Issue:** Multiple database URLs scattered across system

**What We Found:**
```
OLD DATABASE (should NOT be used):
postgresql://neondb_owner:npg_RIgDxzo4St6d@ep-damp-credit-a857vku0-pooler.eastus2.azure.neon.tech/neondb

CORRECT DATABASE (production):
postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb
```

**Files Using WRONG Database:**
1. `/opt/velo-test-monitor/services/realtime_drop_monitor.py` (line 70) ❌
2. `/opt/velo-test-monitor/services/resubmission_handler.py` (line 20) ❌
3. `/etc/systemd/system/drop-monitor.service` environment variable ❌
4. Production app `.env.production` (correct) ✅
5. PM2 ecosystem.config.js (wrong, cached) ❌

**Symptoms:**
- Mamelodi drops went to old database
- Dashboard showed different data (reading new database)
- DR numbers didn't match between systems

**Fixes Required:**
1. Update Python scripts (2 files)
2. Update systemd service environment
3. Clear PM2 cache
4. Restart all services
5. Rebuild production app

**Time Lost:** 1 hour 30 minutes tracking down database mismatches

---

#### **Problem 3: Resubmission Handler Used Wrong Table (30 minutes)**

**Issue:** Resubmission handler checked `installations` table (doesn't exist anymore)

```python
# Line 225 - WRONG
cursor.execute("SELECT id FROM installations WHERE drop_number = %s", (drop_number,))

# Should be:
cursor.execute("SELECT id FROM qa_photo_reviews WHERE drop_number = %s", (drop_number,))
```

**Impact:**
- System always thought drops were "new"
- Never detected resubmissions
- Resubmission feature didn't work

**Files Affected:**
- `/opt/velo-test-monitor/services/resubmission_handler.py` (multiple lines)

**Time Lost:** 30 minutes

---

#### **Problem 4: PM2 Cached Old Database URL (40 minutes)**

**Issue:** PM2 process manager cached environment variables

**Attempts:**
1. Restart with `pm2 restart fibreflow-prod` → Still old DB
2. Restart with `--update-env` flag → Still old DB
3. Updated `.env.production` → PM2 ignored it
4. Updated `ecosystem.config.js` → PM2 still used cached value
5. Deleted and recreated process → Finally worked!

**Root Cause:** PM2 caches environment variables in `~/.pm2/dump.pm2`

**Time Lost:** 40 minutes

---

#### **Problem 5: Missing `resubmitted` Column in Old Database (20 minutes)**

**Issue:** We added `resubmitted` column to NEW database, but code was writing to OLD database

**Error:**
```
column "resubmitted" of relation "qa_photo_reviews" does not exist
```

**Proof system was using wrong database!**

**Time Lost:** 20 minutes debugging before realizing database mismatch

---

#### **Problem 6: Dashboard Showed Different Data Than VPS (30 minutes)**

**Issue:**
- VPS drop monitor: Writing to old database
- Production app: Reading from new database
- Result: Dashboard showed wrong drops

**Example:**
- Posted DR20000003 to Mamelodi
- VPS confirmed: "✅ Created QA review for DR20000003"
- Dashboard: Doesn't show DR20000003
- Query old DB: DR20000003 exists!
- Query new DB: DR20000003 missing!

**Time Lost:** 30 minutes confusion

---

#### **Problem 7: SQLite Path Was Hardcoded Wrong (15 minutes)**

**Issue:** Drop monitor looking for SQLite at `/app/store/messages.db` (Docker path)
**Correct Path:** `/opt/velo-test-monitor/services/whatsapp-bridge/store/messages.db`

**Why:** Code copied from Docker deployment, never updated for bare-metal VPS

**Time Lost:** 15 minutes

---

## Why It Was So HARD - Root Causes

### 1. **Configuration Scattered Everywhere** 🔥
**Problem:** No single source of truth

Configuration locations:
1. Python script: PROJECTS dictionary (line 43)
2. Python script: NEON_DB_URL (line 70)
3. Python script: MESSAGES_DB_PATH (line 71)
4. Resubmission handler: NEON_DB_URL (line 20)
5. Systemd service: Environment variables
6. PM2 config: Environment variables
7. Production app: .env.production
8. Development app: .env.production

**Impact:** Had to update 8 different files to add ONE project!

---

### 2. **Database URLs Hardcoded** 🔥
**Problem:** Connection strings duplicated in 5+ places

When database changes:
- Must update 5+ files
- Miss one → System breaks in mysterious ways
- No validation → Fails silently

**Should Be:** ONE config file, all systems read from there

---

### 3. **No Environment Separation** 🔥
**Problem:** Only ONE drop monitor = production only

Can't test:
- No dev environment to test Mamelodi first
- Changes go directly to production
- Break in production = affects all users
- 4 hours of debugging happened LIVE

**Should Be:** Test on dev first, deploy to prod when working

---

### 4. **Poor Error Messages** 🔥
**Problem:** Errors didn't reveal root cause

Examples:
- "Tuple index out of range" → Useless, had to read code
- "Column doesn't exist" → Which database? Which table?
- "DR20000003 created" → But not visible → No indication of database mismatch

**Should Be:** Clear errors: "Connected to OLD database (eastus2), expected NEW database (gwc)"

---

### 5. **No Documentation of Process** 🔥
**Problem:** No step-by-step guide existed

Adding Mamelodi required:
- Guessing which files to edit
- Trial and error debugging
- Reading through 1000+ lines of Python
- 6 service restarts
- Multiple database connection tests

**Should Be:** Simple checklist: "Edit config.yaml, restart service, done!"

---

### 6. **Code Not Modular** 🔥
**Problem:** Everything tightly coupled

Example:
- DROP_MONITOR includes database URL
- DROP_MONITOR includes SQLite path
- DROP_MONITOR includes project list
- DROP_MONITOR includes resubmission logic
- All in one 1000+ line file!

**Should Be:** Separate concerns:
- config.py → Configuration
- database.py → Database operations
- monitor.py → Drop monitoring logic
- projects.py → Project definitions

---

### 7. **Multiple Outdated Backups** 🔥
**Problem:** Backups existed but were also broken

When code broke:
- Restored from "backup" → Backup was also broken!
- Restored from "backup-twilio" → Used old database URL
- Restored from "backup_1762697632" → Missing Mamelodi config

**Should Be:**
- Git version control for VPS code
- Automated backups
- Tested restore procedures

---

## Current Process: "How to Add a Project Today" (The Hard Way)

### Prerequisites
- SSH access to VPS: `ssh root@72.60.17.245`
- WhatsApp group JID
- Project name

### Step 1: Add to Drop Monitor Python Script (5 min)
```bash
ssh root@72.60.17.245
nano /opt/velo-test-monitor/services/realtime_drop_monitor.py
```

Find PROJECTS dictionary (around line 43), add:
```python
'ProjectName': {
    'group_jid': 'XXXXXXXXXX@g.us',
    'project_name': 'ProjectName',
    'group_description': 'Description'
}
```

### Step 2: Verify Database URLs Are Correct (10 min)
Check these files have CORRECT database URL:

```bash
# 1. Drop monitor script (line 70)
grep "NEON_DB_URL" /opt/velo-test-monitor/services/realtime_drop_monitor.py

# 2. Resubmission handler (line 20)
grep "NEON_DB_URL" /opt/velo-test-monitor/services/resubmission_handler.py

# 3. Systemd service
cat /etc/systemd/system/drop-monitor.service | grep DATABASE_URL

# 4. Production app
grep "DATABASE_URL" /var/www/fibreflow/.env.production

# 5. PM2 config
grep "DATABASE_URL" /var/www/ecosystem.config.js
```

**CORRECT URL:** `postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb`

If ANY are wrong, update them!

### Step 3: Verify SQLite Path (2 min)
```bash
grep "MESSAGES_DB_PATH" /opt/velo-test-monitor/services/realtime_drop_monitor.py
```

Should be: `/opt/velo-test-monitor/services/whatsapp-bridge/store/messages.db`

### Step 4: Test Python Syntax (1 min)
```bash
cd /opt/velo-test-monitor/services
python3 -m py_compile realtime_drop_monitor.py
```

If errors, fix them before proceeding!

### Step 5: Restart Drop Monitor (1 min)
```bash
systemctl restart drop-monitor
systemctl status drop-monitor
```

Verify:
- Status: "active (running)"
- Logs show: "• ProjectName: XXXXXXXXXX@g.us"

### Step 6: Check Logs (2 min)
```bash
tail -50 /opt/velo-test-monitor/logs/drop_monitor.log
```

Look for:
- "🎯 MONITORING ALL CONFIGURED PROJECTS:"
- Your new project listed
- No errors

### Step 7: Post Test Drop (5 min)
1. Find unused drop number in database:
```bash
psql 'postgresql://...' -c "SELECT drop_number FROM qa_photo_reviews ORDER BY drop_number DESC LIMIT 20;"
```

2. Post to WhatsApp group
3. Wait 20 seconds
4. Check logs:
```bash
tail -50 /opt/velo-test-monitor/logs/drop_monitor.log
```

Look for: "✅ Created QA review for DRXXXXXXXX"

### Step 8: Verify in Database (2 min)
```bash
psql 'postgresql://...' -c "SELECT drop_number, project FROM qa_photo_reviews WHERE project='ProjectName';"
```

### Step 9: Check Dashboard (2 min)
Visit: https://app.fibreflow.app/wa-monitor

Verify:
- Your drop appears
- Project name correct
- Can filter by project

### Step 10: Update Documentation (5 min)
Update these files:
- `CLAUDE.md` - Add to monitored groups list
- `docs/WA_MONITOR_DATABASE_SETUP.md` - Add to groups
- `docs/CHANGELOG.md` - Log the change

---

**Total Time (If Everything Works):** 35 minutes
**Actual Time (If Things Break):** 2-4 hours

---

## What "Refactoring" Means

### Definition
**Refactoring** = Improving code structure WITHOUT changing what it does

Like renovating a house:
- Outside looks the same
- Rooms work the same
- But inside: better wiring, better plumbing, cleaner layout
- Makes future changes easier

### What We're NOT Changing
- ✅ Dashboard still works the same
- ✅ Drops still monitored
- ✅ Database schema unchanged
- ✅ WhatsApp groups unchanged
- ✅ Users see no difference

### What We ARE Changing
- 🔧 Configuration: 8 files → 1 config file
- 🔧 Code structure: 1 monolith → Multiple modules
- 🔧 Environments: 1 prod → Prod + Dev
- 🔧 Process: 4 hours → 5 minutes to add project

### Example: Before vs. After

**Before (Current):**
```python
# Line 43: Hardcoded in Python
PROJECTS = {
    'Lawley': {'group_jid': '120363418298130331@g.us', ...},
}

# Line 70: Hardcoded database URL
NEON_DB_URL = "postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@..."

# Line 71: Hardcoded SQLite path
MESSAGES_DB_PATH = "/opt/velo-test-monitor/services/..."

# Result: Must edit Python code to change anything
```

**After (Refactored):**
```yaml
# /opt/wa-monitor/config/production.yaml
database:
  url: ${NEON_DATABASE_URL}  # From environment

sqlite:
  path: ${SQLITE_PATH}  # From environment

projects:
  - name: Lawley
    group_jid: "120363418298130331@g.us"
    enabled: true

# Result: Edit config file, no code changes needed!
```

### Why Refactor?

**Problem Today:**
1. Add Mamelodi → 4 hours
2. Database change → Update 8 files
3. Test new feature → Affects production
4. Code breaks → Hard to debug

**After Refactoring:**
1. Add project → Edit 1 file, restart → 5 minutes
2. Database change → Update 1 environment variable
3. Test new feature → Use dev environment
4. Code breaks → Clear error messages, easy rollback

### Refactoring Principles

1. **DRY (Don't Repeat Yourself)**
   - Before: Database URL in 5 places
   - After: Database URL in 1 place

2. **Separation of Concerns**
   - Before: Everything in one file
   - After: Config, database, monitor, projects = separate modules

3. **Configuration over Code**
   - Before: Edit Python to add project
   - After: Edit YAML to add project

4. **Environment Parity**
   - Before: Only production
   - After: Dev mirrors prod (test safely)

---

## Recommendations for Future

### Immediate (Do This Week)
1. ✅ Create config file for projects
2. ✅ Set up dev environment
3. ✅ Document "add project" process
4. ✅ Centralize database configuration

### Short-term (Do This Month)
1. ⚠️ Add automated tests
2. ⚠️ Set up monitoring/alerts
3. ⚠️ Create rollback procedures
4. ⚠️ Git version control for VPS code

### Long-term (Nice to Have)
1. 💡 CI/CD pipeline (auto-deploy on git push)
2. 💡 Configuration UI (add projects via web interface)
3. 💡 Staging environment (3rd environment for QA)
4. 💡 Infrastructure as Code (automate VPS setup)

---

## Key Lessons

1. **Configuration Sprawl is the Enemy**
   - Scattered config = guaranteed bugs
   - Solution: Single source of truth

2. **Production-Only Testing is Dangerous**
   - No safe place to experiment
   - Solution: Dev environment required

3. **Clear Documentation Saves Hours**
   - 4 hours debugging = cost of no docs
   - Solution: Document as you build

4. **Error Messages Matter**
   - "Tuple index" = useless
   - "Connected to wrong database" = helpful
   - Solution: Add validation and clear errors

5. **Refactoring is an Investment**
   - Costs: 1-2 days upfront work
   - Saves: Hours every time you add/change something
   - ROI: Massive over time

---

## Conclusion

Adding Mamelodi took 4 hours because:
- ❌ No centralized configuration
- ❌ No dev environment
- ❌ Database URLs scattered everywhere
- ❌ No process documentation
- ❌ Code not modular
- ❌ Poor error messages

**The refactoring will fix all of these!**

After refactoring:
- ✅ Single config file
- ✅ Prod + Dev environments
- ✅ Clear process (5 minutes!)
- ✅ Modular, maintainable code
- ✅ Professional enterprise setup

**Time to refactor: 1-2 days**
**Time saved per project: 3.5 hours**
**Break-even: After 1-2 new projects**
**Long-term: Priceless (enables rapid iteration)**
