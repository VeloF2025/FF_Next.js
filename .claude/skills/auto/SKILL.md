---
name: auto
description: Autonomous coding from PRD/specification for FibreFlow. Converts requirements documents into implemented features with tests. USE WHEN user says "implement from PRD", "auto implement", "autonomous coding", "build from spec", or provides a requirements document to implement.
---

# Auto Skill - FibreFlow

**Purpose:** Convert PRD/specification documents into working FF features with tests.

## Usage

```
/auto <path-to-spec>
/auto docs/features/new-feature.md
/auto --dry-run docs/features/pagination.md
```

## What It Does

1. **Parse Specification** - Extract requirements from document
2. **Generate Feature List** - Break down into implementable features
3. **Create Tests First** - TDD approach with tests before code
4. **Implement Features** - One feature at a time
5. **Validate Each Step** - Run tests, type-check, lint

## Workflow

```
/auto docs/features/contractor-dashboard.md
    │
    ▼
┌─────────────────────────────────────┐
│ 1. Parse PRD/Spec                   │
│    - Extract features               │
│    - Identify acceptance criteria   │
│    - Note FF-specific requirements  │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ 2. Generate feature_list.json      │
│    - Feature descriptions          │
│    - Test requirements             │
│    - Implementation notes          │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ 3. For each feature:               │
│    a. Write tests (TDD)            │
│    b. Implement code               │
│    c. Run: npm run type-check      │
│    d. Run: npm run lint            │
│    e. Run: npm test                │
│    f. Mark complete if passes      │
└─────────────────────────────────────┘
    │
    ▼
┌─────────────────────────────────────┐
│ 4. Final Validation                │
│    - All tests pass                │
│    - Build succeeds                │
│    - No lint errors                │
└─────────────────────────────────────┘
```

## Feature List Format

Generated `feature_list.json`:

```json
{
  "project": "FibreFlow",
  "source_spec": "docs/features/contractor-dashboard.md",
  "generated_at": "2026-01-09T15:00:00Z",
  "features": [
    {
      "id": "feature-001",
      "name": "Contractor List View",
      "description": "Display paginated list of contractors with search",
      "files": [
        "src/modules/contractors/components/ContractorList.tsx",
        "src/modules/contractors/hooks/useContractors.ts"
      ],
      "tests": [
        "src/modules/contractors/__tests__/ContractorList.test.tsx"
      ],
      "status": "pending",
      "acceptance_criteria": [
        "Shows contractor name, status, project count",
        "Pagination with 20 items per page",
        "Search by name or email",
        "Sort by name, status, or join date"
      ]
    }
  ]
}
```

## Options

| Flag | Description |
|------|-------------|
| `--dry-run` | Generate feature list only, don't implement |
| `--max-features N` | Limit to N features per run |
| `--skip-tests` | Skip test generation (not recommended) |
| `--continue` | Resume from existing feature_list.json |

## FF-Specific Patterns

Auto-applied to all features:

### API Routes
```typescript
// Always use apiResponse helper
import { apiResponse } from '@/lib/apiResponse';
return apiResponse.success(res, data);
```

### Components
```typescript
// Always use AppLayout for pages
import { AppLayout } from '@/components/layout';
```

### Error Handling
```typescript
// Always log errors properly
import { log } from '@/lib/logger';
catch (error: unknown) {
  log.error('Operation failed', error, 'component');
}
```

### Types
```typescript
// Always define interfaces
interface ContractorProps {
  data: Contractor;
  onUpdate: (id: string) => void;
}
```

## Quality Gates

Every feature must pass:

1. **TypeScript** - `npm run type-check` passes
2. **ESLint** - `npm run lint` passes
3. **Tests** - All tests pass
4. **Zero Tolerance** - No console.log, no empty catches
5. **NLNH** - No hallucinated code references
6. **DGTS** - No fake implementations

## Example Specification

```markdown
# Feature: Contractor Dashboard

## Overview
Dashboard showing contractor performance metrics.

## Requirements
1. Display total projects assigned
2. Show completion rate percentage
3. List recent activity (last 7 days)
4. Filter by project

## Acceptance Criteria
- [ ] Loads within 2 seconds
- [ ] Updates in real-time
- [ ] Mobile responsive
- [ ] Uses existing Contractor type
```

## Resuming Work

If interrupted, resume with:
```
/auto --continue
```

This reads existing `feature_list.json` and continues from last incomplete feature.

## Integration with FF

- Uses existing module structure
- Follows component patterns
- Integrates with Neon database
- Uses Clerk authentication
- Applies AppLayout for pages

---

**Key Principle:** Specification → Tests → Implementation → Validation. No shortcuts.
