---
name: knowledge-base
description: Knowledge base update skill for FibreFlow. Scan codebase, refresh module profiles, update learnings and session state. USE WHEN user says '/kb', 'update knowledge base', 'refresh knowledge', 'scan modules', 'sync knowledge'.
---

# Knowledge Base Update Skill

Update the FibreFlow knowledge base by scanning the codebase and refreshing module profiles, learnings, and session state.

## What This Skill Does

### 1. Scan Source Modules (`src/modules/*/`)

```bash
# List all modules
ls -d src/modules/*/

# Check for missing .claude.md files
for module in src/modules/*/; do
  name=$(basename "$module")
  if [ ! -f "$module/.claude.md" ]; then
    echo "Missing: $name"
  fi
done
```

**For each module:**
- If `.claude.md` missing → Generate from template
- If `.claude.md` exists → Update stats (file count, last modified)
- Check for README.md to extract purpose

### 2. Consolidate Learnings

**Move old learnings to permanent KB:**
```
src/modules/{module}/.claude-learnings.md  →  src/modules/{module}/.claude.md
```

**Archive criteria:**
- Learnings older than 7 days
- Learnings with HIGH confidence
- Learnings confirmed by user

**Archive location:** `.claude/learnings/archive/`

### 3. Update Module Index

Update `.claude/modules/_index.yaml`:
- Add newly discovered modules
- Update `total_modules` count
- Update `last_updated` timestamp
- Verify all modules have profiles

### 4. Update Skills Index

Update `.claude/skills/_index.md`:
- Add new skills discovered
- Update trigger keywords
- Sync with actual skill files

### 5. Update Session State

Update `.claude/session/current.json`:
- Record KB update action
- Clear completed tasks
- Update `last_updated` timestamp

### 6. Generate Report

```
╔══════════════════════════════════════════════════════════════╗
║                    KB UPDATE COMPLETE                        ║
╠══════════════════════════════════════════════════════════════╣
║ Modules scanned:        40                                   ║
║ New modules found:      2 (fleet, dev-queue)                  ║
║ Missing .claude.md:     5                                    ║
║ Learnings consolidated: 12                                   ║
║ Session state:          Updated                              ║
╠══════════════════════════════════════════════════════════════╣
║ NEW .claude.md FILES CREATED:                                ║
║   - src/modules/fleet/.claude.md                             ║
║   - src/modules/dev-queue/.claude.md                          ║
╠══════════════════════════════════════════════════════════════╣
║ MODULES STILL MISSING .claude.md:                            ║
║   - src/modules/field-stock/                                 ║
║   - src/modules/stock-items/                                 ║
║   - src/modules/nokia-equipment/                             ║
╚══════════════════════════════════════════════════════════════╝
```

---

## Module .claude.md Template

When generating new `.claude.md` files, use this template (max 50 lines):

```markdown
# Module: {name}
<!-- 50 lines max - reference .claude/skills/modules/{name}.md for details -->

## Purpose
{Extract from README.md or infer from code}

## Critical Rules
- NEVER {infer from code patterns}
- ALWAYS {infer from code patterns}

## Key Files
| File | Purpose |
|------|---------|
| {main service file} | {purpose} |
| {main component file} | {purpose} |

## API Endpoints
| Method | Endpoint | Purpose |
|--------|----------|---------|
| {from pages/api/} | {endpoint} | {purpose} |

## Database
- {from SQL files or service imports}

## Common Issues
| Issue | Fix |
|-------|-----|
| {from .claude-learnings.md if exists} | {fix} |

---
<!-- Auto-updated by /kb. Last: {timestamp} -->
```

---

## Execution Steps

1. **Read current state:**
   ```
   cat .claude/session/current.json
   cat .claude/modules/_index.yaml
   ```

2. **Scan modules:**
   ```bash
   ls -d src/modules/*/
   ```

3. **For each module without .claude.md:**
   - Check for README.md
   - Analyze key files (services/, components/, types/)
   - Generate .claude.md from template

4. **Consolidate learnings:**
   - Read all `.claude-learnings.md` files
   - Move entries >7 days old to `.claude.md`
   - Archive to `.claude/learnings/archive/`

5. **Update indexes:**
   - `.claude/modules/_index.yaml`
   - `.claude/skills/_index.md`

6. **Update session:**
   - `.claude/session/current.json`

7. **Update user stories (Browser QA):**
   ```bash
   # Auto-generate smoke stories for new/uncovered page routes
   node scripts/playwright-qa/generate-stories.mjs
   ```

   This step:
   - Scans `pages/**/*.tsx` for all UI routes
   - Compares against existing stories in `.claude/user-stories/`
   - Auto-generates smoke stories for uncovered routes
   - Detects **stale stories** (module pages changed since story last updated)
   - Updates `_manifest.json` with metadata and timestamps
   - Reports coverage stats by priority

   **Staleness detection:** If a page file (`pages/{module}/*.tsx`) has been
   modified more recently than its corresponding story, the story is flagged
   as stale and reported in the KB update output.

   **Story types:**
   - `*-smoke.md` — Auto-generated, basic page-loads check (4 steps)
   - Other `.md` — Manually authored workflow stories (kept as-is)

8. **RBAC sync (access_permissions):**
   ```bash
   # Dry-run first to see what's missing
   node scripts/rbac-sync.mjs

   # If missing permissions found, apply them
   node scripts/rbac-sync.mjs --apply
   ```

   This step:
   - Scans `src/modules/navigation/config/modules/*.config.ts` for `rbacKey` values
   - Scans `app/(main)/**/page.tsx` for page routes
   - Compares against `access_permissions` table in the database
   - Seeds missing permissions with `ON CONFLICT` upsert
   - Grants default role permissions (super_admin/admin=full, manager=no delete,
     viewer=view-only, technician/storeman/contractor=no access by default)
   - Reports what was added

   **Always dry-run first** — review the list before applying. New permissions
   default to restrictive (technician/storeman/contractor get no access).
   Adjust role grants manually in Access Control if needed.

9. **Report results**

---

## Related Files

| File | Purpose |
|------|---------|
| `.claude/modules/_index.yaml` | Module registry |
| `.claude/skills/_index.md` | Skills registry |
| `.claude/session/current.json` | Session state |
| `.claude/config/automation.yaml` | HITL rules |
| `.claude/templates/module-claude-md.template` | Template for new modules |
| `src/modules/*/.claude.md` | Module context files |
| `src/modules/*/.claude-learnings.md` | Module learnings |
| `.claude/user-stories/*.md` | Browser QA user stories |
| `.claude/user-stories/_manifest.json` | Story metadata & staleness tracking |
| `scripts/playwright-qa/generate-stories.mjs` | Auto-generates smoke stories |
| `scripts/playwright-qa/setup-auth.mjs` | Playwright auth state setup |
| `scripts/playwright-qa/qa-screenshot.mjs` | Quick authenticated screenshots |
| `scripts/rbac-sync.mjs` | RBAC permission sync (nav configs → DB) |
