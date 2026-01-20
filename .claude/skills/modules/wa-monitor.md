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
5. Check monitor logs for processing
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
- "monitor down"
- "not showing"
- "drops missing"
- "wa monitor broken"
- "service stopped"
- "not working"

**Automatic Actions**:
1. Invoke WA agent
2. Check service status (prod + dev)
3. Check WhatsApp bridge status
4. Check for recent errors in logs
5. Verify database connection
6. Report health status

**Response Template**:
```
🏥 WA Monitor Health Check:

Services:
  wa-monitor-prod: ✅ active / ❌ inactive
  wa-monitor-dev: ✅ active / ❌ inactive
  whatsapp-bridge: ✅ active / ❌ inactive

Recent Activity:
  Last drop processed: [timestamp]
  Last heartbeat: [timestamp]

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
Velo Test: [count] drops

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
3. Restart monitor (clear cache)

[Provide exact commands]

Prevention: Ensure /opt/wa-monitor/prod/restart-monitor.sh is used
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
4. Generate config YAML
5. Provide deployment steps

**Response Template**:
```
➕ Adding New WhatsApp Group (5 minutes):

Prerequisites:
- WhatsApp bridge in group (082 418 9511)
- Group JID: [check if provided]

Steps:
1. Find Group JID (if not provided)
2. Test in DEV first
3. Deploy to PROD
4. Verify monitoring

[Provide exact commands for each step]
```

### Trigger 7: Delete Sent Messages (Jan 2026)

**Keywords**:
- "delete message"
- "delete last message"
- "remove sent message"
- "undo whatsapp"
- "delete the messages"

**Automatic Actions**:
1. Invoke WA agent
2. List recent deletable messages (within 1 hour)
3. Identify message IDs from logs or user context
4. Delete via Sender API
5. Confirm deletion

**Response Template**:
```
🗑️ Message Deletion:

Recent Deletable Messages (last hour):
[List from /list-recent endpoint]

To delete:
curl -X POST http://localhost:8081/delete-message \
  -H "Content-Type: application/json" \
  -d '{"message_id":"XXX","group_jid":"YYY@g.us"}'

[Execute and confirm result]
```

**Note:** Messages can only be deleted within 1 hour of sending.

### Trigger 8: Duplicate Messages (Jan 2026)

**Keywords**:
- "duplicate messages"
- "sending multiple"
- "infinite loop"
- "ack loop"
- "same message twice"

**Automatic Actions**:
1. Invoke WA agent
2. Check bridge logs for ack-filter
3. Verify filter is in main.go
4. Check sender_proxy.go deduplication
5. Rebuild bridge if needed

**Response Template**:
```
🔄 Duplicate Message Investigation:

Ack Filter Status: ✅/❌
Deduplication Cache: ✅/❌

If missing, rebuild bridge:
cd /home/louis/whatsapp-bridge-go
go build -o whatsapp-bridge *.go
sudo systemctl restart whatsapp-bridge.service

[Check logs for confirmation]
```

### Trigger 9: WhatsApp Portal Issues (Jan 2026)

**Keywords**:
- "whatsapp portal"
- "services tab"
- "wa admin"
- "phone pairing"
- "portal not loading"
- "dark theme"

**Automatic Actions**:
1. Check if it's a frontend issue (console errors)
2. Check if API endpoints are responding
3. Verify waAdminApi service methods
4. Check for missing phones API

**Response Template**:
```
🖥️ WhatsApp Portal Investigation:

Portal URL: /communications/whatsapp
API Status: ✅/❌

Services API: /api/communications/whatsapp/services/status
Phones API: /api/communications/whatsapp/phones

Common Issues:
- Console errors: Check waAdminApiService.ts has phonesApi
- Dark theme: Check ServicesTab.tsx uses dark-compatible colors
- Service status: Bridge/Sender health endpoints

Fix: Ensure all API endpoints are deployed
```

**Key Files:**
- `src/modules/communications/whatsapp/components/ServicesTab.tsx`
- `src/modules/communications/whatsapp/services/waAdminApiService.ts`
- `pages/api/communications/whatsapp/phones/`
- `pages/api/communications/whatsapp/services/[service]/`

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
- ❌ Modify Python code
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
  wa-monitor-dev: ❌ inactive (exit code 1)
  wa-monitor-prod: ✅ active
  whatsapp-bridge: ✅ active

Last error (dev): [error message]

Fix: systemctl restart wa-monitor-dev

Would you like me to investigate the dev service error?"
```

### Example 3: Daily Stats
```
User: "How many drops today?"
  ↓
Skill: [Detects stats request, invokes WA agent]
  ↓
Claude: "📊 Today's Drops (2025-11-17):

Lawley:    3 drops
Mamelodi:  1 drop
Velo Test: 1 drop

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
