---
name: module-context
description: Load and provide context about FibreFlow modules for accurate code assistance. USE WHEN user mentions working on a specific module, asks about module dependencies or structure, wants to modify code in a module, or says '/module'.
---

# Module Context Skill

## USE WHEN

- User mentions working on a specific module (e.g., "ticketing", "wa-monitor")
- User asks about module dependencies or structure
- User wants to modify code in a module
- Before implementing features in any module
- User asks "how does X module work?"
- `/module <name>` command is invoked

## QUICK REFERENCE

Load module index for overview:
```
.claude/modules/_index.yaml
```

Load specific module profile:
```
.claude/modules/{module-name}.md
```

## COMMANDS

### `/module <name>`
Load full context for a specific module.

**Steps:**
1. Read `.claude/modules/_index.yaml` for overview
2. Read `.claude/modules/{name}.md` for detailed profile
3. Optionally scan live code if profile seems outdated

**Output:**
```
## Module: {name}
**Purpose:** {purpose}
**Category:** {category}
**Complexity:** {complexity}

### Dependencies
- Internal: {list}
- External: {list}

### Database
- Tables: {list}
- Key queries: {descriptions}

### API Endpoints
{list with methods}

### Key Services
{service names and methods}

### Patterns & Gotchas
{important notes}
```

### `/module list`
Show all 34 modules grouped by category.

### `/module deps <name>`
Show dependency graph for a module.

### `/module db <name>`
Show database tables and queries for a module.

## MODULE CATEGORIES

| Category | Modules | Description |
|----------|---------|-------------|
| **core** | projects, clients, sow, installations, workflow, tasks, ticketing | Core business functionality |
| **procurement** | procurement, assets, suppliers | Procurement and inventory |
| **monitoring** | wa-monitor, foto-review, dr-photo-review, activate, rag, daily-progress | QA and progress monitoring |
| **reporting** | analytics, kpi-dashboard, kpis, reports | Analytics and reporting |
| **operations** | field-app, qfield-sync, barcode-scanner, nokia-equipment, onemap | Field operations |
| **communication** | communications, meetings, livekit | Communication tools |
| **admin** | admin, settings, staff, onboarding, dashboard, action-items | Administration |

## ISOLATION STATUS

### Fully Isolated (can be extracted as microservice)
- **wa-monitor** - Zero external FF dependencies

### Mostly Isolated
- **foto-review** - Minimal dependencies
- **ticketing** - Minimal dependencies

### Tightly Coupled (modify with care)
- **workflow** - Central orchestration
- **installations** - Core data model
- **projects** - Referenced by most modules

## BEFORE MODIFYING A MODULE

1. **Load context:** `/module <name>`
2. **Check dependencies:** What modules depend on this?
3. **Check database:** What tables are affected?
4. **Check API:** What endpoints exist?
5. **Review patterns:** Follow existing patterns in the module

## DATABASE TABLE MAPPING

| Table | Primary Module | Also Used By |
|-------|---------------|--------------|
| drops | sow | wa-monitor |
| qa_photo_reviews | wa-monitor | dr-photo-review |
| foto_ai_reviews | foto-review | - |
| projects | projects | sow, installations |
| contractors | onboarding | rag, staff |
| installations | installations | workflow |
| assets | assets | procurement |
| rfq/boq | procurement | - |
| tickets | ticketing | - |

## LIVE ANALYSIS

If module profile is missing or outdated, analyze live:

```bash
# List module structure
ls -la src/modules/{name}/

# Find dependencies
grep -r "from '@/modules/" src/modules/{name}/ | grep -v node_modules

# Find database tables
grep -rh "FROM\|INTO\|UPDATE\|DELETE" src/modules/{name}/ | grep -oP "(?:FROM|INTO|UPDATE|DELETE)\s+\K\w+"

# Find API endpoints
grep -r "modules/{name}" pages/api/
```

## INTEGRATION

This skill integrates with:
- **TDD skill** - Know what to test based on module structure
- **Pre-commit hook** - Validate changes follow module patterns
- **Expert system** - expertise.yaml references module patterns

## EXAMPLES

### Example 1: Working on ticketing module
```
User: I need to add a new ticket status
Assistant: Let me load the ticketing module context first.
[Reads .claude/modules/ticketing.md]

The ticketing module uses:
- Table: tickets (status column is enum)
- Service: ticketService.ts with updateStatus()
- Types: TicketStatus enum in types/ticket.ts

To add a new status:
1. Update TicketStatus enum in types/ticket.ts
2. Add migration for database enum
3. Update ticketService.updateStatus() if needed
4. Add tests for new status transitions
```

### Example 2: Understanding dependencies
```
User: What modules depend on projects?
Assistant: [Reads _index.yaml and scans imports]

Modules that import from projects:
- sow (project_id foreign key)
- installations (project association)
- workflow (project-scoped workflows)
- kpis (project-level metrics)
- dashboard (project overview)

Changes to projects module will affect these modules.
```
