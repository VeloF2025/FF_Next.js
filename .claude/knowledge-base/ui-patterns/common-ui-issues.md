# Common UI Issues - Audit Patterns

> Issues frequently discovered during UI audits with fixes.

---

## Tab State Not Persisting on Refresh

**Symptom:** User clicks tab, URL updates, but refresh goes back to default tab.

**Root Cause:** Tab state managed with `useState` only, not reading from URL.

**Bad Pattern:**
```typescript
const [activeTab, setActiveTab] = useState('overview');

// URL has ?tab=team but page shows overview tab
```

**Good Pattern:**
```typescript
// Read from URL
const tabFromUrl = router.query.tab as string | undefined;
const activeTab = tabFromUrl || 'overview';

// Update URL on change (shallow = no full reload)
const handleTabChange = (newTab: string) => {
  router.push(
    { pathname: router.pathname, query: { ...router.query, tab: newTab } },
    undefined,
    { shallow: true }
  );
};
```

**Reference:** `src/pages/ProjectDetail.tsx` - Fixed 2026-01-27

---

## API Response Array Safety

**Symptom:** "TypeError: data.filter is not a function" or ".map is not a function"

**Root Cause:** API returned object/null but code assumed array.

**Bad Pattern:**
```typescript
const { data } = useSWR('/api/items', fetcher);
const items = data?.data || [];  // ❌ Still crashes if data.data is object
items.filter(item => ...);
```

**Good Pattern:**
```typescript
const items = Array.isArray(data?.data) ? data.data : [];
items.filter(item => ...);
```

**Common API Response Shapes:**
```typescript
// List endpoint - wrap array check
{ success: true, data: [...] }

// Detail endpoint - no array check needed
{ success: true, data: { id, name, ... } }

// Empty/error - explicit check
{ success: false, error: { message } }
```

---

## Dark Mode Inconsistency

**Symptom:** Component has white background in dark mode.

**Root Cause:** Hardcoded Tailwind colors instead of CSS variables.

**Bad Pattern:**
```tsx
<div className="bg-white text-gray-900 border-gray-200">
```

**Good Pattern:**
```tsx
<div className="bg-[var(--ff-bg-secondary)] text-[var(--ff-text-primary)] border-[var(--ff-border-light)]">
```

**CSS Variable Reference:**
| Variable | Light | Dark | Usage |
|----------|-------|------|-------|
| `--ff-bg-primary` | white | gray-900 | Page background |
| `--ff-bg-secondary` | white | gray-800 | Card backgrounds |
| `--ff-bg-tertiary` | gray-50 | gray-700 | Nested elements, empty states |
| `--ff-text-primary` | gray-900 | white | Main text |
| `--ff-text-secondary` | gray-600 | gray-400 | Labels, descriptions |
| `--ff-text-tertiary` | gray-500 | gray-500 | Subtle text |
| `--ff-border-light` | gray-200 | gray-700 | Borders |
| `--ff-border-medium` | gray-300 | gray-600 | Hover borders |
| `--ff-bg-hover` | gray-100 | gray-700 | Hover states |

**Semi-Transparent Colors for Badges/Icons:**

Instead of solid light backgrounds, use semi-transparent variants for dark theme compatibility:

| Light Pattern | Dark Theme Pattern | Usage |
|---------------|-------------------|-------|
| `bg-blue-50` | `bg-blue-500/20` | Blue icon backgrounds |
| `bg-green-50` | `bg-green-500/20` | Success/verified badges |
| `bg-yellow-50` | `bg-yellow-500/20` | Warning badges |
| `bg-red-50` | `bg-red-500/20` | Error/expired badges |
| `bg-blue-100 text-blue-800` | `bg-blue-500/20 text-blue-400` | Status badges |
| `bg-green-100 text-green-800` | `bg-green-500/20 text-green-400` | Active/approved badges |

**Warning/Alert Banners:**
```tsx
// ❌ Bad - Light theme only
<div className="bg-yellow-50 border-yellow-200 text-yellow-800">

// ✅ Good - Dark theme compatible
<div className="bg-yellow-500/10 border-yellow-500/30 text-yellow-400">
```

**Button Hover States:**
```tsx
// ❌ Bad
<button className="hover:bg-blue-50">

// ✅ Good
<button className="hover:bg-blue-500/10">
```

**Reference:** `app/(main)/contractors/[id]/page.tsx` - Fixed 2026-02-03 (commit `8e3957e8`)

---

## Button Actions Lead to 404

**Symptom:** Edit/Delete/View button navigates to non-existent page.

**Root Cause:** Route doesn't exist (nested dynamic route issue).

**Detection:**
```typescript
// Check if target route file exists
onClick={() => router.push(`/module/${id}/edit`)}  // Does /module/[id]/edit.tsx exist?
```

**Quick Fixes:**

1. **Show notification (interim):**
```typescript
onClick={() => notificationService.info('Feature coming soon')}
```

2. **Use modal instead of navigation:**
```typescript
const [showEditModal, setShowEditModal] = useState(false);
onClick={() => setShowEditModal(true)}
```

3. **Query param edit mode:**
```typescript
onClick={() => router.push(`/module/${id}?mode=edit`)}
// Then in page: const isEdit = router.query.mode === 'edit';
```

**Reference:** `pages/procurement/boq/[id].tsx` - Fixed 2026-01-27

---

## GRN/PO Queries Need Multi-Table JOINs

**Symptom:** "column does not exist" for GRN queries.

**Root Cause:** `goods_receipt_notes` lacks `project_id` and value columns. Must JOIN through `purchase_orders`.

**Table Relationships:**
```
projects
    ↓ project_id
purchase_orders
    ↓ purchase_order_id
goods_receipt_notes
    ↓ grn_id
goods_receipt_items (has total_cost)
```

**Bad Pattern:**
```sql
SELECT project_id, SUM(total_value) FROM goods_receipt_notes
-- ❌ These columns don't exist on GRN table
```

**Good Pattern:**
```sql
SELECT
  COUNT(DISTINCT grn.id) as grn_count,
  COALESCE(SUM(gri.total_cost), 0) as total_value
FROM goods_receipt_notes grn
LEFT JOIN purchase_orders po ON grn.purchase_order_id = po.id
LEFT JOIN goods_receipt_items gri ON gri.grn_id = grn.id
WHERE po.project_id = $1
```

**Reference:** `pages/api/projects/[projectId]/procurement-summary.ts`

---

## Supplier Name Display Issues

**Symptom:** Shows "Unknown Supplier" when data exists.

**Root Cause:** Using wrong column name. Suppliers table has both `name` and `company_name`.

**Pattern:**
```sql
-- Use COALESCE to handle both
COALESCE(s.company_name, s.name, 'Unknown') as supplier_name
```

**Also applies to:** `contractors` table (company_name vs name)

---

## Shared Components Must Be Router-Agnostic

**Symptom:** "NextRouter was not mounted" error when shared component renders in App Router context.

**Root Cause:** Component uses `useRouter` from `next/router` which only works in Pages Router (`pages/`). App Router pages (`app/`) need `next/navigation`.

**Bad Pattern:**
```typescript
// ❌ Crashes in App Router context
import { useRouter } from 'next/router';

const SharedCard = ({ route }: { route?: string }) => {
  const router = useRouter();  // 💥 App Router crash
  return <div onClick={() => router.push(route!)}>...</div>;
};
```

**Good Pattern:**
```typescript
// ✅ next/link works in BOTH router contexts
import Link from 'next/link';

const SharedCard = ({ route, onClick }: Props) => {
  const content = <>{/* card body */}</>;

  if (route) {
    return <Link href={route} className="block no-underline">{content}</Link>;
  }
  return <div onClick={onClick}>{content}</div>;
};
```

**Rule:** Shared components in `src/components/` must NEVER import from `next/router` or `next/navigation`. Use `next/link` Link for navigation.

**Reference:** `src/components/dashboard/EnhancedStatCard.tsx` - Fixed 2026-01-27 (commit `98f82be1`)

---

## Dashboard Stat Cards Must Use EnhancedStatCard

**Standard:** ALL module dashboards must use `EnhancedStatCard` + `StatsGrid` from `@/components/dashboard/EnhancedStatCard`.

**Pattern:**
```typescript
import { StatsGrid } from '@/components/dashboard/EnhancedStatCard';
import type { EnhancedStatCardProps } from '@/components/dashboard/EnhancedStatCard';

<StatsGrid
  cards={[
    {
      title: 'Card Title',
      value: 42,
      icon: IconComponent,    // From lucide-react
      color: '#3B82F6',       // Hex color for top bar + icon badge
      subtitle: 'Short label',
      description: 'Longer description text',
      route: '/module/page',  // Optional navigation
      variant: 'detailed',    // Shows subtitle + description
    },
  ] as EnhancedStatCardProps[]}
  columns={4}               // 2-6 columns
/>
```

**Card Visual Structure:**
- Colored top bar (h-1, uses `color` prop)
- Colored icon badge (w-12 h-12 rounded-lg, uses `color` prop)
- Title + subtitle + value + description
- Hover: shadow + blue border

**Color Palette (commonly used):**
| Color | Hex | Usage |
|-------|-----|-------|
| Blue | `#3B82F6` | Primary/total counts |
| Green | `#10B981` | Active/success/compliant |
| Yellow | `#F59E0B` | Warning/pending/unassigned |
| Red | `#EF4444` | Error/overdue/critical |
| Purple | `#8B5CF6` | Special/locations/departments |
| Gray | `#6B7280` | Inactive/former |

**Modules using EnhancedStatCard (2026-01-27):**
Dashboard, Fleet, Staff, H&S, Activate, Maintenance

**Reference:** Commit `98f82be1` - Router-agnostic fix

---

## Quick Actions Position: After Header

**Symptom:** Quick Action buttons are at the bottom of the page, invisible without scrolling.

**Root Cause:** Quick Actions rendered after all dashboard content instead of near the top.

**Pattern:** Quick Actions should appear immediately after the module header/stats, before main content.

```tsx
<ModulePage config={moduleConfig}>
  {/* 1. Quick Actions - RIGHT AFTER HEADER */}
  <div className="flex gap-3">
    <Link href="/module/new" className="...">+ New Item</Link>
  </div>

  {/* 2. Stats Cards */}
  <StatsGrid cards={[...]} columns={4} />

  {/* 3. Main Content */}
  <div>...</div>
</ModulePage>
```

**Reference:** Commit `b62421d0` - Fixed procurement Quick Actions position

---

## Toast Notification Patterns

**Symptom:** Red error toast for expected behaviors like session timeout.

**Rule:** Use appropriate toast types based on what happened:

| Scenario | Toast Type | Example |
|----------|------------|---------|
| Error (user should worry) | `toast.error()` | "Failed to save changes" |
| Success | `toast.success()` | "Changes saved" |
| Info/Expected behavior | `toast()` with custom style | "Session timed out" |
| Warning | `toast()` with amber style | "Low disk space" |

**Session Timeout Pattern:**
```typescript
// ❌ BAD - treats expected behavior as error
toast.error('Your session has expired. Please sign in again.');

// ✅ GOOD - neutral notification for expected behavior
toast('Session timed out. Redirecting to sign in...', {
  duration: 3000,
  icon: '⏱️',
  style: {
    background: '#374151', // gray-700
    color: '#f9fafb',      // gray-50
    borderRadius: '8px',
  },
});
```

**Reference:** `src/lib/authErrorHandler.ts` - Fixed 2026-01-28

---

## Modal Background Bleed-Through

**Symptom:** Modal content shows page content bleeding through the modal card background.

**Root Cause:** Incorrect modal structure with separate backdrop div causing z-index stacking issues, or using wrong CSS variable (`--ff-card-bg` which may be transparent).

**Bad Pattern:**
```tsx
// ❌ Three-level nesting with separate backdrop
<div className="fixed inset-0 z-50 overflow-y-auto">
  <div className="fixed inset-0 bg-black/50" onClick={onClose} />
  <div className="flex min-h-full items-center justify-center p-4">
    <div className="relative w-full max-w-xl bg-[var(--ff-card-bg)] ...">
```

**Good Pattern:**
```tsx
// ✅ Two-level: combined backdrop + modal as direct child
<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
  <div className="bg-[var(--ff-bg-primary)] rounded-lg shadow-xl w-full max-w-xl mx-4 max-h-[90vh] overflow-hidden flex flex-col">
    {/* Header */}
    <div className="flex items-center justify-between p-4 border-b border-[var(--ff-border-light)] shrink-0">
    {/* Content */}
    <div className="p-4 space-y-4 overflow-y-auto">
    {/* Footer */}
    <div className="flex items-center justify-end gap-3 p-4 border-t border-[var(--ff-border-light)]">
```

**Key Points:**
- Use `bg-[var(--ff-bg-primary)]` for solid background (NOT `--ff-card-bg`)
- Modal card is DIRECT CHILD of backdrop container
- `flex-col` with `shrink-0` header and footer, scrollable content area

**Reference:** `src/pages/detail/LinkPipelineModal.tsx`, `DocumentVerificationModal.tsx` - Fixed 2026-02-03

---

## Neon Array Handling in SQL Queries

**Symptom:** "This function can now be called only as a tagged-template function" error.

**Root Cause:** Using `sql(array)` function call inside tagged template. Neon's `sql` must be used as tagged template literal only.

**Bad Pattern:**
```typescript
// ❌ Calling sql() as function inside template
const excludeIds = ['uuid1', 'uuid2'];
const results = await sql`
  SELECT * FROM items WHERE id NOT IN ${sql(excludeIds)}
`;
```

**Good Pattern:**
```typescript
// ✅ Use ANY() with array parameter
const excludeIds = ['uuid1', 'uuid2'];
const results = await sql`
  SELECT * FROM items WHERE NOT (id = ANY(${excludeIds}))
`;
```

**Alternative - Separate Branches:**
```typescript
// When array might be empty, use explicit branches
if (excludeIds.length > 0) {
  results = await sql`
    SELECT * FROM items WHERE NOT (id = ANY(${excludeIds}))
  `;
} else {
  results = await sql`SELECT * FROM items`;
}
```

**Reference:** `pages/api/pipeline/projects/search.ts` - Fixed 2026-02-03

---

## Audit Checklist

When auditing a page, check:

- [ ] Tabs persist on refresh (URL query params)
- [ ] All action buttons work (Edit, Delete, View)
- [ ] Dark mode styling consistent
- [ ] API errors handled gracefully
- [ ] Loading states present
- [ ] Empty states present
- [ ] Links navigate to correct pages
- [ ] Forms validate and submit
- [ ] Modals open and close properly
- [ ] List data displays correctly
- [ ] Stat cards use EnhancedStatCard + StatsGrid
- [ ] Shared components don't import from next/router
- [ ] Quick Actions positioned after header, not at bottom
