# Router Migration — Remaining 13 Files (15% to Completion)

## Status Summary

- **Completed:** 60/73 files (82%)
- **Remaining:** 13 files (18%)
- **Blocked by:** Pages Router context or complex dependencies

## Files by Migration Pattern Required

### Pattern A: router.query Only (5 files) — SIMPLEST
These files only use `router.query` for dynamic parameters. No pathname or asPath usage.

```
src/components/auth/premium/PremiumLoginPage.tsx
src/modules/clients/components/ClientForm.tsx
src/modules/staff/components/StaffForm.tsx
src/modules/staff/components/StaffEditForm.tsx
src/modules/sow/SOWImportPage.tsx
```

**Migration:**
```typescript
// Before
import { useRouter } from 'next/router';
const { returnUrl } = router.query;

// After
import { useRouter, useSearchParams, useParams } from 'next/navigation';
const searchParams = useSearchParams();
const returnUrl = searchParams.get('returnUrl'); // if query string
// OR
const { id } = useParams(); // if dynamic segment
```

**Effort:** 15 min each

---

### Pattern B: router.query + router.asPath (3 files) — MEDIUM
These files use both query params and asPath (full URL with query string).

```
src/modules/clients/components/ClientDetail.tsx
src/modules/staff/components/StaffDetail.tsx
src/modules/sow/SOWImportPage.tsx
```

**Migration:**
```typescript
// Before
import { useRouter } from 'next/router';
const { id } = router.query;
const currentUrl = router.asPath;

// After
import { useRouter, useParams, useSearchParams, usePathname } from 'next/navigation';
const { id } = useParams();
const pathname = usePathname();
const searchParams = useSearchParams();
const currentUrl = searchParams.toString()
  ? `${pathname}?${searchParams.toString()}`
  : pathname;
```

**Effort:** 20 min each

---

### Pattern C: router.pathname + router.query (2 files) — MEDIUM
These files track pathname and query separately.

```
src/modules/projects/components/prereqs/ProjectPrereqs.tsx
src/pages/ProjectDetail.tsx
```

**Migration:**
```typescript
// Before
import { useRouter } from 'next/router';
const tabFromUrl = router.query.tab;
if (tabFromUrl) {
  router.push({
    pathname: router.pathname,
    query: { ...router.query, tab: newTab }
  });
}

// After
import { useRouter, useSearchParams, usePathname } from 'next/navigation';
const searchParams = useSearchParams();
const tabFromUrl = searchParams.get('tab');
const pathname = usePathname();
if (tabFromUrl) {
  const newParams = new URLSearchParams(searchParams);
  newParams.set('tab', newTab);
  router.push(`${pathname}?${newParams.toString()}`);
}
```

**Effort:** 25 min each

---

### Pattern D: router.isReady (1 file) — MEDIUM
Checks router hydration (not needed in App Router).

```
src/modules/procurement/hooks/useTabPersistence.ts
```

**Migration:**
```typescript
// Before
import { useRouter } from 'next/router';
useEffect(() => {
  if (!router.isReady) return;
  const urlTab = router.query.tab;
  // ...
}, [router.isReady, router.query.tab]);

// After
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
useEffect(() => {
  const urlTab = searchParams.get('tab');
  // ...
}, [searchParams]);

// Wrap in Suspense if needed for async data
export function ComponentWrapper() {
  return (
    <Suspense fallback={<Loading />}>
      <YourComponent />
    </Suspense>
  );
}
```

**Effort:** 20 min

---

### Pattern E: router.pathname + router.asPath (2 files) — COMPLEX
These files use pathname and full URL path together.

```
src/modules/navigation.disabled/context/NavigationContext.tsx
src/modules/navigation.disabled/hooks/useModuleTabs.ts
```

**Note:** These are in `navigation.disabled` module — check if still actively used before migrating.

**Migration:**
```typescript
// Before
import { useRouter } from 'next/router';
const currentPath = router.pathname;
const activeSubTab = getActiveSubTabByPath(config, activeTab, router.asPath);

// After
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
const pathname = usePathname();
const searchParams = useSearchParams();
const asPath = searchParams.toString()
  ? `${pathname}?${searchParams.toString()}`
  : pathname;
const activeSubTab = getActiveSubTabByPath(config, activeTab, asPath);
```

**Effort:** 20 min each

---

### Pattern F: All Four (router.query, router.pathname, router.asPath, router.isReady) — COMPLEX

```
src/hooks/useNavigation.ts
```

This is a **shared hook** that wraps the Pages Router API. Either:

**Option 1: Keep as Pages Router hook**
- Keep it as-is with `next/router`
- Use only in Pages Router (`pages/`) context
- Create App Router equivalent if needed in App Router context

**Option 2: Complete refactor to App Router**
- Replace with exported function using `useSearchParams`, `usePathname`, etc.
- No Suspense needed (App Router always has params available)
- Break out into smaller utilities

**Recommended:** Option 1 (keep as Pages Router hook)
- This allows Pages Router code to continue working
- Create `src/hooks/useNavigationAppRouter.ts` if App Router version needed
- Less risky than breaking all Pages Router consumers

**Effort:** 30 min (Option 1: keep) or 1 hour (Option 2: refactor)

---

## Completion Strategy

### Tier 1: Quick Wins (Can do in parallel)
- **Pattern A** (5 files) — 15 min each = 75 min total
- **Pattern B** (3 files) — 20 min each = 60 min total
- **Total: 135 min (~2.5 hours for 8 files)**

### Tier 2: Medium Complexity
- **Pattern C** (2 files) — 25 min each = 50 min
- **Pattern D** (1 file) — 20 min
- **Pattern E** (2 files) — 20 min each = 40 min
- **Total: 110 min (~2 hours for 5 files)**

### Tier 3: Complex/Risky
- **Pattern F** (1 file) — 30 min (keep) or 1 hour (refactor)
- **Decision needed** on `useNavigation.ts` strategy

---

## Testing Strategy for Remaining Files

After migrating each file:

1. **Check for runtime errors:**
   ```bash
   npm run test -- <file>.test.ts --run
   npm run dev  # Test in dev mode (port 3005)
   ```

2. **Verify parameter passing:**
   - Check that query params are read correctly
   - Check that navigation updates URL correctly
   - Test with multiple parameters (if applicable)

3. **Verify no regressions:**
   - If migrating a component in Pages Router context, test in Pages Router
   - If migrating a component in App Router context, test in App Router
   - Test both navigation into and out of the component

---

## Files by Context

**Pages Router (keep next/router):**
```
src/pages/ProjectDetail.tsx
src/modules/staff/components/StaffDetail.tsx
src/modules/staff/components/StaffForm.tsx
src/modules/staff/components/StaffEditForm.tsx
src/modules/clients/components/ClientForm.tsx
src/modules/clients/components/ClientDetail.tsx
```

**App Router (migrate to next/navigation):**
```
src/modules/projects/components/prereqs/ProjectPrereqs.tsx
src/modules/sow/SOWImportPage.tsx
src/modules/procurement/hooks/useTabPersistence.ts
src/components/auth/premium/PremiumLoginPage.tsx
```

**Decision Needed:**
```
src/modules/navigation.disabled/* — Check if actively used
src/hooks/useNavigation.ts — Keep (Pages) or refactor (App)?
```

---

## Quick Reference: Which Pattern Does My File Need?

```
Does your file use router.query?
  ✓ Yes → Check for router.pathname or router.asPath
    ├─ No other router usage → Pattern A (simplest)
    ├─ Also uses router.asPath → Pattern B
    └─ Also uses router.pathname → Pattern C
    
  Does your file use router.pathname?
    ├─ Yes (with query) → Pattern C
    ├─ Yes (without query, check for asPath)
    │   ├─ Also uses asPath → Pattern E
    │   └─ asPath only → Pattern E
    └─ No → go back to router.query check

Does your file use router.isReady?
  ✓ Yes → Pattern D (remove check, use Suspense if needed)

Does your file use all four (query, pathname, asPath, isReady)?
  ✓ Yes → Pattern F (complex, decide keep/refactor)
```

---

## Estimated Total Effort

- **Tier 1 (8 files):** 2.5 hours
- **Tier 2 (5 files):** 2 hours  
- **Tier 3 (1 file):** 0.5 hours (keep) or 1 hour (refactor)
- **Total: 5-6 hours of work**

Can be split across multiple sessions/developers. All 8 Tier 1 files are independent and can be done in parallel.

---

## Reference Links

- **Main strategy:** `docs/ROUTER-MIGRATION-GUIDE.md`
- **Worked examples:** See commits 31a887cf, 972230cc, ffe933ac, c2f2925d
- **Test utilities:** `tests/utils/api-mocks.ts`
