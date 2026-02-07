# Validation Implementation Guide

## How to Create Effective Validation Commands

This guide walks you through creating, testing, and optimizing validation commands for FibreFlow.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Step-by-Step Process](#step-by-step-process)
3. [Writing Effective Validation Commands](#writing-effective-validation-commands)
4. [Testing and Iteration](#testing-and-iteration)
5. [Optimization Guidelines](#optimization-guidelines)
6. [Documentation Standards](#documentation-standards)

---

## Prerequisites

### Tools Required

Your AI coding assistant needs access to these tools:

- **SSH/sshpass** - VPS access (already configured)
- **psql** - PostgreSQL client (Neon database)
- **curl** - API testing
- **jq** - JSON parsing
- **systemctl** - Service management (via SSH)
- **tail/grep** - Log analysis (via SSH)

### Environment Setup

Ensure these are configured in your system:

```bash
# VPS credentials (already in approved commands)
VPS_HOST=72.60.17.245
VPS_USER=root
VPS_PASSWORD='$VPS_SSH_PASSWORD'

# Database connection (Neon)
DATABASE_URL='postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require'

# Production/Dev URLs
PROD_URL=https://app.fibreflow.app
DEV_URL=https://dev.fibreflow.app
```

---

## Step-by-Step Process

### Phase 1: Planning (30 minutes)

**1. Identify the Module/Feature**
```
Example: WA Monitor
- User submits drop to WhatsApp group
- WhatsApp Bridge captures message
- Monitor service processes it
- Stored in database
- Displayed on dashboard
- Synced to SharePoint nightly
```

**2. Map the User Flow**

Create a flow diagram:
```
User Action → System Response → Verification Point
     ↓              ↓                   ↓
   Input        Processing            Output
```

**Example for WA Monitor:**
```
WhatsApp Message
    ├─ Verification: Message appears in SQLite DB
    ↓
Monitor Service Processes
    ├─ Verification: Service logs show processing
    ↓
Stored in Neon PostgreSQL
    ├─ Verification: Query finds the record
    ↓
API Returns Drop
    ├─ Verification: Endpoint returns correct JSON
    ↓
Dashboard Displays
    ├─ Verification: HTML contains drop number
```

**3. Identify Edge Cases**

Common edge cases:
- **Resubmissions** - Same drop posted twice
- **Missing data** - Incomplete submissions
- **Error handling** - Invalid phone numbers, LIDs
- **Race conditions** - Concurrent submissions
- **Service failures** - Monitor down, database unreachable

**4. Define Pass/Fail Criteria**

For each test:
```
✅ PASS = Specific expected output
❌ FAIL = Any deviation from expected output
```

**Example:**
```
Test: Check wa-monitor-prod service status
Command: ssh root@72.60.17.245 "systemctl is-active wa-monitor-prod"
Expected: "active"
Pass: Output = "active"
Fail: Output = "inactive" | "failed" | command error
```

### Phase 2: Create Validation Command (1 hour)

**1. Create Command File**

```bash
# For slash commands in .agent-os/commands/
touch .agent-os/commands/validate-wa-monitor.md

# Or standalone command files
touch docs/validation/commands/validate-wa-monitor.md
```

**2. Structure Template**

Use this template:

```markdown
# /validate-{module-name}

## Overview
Brief description of what this validates

## Prerequisites
- List required services/tools
- Environment variables needed
- Test data requirements

## Validation Steps

### 1. Test Name
**Purpose**: What this test validates

**Commands to run**:
```bash
# Actual bash commands the AI will execute
command here
```

**Expected output**:
```
Exact expected output
```

**Pass criteria**: Specific conditions for success
**Fail criteria**: What indicates failure
**On failure**: What to do next (check logs, suggest fix)

### 2. Next Test
...

## Success Report Format
Template for final report

## Known Limitations
What this validation doesn't cover
```

**3. Write Detailed Tests**

For each test, be **extremely specific**:

❌ **Bad (too vague):**
```markdown
### Check if database is working
Run a query and see if it works
```

✅ **Good (specific and actionable):**
```markdown
### Verify Database Connectivity from VPS

**Purpose**: Ensure wa-monitor service can reach Neon PostgreSQL

**Command**:
```bash
ssh root@72.60.17.245 "psql 'postgresql://neondb_owner:$NEON_DB_PASSWORD_OLD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require' -c 'SELECT COUNT(*) FROM qa_photo_reviews;'"
```

**Expected output**:
```
 count
-------
  2543
(1 row)
```

**Pass criteria**:
- Command exit code = 0
- Output contains a number (any count is valid)
- No connection errors

**Fail criteria**:
- Exit code ≠ 0
- Output contains "could not connect"
- Output contains "authentication failed"

**On failure**:
1. Check VPS can reach internet: `ssh root@72.60.17.245 "ping -c 1 8.8.8.8"`
2. Verify DATABASE_URL in `/opt/wa-monitor/prod/config/.env`
3. Check Neon database status at console.neon.tech
4. Report: "Database unreachable from VPS - [specific error]"
```

### Phase 3: Initial Testing (30 minutes)

**1. Run the Validation Command**

```bash
# In Claude Code
/validate-wa-monitor

# Or copy the command content and paste
```

**2. Observe Execution**

Watch for:
- ✅ Commands execute without errors
- ✅ AI parses outputs correctly
- ✅ Pass/fail logic works as expected
- ❌ Unexpected failures (false negatives)
- ❌ Passes when it shouldn't (false positives)
- ❌ Commands hang or timeout

**3. Document First Run**

Create result file:
```bash
docs/validation/wa-monitor/results/2025-11-24-run-1.md
```

Template:
```markdown
# Validation Run - [Date/Time]

## Configuration
- Branch: master
- Commit: abc123
- Environment: Local testing

## Results

### Test 1: [Name]
- Status: ✅ PASS / ❌ FAIL
- Output: [Actual output]
- Notes: [Any observations]

### Test 2: [Name]
...

## Issues Found
1. [Description of any issues]
2. ...

## False Positives/Negatives
- [Any tests that failed incorrectly]
- [Any tests that passed incorrectly]

## Improvements Needed
- [ ] [Specific changes to make]
- [ ] ...

## Overall Assessment
[Ready for production? / Needs refinement?]
```

### Phase 4: Iteration (2-3 hours over multiple runs)

**Goal:** Run validation 10 times with consistent, accurate results

**For each issue found:**

**Issue Type 1: False Positive**
```
Problem: Test passes when system has a bug
Fix: Make pass criteria more strict
Example: Check not just "service running" but "service + no errors in last 10 log lines"
```

**Issue Type 2: False Negative**
```
Problem: Test fails when system is healthy
Fix: Make pass criteria more flexible
Example: Allow 1-2 second variance in timestamps, not exact match
```

**Issue Type 3: Flaky Test**
```
Problem: Sometimes passes, sometimes fails (same system state)
Fix: Add retry logic or stabilization wait
Example: Wait 3 seconds after service restart before checking status
```

**Issue Type 4: Unclear Failure Message**
```
Problem: Test fails but doesn't explain why
Fix: Add more detailed error reporting
Example: "Database query failed" → "Database query failed: connection timeout after 30s. Check VPS networking."
```

**Track improvements:**
```bash
docs/validation/wa-monitor/optimization-log.md
```

```markdown
# WA Monitor Validation Optimization Log

## 2025-11-24 - Run 1
**Issue**: Service status check always failed
**Root cause**: SSH command needed single quotes around systemctl
**Fix**: Changed `systemctl status` to `'systemctl status wa-monitor-prod'`
**Result**: Now passes consistently

## 2025-11-24 - Run 3
**Issue**: Database connectivity test intermittently failed
**Root cause**: Query timeout due to cold start (Neon serverless)
**Fix**: Added retry logic with 3 attempts, 5 second timeout each
**Result**: 100% pass rate over next 5 runs
```

### Phase 5: Production-Ready Certification (After 10 runs)

**Checklist:**

- [ ] Ran 10+ times with consistent results
- [ ] Catches known bugs (tested by introducing bugs)
- [ ] No false positives in last 5 runs
- [ ] No false negatives in last 5 runs
- [ ] Completes in < 10 minutes (or acceptable timeframe)
- [ ] Clear, actionable failure messages
- [ ] Edge cases covered (resubmissions, errors, etc.)
- [ ] Documentation complete (README, scenarios, issues)
- [ ] Team has reviewed and approved

**When certified:**
```markdown
# Update docs/validation/wa-monitor/README.md

## Status: ✅ PRODUCTION READY

**Certified on**: 2025-11-24
**Runs completed**: 15
**Pass rate**: 98% (1 false negative fixed in optimization)
**Average duration**: 4.2 minutes
**Bugs caught**: 3 (LID resolution, cache issue, DB connectivity)
```

---

## Writing Effective Validation Commands

### Best Practices

**1. Be Extremely Specific**

❌ "Check the database"
✅ "Query qa_photo_reviews table for records created in last 24 hours, expect at least 1 row"

**2. Use Actual Commands**

❌ "Somehow verify the service is running"
✅ "Run `ssh root@72.60.17.245 'systemctl is-active wa-monitor-prod'` and expect output 'active'"

**3. Define Clear Pass/Fail**

❌ "See if it looks right"
✅ "Exit code 0 AND output contains 'success' AND response time < 2 seconds = PASS"

**4. Add Context on Failure**

❌ "Test failed"
✅ "Test failed: Service inactive. Check logs: `tail /opt/wa-monitor/prod/logs/wa-monitor-prod.log`. Common causes: 1) Python cache not cleared, 2) Service crashed, 3) Config error"

**5. Test End-to-End, Not Just Units**

❌ Test individual API endpoints in isolation
✅ Test entire user flow: Input → Processing → Storage → Retrieval → Display

**6. Include Edge Cases**

Don't just test happy path:
- Error conditions
- Missing data
- Concurrent operations
- Boundary values
- Previously known bugs

### Command Structure Template

```markdown
# /validate-{module}

## Overview
[1-2 sentence description]

## Test Scenarios Covered
- ✅ Happy path: [description]
- ✅ Edge case 1: [description]
- ✅ Edge case 2: [description]
- ✅ Error handling: [description]
- ⚠️ Not covered: [what this doesn't test]

## Prerequisites

### Required Services
- Service A (must be running)
- Service B (must be accessible)

### Test Data
- [Any test data needed]
- [How to prepare test environment]

### Environment Setup
```bash
# Any setup commands needed before validation
```

## Validation Steps

### Step 1: [Category] - Foundation Checks

#### 1.1 Test Service A Status

**Purpose**: Ensure Service A is running and healthy

**Command**:
```bash
[exact command to run]
```

**Expected Output**:
```
[exact expected output or pattern]
```

**Pass Criteria**:
- [Specific condition 1]
- [Specific condition 2]

**Fail Criteria**:
- [What indicates failure]

**On Failure**:
1. [First debugging step]
2. [Second debugging step]
3. Report: "[Error message template]"

#### 1.2 Test Service B Connectivity
[Same structure as above]

### Step 2: [Category] - Integration Tests

#### 2.1 Test Full User Flow
[Same structure]

### Step 3: [Category] - Edge Cases

#### 3.1 Test Error Handling
[Same structure]

## Final Report Format

Generate report in this format:
```
✅ {MODULE} Validation Report
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

✅/❌ Category 1
   ✅ Test 1.1: [Brief result]
   ❌ Test 1.2: [Brief result + next steps]

✅/❌ Category 2
   ...

Summary: X/Y tests passed (Z%)
Duration: X minutes
Status: PASS / FAIL
Next steps: [If failed, what to do]
```

## Self-Correction Guidelines

When a test fails, the AI should:

1. **Detect**: Command exit code, output parsing
2. **Diagnose**: Read relevant logs, check configs
3. **Attempt Fix** (if safe and within scope):
   - Restart service
   - Clear cache
   - Retry with backoff
4. **Re-test**: Run test again after fix attempt
5. **Report**: Whether fix worked or manual intervention needed

**Example self-correction:**
```markdown
### On Failure: Service Inactive

**Step 1: Check if it's a Python cache issue**
```bash
ssh root@72.60.17.245 "ls -la /opt/wa-monitor/prod/modules/__pycache__/*.pyc"
```
If .pyc files exist and are newer than .py files → Python cache issue

**Step 2: Attempt safe restart**
```bash
ssh root@72.60.17.245 "/opt/wa-monitor/prod/restart-monitor.sh"
```

**Step 3: Wait for service to stabilize**
Sleep 5 seconds

**Step 4: Re-test service status**
If now active → Mark as ✅ PASS (with warning: "Service was down, auto-restarted")
If still inactive → Mark as ❌ FAIL and report manual intervention needed
```

## Known Limitations Section

Every validation command should document what it DOESN'T test:

```markdown
## Known Limitations

This validation does NOT test:
- ⚠️ SharePoint sync (requires waiting for nightly job)
- ⚠️ WhatsApp Bridge message capture (requires posting to real WhatsApp group)
- ⚠️ Mobile responsive design (requires browser automation)
- ⚠️ Performance under load (requires load testing tools)

These require manual testing or separate validation modules.
```

---

## Testing and Iteration

### Run Schedule

**First 5 Runs**: Back-to-back testing
- Identify obvious issues
- Fix false positives/negatives
- Refine pass/fail criteria

**Runs 6-10**: Spread over 2-3 days
- Test in different system states
- Verify consistency over time
- Catch intermittent issues

**Production Use**: Weekly or pre-deployment
- Run before merging to master
- Run after infrastructure changes
- Run when debugging production issues

### Tracking Results

Create a results log for each run:

```bash
docs/validation/{module}/results/
├── 2025-11-24-run-1.md   # Initial test
├── 2025-11-24-run-2.md   # After fixes
├── 2025-11-25-run-3.md   # Next day test
├── ...
└── summary.md            # Aggregated results
```

**Summary template:**
```markdown
# Validation Results Summary

## Overall Stats
- Total runs: 15
- Pass rate: 93% (14/15)
- Average duration: 4.5 minutes
- Bugs caught: 4
- False positives: 1 (fixed)
- False negatives: 0

## Bugs Caught
1. **LID Resolution Bug** (Run 3)
   - Description: Resubmissions showing LID instead of phone
   - Caught by: Edge case test for resubmissions
   - Fixed: commit abc123

2. **Python Cache Issue** (Run 7)
   - Description: Service restart didn't clear cache
   - Caught by: Service health check
   - Fixed: Updated restart script

## Improvements Made
1. Added retry logic for database connectivity (Run 4)
2. Tightened pass criteria for service status (Run 6)
3. Added log analysis for error detection (Run 9)

## Status: ✅ Production Ready
```

---

## Optimization Guidelines

### Speed Optimization

**Parallelize Independent Tests**
```markdown
❌ Sequential:
1. Test Service A (5 sec)
2. Test Service B (5 sec)
3. Test Service C (5 sec)
Total: 15 seconds

✅ Parallel:
Run all three tests concurrently
Total: 5 seconds
```

**Cache Stable Data**
```markdown
❌ Query database count on every test
✅ Query once at start, use cached value
```

**Skip Redundant Checks**
```markdown
❌ Check service status before every test
✅ Check once at start, assume stable
```

### Accuracy Optimization

**Tighten Pass Criteria**
```markdown
Before: Service running = PASS
After: Service running + No errors in last 20 log lines = PASS
```

**Add Multi-Step Verification**
```markdown
Before: API returns 200 = PASS
After: API returns 200 + Response has expected fields + Data matches database = PASS
```

**Increase Timeout for Flaky Tests**
```markdown
Before: 1 second timeout → flaky
After: 5 second timeout with retry → consistent
```

### Maintainability Optimization

**Modularize Common Checks**
```markdown
Create reusable test patterns:

```bash
# Function: check_service_status
# Args: service_name
# Returns: PASS/FAIL + details
```

Use across multiple validation commands
```

**Version Control Commands**
```markdown
Track changes to validation commands:
- Git commit validation command changes
- Document why changes were made
- Link to issues that prompted changes
```

**Keep Documentation Updated**
```markdown
When validation logic changes:
- Update README
- Update test scenarios
- Update known limitations
- Update optimization log
```

---

## Documentation Standards

### Required Documentation Per Module

**1. README.md**
- Module overview
- What it validates
- Test scenarios covered
- Status (in progress / production ready)
- Known limitations

**2. test-scenarios.md**
- Detailed description of each test case
- Input data
- Expected outputs
- Edge cases

**3. known-issues.md**
- False positives (and workarounds)
- False negatives (and workarounds)
- Flaky tests
- Dependencies on external factors

**4. optimization-log.md**
- Chronological log of improvements
- Before/after for each change
- Impact on accuracy/speed

**5. results/ directory**
- Individual run results
- Summary statistics
- Bug reports from validation

### Documentation Templates

See `docs/validation/wa-monitor/` for complete examples.

---

## Success Checklist

Before marking a validation module as "Production Ready":

- [ ] **Consistency**: 10+ runs with same results
- [ ] **Accuracy**: Caught 2+ real bugs during development
- [ ] **Reliability**: No false positives in last 5 runs
- [ ] **Speed**: Completes in acceptable timeframe
- [ ] **Coverage**: Tests all critical user flows
- [ ] **Edge Cases**: Tests known failure scenarios
- [ ] **Self-Correction**: Handles common failures automatically
- [ ] **Documentation**: All required docs complete and accurate
- [ ] **Team Review**: At least 1 other person has reviewed and approved
- [ ] **User Tested**: Developer has run it manually 3+ times

---

## Common Pitfalls

**Pitfall 1: Over-Mocking**
```
❌ Mock API responses instead of hitting real API
✅ Use curl to hit actual deployed API
```

**Pitfall 2: Brittle Tests**
```
❌ Expect exact timestamp match
✅ Expect timestamp within 60 second window
```

**Pitfall 3: Unclear Failures**
```
❌ "Test failed"
✅ "Database unreachable: connection timeout. Check VPS network and Neon status."
```

**Pitfall 4: Testing Implementation Instead of Behavior**
```
❌ Check if function X was called
✅ Check if user can see drop in dashboard
```

**Pitfall 5: Ignoring Environment Differences**
```
❌ Test only works on local machine
✅ Test works on local, dev, and prod
```

---

## Next Steps

1. ✅ Read this implementation guide
2. ✅ Review WA Monitor validation plan
3. ✅ Create `/validate-wa-monitor` command
4. ✅ Run initial test and document results
5. ✅ Iterate based on results
6. ✅ Certify as production ready after 10 successful runs
7. Move to next module

---

## Questions?

- **How long should a validation command be?** - As long as needed to test thoroughly (WA Monitor: ~300 lines)
- **Can I modify validation commands mid-testing?** - Yes! Document changes in optimization log
- **What if validation is too slow?** - Parallelize tests, cache data, or split into smaller modules
- **Should I validate on every commit?** - For critical modules like WA Monitor, yes. For stable modules, weekly or pre-deployment.

---

**Remember**: The goal is confidence, not perfection. Start simple, iterate based on real failures, and gradually build comprehensive coverage.
