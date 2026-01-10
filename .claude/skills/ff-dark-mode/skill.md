# FibreFlow Dark Mode Styling Skill

## USE WHEN
- Fixing dark mode styling issues on any page
- Creating new components that need dark mode support
- Reviewing UI for theme consistency
- User mentions "dark mode", "theme", "styling", or "colors don't look right"

## REFERENCE PAGES
The following pages have CORRECT dark mode implementation - use as reference:
1. **Dashboard** - `src/modules/dashboard/Dashboard.tsx`
2. **Ticketing Dashboard** - `src/modules/ticketing/components/Dashboard/TicketingDashboard.tsx`
3. **Staff pages** - `pages/staff/index.tsx`

## CSS VARIABLE SYSTEM

### Background Colors
| Variable | Light Mode | Dark Mode | Use For |
|----------|-----------|-----------|---------|
| `--ff-bg-primary` | `#ffffff` | `#0f172a` | Page background |
| `--ff-bg-secondary` | `#f9fafb` | `#1e293b` | Cards, panels |
| `--ff-bg-tertiary` | `#f3f4f6` | `#334155` | Inputs, table headers |
| `--ff-surface-primary` | `#ffffff` | `#1e293b` | Card surfaces |
| `--ff-surface-secondary` | `#f9fafb` | `#334155` | Nested surfaces |

### Text Colors
| Variable | Light Mode | Dark Mode | Use For |
|----------|-----------|-----------|---------|
| `--ff-text-primary` | `#111827` | `#f1f5f9` | Headings, main text |
| `--ff-text-secondary` | `#6b7280` | `#cbd5e1` | Descriptions, labels |
| `--ff-text-tertiary` | `#9ca3af` | `#94a3b8` | Placeholders, hints |

### Border Colors
| Variable | Light Mode | Dark Mode | Use For |
|----------|-----------|-----------|---------|
| `--ff-border-light` | `#e5e7eb` | `#334155` | Card borders, dividers |
| `--ff-border-medium` | `#d1d5db` | `#475569` | Input borders |
| `--ff-border-strong` | `#9ca3af` | `#64748b` | Focus states |

## CONVERSION RULES

### Replace Hardcoded Tailwind Classes

```
❌ BAD (Light mode only)          ✅ GOOD (Theme-aware)
─────────────────────────────────────────────────────────
bg-white                    →    bg-[var(--ff-surface-primary)]
                                 OR bg-[var(--ff-bg-secondary)]
bg-gray-50                  →    bg-[var(--ff-bg-tertiary)]
bg-gray-100                 →    bg-[var(--ff-bg-tertiary)]

text-gray-900               →    text-[var(--ff-text-primary)]
text-gray-800               →    text-[var(--ff-text-primary)]
text-gray-700               →    text-[var(--ff-text-primary)]
text-gray-600               →    text-[var(--ff-text-secondary)]
text-gray-500               →    text-[var(--ff-text-secondary)]
text-gray-400               →    text-[var(--ff-text-tertiary)]

border-gray-200             →    border-[var(--ff-border-light)]
border-gray-300             →    border-[var(--ff-border-light)]
divide-gray-200             →    divide-[var(--ff-border-light)]

hover:bg-gray-50            →    hover:bg-[var(--ff-bg-hover)]
                                 OR hover:bg-[var(--ff-bg-tertiary)]
```

### Status Badges (CRITICAL)
Use opacity-based backgrounds that work in both themes:

```
❌ BAD (Light mode only)          ✅ GOOD (Works in both)
─────────────────────────────────────────────────────────
bg-green-100 text-green-800 →    bg-green-500/20 text-green-400
bg-red-100 text-red-800     →    bg-red-500/20 text-red-400
bg-yellow-100 text-yellow-800 →  bg-yellow-500/20 text-yellow-400
bg-blue-100 text-blue-800   →    bg-blue-500/20 text-blue-400
bg-purple-100 text-purple-800 →  bg-purple-500/20 text-purple-400
bg-orange-100 text-orange-800 →  bg-orange-500/20 text-orange-400
```

### Error/Success Messages
```
❌ text-red-600             →    ✅ text-red-400
❌ text-green-600           →    ✅ text-green-400
❌ text-yellow-600          →    ✅ text-yellow-400
```

### Icon Backgrounds
```
❌ bg-blue-100              →    ✅ bg-blue-500/20
❌ bg-purple-100            →    ✅ bg-purple-500/20
```

## COMPONENT PATTERNS

### Card/Panel
```tsx
<div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-6">
  <h2 className="text-lg font-semibold text-[var(--ff-text-primary)]">Title</h2>
  <p className="text-sm text-[var(--ff-text-secondary)]">Description</p>
</div>
```

### Table
```tsx
<table className="min-w-full divide-y divide-[var(--ff-border-light)]">
  <thead className="bg-[var(--ff-bg-tertiary)]">
    <tr>
      <th className="px-6 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase">
        Column
      </th>
    </tr>
  </thead>
  <tbody className="bg-[var(--ff-bg-secondary)] divide-y divide-[var(--ff-border-light)]">
    <tr className="hover:bg-[var(--ff-bg-tertiary)]">
      <td className="px-6 py-4 text-sm text-[var(--ff-text-primary)]">Data</td>
    </tr>
  </tbody>
</table>
```

### Form Input
```tsx
<input
  className="w-full px-4 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg focus:ring-2 focus:ring-blue-500 placeholder:text-[var(--ff-text-tertiary)]"
/>
```

### Select/Dropdown
```tsx
<select className="px-4 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-primary)] border border-[var(--ff-border-light)] rounded-lg">
  <option>Option 1</option>
</select>
```

### Button - Secondary
```tsx
<button className="px-4 py-2 bg-[var(--ff-bg-tertiary)] text-[var(--ff-text-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-hover)] transition-colors">
  Cancel
</button>
```

### Status Badge
```tsx
<span className={`px-2 py-1 text-xs font-semibold rounded-full ${
  status === 'active' ? 'bg-green-500/20 text-green-400' :
  status === 'pending' ? 'bg-yellow-500/20 text-yellow-400' :
  status === 'error' ? 'bg-red-500/20 text-red-400' :
  'bg-gray-500/20 text-gray-400'
}`}>
  {status}
</span>
```

### Alert/Error Box
```tsx
<div className="bg-red-500/10 border border-red-500/20 rounded-lg p-4">
  <div className="flex items-start gap-3">
    <AlertTriangle className="w-5 h-5 text-red-400" />
    <div>
      <h3 className="font-medium text-red-400">Error Title</h3>
      <p className="text-sm text-red-300">Error description</p>
    </div>
  </div>
</div>
```

### Stat Card
```tsx
<div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg p-4">
  <div className="flex items-center gap-2 mb-2">
    <Icon className="w-4 h-4 text-blue-400" />
    <p className="text-sm text-[var(--ff-text-secondary)]">Label</p>
  </div>
  <p className="text-3xl font-bold text-[var(--ff-text-primary)]">123</p>
</div>
```

## QUICK FIX CHECKLIST

When fixing a component for dark mode:

- [ ] Replace all `bg-white` with `bg-[var(--ff-bg-secondary)]` or `bg-[var(--ff-surface-primary)]`
- [ ] Replace all `bg-gray-50/100` with `bg-[var(--ff-bg-tertiary)]`
- [ ] Replace all `text-gray-900/800/700` with `text-[var(--ff-text-primary)]`
- [ ] Replace all `text-gray-600/500` with `text-[var(--ff-text-secondary)]`
- [ ] Replace all `text-gray-400` with `text-[var(--ff-text-tertiary)]`
- [ ] Replace all `border-gray-*` with `border-[var(--ff-border-light)]`
- [ ] Replace all `divide-gray-*` with `divide-[var(--ff-border-light)]`
- [ ] Replace all `hover:bg-gray-50` with `hover:bg-[var(--ff-bg-hover)]`
- [ ] Convert status badges to `bg-{color}-500/20 text-{color}-400` format
- [ ] Convert error text from `text-red-600` to `text-red-400`
- [ ] Convert success text from `text-green-600` to `text-green-400`
- [ ] Add `placeholder:text-[var(--ff-text-tertiary)]` to inputs

## VERIFICATION WORKFLOW

### Correct Process:
1. **Make code changes** - Apply CSS variable conversions
2. **Build** - Run `npm run build` to verify no syntax errors
3. **Start server** - `PORT=3005 npm start`
4. **Use browser automation** - Navigate and screenshot to verify
5. **Toggle theme via UI** - Click theme toggle, don't manipulate DOM directly

### ⚠️ What NOT to Do:
- ❌ DON'T use JavaScript to manipulate `document.documentElement.classList.add('dark')`
- ❌ DON'T set theme via `localStorage.setItem()` programmatically
- These cause React hydration errors (#418, #423) - server/client mismatch

### ✅ What IS Safe:
- ✅ Navigate to pages with browser automation
- ✅ Take screenshots to verify styling
- ✅ Click the theme toggle button in the UI
- ✅ Read page elements

## TESTING

After making changes:
1. Toggle dark mode using the theme switcher
2. Check all text is readable (good contrast)
3. Check all backgrounds change appropriately
4. Check status badges are visible in both modes
5. Check form inputs have proper styling
6. Check hover states work correctly
7. Check no "flash" of wrong colors on page load

## FILES LOCATION

- CSS Variables: `src/styles/design-system.css` (lines 125-143 for dark mode)
- Global styles: `styles/globals.css`
- Tailwind config: `tailwind.config.mjs`
