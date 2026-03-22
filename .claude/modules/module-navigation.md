# Module Navigation — Horizontal Nav Bar Pattern

## Standard Pattern (Mandatory for Multi-Page Modules)

Every module with **3+ pages** MUST use an AppLayout-level horizontal nav bar with Sage-style dropdown menus. This is the standard navigation pattern going forward.

## Architecture

```
src/components/layout/ModuleNav.tsx          ← Generic shared component (DO NOT COPY)
src/components/{module}/{module}NavConfig.ts  ← Tab definitions + route matching
src/components/{module}/{Module}Nav.tsx       ← Thin wrapper (~11 lines)
src/components/layout/AppLayout.tsx           ← Renders correct nav based on pathname
```

### How It Works

1. **`ModuleNav`** is a generic component that renders a horizontal tab bar with flyout dropdown menus. It accepts `tabs`, `getActiveTabId`, and `accentColor` props.
2. Each module creates a **config file** defining its tabs and a **thin wrapper** passing config + accent color.
3. **`AppLayout`** detects the current pathname and conditionally renders the correct nav bar.
4. Pages just use `<AppLayout>` — navigation is automatic.

## Current Modules

| Module | Accent Color | Detection | Config File |
|--------|-------------|-----------|-------------|
| Accounting | emerald | `/accounting` | `accountingNavConfig.ts` |
| Procurement | blue | `/procurement` | `procurementNavConfig.ts` |
| Fleet | amber | `/fleet` | `fleetNavConfig.ts` |
| SOW | teal | `/sow` | `sowNavConfig.ts` |
| Analytics | violet | `/analytics`, `/enhanced-kpis`, `/kpi-dashboard`, `/reports` | `analyticsNavConfig.ts` |
| System | slate | `/system`, `/settings`, `/deployment` | `systemNavConfig.ts` |

## Adding a New Module Nav

### Step 1: Create config (`src/components/{module}/{module}NavConfig.ts`)

```typescript
import type { Tab } from '../accounting/accountingNavConfig';
export type { Tab, DropdownItem, FlyoutSection, NavItem } from '../accounting/accountingNavConfig';
export { isFlyout, isLinkActive } from '../accounting/accountingNavConfig';

export const TABS: Tab[] = [
  { id: 'dashboard', label: 'Dashboard', href: '/mymodule' },
  {
    id: 'section', label: 'Section',
    topItems: [
      { label: 'Quick Action', href: '/mymodule/new' },
    ],
    items: [
      {
        section: 'Category',
        items: [
          { label: 'Page A', href: '/mymodule/page-a' },
          { label: 'Page B', href: '/mymodule/page-b' },
        ],
      },
    ],
  },
];

export function getActiveTabId(
  pathname: string,
  query: Record<string, string | string[] | undefined>,
): string {
  if (pathname === '/mymodule') return 'dashboard';
  if (pathname.startsWith('/mymodule/page-a')) return 'section';
  void query;
  return 'dashboard';
}
```

### Step 2: Create wrapper (`src/components/{module}/{Module}Nav.tsx`)

```typescript
import { ModuleNav } from '../layout/ModuleNav';
import { TABS, getActiveTabId } from './{module}NavConfig';

export function {Module}Nav() {
  return <ModuleNav tabs={TABS} getActiveTabId={getActiveTabId} accentColor="{color}" />;
}
```

### Step 3: Wire into AppLayout

In `src/components/layout/AppLayout.tsx`:

1. Add dynamic import at top:
```typescript
const MyModuleNav = dynamic(() => import('@/components/{module}/{Module}Nav').then(mod => ({ default: mod.{Module}Nav })), { ssr: false });
```

2. Add pathname detection:
```typescript
const isMyModule = p.startsWith('/mymodule');
```

3. Add render in JSX (after existing nav bars):
```typescript
{isMyModule && <MyModuleNav />}
```

## Available Accent Colors

`emerald` | `blue` | `amber` | `teal` | `violet` | `slate` | `rose` | `cyan`

Defined in `ModuleNav.tsx` as `AccentColor` type with pre-written Tailwind classes (not dynamic — avoids purge issues).

## Tab Types

- **Direct link**: `{ id, label, href }` — simple navigation
- **Flat dropdown**: `{ id, label, items: DropdownItem[] }` — list of links
- **Flyout dropdown**: `{ id, label, topItems?, items: FlyoutSection[] }` — sections with chevron sub-menus, up to 3 levels deep

## Multi-Prefix Detection

For modules with pages spread across multiple route prefixes (e.g. Analytics has `/analytics`, `/reports`, `/enhanced-kpis`):

```typescript
const isAnalytics = ['/analytics', '/enhanced-kpis', '/kpi-dashboard', '/reports']
  .some(prefix => p.startsWith(prefix));
```

## Rules

- **DO NOT copy-paste `ModuleNav.tsx`** — always use the generic component via thin wrapper
- **DO NOT add manual tab/nav components to individual pages** — AppLayout handles it
- **DO NOT use dynamic Tailwind classes** (e.g. `` `text-${color}-400` ``) — use the `ACCENT_CLASSES` map
- All shared types (`Tab`, `DropdownItem`, `FlyoutSection`, `NavItem`) are defined in `accountingNavConfig.ts` and re-exported by each module config
- Config files should be under 200 lines, wrapper files ~11 lines

## Key Files

| File | Purpose |
|------|---------|
| `src/components/layout/ModuleNav.tsx` | Generic nav component (262 lines) |
| `src/components/layout/AppLayout.tsx` | Central wiring — renders nav by pathname |
| `src/components/accounting/accountingNavConfig.ts` | Canonical type definitions |
