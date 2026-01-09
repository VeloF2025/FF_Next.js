# Zero Tolerance Quality Gates

**STATUS**: AUTOMATIC BLOCKING
**LOAD WHEN**: Code review, pre-commit validation, quality checks

---

## Critical Patterns - Automatic Blocking

### Console.log Statements
**ZERO TOLERANCE** - All console.* statements BLOCKED

```typescript
// BLOCKED
console.log('debug');
console.error('error');
console.warn('warning');

// CORRECT - Use proper logger
import { log } from '@/lib/logger';
log.info('message', data, 'component');
log.error('failed', error, 'component');
log.warn('warning', data, 'component');
```

### Empty Catch Blocks
**ZERO TOLERANCE** - All catch blocks must handle errors

```typescript
// BLOCKED
catch { }
catch (_error) { }
catch (e) { void e; }

// CORRECT
catch (error: unknown) {
  log.error('Operation failed', error, 'component');
  return apiResponse.internalError(res, error);
}
```

### Implicit Any
**ZERO TOLERANCE** - 100% type coverage required

```typescript
// BLOCKED
function process(data) { }        // implicit any
const items: any[] = [];          // explicit any
const result = response as any;   // any cast

// CORRECT
function process(data: ProcessInput): ProcessOutput { }
const items: Item[] = [];
const result = response as ApiResponse;
```

---

## Quality Standards

| Standard | Requirement |
|----------|-------------|
| Type Coverage | 100% - No implicit 'any' |
| File Size | Max 300 lines |
| Component Size | Max 200 lines |
| Linting | Zero errors, zero warnings |
| Error Handling | All errors logged and handled |

---

## Pre-Commit Checklist

1. Zero TypeScript errors (`npm run type-check`)
2. Zero ESLint errors (`npm run lint`)
3. Zero console.* statements
4. All catch blocks handle errors
5. All functions have proper types
6. File sizes within limits

---

## FibreFlow Specific

### Required Imports for Error Handling
```typescript
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
```

### Standard Error Pattern
```typescript
try {
  const result = await operation();
  return apiResponse.success(res, result);
} catch (error: unknown) {
  log.error('Operation failed', error, 'api-route-name');
  return apiResponse.internalError(res, error);
}
```

---

## Validation Commands

```bash
npm run lint                    # Check linting
npm run type-check             # Check types
npm run build                  # Full build check
```

---

**Commits with violations are BLOCKED.**
