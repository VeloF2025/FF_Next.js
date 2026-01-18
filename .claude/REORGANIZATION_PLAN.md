# .claude Directory Reorganization Plan

## Current Problems

1. **Skill Sprawl** - 25+ skills with no clear organization
2. **Duplicate Content** - Same info in skills, modules, memories, and CLAUDE.md
3. **One-time Patches** - Temporary fix files left behind
4. **Inconsistent Naming** - `SKILL.md` vs `skill.md` vs flat files
5. **Missing Module Coverage** - Active modules without skills

---

## Best Practices Principles

### 1. Single Source of Truth
- Each piece of knowledge lives in ONE place
- Other places reference, don't duplicate

### 2. Clear Hierarchy
```
CLAUDE.md           → Quick reference, essential commands
.claude/skills/     → Deep procedural knowledge
.claude/modules/    → Module API/structure docs (auto-generated)
.claude/commands/   → Slash command definitions
.claude/agents/     → Custom agent configurations
```

### 3. Skill Categories
- **Infrastructure** - Servers, VLM, database, deployment
- **Modules** - Feature-specific knowledge (activate, fleet, wa-monitor)
- **Integrations** - External APIs (Sage, OneMap, WhatsApp)
- **Workflows** - Dev processes (TDD, imports, PR)

### 4. Naming Convention
- Flat files: `{category}-{name}.md` (e.g., `infra-vlm.md`)
- No subdirectories for simple skills
- Subdirectories only for skills with multiple files

---

## Proposed Structure

```
.claude/
├── CLAUDE.md                    # Symlink to ../CLAUDE.md (if needed)
├── settings.json                # Permissions and hooks
├── settings.local.json          # Local overrides
│
├── agents/                      # Custom agent definitions
│   ├── antihall-validator.md
│   ├── code-implementation.md
│   └── wa-agent.md
│
├── commands/                    # Slash commands (/command)
│   ├── README.md
│   ├── deploy.md
│   ├── pr.md
│   ├── review.md
│   ├── status.md
│   ├── sync.md
│   ├── log.md
│   ├── tdd.md
│   ├── oes.md
│   └── activate-reporting.md
│
├── hooks/                       # Automation hooks
│   ├── expert-load.ts
│   ├── pre-commit.ts
│   ├── tdd-reminder.ts
│   └── token-tracker.ts
│
├── protocols/                   # Quality standards
│   ├── nlnh-protocol.md
│   ├── dgts-validation.md
│   ├── tdd-enforcement.md
│   └── zero-tolerance-quality.md
│
├── modules/                     # Module documentation (keep as-is)
│   └── *.md                     # Auto-reference from codebase
│
└── skills/                      # REORGANIZED
    │
    ├── _index.md                # Skill directory with triggers
    │
    ├── infrastructure/
    │   ├── vlm.md               # VLM config, benchmarks, troubleshooting
    │   ├── staging.md           # Staging deployment
    │   └── database.md          # Neon setup, connections
    │
    ├── modules/
    │   ├── activate.md          # DR photo review + VLM categorization
    │   ├── wa-monitor.md        # WhatsApp monitoring
    │   ├── fleet.md             # Fleet portal + plate verification
    │   ├── procurement.md       # BOQ, RFQ, PO, GRN
    │   ├── qa-learning.md       # HITL few-shot learning
    │   └── projects.md          # Project management
    │
    ├── integrations/
    │   ├── go-bridge.md         # WhatsApp Go bridge
    │   ├── sage-api.md          # Sage accounting API
    │   ├── onemap.md            # OneMap GIS
    │   └── qcontact.md          # QContact ticketing
    │
    └── workflows/
        ├── tdd.md               # Test-driven development
        ├── project-import.md    # SOW/project imports
        └── oes-import.md        # OES data imports
```

---

## Migration Steps

### Phase 1: Cleanup (Remove Clutter)
- [ ] Delete `go_ack_patch.py`, `go_ack_patch.b64`, `reply_fix.py`
- [ ] Archive or delete `commands/BMad/` if unused
- [ ] Remove stale memories
- [ ] Remove duplicate `staging-fix-logger.js` (keep .ts)

### Phase 2: Consolidate Skills
- [ ] Merge `photo-categorization.md` + `ai-qa-validation.md` → `modules/activate.md`
- [ ] Merge `vlm-infrastructure.md` → `infrastructure/vlm.md`
- [ ] Move `wa-monitor-auto.md` → `modules/wa-monitor.md`
- [ ] Move `staging-deploy.md` → `infrastructure/staging.md`
- [ ] Move `go-bridge.md` → `integrations/go-bridge.md`
- [ ] Move `sage-api-south-africa.md` → `integrations/sage-api.md`

### Phase 3: Create Missing Skills
- [ ] Create `modules/fleet.md` (plate verification, VLM)
- [ ] Create `modules/procurement.md` (BOQ, RFQ, stock)
- [ ] Create `modules/qa-learning.md` (HITL learning)
- [ ] Create `infrastructure/database.md` (Neon config)

### Phase 4: Create Skill Index
- [ ] Create `skills/_index.md` with triggers and descriptions
- [ ] Update CLAUDE.md to reference skill index
- [ ] Verify all skill references work

### Phase 5: Cleanup Generic Skills
- [ ] Evaluate: `auto/`, `boss-orchestrator/`, `CORE/`, `fabric/`
- [ ] Keep if FF-specific, remove if generic (use global skills instead)
- [ ] Move `typescript-fixer/` → keep (useful)
- [ ] Archive: `ff-dark-mode/`, `theme-audit.md`, `toast-notifications.md`

---

## Skill Template

```markdown
# {Skill Name}

## Overview
One-line description of what this skill covers.

## Quick Reference
- **Key URL/Path:** ...
- **Main API:** ...
- **Database Table:** ...

## Common Tasks

### Task 1: {Name}
```bash
# Commands or code
```

### Task 2: {Name}
...

## Troubleshooting

### Issue: {Description}
- **Cause:** ...
- **Fix:** ...

## Related
- Link to other skills
- Link to CLAUDE.md section
```

---

## Files to Delete

| File | Reason |
|------|--------|
| `go_ack_patch.py` | One-time patch, already applied |
| `go_ack_patch.b64` | One-time patch data |
| `reply_fix.py` | One-time fix |
| `hooks/staging-fix-logger.js` | Duplicate of .ts version |
| `memories/staging-fixes.json` | Stale |

## Files to Archive (move to .claude/archive/)

| File | Reason |
|------|--------|
| `skills/ff-dark-mode/` | Completed feature |
| `skills/theme-audit.md` | Completed audit |
| `skills/toast-notifications.md` | Minor utility |
| `commands/BMad/` | Framework not actively used? |

---

## Decision Points

1. **BMad Framework** - Keep 33 files or archive?
2. **Generic Skills** - Keep `CORE/`, `fabric/`, `boss-orchestrator/` or use global?
3. **Modules Docs** - Keep separate or merge into skills?

---

## Success Criteria

- [ ] No duplicate information across files
- [ ] Every active module has a skill
- [ ] Clear naming convention followed
- [ ] CLAUDE.md stays under 500 lines (quick reference only)
- [ ] Skills index provides discoverability
- [ ] Hooks still work after reorganization
