---
name: noc-tickets
description: NOC Tickets — triage, diagnose, fix, and resolve NOC tickets (DevOps, fault repair, incidents, all types)
version: 1.1.0
triggers:
  - /noc
  - /noc-tickets
  - noc tickets
  - noc devops
  - devops ticket
  - fibreflow bug
  - application error
  - debug ticket
  - troubleshoot ticket
  - noc troubleshoot
  - app crash
  - UI broken
  - page not loading
  - 500 error
  - fibreflow issue
  - open tickets
  - ticket queue
  - maintenance ticket
---

# /noc — NOC Tickets

Autonomous agent that picks up tickets from the NOC queue, triages by priority/SLA, diagnoses issues using the codebase, logs, and existing skills, implements fixes via PR workflow, deploys, verifies with screenshots, and resolves tickets with proof attached.

## Quick Reference

| Item | Value |
|------|-------|
| **Ticket table** | `maintenance_tickets` (type = `dev_ops`) |
| **Extension table** | `dev_ticket_details` (error_url, stack_trace, affected_module, etc.) |
| **Ticket UID format** | `VF-YYYYMMDD-NNN` |
| **API — list tickets** | `GET /api/noc/tickets?ticket_type=dev_ops&status=open,assigned` |
| **API — ticket detail** | `GET /api/noc/tickets/[id]` |
| **API — update ticket** | `PUT /api/noc/tickets/[id]` |
| **API — verification steps** | `GET/PUT /api/noc/tickets/[id]/verification/[step]` |
| **API — VLM screenshot** | `POST /api/noc/devops-vlm-analyse` |
| **Dev URL** | `https://dev.fibreflow.app` (port 3005) |
| **Prod URL** | `https://app.fibreflow.app` (port 3000) |
| **Local URL** | `http://localhost:3004` |

## Agent Workflow

When triggered, follow this sequence:

### Phase 1: Ticket Intake

```bash
# 1. Fetch open/assigned DevOps tickets
curl -s "http://localhost:3004/api/noc/tickets?ticket_type=dev_ops&status=open,assigned&limit=20" \
  -H "Cookie: $(cat .claude/credentials.local.md | grep SESSION | cut -d'=' -f2)" | jq '.data'
```

Or query the database directly:

```sql
-- Open DevOps tickets with details
SELECT
  t.id, t.ticket_uid, t.title, t.status, t.priority,
  t.created_at, t.assigned_to,
  d.affected_module, d.environment, d.error_url,
  d.stack_trace, d.steps_to_reproduce, d.browser_info,
  d.agent_status
FROM maintenance_tickets t
LEFT JOIN dev_ticket_details d ON d.ticket_id = t.id
WHERE t.ticket_type = 'dev_ops'
  AND t.status IN ('open', 'assigned', 'in_progress')
ORDER BY
  CASE t.priority
    WHEN 'critical' THEN 1
    WHEN 'urgent' THEN 2
    WHEN 'high' THEN 3
    WHEN 'normal' THEN 4
    WHEN 'low' THEN 5
  END,
  t.created_at ASC;
```

### Phase 2: Triage & Prioritize

For each ticket, assess:

1. **Severity** — Is production affected? How many users impacted?
2. **Module** — Which FibreFlow module? (Dashboard, NOC, Activate, Procurement, etc.)
3. **Reproducibility** — Can we reproduce from steps_to_reproduce?
4. **Quick win?** — Is it a known pattern (see Common Patterns below)?

**Priority matrix:**
| Priority | SLA | Action |
|----------|-----|--------|
| Critical | 6h | Drop everything, fix immediately |
| Urgent | 12h | Fix within session |
| High | 1d | Fix today |
| Normal | 3d | Queue for next session |
| Low | 7d | Backlog |

### Phase 3: Diagnosis

**Step 1 — Locate the affected code:**

```bash
# Find the module's source files
ls src/modules/<affected_module>/

# Find the API route if error_url points to an API
# Example: error on /api/noc/tickets → pages/api/noc/tickets.ts
find pages/api/ -name "*.ts" | grep <keyword>

# Find the page component if error_url points to a UI page
# Example: error on /projects/123 → pages/projects/[id]/index.tsx
find pages/ -name "*.tsx" | grep <keyword>
```

**Step 2 — Reproduce the error:**

Use the `steps_to_reproduce` from the ticket. If it's a UI issue, use browser automation:

```
1. mcp__claude-in-chrome__tabs_context_mcp  (get browser context)
2. mcp__claude-in-chrome__navigate          (go to error_url)
3. mcp__claude-in-chrome__read_page         (get page state)
4. mcp__claude-in-chrome__computer          (follow reproduction steps)
```

**Step 3 — Analyze the stack trace:**

If `stack_trace` is provided, trace it through the codebase:

```bash
# Search for the error message in code
rg "ErrorMessage" src/ pages/

# Check the specific file:line from stack trace
# Read the file at that location
```

**Step 4 — Check logs:**

```bash
# Dev server logs
sudo journalctl -u fibreflow-dev.service --since "1 hour ago" | grep -i error

# Production logs
sudo journalctl -u fibreflow-production.service --since "1 hour ago" | grep -i error

# Check for specific error patterns
sudo journalctl -u fibreflow-dev.service --since "1 hour ago" | grep "<ticket_keyword>"
```

**Step 5 — Database investigation:**

```sql
-- Check for data issues related to the ticket
-- Example: missing records, null values, constraint violations
SELECT * FROM <related_table> WHERE <condition> LIMIT 10;
```

### Phase 4: Fix Implementation

**Follow the PR workflow (MANDATORY):**

1. Create a feature branch: `fix/noc-<ticket_uid>-<short-description>`
2. Implement the fix
3. Run quality checks: `npm run lint && npm run type-check`
4. Run tests: `npm test`
5. Create PR via `/pr` skill
6. Update the ticket with PR link

**Update ticket status as you work:**

```sql
-- Mark ticket as in_progress when starting work
UPDATE maintenance_tickets SET status = 'in_progress' WHERE id = '<ticket_id>';

-- Update dev_ticket_details with branch/PR
UPDATE dev_ticket_details
SET github_branch = 'fix/noc-VF-XXXXXXXX-XXX-description',
    github_pr_url = 'https://github.com/VelocityFibre/FF_Next.js/pull/XXX',
    agent_status = 'running'
WHERE ticket_id = '<ticket_id>';
```

### Phase 5: Verification

DevOps tickets have 5 verification steps:

| Step | Name | Photo Required | Description |
|------|------|----------------|-------------|
| 1 | Issue Reproduction | Yes | Screenshot of the reproduced error |
| 2 | Root Cause Analysis | No | Document the root cause in notes |
| 3 | Fix Implementation | No | Link the PR, describe the fix |
| 4 | Testing & Verification | Yes | Screenshot of fix working in dev |
| 5 | Deployment | Yes | Screenshot of fix working in prod |

```bash
# Update verification step (example: step 2 - root cause)
curl -X PUT "http://localhost:3004/api/noc/tickets/<id>/verification/2" \
  -H "Content-Type: application/json" \
  -d '{
    "completed": true,
    "notes": "Root cause: missing null check in X component causing crash when Y is undefined"
  }'
```

---

## Common Patterns (Known Issues)

### Pattern: API returns `data.data` (double-wrapped response)
**Symptom:** UI shows blank/undefined values
**Cause:** `apiResponse.success(res, { success: true, data: {...} })` double-wraps
**Fix:** Remove inner wrapper — just pass the raw data to `apiResponse.success(res, data)`
**Ref:** Memory `MEMORY.md` — "apiResponse.success() Double-Wrapping Anti-Pattern"

### Pattern: Conditional SQL fragment breaks Neon
**Symptom:** SQL syntax error, query returns unexpected results
**Cause:** `${cond ? sql\`AND x\` : sql\`\`}` — template literal fragments don't compose in Neon
**Fix:** Use explicit query branches (if/else with full queries)
**Ref:** CLAUDE.md — "NO Conditional SQL Fragments"

### Pattern: Dynamic route params `undefined`
**Symptom:** API returns 404 or "invalid UUID"
**Cause:** Nested dynamic routes fail on Vercel, or inconsistent param names
**Fix:** Flatten routes (`contractors-stages.ts` not `[id]/stages.ts`), use consistent `[projectId]`

### Pattern: Numeric values are strings from Neon
**Symptom:** Math operations return NaN or concatenate instead of add
**Cause:** Neon returns numeric columns as strings
**Fix:** Always `Number()` before arithmetic

### Pattern: Missing `credentials: 'include'` in fetch
**Symptom:** 401 Unauthorized on API calls
**Cause:** Auth cookie not sent with request
**Fix:** Add `credentials: 'include'` to all fetch calls

### Pattern: `console.log` in production code
**Symptom:** Lint error or log noise
**Fix:** Replace with `import { log } from '@/lib/logger'` — use `log.info()`, `log.error()`, etc.

### Pattern: File > 300 lines
**Symptom:** Quality violation
**Fix:** Extract components/utilities into separate files

---

## Module-Specific Diagnostics

When the `affected_module` field points to a specific module, use these targeted approaches:

### Activate Module
- **Skill:** `.claude/skills/modules/activate.md`
- **Key services:** VLM (:8100), WhatsApp Bridge (:8083), 1Map API
- **Common issues:** VLM timeout, photo categorization wrong, DR acknowledgment not sent
- **Health check:** `curl http://100.96.203.105:8100/health`

### NOC Module (self-referential)
- **Module doc:** `.claude/modules/noc.md`
- **Common issues:** Ticket filters broken, QContact sync lag, SLA calculation wrong
- **Key files:** `src/modules/noc/services/ticketService.ts`, `src/modules/noc/constants/`

### Procurement Module
- **Skill:** `.claude/skills/modules/procurement.md`
- **Common issues:** BOQ import fails, PO total calculation wrong, stock mismatch
- **Key files:** `src/modules/procurement/`, `pages/api/procurement/`

### Dashboard
- **Common issues:** Stats don't match, widgets crash, date filtering broken
- **Key files:** `src/modules/dashboard/`, `pages/api/dashboard/`

### Data Sync / QField
- **Skill:** `.claude/skills/qfield-qa-sync/skill.md` or `/Qfield`
- **Common issues:** Sync stale, GPKG import fails, MinIO connection errors
- **Health check:** `curl http://100.96.203.105:8095/health`

### Accounting
- **Common issues:** Sage API auth expired, invoice sync fails, exchange rate stale
- **Key files:** `src/modules/accounting/`, `pages/api/accounting/`

### Fleet
- **Common issues:** VLM plate reading fails, check-in form errors
- **Key files:** `src/modules/fleet/`, `pages/api/fleet/`

---

## Escalation Rules

Escalate (don't attempt to fix) when:

1. **Database schema change required** — Needs migration review + Hein approval
2. **Production data corruption** — Flag immediately, don't modify data
3. **Auth/security issue** — Credential leak, permission bypass → escalate to Hein
4. **Third-party API down** — Neon, QContact, 1Map, Sage → wait/retry, notify Hein
5. **Infrastructure issue** — Server/service down → use `/infra` skill or notify Hein
6. **Unclear reproduction** — Can't reproduce after 3 attempts → ask reporter for more detail

**Escalation template:**
```
ESCALATION: [Ticket UID]
REASON: [Why agent can't resolve]
FINDINGS: [What was discovered]
RECOMMENDATION: [Suggested next step]
BLOCKED_ON: [What's needed to proceed]
```

---

## Interplay with Other Skills

| Situation | Invoke Skill |
|-----------|-------------|
| Need to check/fix database | `/db` |
| VLM service issue | `/vlm` (`.claude/skills/vlm-ops.md`) |
| WhatsApp integration broken | `.claude/skills/infrastructure/whatsapp.md` |
| TypeScript errors after fix | `/typescript-fixer` |
| Need to deploy fix | `/deploy` |
| Need to create PR | `/pr` |
| Infrastructure down | `/infra` |
| QField sync issue | `/Qfield` |
| Need to run tests | `/tdd` |
| OpenClaw/bot issue | `.claude/skills/infrastructure/openclaw.md` |

---

## Reporting

After working a ticket, update the ticket notes with a structured report:

```
## Agent Diagnosis Report — [Ticket UID]

**Module:** [affected_module]
**Environment:** [production/dev/local]
**Root Cause:** [1-2 sentence explanation]

**Fix:**
- Branch: `fix/noc-[ticket_uid]-[description]`
- PR: #[number]
- Files changed: [list]

**Verification:**
- [ ] Reproduced in dev
- [ ] Fix tested in dev
- [ ] Deployed to dev
- [ ] Verified in dev
- [ ] Deployed to production (if approved)

**Time spent:** [duration]
```

---

## Lessons Learned (Updated per ticket)

### 2026-03-13: VF-20260313-133 + VF-20260313-134
- **Schema column names differ from TypeScript types**: DB uses `type` not `ticket_type`, `status` not `ticket_status`. Always check actual schema with `\d maintenance_tickets` before querying.
- **psql connection**: Local psql defaults to port 5434 via socket. Use explicit: `PGPASSWORD=<pw> psql -h <host> -p 5432 -U neondb_owner -d neondb --set=sslmode=require`
- **z-index patterns**: ALL modals in codebase use `z-50` (not design tokens). Design system defines `--ff-z-modal-backdrop: 1040` and `--ff-z-modal: 1050` but they were never adopted. When fixing z-index, note this is a codebase-wide pattern, not a single-modal bug.
- **maintenance_notes schema**: Uses `created_by` (not `author_id`), has `is_resolution` boolean flag, `note_type` must be one of: internal, external, system.
- **Chrome DevTools scrolling**: Page content is in a `<main>` element that scrolls independently. Use `document.querySelector('main').scrollTop += N` via `evaluate_script`.
- **PR merge**: Branch protection requires `--admin` flag for gh merge. Auto-merge not enabled on repo.
- **Deploy workflow**: `sudo -u velo bash -c 'cd /home/velo/fibreflow-dev && git pull origin master && npm run build'` then `sudo systemctl restart fibreflow-dev.service`.

---

## Related

- `.claude/modules/noc.md` — Full NOC module documentation
- `src/modules/noc/` — NOC source code
- `src/modules/noc/constants/verificationSteps.ts` — DevOps 5-step checklist
- `src/modules/noc/services/ticketService.ts` — Ticket CRUD
- `scripts/migrations/196_dev_ticket_details.sql` — DevOps extension schema
- `.claude/skills/db.md` — Database troubleshooting
- `.claude/skills/vlm-ops.md` — VLM diagnostics
- `.claude/skills/infrastructure/whatsapp.md` — WhatsApp troubleshooting
- `CLAUDE.md` — Project conventions and anti-patterns
