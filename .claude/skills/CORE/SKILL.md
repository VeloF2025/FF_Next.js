---
name: core
description: FibreFlow PAI Core - Response format, protocols, and quality standards. AUTO-LOADS at session start. USE WHEN any session begins OR user asks about PAI protocols, response format, or quality standards.
---

# CORE - FibreFlow PAI Infrastructure

**Auto-loads at session start.** This skill defines response format and core operating principles for FibreFlow development.

## PAI Trigger

**@pai** or **@PAI** activates full PAI context with protocols.

---

## MANDATORY RESPONSE FORMAT (Task-Based)

```
SUMMARY: [One sentence - what this response is about]
ANALYSIS: [Key findings, insights, or observations]
ACTIONS: [Steps taken or tools used]
RESULTS: [Outcomes, what was accomplished]
STATUS: [Current state - completed/in-progress/blocked]
NEXT: [Recommended next steps]
COMPLETED: [12 words max summary]
```

**Use for:** Feature implementations, bug fixes, investigations, complex tasks
**Skip for:** Simple questions, quick lookups, confirmations

---

## ACTIVE PROTOCOLS

### NLNH (No Lies, No Hallucinations)
- Say "I don't know" when uncertain
- Use confidence levels: HIGH/MEDIUM/LOW
- Code markers: `// WORKING:`, `// PARTIAL:`, `// BROKEN:`, `// MOCK:`, `// UNTESTED:`
- Never claim features work without verification

### DGTS (Don't Game The System)
- No fake tests (`assert True`, tautologies)
- No mocked implementations pretending to be real
- No commented validation rules
- No empty implementations claiming completion

### Zero Tolerance Quality
- No `console.log` - use proper logger from `@/lib/logger`
- No empty catch blocks - handle errors properly
- 100% type coverage - no implicit `any`
- Max 300 lines per file, 200 for components

---

## FIBREFLOW STACK RULES

| Rule | Standard |
|------|----------|
| Package Manager | npm (project standard) |
| Framework | Next.js 14+ with App Router |
| Database | Neon PostgreSQL (direct SQL, no ORM) |
| Auth | Clerk |
| API Response | Use `apiResponse` helper from `@/lib/apiResponse` |
| Logging | Use `log` from `@/lib/logger` (never console.*) |
| Layout | Use `AppLayout` for pages with sidebar |

---

## FIBREFLOW API PATTERNS

```typescript
// Standard API response
import { apiResponse } from '@/lib/apiResponse';
return apiResponse.success(res, data);
return apiResponse.notFound(res, 'Resource', id);
return apiResponse.internalError(res, error);

// Error handling
import { log } from '@/lib/logger';
catch (error: unknown) {
  log.error('Operation failed', error, 'component-name');
  return apiResponse.internalError(res, error);
}
```

---

## DELEGATION (Model Routing)

| Task Type | Model | When |
|-----------|-------|------|
| Quick checks, lookups | `haiku` | Simple verification, file reading |
| Standard work | `sonnet` | Implementation, most coding |
| Architecture, deep reasoning | `opus` | Complex decisions, system design |

**Parallelize when possible** - Launch multiple Task tools in one message.

---

## DATABASE REMINDER

**TWO DROP TABLES - DO NOT CONFUSE:**
1. `drops` - SOW imports from Excel (API: `/api/sow/*`)
2. `qa_photo_reviews` - WhatsApp QA data (API: `/api/wa-monitor-*`)

**Environments:**
- Production: `ep-dry-night-a9qyh4sj` (master branch)
- Development: `ep-aged-poetry-a9bbd8e9` (hein/dev branch)

---

## MEMORY SYSTEM

Session context persists in `.claude/memories/`:
- `current.md` - Active session progress
- `project-index.md` - FF module index and key locations

**Update memories at session end with significant learnings.**

---

## VALIDATION COMMANDS

```bash
npm run ci:quick      # Local CI lint gates (before PRs — mandatory)
npm run ci            # Full CI: lint + tests + build
npm run lint          # ESLint only
npm run type-check    # TypeScript checking only
npm run antihall      # Validate code references
npm run build         # Full build validation
```

**Ratchet baselines** (any regression blocks): 77 lint errors, 3765 warnings, 88 silent catches.

---

**This completes the FF CORE skill. Reference protocols in `.claude/protocols/` for detailed rules.**
