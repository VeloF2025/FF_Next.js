---
name: typescript-fixer
description: Automated TypeScript and ESLint error fixing for FibreFlow. USE WHEN user says "fix typescript errors", "fix type errors", "fix lint errors", "run type check", or after builds fail with type errors.
---

# TypeScript Fixer - FibreFlow

Automated workflow for fixing TypeScript and ESLint errors in the FibreFlow codebase.

## Workflow

### Step 1: Run Type Check
```bash
npm run type-check 2>&1 | head -100
```

### Step 2: Run Lint
```bash
npm run lint 2>&1 | head -100
```

### Step 3: Analyze Errors
Parse the output and categorize:
- **Type errors**: Missing types, wrong types, implicit any
- **Import errors**: Missing imports, wrong paths
- **Lint errors**: Style issues, unused variables
- **Build errors**: Module resolution, compilation

### Step 4: Fix Strategy

| Error Type | Strategy |
|------------|----------|
| Missing type | Add explicit type annotation |
| Implicit any | Define proper interface |
| Missing import | Add import statement |
| Unused variable | Remove or prefix with `_` |
| Wrong type | Cast or fix source |

### Step 5: Verify Fix
```bash
npm run type-check && npm run lint
```

---

## Common FibreFlow Fixes

### API Response Types
```typescript
// Add proper typing
import type { NextApiRequest, NextApiResponse } from 'next';

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) { ... }
```

### Database Query Types
```typescript
// Type the result
interface DropRow {
  id: string;
  drop_number: string;
  project_id: string;
}
const result = await sql<DropRow[]>`SELECT * FROM drops`;
```

### Component Props
```typescript
// Define props interface
interface Props {
  data: DataType;
  onUpdate: (id: string) => void;
}

export function Component({ data, onUpdate }: Props) { ... }
```

---

## Quick Commands

```bash
# Full validation
npm run type-check && npm run lint && npm run build

# Type check only
npm run type-check

# Lint with auto-fix
npm run lint -- --fix

# Check specific file
npx tsc --noEmit src/modules/ticketing/services/drLookupService.ts
```

---

## Error Priority

1. **CRITICAL**: Build-breaking type errors (fix first)
2. **HIGH**: Implicit any, missing types
3. **MEDIUM**: Lint warnings, style issues
4. **LOW**: Unused imports, minor warnings

---

## Parallel Fixing

For many errors, use Task tool with haiku model:
```
Launch parallel agents to fix errors in different files simultaneously
```

---

**After fixing, always run full validation: `npm run type-check && npm run lint`**
