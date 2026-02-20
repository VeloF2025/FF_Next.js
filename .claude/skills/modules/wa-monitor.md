# WA Monitor Auto-Responder Skill

Automatically detect WhatsApp Monitor issues and proactively invoke the WA agent for investigation.

## Purpose

This skill makes Claude Code proactive about WA Monitor issues by:
1. Detecting drop numbers, service issues, and validation problems
2. Automatically invoking the WA agent (without user having to ask)
3. Running diagnostics and reporting findings
4. Providing actionable next steps

## When to Activate

### Trigger 1: Drop Number Mentioned

**Pattern**: `DR[0-9]{6,7}` (e.g., DR1734306, DR470165)

**User says**:
- "Check DR1734306"
- "Why isn't DR470165 showing?"
- "DR1857337 is missing"

**Automatic Actions**:
1. Extract drop number from user message
2. Silently invoke WA agent
3. Check if drop exists in database
4. Check if drop was rejected (validation)
5. Check bridge logs for processing
6. Report findings with context

**Response Template**:
```
🔍 Investigating DR[NUMBER]...

Database Check: ✅ Found / ❌ Not found
Validation: ✅ Valid / ❌ Rejected / ⏭️ No validation
Last Processed: [timestamp]
Submitted By: [phone/name]
Project: [project name]

[Additional context if issues found]
```

### Trigger 2: Service Health Issues

**Keywords**:
- "bridge down"
- "not showing"
- "drops missing"
- "wa bridge broken"
- "service stopped"
- "not working"

**Automatic Actions**:
1. Invoke WA agent
2. Check bridge service status (VPS)
3. Check for recent errors in logs
4. Verify database connection
5. Report health status

**Response Template**:
```
🏥 WA Monitor Health Check:

Services (VPS 72.61.197.178):
  whatsapp-bridge: ✅ active / ❌ inactive
  wa-command-bot: ✅ active / ❌ inactive

Recent Activity:
  Last drop processed: [timestamp]
  Last message: [timestamp]

Errors (last hour): [count] errors found
[Show last 3 errors if any]

Database: ✅ connected / ❌ connection failed

[Suggested actions if issues detected]
```

### Trigger 3: Validation Problems

**Keywords**:
- "rejected drop"
- "invalid drop"
- "validation error"
- "why was it rejected"
- "drop not accepted"

**Automatic Actions**:
1. Invoke WA agent
2. Check invalid_drop_submissions table
3. Check validation configuration
4. Verify valid_drop_numbers sync status
5. Explain rejection reason
6. Suggest resolution

**Response Template**:
```
🚫 Validation Investigation:

Drop: [DR number]
Project: [project]
Rejection Reason: [reason from database]

Validation Status:
  - Mohadin: ✅ Active ([count] valid drops loaded)
  - Other projects: ⏭️ Disabled (accept all)

Last Sync: [timestamp]

Resolution:
[Specific steps to resolve]
```

### Trigger 4: Daily Stats Request

**Keywords**:
- "today's drops"
- "drop count"
- "daily stats"
- "how many drops"
- "wa monitor stats"

**Automatic Actions**:
1. Invoke WA agent
2. Query database for today's counts
3. Break down by project
4. Compare to yesterday (if requested)
5. Show formatted summary

**Response Template**:
```
📊 Today's Drop Counts (YYYY-MM-DD):

Lawley:    [count] drops
Mohadin:   [count] drops
Mamelodi:  [count] drops
Marketing: [count] drops
Mamelodi Internal: [count] drops

Total: [count] drops

[Yesterday comparison if available]
```

### Trigger 5: LID Issues

**Keywords**:
- "LID showing"
- "phone number wrong"
- "submitted_by broken"
- "contact name missing"

**Automatic Actions**:
1. Invoke WA agent
2. Check for LIDs in database (length > 11)
3. Look up LIDs in WhatsApp database
4. Provide fix commands
5. Explain how to prevent

**Response Template**:
```
🔗 LID Issue Detected:

Drops with LIDs: [count] found

[List drops with LIDs]

Resolution Steps:
1. Look up LID → phone number
2. Update database

[Provide exact commands]
```

### Trigger 6: Adding New Project

**Keywords**:
- "add new group"
- "monitor new project"
- "add whatsapp group"
- "new activation group"

**Automatic Actions**:
1. Invoke WA agent
2. Provide 5-minute guide
3. Check if Group JID provided
4. Generate database insert
5. Provide reload command

**Response Template**:
```
➕ Adding New WhatsApp Group (5 minutes):

Prerequisites:
- WhatsApp bridge in group (+27 63 841 2276)
- Group JID: [check if provided]

Steps:
1. Add phone to group
2. Find Group JID from logs
3. Add to database
4. Reload bridge

[Provide exact commands for each step]
```

### Trigger 7: Maintenance Group Routing Issues (Updated Feb 2026)

**Keywords**:
- "maintenance group"
- "non-invoicable"
- "ack in maintenance"
- "wrong group message"
- "maintenance photos"

**Automatic Actions**:
1. Check if `processDropNumbers` is skipping maintenance groups in bridge logs
2. Check `/api/maintenance/wa-message` endpoint health
3. Verify bridge secret authentication
4. Check maintenance group JIDs match DB

**Response Template**:
```
🔧 Maintenance Group Routing Check:

Bridge routing:
  dr_submission → processDropNumbers + ack + sync ✅/❌
  maintenance → forwardToMaintenanceAPI only ✅/❌
  pre_provision → TBD workflow ✅/❌

Maintenance API: /api/maintenance/wa-message
  Auth: Bridge secret ✅/❌
  Known groups: Mohadin (120363424360693693), Lawley (120363423947610853)

Bridge logs (maintenance skip):
[Check for "Skipping DR processing in maintenance group" in logs]

If acks appearing in maintenance groups:
  1. Check bridge binary has groupType parameter in processDropNumbers
  2. Recompile and redeploy bridge (see KB: bridge-configuration.md)
```

**KB Reference:** `.claude/knowledge-base/wa-monitor/bridge-configuration.md`

### Trigger 8: Pre-Provision Workflow

**Keywords**:
- "pre-provision"
- "pre provision"
- "Mohadin pre-provision"

**Automatic Actions**:
1. Check pre_provision group configuration
2. Verify group is being monitored
3. Check workflow implementation status

**Response Template**:
```
📋 Pre-Provision Group Check:

Group: Mohadin Pre-Provision
JID: 120363423163566226@g.us
Type: pre_provision
Status: [active/inactive]

Workflow: [implemented/pending]

[Provide current workflow details or implementation status]
```

## Auto-Activation Rules

### DO Automatically (No User Confirmation Needed):
- ✅ Investigate drop numbers mentioned
- ✅ Check service status when issues reported
- ✅ Query daily stats when requested
- ✅ Diagnose validation problems

### ASK First:
- ❓ Restarting services
- ❓ Modifying configuration files
- ❓ Updating database records
- ❓ Adding new projects

### DON'T (Never Do Without Explicit Request):
- ❌ Restart production services
- ❌ Modify source code
- ❌ Change database data
- ❌ Edit config files

## Session Start Health Check

**Automatically run at session start**:
1. Silent health check of WA Monitor
2. Only alert if issues detected
3. Keep quiet if all healthy

**Implementation**:
```
[Session starts]
  ↓
WA Skill: *Silently checks services*
  ↓
IF issues detected:
  "⚠️ WA Monitor Health Alert: [issue]. Investigate?"
ELSE:
  [Stay quiet, all good]
```

## Integration with WA Agent

This skill acts as a **dispatcher** for the WA agent:

```
User mentions WA Monitor issue
  ↓
WA Monitor Skill (this file) detects trigger
  ↓
Skill automatically invokes WA Agent
  ↓
WA Agent runs diagnostics (uses .claude/agents/wa-agent.md)
  ↓
WA Agent reports findings
  ↓
Skill formats response for user
  ↓
Claude presents results
```

## Response Tone

- 🎯 **Concise**: Get to the point quickly
- 📊 **Data-first**: Show the numbers/status
- 🔧 **Actionable**: Provide next steps
- ⚡ **Fast**: Don't make user wait
- 🤐 **Quiet when healthy**: Only speak up if there's an issue

## Example Workflows

### Example 1: Drop Investigation
```
User: "Check DR1734306"
  ↓
Skill: [Detects DR pattern, invokes WA agent]
  ↓
Claude: "🔍 Investigating DR1734306...

Database: ✅ Found
Project: Lawley
Submitted: 13:26 by 27711558396
Status: Resubmission (original: 2025-11-15)
All QA steps: Complete

✅ Drop is in system and processed correctly."
```

### Example 2: Service Down
```
User: "Why aren't drops showing?"
  ↓
Skill: [Detects service issue keywords, invokes WA agent]
  ↓
Claude: "🏥 Running health check...

⚠️ Issue Found:
  whatsapp-bridge: ❌ inactive (exit code 1)

Last error: [error message from logs]

Fix: systemctl restart whatsapp-bridge

Would you like me to investigate the error further?"
```

### Example 3: Daily Stats
```
User: "How many drops today?"
  ↓
Skill: [Detects stats request, invokes WA agent]
  ↓
Claude: "📊 Today's Drops (2026-02-20):

Lawley:    3 drops
Mamelodi:  1 drop
Marketing: 1 drop

Total: 5 drops"
```

## Configuration

**Enable by default**: Yes (always active)

**Disable** with:
- "Disable WA auto-respond"
- "Stop auto WA checks"

**Re-enable** with:
- "Enable WA auto-respond"
- "Resume WA auto-checks"

## Status Indicators

Use emoji indicators for quick scanning:

- 🔍 Investigating
- ✅ Healthy/Found/Success
- ❌ Error/Not found/Failed
- ⚠️ Warning/Issue detected
- 📊 Statistics
- 🔗 LID resolution
- 🚫 Validation rejection
- ➕ Adding new item
- 🏥 Health check
- 🔧 Fix available
- ⏭️ Skipped/Disabled
- 📋 Pre-provision workflow

## Success Criteria

Skill is successful when:
- ✅ User doesn't need to say "use WA agent"
- ✅ Issues are diagnosed within 5 seconds
- ✅ Response is clear and actionable
- ✅ Next steps are obvious
- ✅ No false positives (triggering when shouldn't)
- ✅ Quiet when everything is healthy

## Monitoring Own Performance

Track these metrics mentally:
1. How often triggered correctly vs incorrectly
2. User satisfaction with auto-responses
3. Time saved (user didn't have to ask explicitly)
4. False positive rate

Adjust sensitivity if:
- Too many false triggers → Tighten keyword matching
- Missing obvious issues → Expand trigger phrases
- User frequently overrides → Make less aggressive

## Important Reminders (Updated Feb 2026)

1. **Architecture**: Unified VPS bridge at 72.61.197.178:8083
2. **Phone**: +27 63 841 2276 (unified for ALL messages)
3. **No separate sender service** on VPS
4. **Groups**: 9 monitored groups (including pre_provision type)
5. **Version**: Bridge 2.0.0
6. **Services**: whatsapp-bridge + wa-command-bot (VPS only)
