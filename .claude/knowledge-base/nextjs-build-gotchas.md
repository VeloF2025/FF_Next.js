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
4. `.next` directory permission issues on Velocity server (different users running build)

**Nuclear Option:**
```bash
rm -rf .next node_modules/.cache
npm run build
```

**Velocity Server (permissions issue):**
```bash
echo 'velo2026' | sudo -S rm -rf .next
echo 'velo2026' | sudo -S chown -R velo:velo .
mkdir -p .next
npm run build
```

**When to Suspect Cache Issues:**
- Build succeeds but behavior doesn't match source
- TypeScript errors appear that shouldn't exist
- Chunks reference deleted files
- `ENOENT: no such file or directory` errors during build on server
- `Build directory is not writeable` errors

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

---

## API Exporting Wrong Function

**Severity:** CRITICAL - endpoint completely broken with no obvious errors

**Problem:** API file exports a helper function instead of the handler.

**Example:**
```typescript
// pages/api/my-api.ts

// Helper function
async function validateInput(data: any): Promise<boolean> { ... }

// Actual handler
async function handler(req: NextApiRequest, res: NextApiResponse) { ... }

// WRONG - exports helper instead of handler!
export default withAuth(validateInput);
```

**Symptoms:**
- Endpoint times out or returns unexpected results
- No compile errors, no runtime errors
- Appears to "work" but does nothing useful
- Very difficult to debug

**Why TypeScript Doesn't Catch This:**
- Both are async functions
- Both are valid exports
- Type checking passes

**Quick Diagnosis:**
```bash
# Always check the export line
tail -5 pages/api/your-api.ts

# Should see: export default withAuth(handler);
# NOT: export default withAuth(someHelper);
```

**Prevention:**
1. Always name the main handler `handler`
2. Keep export at very end of file
3. Visual check before committing
4. Actually test the endpoint after changes

**Reference:** Commit `4af1d20b` - OCR preview was exporting `detectImageOrientation` instead of `handler`

---

## Dynamic Routes Catch Named Paths

**Severity:** HIGH - causes "not found" errors for valid routes

**Problem:** Dynamic `[id]` routes catch named URL segments when explicit files don't exist.

**Example:**
```
pages/projects/
├── [id]/
│   └── index.tsx       # Dynamic route
└── index.tsx           # Landing page

# URL: /projects/tasks
# Expected: Tasks page
# Actual: [id] catches "tasks" → queries for project id="tasks" → "Project not found"
```

**Why This Happens:**
Next.js route priority:
1. Exact match files (`/projects/tasks.tsx`)
2. Dynamic routes (`/projects/[id]/`)

If no explicit file exists, dynamic route catches EVERYTHING including words like "tasks", "reports", "settings".

**Quick Diagnosis:**
```bash
# Check for the bug pattern
ls pages/module-name/           # Does [id] directory exist?
ls pages/module-name/[id]/      # Yes? Then explicit files needed for named routes

# If navigation config has these tabs but no explicit files → BUG:
grep -r "path.*'/projects/" src/modules/navigation/
```

**Fix:** Create explicit page files for every named route:
```
pages/projects/
├── [id]/              # Dynamic (catches UUIDs)
├── tasks.tsx          # ✅ Explicit - "tasks" won't hit [id]
├── reports.tsx        # ✅ Explicit - "reports" won't hit [id]
├── progress.tsx       # ✅ Explicit - "progress" won't hit [id]
└── index.tsx
```

**Prevention:**
1. When adding navigation tabs, CREATE the actual page files
2. When creating `[id]` directory, audit all sibling routes
3. Test every sidebar/tab link before deploying

**Reference:** Commit `fb51b13c` - fix(routing): add missing project pages
