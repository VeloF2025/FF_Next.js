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
<div className="bg-[var(--ff-card-bg)] text-[var(--ff-text-primary)] border-[var(--ff-border-light)]">
```

**CSS Variable Reference:**
| Variable | Light | Dark | Usage |
|----------|-------|------|-------|
| `--ff-bg-primary` | white | gray-900 | Page background |
| `--ff-bg-secondary` | white | gray-800 | Card backgrounds |
| `--ff-card-bg` | white | gray-800 | Card alias |
| `--ff-text-primary` | gray-900 | white | Main text |
| `--ff-text-secondary` | gray-600 | gray-400 | Labels |
| `--ff-border-light` | gray-200 | gray-700 | Borders |

**Reference:** `src/pages/detail/ProjectTimelineTab.tsx` - Fixed 2026-01-27

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
