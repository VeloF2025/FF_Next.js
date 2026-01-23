# Knowledge Base Update Skill

Update the FibreFlow knowledge base by scanning the codebase and refreshing module profiles, learnings, and session state.

## Triggers

USE WHEN user says:
- "kb", "KB", "/kb"
- "update knowledge base", "update kb"
- "refresh knowledge", "refresh kb"
- "scan modules", "update modules"
- "sync knowledge"

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

7. **Report results**

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
