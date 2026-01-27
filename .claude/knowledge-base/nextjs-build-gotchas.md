# Next.js Build Gotchas

> Common issues where Next.js build behavior doesn't match expectations.

---

## Route Resolution: Directory Wins Over Flat File

**Severity:** Critical - causes silent deployment failures

**Problem:** When both exist, Next.js compiles the directory version and ignores the flat file:
```
pages/api/my-route.ts        ← IGNORED
pages/api/my-route/
  └── index.ts               ← COMPILED
```

**Symptoms:**
- Source file updated but API behavior unchanged
- `rm -rf .next && npm run build` doesn't help
- Version markers in source never appear in responses
- Built file (`grep` in `.next/server/pages/api/*.js`) shows old code

**Quick Diagnosis:**
```bash
# Check for conflict
ls pages/api/route-name*

# Expected (flat file only):
# pages/api/route-name.ts

# Problem (both exist):
# pages/api/route-name.ts
# pages/api/route-name/
#   └── index.ts
```

**Fix:**
```bash
# Remove directory to allow flat file to compile
rm -rf pages/api/route-name/
rm -rf .next && npm run build
```

**Prevention:**
1. When converting directory→flat file: DELETE the directory
2. When converting flat→directory: DELETE the flat file
3. Use version markers for deployment verification:
```typescript
return res.json({
  success: true,
  data,
  _v: '2026-01-27-v1',  // Increment on each deploy
});
```

**Reference:** Commit `ca90e61e` - qa-review-history fix

---

## Build Cache Corruption

**Problem:** Next.js build produces stale output even after source changes.

**Common Causes:**
1. `node_modules/.cache` contains stale webpack artifacts
2. `.next` folder has corrupted chunks
3. TypeScript compilation caching issues

**Nuclear Option:**
```bash
rm -rf .next node_modules/.cache
npm run build
```

**When to Suspect Cache Issues:**
- Build succeeds but behavior doesn't match source
- TypeScript errors appear that shouldn't exist
- Chunks reference deleted files

---

## API Route Import Resolution

**Problem:** Default exports from `@/lib/*` may not resolve correctly in minified production builds.

**Bad Pattern:**
```typescript
import db from '@/lib/db';
await db.connect();  // TypeError: s.default.connect is not a function
```

**Good Pattern:**
```typescript
import { Pool } from 'pg';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
await pool.connect();
```

**See Also:** `learnings.md` - "Database Connection Pattern - Use Inline pg Pool"

---

## Dynamic Route Parameter Naming

**Problem:** Inconsistent parameter names cause 404s or undefined params.

**Example:**
```
pages/api/projects/[projectId]/team.ts  ← Uses projectId
pages/api/projects/[id]/budget.ts       ← Uses id - INCONSISTENT
```

**Access differs:**
```typescript
// projectId route
const { projectId } = req.query;

// id route
const { id } = req.query;  // Different name!
```

**Best Practice:** Use consistent naming across all nested routes:
- Projects: `[projectId]`
- Staff: `[staffId]`
- Assets: `[assetId]`

---

## Vercel Deployment: Nested Dynamic Routes Fail

**Problem:** Deeply nested dynamic routes like `[a]/[b]/[c].ts` may fail on Vercel.

**Solution:** Flatten to catch-all routes:
```
# Instead of
pages/api/[a]/[b]/[c].ts

# Use
pages/api/[...path].ts
```

Then parse path segments in handler:
```typescript
const { path } = req.query;
const [a, b, c] = Array.isArray(path) ? path : [path];
```

---

## Page Routes: Nested Action Routes Don't Exist

**Problem:** Button navigates to `/module/[id]/edit` but page returns 404.

**Example:**
```typescript
// pages/procurement/boq/[id].tsx - EXISTS
// pages/procurement/boq/[id]/edit.tsx - DOES NOT EXIST

// In [id].tsx:
onClick={() => router.push(`/procurement/boq/${boq.id}/edit`)}  // ❌ 404!
```

**Why This Fails:**
1. Pages Router requires explicit file for each route
2. Nested `[id]/edit.tsx` creates complex routing
3. Build/deploy may not include these nested patterns

**Solutions:**

| Approach | Example | Pros | Cons |
|----------|---------|------|------|
| Flattened route | `boq-edit/[id].tsx` | Clear, reliable | Extra file |
| Query param | `boq/[id]?mode=edit` | Same file handles | URL less clean |
| Modal | `setShowEditModal(true)` | No navigation | Complex state |
| Interim notification | `notificationService.info('Coming soon')` | Quick fix | Not functional |

**Recommended Pattern:**
```typescript
// pages/procurement/boq/[id].tsx
const isEditMode = router.query.mode === 'edit';

// Button:
onClick={() => router.push(`/procurement/boq/${boq.id}?mode=edit`)}

// OR flattened:
// pages/procurement/boq-edit/[id].tsx
onClick={() => router.push(`/procurement/boq-edit/${boq.id}`)}
```

**Affected Files (audit 2026-01-27):**
- `pages/procurement/boq/[id].tsx` - Edit button fixed with notification

---

## Circular Redirects During Route Restructuring

**Problem:** Route A redirects to B, B redirects to A → infinite loop.

**Example:**
```
/health-safety/incidents → redirect to /projects/health-safety/incidents
/projects/health-safety/incidents → redirect to /health-safety/incidents
Result: ERR_TOO_MANY_REDIRECTS
```

**Prevention Checklist:**
1. Choose ONE canonical location
2. Create actual page content there
3. Make ALL other locations redirect TO it (one-way only)
4. Test in browser before deploying

**Verification:**
```bash
# Check for potential circular redirects
grep -r "redirect.*destination" pages/ | grep -E "(health-safety|incidents)"
```
