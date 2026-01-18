# Auto-Tracker Skill

Automatically maintain the tracking system throughout the development session.

## When to Activate

This skill should be PROACTIVE and activate automatically when:

1. **After fixing a bug** → Update page log
2. **After deploying** → Add CHANGELOG entry
3. **After user verification** → Mark as "VERIFIED WORKING"
4. **End of work session** → Summarize in CHANGELOG
5. **User reports issue** → Create page log entry

## How It Works

### 1. Bug Fix Detected

**Trigger**: User reports issue or you fix a bug

**Actions**:
1. Check if page log exists for the affected page
2. If not, create `docs/page-logs/[page].md`
3. Add timestamped entry with:
   - Problem description
   - Root cause
   - Changes made (file:line references)
   - Testing notes
4. Leave status as "In Progress" until user verifies

**Template**:
```markdown
## Month DD, YYYY - HH:MM AM/PM
**Developer**: Claude Assistant
**Issue**: [description]

### Problem Identified:
- [root cause]

### Changes Made:
**File**: path/to/file.ts:line
- [specific changes]

### Result:
🔍 Fix implemented, awaiting user verification

### Testing Notes:
- [how to test]
```

### 2. User Verification

**Trigger**: User says "yes it works", "works now", "verified", etc.

**Actions**:
1. Find the latest entry in relevant page log
2. Update status to:
   ```markdown
   ### Result:
   ✅ **Issue Fixed**
   ✅ **User Verified**: [timestamp]
   ```
3. Remind user to deploy if not yet deployed

### 3. Deployment Completed

**Trigger**: After `git push` or deploy hook trigger

**Actions**:
1. Get current date (YYYY-MM-DD)
2. Collect git commit hash: `git rev-parse HEAD`
3. Summarize what was done (from recent work)
4. Add entry to `docs/CHANGELOG.md`:
   ```markdown
   ## YYYY-MM-DD - [Type]: Title

   ### What Was Done
   - [summary of work]

   ### Files Changed
   - [key files]

   ### Deployed
   - [x] Deployed to Vercel (commit: [hash])

   ### Related
   - Page logs: [links]
   ```

### 4. End of Session

**Trigger**: User says "done for today", "wrap up", "end session"

**Actions**:
1. Review work done in this session
2. Check if CHANGELOG has today's entry
3. If not, ask user:
   ```
   Would you like me to add a CHANGELOG entry for today's work?
   Summary:
   - [what was done]
   - [files changed]
   - [deployed: y/n]
   ```
4. Add entry if user confirms

### 5. Create New Page Log

**Trigger**: Issue reported for page without existing log

**Actions**:
1. Extract page name from URL or user description
2. Create `docs/page-logs/[page-name].md`:
   ```markdown
   # [Page Name] Page Development Log

   **Page Path**: `/path`
   **Component**: `path/to/component.tsx`

   ---

   [First entry]
   ```
3. Update `docs/page-logs/README.md` index
4. Add first issue entry

## Automation Rules

### DO Automatically:
- ✅ Create page log entries when bugs are fixed
- ✅ Update entries when user verifies
- ✅ Add CHANGELOG entries after deployments
- ✅ Update page log README index

### ASK First:
- ❓ Creating new page log file
- ❓ Adding CHANGELOG entry (unless deploying)
- ❓ Major changes to existing entries

### DON'T:
- ❌ Update PROGRESS.md (reserved for major phases)
- ❌ Modify git commits
- ❌ Delete tracking entries

## Integration with Workflow

```
User: "The dashboard page has a bug"
  ↓
Auto-Tracker: Creates page-logs/dashboard.md entry
  ↓
Claude: Fixes the bug
  ↓
Auto-Tracker: Updates entry with fix details
  ↓
User: "yes it works"
  ↓
Auto-Tracker: Marks "VERIFIED WORKING"
  ↓
Claude: git push origin master
  ↓
Auto-Tracker: Adds CHANGELOG entry automatically
  ↓
Auto-Tracker: "✅ Tracking updated in CHANGELOG and page-logs/dashboard.md"
```

## Example Usage

### Scenario 1: Bug Fix + Deploy
```
User: "Contractor approval broken"
Auto-Tracker: [Creates contractors.md entry]
Claude: [Fixes bug]
Claude: "Fixed. Testing at localhost:3005"
User: "works!"
Auto-Tracker: [Updates entry: ✅ VERIFIED WORKING]
Claude: [Deploys]
Auto-Tracker: [Adds CHANGELOG entry]
Auto-Tracker: "✅ Tracked in CHANGELOG.md and page-logs/contractors.md"
```

### Scenario 2: End of Session
```
User: "Done for today"
Auto-Tracker: "Would you like me to add today's work to CHANGELOG?
             Summary:
             - Fixed 3 bugs in contractors module
             - Set up Vercel infrastructure
             - Deployed to production
             Deployed: Yes (commit: 2f70370)"
User: "yes"
Auto-Tracker: [Adds CHANGELOG entry]
Auto-Tracker: "✅ Added to CHANGELOG.md. Great work today!"
```

## Monitoring Triggers

Watch for these phrases to activate:

**Bug Reports**:
- "X is broken"
- "X doesn't work"
- "Error on X page"
- "Bug in X"

**Verification**:
- "works now"
- "yes it works"
- "verified"
- "looks good"
- "fixed"

**Deployment**:
- After successful `git push`
- After deploy hook trigger
- "deploy this"
- "push to production"

**Session End**:
- "done for today"
- "wrap up"
- "end session"
- "that's all"

## Configuration

Enable this skill by default for all sessions. User can disable by saying:
- "Disable auto-tracking"
- "Don't auto-update logs"

Re-enable with:
- "Enable auto-tracking"
- "Resume auto-tracking"

## Status Messages

When auto-tracking activates, show brief confirmation:
```
✅ Auto-tracked in page-logs/[page].md
✅ CHANGELOG updated
🔍 Awaiting user verification
```

Keep messages concise and non-intrusive.
