# Next.js Router Migration Guide: Pages Router → App Router

## Context

FibreFlow is in the middle of migrating from Next.js **Pages Router** (`pages/`) to **App Router** (`app/(main)/`).

**Bug (Fixed Feb 22, 2026):** NotificationsDropdown.tsx in the App Router layout imported from `next/router` (Pages Router), causing "NextRouter not mounted" crash on all `/assets` pages. Fixed by switching to `next/navigation`.

**Remaining Work:** 73 files still import from `next/router`. Most are in Pages Router context and don't need migration yet. However, some modules live in `app/` or are shared across both router contexts and need careful refactoring.

## API Differences

### Simple Replacements (router.push(), router.replace(), router.back())

These methods work identically in both `next/router` and `next/navigation`:

```typescript
// Pages Router
import { useRouter } from 'next/router';
router.push('/path');
router.replace('/path');
router.back();

// App Router (identical methods)
import { useRouter } from 'next/navigation';
router.push('/path');
router.replace('/path');
router.back();
```

**Files in this category:** NotificationsDropdown.tsx (already fixed), GlobalSearch.tsx, and 53 others.

---

### Complex Replacements (router.query, router.pathname, router.asPath, router.isReady)

These properties **DO NOT EXIST** in `next/navigation` useRouter. You must extract them into separate hooks.

#### Pattern 1: router.query → useSearchParams()

**Pages Router:**
```typescript
import { useRouter } from 'next/router';

export function MyComponent() {
  const router = useRouter();
  
  // Access query params
  const { id } = router.query as { id: string };
  const tab = router.query.tab as string || 'default';
  
  // Wait for hydration
  if (!router.isReady) return null;
  
  return <div>{id} / {tab}</div>;
}
```

**App Router:**
```typescript
import { useSearchParams } from 'next/navigation';

export function MyComponent() {
  const searchParams = useSearchParams();
  
  // Access query params (from URL search string)
  const tab = searchParams.get('tab') || 'default';
  
  return <div>{tab}</div>;
}
```

**Key differences:**
- `useSearchParams()` returns the `?key=value` portion of the URL
- No hydration delay (use Suspense boundary if needed for dynamic content)
- Use `useParams()` for dynamic route segments like `[id]`

#### Pattern 2: router.pathname → usePathname()

**Pages Router:**
```typescript
import { useRouter } from 'next/router';

export function MyComponent() {
  const router = useRouter();
  const currentPath = router.pathname; // '/projects/[id]'
  
  return <div>{currentPath}</div>;
}
```

**App Router:**
```typescript
import { usePathname } from 'next/navigation';

export function MyComponent() {
  const pathname = usePathname(); // '/projects/123' (actual path)
  
  return <div>{pathname}</div>;
}
```

**Key differences:**
- `usePathname()` returns the **actual path** (with segments filled in), not the route template
- No `[id]` placeholders — you get `/projects/123` not `/projects/[id]`

#### Pattern 3: Dynamic Route Segments [id]

**Pages Router** — access via `router.query`:
```typescript
import { useRouter } from 'next/router';

export function ProjectDetail() {
  const router = useRouter();
  const { id } = router.query; // undefined until router.isReady
  
  if (!router.isReady) return null;
  return <div>Project: {id}</div>;
}
```

**App Router** — use `useParams()`:
```typescript
import { useParams } from 'next/navigation';

export function ProjectDetail() {
  const { id } = useParams();
  // id is always available, no hydration delay
  return <div>Project: {id}</div>;
}
```

#### Pattern 4: router.asPath → pathname + searchParams

**Pages Router:**
```typescript
import { useRouter } from 'next/router';

export function MyComponent() {
  const router = useRouter();
  
  // asPath = pathname + query string
  // Example: '/projects/123?tab=settings'
  const currentUrl = router.asPath;
}
```

**App Router:**
```typescript
import { usePathname, useSearchParams } from 'next/navigation';

export function MyComponent() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  
  // Reconstruct full URL
  const currentUrl = searchParams.toString()
    ? `${pathname}?${searchParams.toString()}`
    : pathname;
}
```

#### Pattern 5: router.isReady → Suspense

**Pages Router:**
```typescript
import { useRouter } from 'next/router';

export function MyComponent() {
  const router = useRouter();
  
  // Wait for router to hydrate before accessing query params
  if (!router.isReady) return <LoadingSpinner />;
  
  const { id } = router.query;
  return <div>{id}</div>;
}
```

**App Router:**
```typescript
import { Suspense } from 'react';
import { useParams } from 'next/navigation';

function ProjectDetail() {
  const { id } = useParams();
  return <div>{id}</div>;
}

export default function Page() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <ProjectDetail />
    </Suspense>
  );
}
```

---

## Files Needing Migration

### Priority 1: App Router Context (Must Migrate)
- `src/modules/communications/CommunicationsDashboard.tsx` — uses `router.query.tab`, `router.isReady`
- `src/modules/workflow/WorkflowPortalPage.tsx` — uses `router.query.tab`, `router.pathname`
- `src/modules/projects/tracker/UnifiedTrackerGrid.tsx` — uses `router.query.projectId`
- `src/modules/projects/pole-tracker/PoleTrackerDetail.tsx` — uses `router.query.id`
- `src/modules/data-sync/components/DataSyncPage.tsx` — uses `router.query.group`, `router.query.tab`
- `src/modules/projects/sow/components/SOWHeader.tsx` — uses `router.query.projectId`
- `src/modules/projects/components/prereqs/ProjectPrereqs.tsx` — uses `router.query`, `router.pathname`
- `src/modules/pipeline/components/PipelineProjectDetail.tsx` — uses `router.query.id`

### Priority 2: Pages Router Context (Can Stay)
These are in `pages/` or `.disabled` modules, keep `next/router` for now:
- `src/hooks/useNavigation.ts`
- `src/modules/staff/*` (pages-based)
- `src/modules/clients/*` (pages-based)
- `src/modules/procurement/*` (pages-based)
- All files in `src/pages/` directory

### Priority 3: Simple Migrations (Just Import Swap)
- `src/components/search/GlobalSearch.tsx`
- `src/components/layout/header/SearchBar.tsx`
- `src/components/staff/StaffAlertsPanel.tsx`
- And 50+ others that only use `router.push()`, `router.back()`, `router.replace()`

---

## Migration Checklist

For each Priority 1 file:

- [ ] Identify which router properties are used (query, pathname, asPath, isReady, route)
- [ ] Create test cases for current behavior
- [ ] Replace `next/router` with `next/navigation` + appropriate hooks
- [ ] Update `router.query` → `useSearchParams()` or `useParams()`
- [ ] Update `router.pathname` → `usePathname()`
- [ ] Remove `router.isReady` checks → wrap in Suspense if needed
- [ ] Update any `router.push({ pathname, query })` → `router.push(pathname + query string)`
- [ ] Test on dev (port 3005)
- [ ] Test on staging (port 3006)
- [ ] Submit CR to Jarvis for production deployment

---

## Example: CommunicationsDashboard.tsx

**Before (Pages Router):**
```typescript
import { useRouter } from 'next/router';

export function CommunicationsDashboard() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<string>('');

  useEffect(() => {
    if (router.isReady) {
      const tabParam = router.query.tab as string;
      setActiveTab(tabParam || 'inbox');
    }
  }, [router.isReady, router.query.tab]);

  const handleTabChange = (tabName: string) => {
    router.push(`/communications?tab=${tabName}`, undefined, { shallow: true });
  };

  return <TabSelector activeTab={activeTab} onChange={handleTabChange} />;
}
```

**After (App Router):**
```typescript
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useEffect, useState } from 'react';

function CommunicationsDashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [activeTab, setActiveTab] = useState<string>('');

  useEffect(() => {
    const tabParam = searchParams.get('tab') || 'inbox';
    setActiveTab(tabParam);
  }, [searchParams]);

  const handleTabChange = (tabName: string) => {
    router.push(`/communications?tab=${tabName}`);
  };

  return <TabSelector activeTab={activeTab} onChange={handleTabChange} />;
}

export default function CommunicationsDashboard() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <CommunicationsDashboardContent />
    </Suspense>
  );
}
```

---

## Testing Strategy

1. **Unit tests:** Test hooks independently with mock router context
2. **Integration tests:** Test components with Suspense boundaries
3. **E2E tests:** Test navigation flow in actual App Router pages
4. **Regression tests:** Ensure query params still work correctly

---

## References

- [Next.js App Router docs](https://nextjs.org/docs/app)
- [useRouter hook in App Router](https://nextjs.org/docs/app/api-reference/functions/use-router)
- [useSearchParams](https://nextjs.org/docs/app/api-reference/functions/use-search-params)
- [useParams](https://nextjs.org/docs/app/api-reference/functions/use-params)
- [usePathname](https://nextjs.org/docs/app/api-reference/functions/use-pathname)

---

## Notes

- **Status:** In progress. NotificationsDropdown fixed as critical path (Feb 22, 10:30).
- **Safe to deploy:** Simple migrations (import-only changes) for non-complex files
- **Requires care:** Priority 1 files need refactoring, testing, and CR review
- **Pages Router files:** Can remain on `next/router` indefinitely if not used in App Router context
