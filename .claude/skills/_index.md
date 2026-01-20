# FibreFlow Skills Index

Quick reference for all available skills organized by category.

## Skill Activation Triggers

Skills are automatically loaded when relevant keywords or contexts are detected.

---

## Knowledge Base Skills

### `knowledge-base/SKILL.md`
**Trigger:** kb, KB, /kb, update kb, refresh knowledge, scan modules, sync knowledge
- Scan source modules for missing `.claude.md` files
- Update module index and skills index
- Consolidate learnings from `.claude-learnings.md` files
- Update session state
- Generate summary report

---

## Infrastructure Skills

### `infrastructure/vlm.md`
**Trigger:** VLM, Qwen3, model, GPU, benchmark, categorization service
- VLM (Qwen3-VL-8B-Instruct) configuration and troubleshooting
- GPU setup (RTX 5090 compute-only mode)
- Benchmark system (7 tests: 2 text + 5 image)
- Service management on Velocity Server

### `infrastructure/staging.md`
**Trigger:** staging, deploy, vf.fibreflow.app, deployment
- Staging server deployment
- Service management
- Rollback procedures
- Troubleshooting common issues

---

## Module Skills

### `modules/activate.md`
**Trigger:** activate, DR photo, categorization, QA review, OES import, WhatsApp acknowledgment
- DR Photo Unified system
- 5-service health check (DB, 1M, VLM, WA Bridge, WA Sender)
- WhatsApp acknowledgment flow
- OES import
- Reporting (daily counts, discrepancy, serial validation, user attribution)
- 10-step photo checklist

### `modules/wa-monitor.md`
**Trigger:** wa-monitor, WhatsApp monitor, drops, feedback
- WhatsApp monitoring service
- Drop tracking and validation
- Service management (prod/dev)
- Adding new projects/groups

### `modules/procurement.md`
**Trigger:** procurement, BOQ, RFQ, quotes, PO, purchase order, stock, GRN
- BOQ (Bill of Quantities) management
- RFQ creation and distribution
- Quote evaluation
- Purchase orders
- Stock management and drum tracking

### `modules/qa-learning.md`
**Trigger:** qa-learning, HITL, few-shot, corrections, learning
- Human-in-the-loop learning system
- Correction recording and retrieval
- Few-shot example selection
- Confusion pair handling

---

## Integration Skills

### `integrations/go-bridge.md`
**Trigger:** go bridge, WhatsApp bridge, threading, LID, acknowledgment
- WhatsApp Go bridge service
- Message threading (ContextInfo)
- DR acknowledgment system
- LID handling

### `integrations/sage-api.md`
**Trigger:** sage, accounting, invoice, payment
- Sage Business Cloud South Africa
- API authentication
- Invoice sync

### `integrations/qcontact.md`
**Trigger:** qcontact, ticketing, support ticket
- QContact ticketing integration
- Ticket creation and management

---

## Workflow Skills

### `workflows/oes-import.md`
**Trigger:** OES, import, Excel, activations
- OES activation report import
- Excel parsing
- Validation and matching

### `workflows/project-import.md`
**Trigger:** SOW import, project import, fibre import
- Statement of Work imports
- Project data ingestion

### `workflows/tdd.md`
**Trigger:** TDD, test-driven, spec, test specification
- Test-Driven Development workflow
- Spec → Test → Code process
- Test structure and commands

---

## Generic Skills (Keep for Utilities)

### `auto/`
Autonomous implementation from PRD/specifications.

### `boss-orchestrator/`
Multi-agent task orchestration for complex operations.

### `CORE/`
PAI core protocols and response format.

### `fabric/`
Pattern-based content processing (242+ patterns).

### `observability/`
Session monitoring and metrics tracking.

### `research/`
Multi-agent research for technical decisions.

### `typescript-fixer/`
Automated TypeScript and ESLint error fixing.

---

## Archived Skills

Location: `.claude/skills/archive/`

| Skill | Reason |
|-------|--------|
| `ff-dark-mode/` | Completed feature |
| `theme-audit.md` | Completed audit |
| `toast-notifications.md` | Minor utility, documented |

---

## Skill Loading Rules

1. **Auto-load:** Skills matching trigger keywords are loaded automatically
2. **Context-aware:** Module skills load when working in that module's code
3. **Manual:** Use `/skill <name>` to explicitly load a skill
4. **Cascade:** Loading a skill may reference related skills

## Adding New Skills

**AUTO-INVOKE:** When new skills are needed, the `/Createskill` skill is automatically invoked.

**Triggers for Createskill:**
- "create a new skill", "create skill"
- "validate skill", "check skill"
- "update skill", "add workflow"
- "canonicalize", "fix skill structure"

**Manual workflow:**
1. Invoke `/Createskill` or it auto-activates on skill creation requests
2. Follow the workflow prompts (reads `SkillSystem.md` for structure)
3. Creates skill in appropriate category folder with TitleCase naming
4. Add entry to this index with triggers
5. Update CLAUDE.md if project-critical

## Skill Template

```markdown
# {Skill Name}

## Overview
One-line description.

## Quick Reference
- **URL/Path:** ...
- **API:** ...
- **Database:** ...

## Common Tasks
### Task 1: {Name}
```bash
# Commands
```

## Troubleshooting
### Issue: {Description}
- **Cause:** ...
- **Fix:** ...

## Related
- Link to other skills
```
