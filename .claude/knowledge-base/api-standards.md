# API Response Standards — FibreFlow

**Decision:** Committee IMPLEMENT, Feb 23, 2026  
**Phase:** 1 of 4 (foundation shipped, migration in progress)  
**Migration Guide:** `docs/API-ERROR-RESPONSE-MIGRATION.md`

---

## TL;DR — Which Utility to Use

| Situation | Use This | Import From |
|-----------|----------|-------------|
| Pages Router — throw typed errors | `ApiError` + `handleApiError()` | `@/lib/api/errorHandler` |
| Pages Router — build success/error response | `successResponse()` + `HttpErrors.*` | `@/lib/api-response` |
| Pages Router — wrap entire handler | `withErrorHandler()` | `@/lib/api-response` |
| App Router (route.ts) | `NextResponse.json()` + `ApiError` | `next/server` + `@/lib/api/errorHandler` |
| Frontend — consume any API response | `handleApiResponse()` | `@/src/lib/handleApiResponse` |
| **DO NOT USE** | ~~old `lib/api-error-handler.ts`~~ | legacy, being phased out |

---

## Backend Patterns

### Pattern 1 — Pages Router with typed throws (preferred for new code)

```typescript
import { ApiError, handleApiError, ValidationError, NotFoundError, AuthError } from '@/lib/api/errorHandler';
import { successResponse, withErrorHandler } from '@/lib/api-response';

export default withErrorHandler(async (req, res) => {
  if (req.method !== 'GET') {
    throw new ApiError('VALIDATION_ERROR', `Method ${req.method} not allowed`, undefined, 405);
  }

  const { id } = req.query;
  if (!id) throw ValidationError('id is required');

  const item = await db.items.findById(String(id));
  if (!item) throw NotFoundError('Item');

  res.status(200).json(successResponse(item));
});
```

### Pattern 2 — Pages Router with explicit catch

```typescript
import { ApiError, handleApiError, ValidationError } from '@/lib/api/errorHandler';
import { successResponse } from '@/lib/api-response';

export default async function handler(req, res) {
  try {
    if (!req.body.name) throw ValidationError('name is required', { field: 'name' });
    
    const result = await db.items.create(req.body);
    res.status(201).json(successResponse(result));
  } catch (error) {
    handleApiError(error, res);
  }
}
```

### Pattern 3 — App Router (route.ts)

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { ApiError, handleApiError, NotFoundError } from '@/lib/api/errorHandler';
import { successResponse } from '@/lib/api-response';

export async function GET(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const item = await db.items.findById(params.id);
    if (!item) throw NotFoundError('Item');
    return NextResponse.json(successResponse(item));
  } catch (error) {
    if (error instanceof ApiError) {
      return NextResponse.json(
        { success: false, error: { code: error.code, message: error.message } },
        { status: error.statusCode || 500 }
      );
    }
    return NextResponse.json({ success: false, error: 'Internal server error' }, { status: 500 });
  }
}
```

---

## Error Codes Reference

| Code | HTTP Status | When to Use |
|------|------------|-------------|
| `VALIDATION_ERROR` | 400 | Missing/invalid fields, bad input |
| `AUTH_ERROR` | 401 | Not authenticated, token invalid |
| `NOT_FOUND` | 404 | Resource doesn't exist |
| `CONFLICT` | 409 | Duplicate, constraint violation |
| `RATE_LIMIT` | 429 | Too many requests |
| `SERVER_ERROR` | 500 | Unexpected runtime error |
| `DATABASE_ERROR` | 500 | DB query failed |
| `EXTERNAL_SERVICE_ERROR` | 502 | Third-party API failure |

### Convenience Factories (throw these directly)

```typescript
throw ValidationError('Email is required', { field: 'email' });
throw AuthError('Session expired');
throw NotFoundError('Project');           // → "Project not found"
throw ConflictError('Name already exists');
throw DatabaseError('Failed to fetch records');
```

---

## Response Shapes

### Success
```json
{
  "success": true,
  "data": { ... },
  "timestamp": "2026-02-23T18:00:00.000Z",
  "requestId": "a1b2c3d4-..."
}
```

### Error (new standard)
```json
{
  "success": false,
  "error": {
    "code": "NOT_FOUND",
    "message": "Project not found",
    "details": null
  },
  "timestamp": "2026-02-23T18:00:00.000Z"
}
```

### Error (legacy — still in production during migration)
```json
{
  "success": false,
  "data": null,
  "message": "Not found",
  "code": "NOT_FOUND"
}
```

---

## Frontend Pattern

### Always use `handleApiResponse()` — handles both old + new shapes during migration

```typescript
import { handleApiResponse } from '@/src/lib/handleApiResponse';

// In a component or service
const raw = await fetch('/api/projects').then(r => r.json());
const { data, error } = handleApiResponse<Project[]>(raw);

if (error) {
  // error.code  → machine-readable: 'AUTH_ERROR', 'NOT_FOUND', etc.
  // error.message → human-readable: safe to display
  // error.details → structured field errors (VALIDATION_ERROR only)
  
  if (error.code === 'AUTH_ERROR') return router.push('/login');
  if (error.code === 'NOT_FOUND') return setEmpty(true);
  showToast(error.message, 'error');
  return;
}

setItems(data);
```

### Do NOT check response shapes manually
```typescript
// ❌ Brittle — breaks when response shape changes
if (res.error) showToast(res.error);
if (!res.success) showToast(res.message || res.error);

// ✅ Correct — normalises all shapes, survives migration
const { data, error } = handleApiResponse(res);
if (error) showToast(error.message);
```

---

## Migration Status

| Phase | Scope | Status | Target |
|-------|-------|--------|--------|
| Phase 1 | Foundation: errorHandler.ts + api-response.ts + handleApiResponse.ts | ✅ SHIPPED Feb 23 | — |
| Phase 2 | Migrate high-traffic endpoints (auth, projects, procurement) | 🟡 PENDING | Mar 7 |
| Phase 3 | Migrate remaining pages/api/ endpoints | 🟡 PENDING | Mar 21 |
| Phase 4 | Migrate app/api/ (App Router) endpoints | 🟡 PENDING | Apr 4 |

**During migration (Phases 2-4):** Both old and new formats coexist. Always use `handleApiResponse()` on frontend so your code survives the cutover.

---

## What NOT to Do

```typescript
// ❌ Old lib/api-error-handler.ts — DO NOT USE for new code
import { withErrorHandler } from '@/lib/api-error-handler';  // legacy

// ❌ Hand-rolling error responses
res.status(400).json({ error: 'Bad request' });             // inconsistent

// ❌ Swallowing errors silently
catch (e) { res.status(500).json({}) }                      // untraceable

// ❌ Leaking stack traces in production
catch (e) { res.status(500).json({ stack: e.stack }) }      // security risk
```

---

## Gotchas

1. **`withErrorHandler` exists in both files** — the one in `lib/api-response.ts` is the NEW version (use this). The one in `lib/api-error-handler.ts` is legacy (avoid).
2. **App Router handlers** — `handleApiError()` expects a `NextApiResponse`, not `NextResponse`. Use explicit try/catch with `NextResponse.json()` in App Router.
3. **Details are dev-only** — `details` field in `buildErrorResponse()` is stripped in production. Don't rely on it in prod frontend code.
4. **requestId in api-response.ts** — auto-generated UUID per request, useful for correlating logs. Log it in your catch blocks.
5. **Frontend normaliser covers both shapes** — `handleApiResponse()` bridges old `{ message: "..." }` and new `{ error: { code, message } }` formats. Use it everywhere until migration is complete.

---

*Last updated: Feb 23, 2026 — Phase 1 shipped*  
*See also: `docs/API-ERROR-RESPONSE-MIGRATION.md` for the full 4-week rollout plan*
