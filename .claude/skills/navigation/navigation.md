# Navigation Skill

Migrate FibreFlow modules from sidebar sub-items to horizontal tab-based navigation.

## Trigger

Use when user says:
- "migrate [module] to tabs"
- "add tab navigation to [module]"
- "convert [module] sidebar to tabs"
- "/navigation [module]"

## Overview

This skill converts a module's navigation from sidebar sub-items to horizontal tabs at the top of each page. After migration:
- Sidebar shows single module entry (no sub-items)
- Horizontal tabs appear at top of every page in the module
- Each tab navigates to its dedicated URL

## Prerequisites

1. Navigation module exists: `src/modules/navigation/`
2. ModulePage component exists: `src/components/module-page/ModulePage.tsx`
3. Module has pages in `app/(main)/[module]/` or `pages/[module]/`

## Migration Steps

### Step 1: Create Module Navigation Config

Create `src/modules/navigation/config/modules/[module].config.ts`:

```typescript
/**
 * [Module] Module Navigation Config
 * Tab configuration for the [Module] module
 */

import {
  LayoutDashboard,
  // ... other icons
} from 'lucide-react';
import type { ModuleNavigationConfig } from '../../types';

export const [module]Config: ModuleNavigationConfig = {
  moduleId: '[module]',
  moduleName: '[Module Name]',
  description: '[Module description]',
  basePath: '/[module]',
  icon: LayoutDashboard, // Main module icon
  tabs: [
    {
      id: 'dashboard',
      label: 'Dashboard',
      shortLabel: 'Home',
      icon: LayoutDashboard,
      path: '/[module]',
    },
    {
      id: 'sub-page',
      label: 'Sub Page',
      icon: SomeIcon,
      path: '/[module]/sub-page',
      rbacKey: '[module]:sub-page:view', // Optional RBAC
    },
    // ... more tabs
  ],
};
```

### Step 2: Register Config in Registry

Update `src/modules/navigation/config/registry.ts`:

```typescript
import { [module]Config } from './modules/[module].config';

// Add to moduleConfigs map
moduleConfigs.set('[module]', [module]Config);
```

Export from `src/modules/navigation/config/index.ts`:

```typescript
export { [module]Config } from './modules/[module].config';
```

### Step 3: Wrap Each Page with ModulePage

For each client component in the module:

**Before:**
```typescript
export default function SomePageClient() {
  return (
    <div className="...">
      {/* content */}
    </div>
  );
}
```

**After:**
```typescript
import { ModulePage } from '@/components/module-page';
import { [module]Config } from '@/modules/navigation';

export default function SomePageClient() {
  // Optional: header actions for this page
  const headerActions = (
    <button className="...">Action</button>
  );

  return (
    <ModulePage config={[module]Config} headerActions={headerActions}>
      <div className="...">
        {/* content */}
      </div>
    </ModulePage>
  );
}
```

### Step 4: Fix Redirect Pages

If any `page.tsx` uses `redirect()`, change to client component import:

**Before:**
```typescript
import { redirect } from 'next/navigation';

export default function SomePage() {
  redirect('/somewhere-else');
}
```

**After:**
```typescript
export const dynamic = 'force-dynamic';

import SomePageClient from './client';

export default function SomePage() {
  return <SomePageClient />;
}
```

### Step 5: Update Sidebar Config

Update `src/components/layout/sidebar/config/[module]Section.ts`:

**Before (7 items):**
```typescript
export const [module]Section: NavSection = {
  section: '[MODULE]',
  sectionId: '[module]',
  isCollapsible: true,
  items: [
    { to: '/[module]', label: 'Dashboard', ... },
    { to: '/[module]/page1', label: 'Page 1', ... },
    { to: '/[module]/page2', label: 'Page 2', ... },
    // ... more items
  ]
};
```

**After (1 item):**
```typescript
export const [module]Section: NavSection = {
  section: '[MODULE]',
  sectionId: '[module]',
  isCollapsible: false,
  items: [
    {
      to: '/[module]',
      icon: ModuleIcon,
      label: '[Module Name]',
      shortLabel: '[Short]',
      permissions: [],
      rbacKey: '[module].main',
    },
  ]
};
```

## Verification Steps

After migration, verify each tab works:

### Automated Verification (Browser)

1. Navigate to module: `http://localhost:3004/[module]`
2. Take screenshot - verify:
   - Horizontal tabs visible at top
   - Sidebar shows single entry (no sub-items)
3. Click each tab and verify:
   - URL changes to correct path
   - Tab becomes active (highlighted)
   - Page content loads
   - Horizontal tabs still visible

### Verification Checklist

For each tab in the module:

- [ ] Tab visible in horizontal navigation
- [ ] Clicking tab navigates to correct URL
- [ ] Tab shows active state when on that page
- [ ] Page content renders correctly
- [ ] ModulePage wrapper applied (header + tabs visible)
- [ ] Sidebar shows single module entry

### Browser Automation Commands

```javascript
// Get tab context first
mcp__claude-in-chrome__tabs_context_mcp()

// Navigate to module
mcp__claude-in-chrome__navigate({ url: 'http://localhost:3004/[module]', tabId: TAB_ID })

// Take screenshot to verify
mcp__claude-in-chrome__computer({ action: 'screenshot', tabId: TAB_ID })

// Click on a tab (adjust coordinates based on screenshot)
mcp__claude-in-chrome__computer({ action: 'left_click', coordinate: [X, Y], tabId: TAB_ID })
```

## Files to Modify

For a typical migration:

| File | Action |
|------|--------|
| `src/modules/navigation/config/modules/[module].config.ts` | Create |
| `src/modules/navigation/config/registry.ts` | Update |
| `src/modules/navigation/config/index.ts` | Update |
| `app/(main)/[module]/*/client.tsx` | Wrap with ModulePage |
| `app/(main)/[module]/*/page.tsx` | Fix redirects if any |
| `src/components/layout/sidebar/config/[module]Section.ts` | Remove sub-items |

## Commit Message Template

```
feat([module]): migrate to horizontal tab navigation

Replace sidebar sub-items with horizontal tabs at top of page:
- Wrap all [module] pages with ModulePage component
- [list specific pages wrapped]
- Remove N sidebar items, keep single "[Module]" entry
- Horizontal tabs handle: [list tabs]
```

## Troubleshooting

### Tabs not showing
- Verify ModulePage wrapper is applied
- Check config is exported from navigation module
- Ensure page is client component ('use client')

### HMR issues after changes
- Kill dev server: `pkill -f "next.*3004"`
- Clear cache: `rm -rf .next/cache`
- Restart: `PORT=3004 npm run dev`

### Tab navigation not working
- Check tab paths match actual page routes
- Verify useModuleTabs hook is working
- Check browser console for errors

### "Not found" errors on tab click (CRITICAL)
**Symptom:** Clicking tab shows "Project not found" or similar error.

**Root Cause:** Dynamic `[id]` route is catching the named path (e.g., "tasks") as an ID.

**Diagnosis:**
```bash
# Check if explicit page exists for the tab path
ls pages/[module]/tasks.tsx    # Does this file exist?
ls pages/[module]/[id]/        # Does dynamic route exist?
# If [id] exists but tasks.tsx doesn't → BUG!
```

**Fix:** Create explicit page file for each tab:
```typescript
// pages/[module]/tasks.tsx
import type { NextPage } from 'next';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModulePage } from '@/components/module-page';
import { [module]Config } from '@/modules/navigation';

const TasksPage: NextPage = () => {
  return (
    <AppLayout>
      <ModulePage config={[module]Config}>
        {/* Page content */}
      </ModulePage>
    </AppLayout>
  );
};

export default TasksPage;
```

**Prevention:** When adding tabs to navigation config, ALWAYS create the corresponding page files.

## Reference Implementation

See Maintenance module migration:
- Config: `src/modules/navigation/config/modules/maintenance.config.ts`
- Wrapped pages: `app/(main)/maintenance/*/client.tsx`
- Sidebar: `src/components/layout/sidebar/config/maintenanceSection.ts`
- Commit: `96ea3f84` - feat(maintenance): migrate to horizontal tab navigation
