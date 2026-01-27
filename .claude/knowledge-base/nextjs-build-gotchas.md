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
