---
name: memory
description: Memory and knowledge system management for FibreFlow. Route knowledge to correct location, audit hierarchy, slim CLAUDE.md. USE WHEN user says '/memory', 'memory check', 'memory audit', 'where should this go', 'knowledge audit', 'CLAUDE.md is too big', 'persist this', 'save this knowledge'.
---

# Memory Management Skill

Manage the progressive knowledge system - ensure CLAUDE.md stays slim, route knowledge to the right location, and maintain the knowledge hierarchy.

## Knowledge Hierarchy

```
┌─────────────────────────────────────────────────────────────────┐
│ CLAUDE.md (~5-10KB max)                                         │
│ Essential quick reference only - connection strings, commands,  │
│ critical gotchas, cross-references to detailed docs             │
├─────────────────────────────────────────────────────────────────┤
│ .claude/modules/*.md (40+ files)                                │
│ Module-specific documentation - APIs, tables, troubleshooting,  │
│ component structure, patterns, gotchas                          │
├─────────────────────────────────────────────────────────────────┤
│ .claude/skills/**/SKILL.md                                      │
│ Workflow procedures - step-by-step guides for specific tasks    │
│ Examples: /deploy, /pr, /Qfield, /audit                         │
├─────────────────────────────────────────────────────────────────┤
│ .claude/knowledge-base/                                         │
│ Deep reference material - historical decisions, architecture    │
│ rationale, troubleshooting guides, integration details          │
├─────────────────────────────────────────────────────────────────┤
│ docs/                                                           │
│ User-facing documentation - README, INFRASTRUCTURE, PRDs        │
└─────────────────────────────────────────────────────────────────┘
```

## Health Check

Run when session starts or when knowledge seems stale:

```bash
# 1. Check CLAUDE.md size (should be <15KB, ideal <10KB)
SIZE=$(wc -c < CLAUDE.md)
if [ $SIZE -gt 15000 ]; then
  echo "WARNING: CLAUDE.md is ${SIZE} bytes - needs slimming"
fi

# 2. Check module doc coverage
for module in src/modules/*/; do
  name=$(basename "$module")
  if [ ! -f ".claude/modules/${name}.md" ]; then
    echo "Missing module doc: $name"
  fi
done

# 3. Check for stale session state
if [ -f ".claude/session/current.json" ]; then
  echo "Session state exists - check if current"
fi
```

## Routing Decision Tree

When new knowledge needs to be persisted, use this decision tree:

### Is it a CONNECTION STRING, CRITICAL GOTCHA, or ESSENTIAL COMMAND?
→ **CLAUDE.md** (but keep it brief - 1-2 lines max)

### Is it MODULE-SPECIFIC (API, tables, components, patterns)?
→ **`.claude/modules/{module}.md`**

### Is it a WORKFLOW or PROCEDURE (step-by-step)?
→ **`.claude/skills/{category}/SKILL.md`** or create new skill

### Is it HISTORICAL CONTEXT or ARCHITECTURE RATIONALE?
→ **`.claude/knowledge-base/`**

### Is it USER-FACING DOCUMENTATION?
→ **`docs/`**

### Is it TEMPORARY or SESSION-SPECIFIC?
→ **`.claude/session/current.json`** (auto-managed)

## Slimming CLAUDE.md

When CLAUDE.md exceeds 15KB:

### Step 1: Identify bloat
```bash
# Count lines per section
grep -n "^## " CLAUDE.md | while read line; do
  echo "$line"
done
```

### Step 2: Move detailed content
For each section >50 lines:
1. Identify the appropriate module doc
2. Move detailed content there
3. Replace with cross-reference: `See: .claude/modules/X.md`

### Step 3: Verify cross-references work
```bash
# Check all referenced module docs exist
grep -oP '\.claude/modules/\S+\.md' CLAUDE.md | while read doc; do
  [ -f "$doc" ] || echo "Missing: $doc"
done
```

## Creating New Module Docs

When a module needs documentation:

```markdown
# Module: {name}

## Overview
| Property | Value |
|----------|-------|
| **Purpose** | Brief description |
| **Status** | Active/Planned/Deprecated |
| **Complexity** | Low/Medium/High |
| **Category** | operations/monitoring/infrastructure |

## Quick Reference
- **Dashboard:** /path
- **API:** /api/prefix/*
- **Tables:** table1, table2

## API Endpoints
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | /api/... | ... |

## Database Tables
| Table | Purpose |
|-------|---------|
| ... | ... |

## Troubleshooting
- **Issue:** Solution
- **Issue:** Solution

## Related
- Link to related docs
```

## Session Knowledge Persistence

At end of significant work sessions:

### 1. Capture learnings
What was discovered that should be permanent?
- New gotchas or patterns
- Troubleshooting solutions
- Configuration changes

### 2. Route to correct location
Use the routing decision tree above.

### 3. Update cross-references
If adding to module doc, ensure CLAUDE.md references it.

## Audit Report Template

When running `/memory audit`:

```
╔══════════════════════════════════════════════════════════════╗
║                   KNOWLEDGE SYSTEM AUDIT                      ║
╠══════════════════════════════════════════════════════════════╣
║ CLAUDE.md Size: {size}KB ({status})                          ║
║ Module Docs: {count} files                                   ║
║ Skills: {count} skills                                       ║
║ KB Entries: {count} files                                    ║
╠══════════════════════════════════════════════════════════════╣
║ ISSUES:                                                      ║
║ - {issue 1}                                                  ║
║ - {issue 2}                                                  ║
╠══════════════════════════════════════════════════════════════╣
║ RECOMMENDATIONS:                                             ║
║ - {recommendation 1}                                         ║
║ - {recommendation 2}                                         ║
╚══════════════════════════════════════════════════════════════╝
```

## Integration with Other Skills

- **`/kb`** - Scans modules, updates module docs
- **`/memory`** - Audits hierarchy, routes knowledge, slims CLAUDE.md
- **`module-context`** - Loads specific module context on demand

## Best Practices

1. **CLAUDE.md is an INDEX, not a dump** - If you're adding >5 lines, it probably belongs elsewhere
2. **Module docs are authoritative** - All module details live in `.claude/modules/`
3. **Skills are procedures** - Step-by-step workflows, not reference material
4. **KB is for depth** - Historical context, rationale, edge cases
5. **Session state is temporary** - Don't rely on it persisting
