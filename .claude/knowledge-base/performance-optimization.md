# Performance Optimization Patterns

> Proven optimization techniques for FibreFlow Next.js application.

---

## next.config.js Critical Settings

### Do NOT Set
```javascript
// NEVER use these - they disable critical optimizations:
disableOptimizedLoading: true    // Blocks script load optimization
```

### Must Configure
```javascript
experimental: {
  optimizePackageImports: [
    '@tanstack/react-query',
    'react-icons',
    'lucide-react',
    'date-fns',
    'zod',
    'react-hot-toast',
    '@heroicons/react',
  ],
},
```

### Do NOT Customize
```javascript
// Let Next.js handle chunk splitting - its defaults are well-optimized.
// Custom splitChunks that create per-package chunks cause excessive HTTP requests.
// webpack: (config) => { config.optimization.splitChunks = ... }  // DON'T
```

**Reference:** Commit `7a775992` — `_app` chunk 52K → 30.8K (40% reduction)

---

## API Query Parallelization

### Pattern: All Independent Queries
When queries don't depend on each other, use `Promise.all`:

```typescript
// ❌ BAD: Sequential (~1.2s for 3 queries)
const a = await sql`SELECT ...`;
const b = await sql`SELECT ...`;
const c = await sql`SELECT ...`;

// ✅ GOOD: Parallel (~473ms, 2.6x faster)
const [a, b, c] = await Promise.all([
  sql`SELECT ...`,
  sql`SELECT ...`,
  sql`SELECT ...`,
]);
```

### Pattern: Two-Batch (Conditional Dependencies)
When some queries depend on results of others:

```typescript
// Batch 1: Independent queries + condition checks
const [tableCheck, statsA, statsB, statsC] = await Promise.all([
  sql`SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'my_table')`,
  sql`SELECT COUNT(*) FROM other_table`,
  sql`SELECT AVG(score) FROM scores`,
  sql`SELECT MAX(date) FROM logs`,
]);

const hasTable = tableCheck[0]?.exists;

// Batch 2: Only run if condition met
if (hasTable) {
  const [resultA, resultB] = await Promise.all([
    sql`SELECT ... FROM my_table WHERE ...`,
    sql`SELECT ... FROM my_table GROUP BY ...`,
  ]);
}
```

### Neon Serverless Compatibility
Dynamic SQL fragments work correctly inside Promise.all:
```typescript
const [a, b] = await Promise.all([
  sql`SELECT * FROM table WHERE active = true
    ${project_id ? sql`AND project_id = ${project_id}` : sql``}`,
  sql`SELECT COUNT(*) FROM table
    ${status ? sql`WHERE status = ${status}` : sql``}`,
]);
```

### Parallelized Routes (as of 2026-01-31)

| Route | Queries | Pattern | Commit |
|-------|---------|---------|--------|
| `procurement/metrics/aggregate.ts` | 10 | Single batch | `7a775992` |
| `projects/[projectId]/procurement-summary.ts` | 4 | Single batch (after projectExists) | `7a775992` |
| `health-safety/dashboard.ts` | 12 | Two batches (10 + 2 conditional) | `f2de1714` |
| `system/stats.ts` | 9+3 | Single batch (getTodayStats internal) | `fca9bdaf` |

---

## Identifying Sequential Query Bottlenecks

### How to Find
```bash
# Find API routes with multiple sequential awaits
grep -rn "await sql\`\|await db.query" pages/api/ | \
  awk -F: '{print $1}' | sort | uniq -c | sort -rn | head -20
```

Look for files with 4+ sequential `await` calls on independent queries.

### Verification Pattern
1. **Build test:** `npm run build` — must pass
2. **DB query test:** Run queries directly against Neon with `node -e` script
3. **Deploy:** Push to dev.fibreflow.app
4. **Browser verify:** Load the page, check data matches, check console for errors

---

## Barrel Import Optimization

### When It Matters
- **Production builds:** Next.js tree-shakes unused exports — barrel impact is minimal
- **Dev mode (HMR):** No tree-shaking — barrels pull in everything, slowing HMR
- **npm packages:** Use `optimizePackageImports` in next.config.js (high impact)
- **Internal barrels:** Lower priority — focus on packages first

### When NOT Worth Refactoring
- Dead barrels (0 imports) — no performance impact, just dead code
- Barrels used by many files (19+ imports) — high risk, marginal production gain
- Type-only barrels — types are erased at compile time, zero runtime cost

### Red Flags to Watch
- `export *` from large modules (50+ exports)
- Barrel chains: `index.ts` → re-exports from another `index.ts`
- Importing 1 item from a barrel that exports 25+

---

## Dev Server Deployment

### Permission Issues with `.next`
```bash
# Always clean with sudo on Velocity server
echo '$VELO_SSH_PASSWORD' | sudo -S rm -rf .next
echo '$VELO_SSH_PASSWORD' | sudo -S chown -R velo:velo .
mkdir -p .next
npm run build
```

### Build Cache Corruption
If build produces stale output:
```bash
rm -rf .next node_modules/.cache
npm run build
```

---

## Performance Measurement

### Bundle Size
```bash
# Check _app chunk size (should be ~30K)
npm run build 2>&1 | grep "_app"
```

### API Response Time
```bash
# Test query performance directly against Neon
DATABASE_URL='...' node -e "
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
const start = Date.now();
// ... run queries ...
console.log('Time:', (Date.now() - start) + 'ms');
"
```
