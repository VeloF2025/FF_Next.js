# Theme Audit Skill

## Overview
FibreFlow uses CSS custom properties for theming with light mode as default and dark mode via `[data-theme="dark"]` or `.dark` class. This skill covers auditing both themes for visual consistency.

## Theme Variables Location
`styles/design-system.css`

## Light Theme Variables (Default)
```css
:root {
  /* Backgrounds */
  --ff-bg-primary: #ffffff;
  --ff-bg-secondary: #f9fafb;
  --ff-bg-tertiary: #f3f4f6;
  --ff-bg-card: #ffffff;

  /* Text */
  --ff-text-primary: #111827;
  --ff-text-secondary: #6b7280;
  --ff-text-tertiary: #9ca3af;

  /* Borders */
  --ff-border-light: #e5e7eb;
  --ff-border-medium: #d1d5db;
  --ff-border-strong: #9ca3af;

  /* Shadows */
  --ff-shadow-sm: 0 1px 2px 0 rgba(0, 0, 0, 0.05);
  --ff-shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
}
```

## Dark Theme Variables
```css
:root[data-theme="dark"], .dark {
  --ff-bg-primary: #0f172a;
  --ff-bg-secondary: #1e293b;
  --ff-bg-tertiary: #334155;
  --ff-bg-card: #1e293b;
  --ff-bg-hover: #475569;

  --ff-text-primary: #f1f5f9;
  --ff-text-secondary: #e2e8f0;
  --ff-text-tertiary: #94a3b8;

  --ff-border-light: #334155;
  --ff-border-medium: #475569;
  --ff-border-strong: #64748b;
}
```

## Theme Toggle Location
Header component at `src/components/layout/Header.tsx`:
- Dropdown selector with options: Light, Dark, VELOCITY, FibreFlow, System
- Theme stored in localStorage and applied via ThemeContext

## Visual Audit Checklist

### Light Theme Critical Checks
1. **Text Contrast** - All text readable against light backgrounds
2. **Card Borders** - Cards distinguishable from background
3. **Form Inputs** - Input fields have visible borders and focus states
4. **Status Badges** - All status colors visible (green, yellow, red, blue, purple)
5. **Icons** - Lucide icons visible in secondary/tertiary colors
6. **Dropdowns** - Select options readable with good contrast
7. **Tables** - Row borders and hover states visible
8. **Buttons** - Primary and secondary buttons distinguishable

### Dark Theme Critical Checks
1. **Text Contrast** - Light text readable on dark backgrounds
2. **Card Backgrounds** - Cards visible against page background
3. **Form Inputs** - `color-scheme: dark` applied for native controls
4. **Date Pickers** - Calendar icons inverted (filter: invert(1))
5. **Select Options** - Dark background with light text
6. **Autofill** - Custom `-webkit-autofill` styles for dark backgrounds

## Common Issues

### Issue: White flash on page load (dark mode)
**Fix:** Set initial theme in `_document.tsx`:
```tsx
<script dangerouslySetInnerHTML={{
  __html: `(function(){
    const t=localStorage.getItem('theme');
    if(t==='dark')document.documentElement.classList.add('dark');
  })();`
}} />
```

### Issue: Select/date inputs show white in dark mode
**Fix:** Already handled in `design-system.css`:
```css
.dark select { color-scheme: dark; background-color: #334155; }
```

### Issue: Hydration mismatch with theme state
**Fix:** Use `isHydrated` pattern:
```tsx
const [isHydrated, setIsHydrated] = useState(false);
useEffect(() => setIsHydrated(true), []);
// Only access localStorage after hydration
```

### Issue: Text invisible on same-color background
**Fix:** Use CSS variables consistently:
```tsx
// BAD
<p className="text-gray-700">...</p>

// GOOD
<p className="text-[var(--ff-text-primary)]">...</p>
```

## Browser Audit Using Claude in Chrome

### Setup
```typescript
// Get tab context first
mcp__claude-in-chrome__tabs_context_mcp({ createIfEmpty: true })

// Navigate to staging
mcp__claude-in-chrome__navigate({ url: "https://vf.fibreflow.app", tabId: X })
```

### Toggle Theme via Browser
```typescript
// 1. Take snapshot to find theme toggle
mcp__claude-in-chrome__read_page({ tabId: X, filter: "interactive" })

// 2. Click user avatar/menu to open theme selector
mcp__claude-in-chrome__computer({ action: "left_click", coordinate: [X, Y], tabId: T })

// 3. Select Light/Dark from dropdown
mcp__claude-in-chrome__find({ query: "Light theme option", tabId: T })
mcp__claude-in-chrome__computer({ action: "left_click", ref: "ref_X", tabId: T })
```

### Visual Audit Steps
```typescript
// 1. Take screenshot
mcp__claude-in-chrome__computer({ action: "screenshot", tabId: T })

// 2. Navigate to each page
const pagesToAudit = [
  "/dashboard",
  "/projects",
  "/staff",
  "/ticketing",
  "/procurement",
  "/clients",
  "/staff/new"  // Test forms
];

// 3. For each page:
// - Navigate
// - Take screenshot
// - Check for contrast issues visually
// - Check console for errors
```

### Check for Errors
```typescript
mcp__claude-in-chrome__read_console_messages({
  tabId: T,
  pattern: "error|warning|hydration"
})
```

## Pages to Audit
1. **Dashboard** - Stats cards, quick actions, charts
2. **Projects** - Table, filters, status badges
3. **Staff** - List view, stats, action buttons
4. **Ticketing** - Kanban columns, ticket cards, priority badges
5. **Procurement** - Tabs, project filter dropdown, tables
6. **Clients** - Stats cards, table, status indicators
7. **Forms** - Any /new or /edit page for input styling

## Audit Report Template
```markdown
## Theme Audit Report - [Date]

### Theme: [Light/Dark]

### Pages Audited:
- [ ] Dashboard - [Pass/Fail] - Notes
- [ ] Projects - [Pass/Fail] - Notes
- [ ] Staff - [Pass/Fail] - Notes
- [ ] Ticketing - [Pass/Fail] - Notes
- [ ] Procurement - [Pass/Fail] - Notes
- [ ] Clients - [Pass/Fail] - Notes
- [ ] Forms - [Pass/Fail] - Notes

### Issues Found:
1. [Component] - [Issue] - [Fix]

### Console Errors:
- [Error message] - [Cause] - [Fix]

### Recommendations:
1. [Improvement suggestion]
```

## Quick Fixes Reference

### Make text theme-aware
```tsx
// Replace hardcoded colors
className="text-gray-900"  // BAD
className="text-[var(--ff-text-primary)]"  // GOOD
```

### Make backgrounds theme-aware
```tsx
className="bg-white"  // BAD
className="bg-[var(--ff-bg-primary)]"  // GOOD
```

### Make borders theme-aware
```tsx
className="border-gray-200"  // BAD
className="border-[var(--ff-border-light)]"  // GOOD
```

## Related Files
- `styles/design-system.css` - All theme variables
- `styles/globals.css` - Base styles
- `src/contexts/ThemeContext.tsx` - Theme state management
- `src/components/layout/Header.tsx` - Theme toggle UI
