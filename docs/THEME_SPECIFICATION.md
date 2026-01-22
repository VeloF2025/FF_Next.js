# FibreFlow Theme Specification

*Version 2.0 - January 2026*
*Unified specification for all UI/UX standards*

---

## Overview

FibreFlow uses a **dark-first theme** with CSS custom properties for consistent styling across all modules. This document is the single source of truth for all theme-related decisions.

**Gold Standard Reference:** `/maintenance` page

---

## Theme Architecture

### CSS Custom Properties (Required)

All components MUST use CSS variables for theme-aware colors:

```tsx
// CORRECT - Uses theme variables
className="bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)]"
className="border-[var(--ff-border-light)]"

// WRONG - Hardcoded colors
className="bg-gray-900 text-white"
className="border-gray-700"
```

### Core Color Variables

| Variable | Purpose | Dark Mode Value | Light Mode Value |
|----------|---------|-----------------|------------------|
| `--ff-bg-primary` | Main background | `#1a1d23` | `#ffffff` |
| `--ff-bg-secondary` | Card/panel bg | `#21242c` | `#f9fafb` |
| `--ff-bg-tertiary` | Input/elevated bg | `#2a2e38` | `#f3f4f6` |
| `--ff-text-primary` | Main text | `#f3f4f6` | `#111827` |
| `--ff-text-secondary` | Muted text | `#9ca3af` | `#6b7280` |
| `--ff-text-tertiary` | Subtle text | `#6b7280` | `#9ca3af` |
| `--ff-border-light` | Subtle borders | `#374151` | `#e5e7eb` |
| `--ff-border-medium` | Standard borders | `#4b5563` | `#d1d5db` |

### Brand Colors (VF Theme)

```scss
// Primary Brand Colors
$vf-primary: #1e3a8a;      // Deep Blue
$vf-secondary: #2563eb;    // Bright Blue
$vf-accent: #3b82f6;       // Light Blue
$vf-dark: #111827;         // Dark Gray
$vf-light: #f9fafb;        // Light Gray

// Status Colors
$success: #10b981;         // Green
$warning: #f59e0b;         // Amber
$error: #ef4444;           // Red
$info: #3b82f6;            // Blue
```

---

## Page Structure (Mandatory)

Every page MUST follow this structure:

### 1. AppLayout Wrapper (Required)

```tsx
import { AppLayout } from '@/components/layout/AppLayout';

export default function MyPage() {
  return (
    <AppLayout>
      {/* Page content */}
    </AppLayout>
  );
}
```

### 2. Standard Page Layout

```tsx
<div className="space-y-6">
  {/* 1. Header Section */}
  <ModuleHeader />

  {/* 2. Summary/Stats Cards */}
  <SummaryCards />

  {/* 3. Search & Filters Bar */}
  <SearchFiltersBar />

  {/* 4. Data Table/Content */}
  <DataTable />
</div>
```

---

## Component Patterns

### Stat Cards

```tsx
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
  <div className="bg-[var(--ff-bg-secondary)] p-6 rounded-lg border border-[var(--ff-border-light)]">
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm text-[var(--ff-text-secondary)]">{label}</p>
        <p className="text-2xl font-bold text-[var(--ff-text-primary)]">{value}</p>
      </div>
      <div className="h-12 w-12 bg-blue-500/20 rounded-full flex items-center justify-center">
        <Icon className="h-6 w-6 text-blue-400" />
      </div>
    </div>
  </div>
</div>
```

### Status Badges (Dark Mode)

```tsx
const statusColors = {
  active: 'bg-green-500/20 text-green-400',
  inactive: 'bg-gray-500/20 text-gray-400',
  pending: 'bg-yellow-500/20 text-yellow-400',
  completed: 'bg-blue-500/20 text-blue-400',
  cancelled: 'bg-red-500/20 text-red-400',
  approved: 'bg-green-500/20 text-green-400',
  rejected: 'bg-red-500/20 text-red-400',
  draft: 'bg-gray-500/20 text-gray-400'
};

<span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${statusColors[status]}`}>
  {status}
</span>
```

### Priority Badges

```tsx
const priorityColors = {
  low: 'bg-gray-500/20 text-gray-400',
  medium: 'bg-yellow-500/20 text-yellow-400',
  high: 'bg-orange-500/20 text-orange-400',
  critical: 'bg-red-500/20 text-red-400'
};
```

### Buttons

```tsx
// Primary Action
<button className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700">
  <Plus className="h-4 w-4 mr-2" />
  Add Item
</button>

// Secondary Action
<button className="inline-flex items-center px-4 py-2 text-sm font-medium text-[var(--ff-text-primary)] bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-secondary)]">
  <Download className="h-4 w-4 mr-2" />
  Export
</button>

// Icon Button (Table Actions)
<button className="p-1 text-[var(--ff-text-secondary)] hover:text-blue-400" title="View">
  <Eye className="h-4 w-4" />
</button>
```

### Table Row Actions

Order: View → Edit → Delete

```tsx
<td className="px-4 py-4">
  <div className="flex items-center gap-2">
    <button className="p-1 text-[var(--ff-text-secondary)] hover:text-blue-400" title="View">
      <Eye className="h-4 w-4" />
    </button>
    <button className="p-1 text-[var(--ff-text-secondary)] hover:text-blue-400" title="Edit">
      <Edit className="h-4 w-4" />
    </button>
    <button className="p-1 text-[var(--ff-text-secondary)] hover:text-red-400" title="Delete">
      <Trash2 className="h-4 w-4" />
    </button>
  </div>
</td>
```

### Data Tables

```tsx
<div className="bg-[var(--ff-bg-secondary)] border border-[var(--ff-border-light)] rounded-lg overflow-hidden">
  <div className="overflow-x-auto">
    <table className="min-w-full divide-y divide-[var(--ff-border-light)]">
      <thead className="bg-[var(--ff-bg-tertiary)]">
        <tr>
          <th className="px-4 py-3 text-left text-xs font-medium text-[var(--ff-text-secondary)] uppercase tracking-wider">
            Column
          </th>
        </tr>
      </thead>
      <tbody className="divide-y divide-[var(--ff-border-light)]">
        {/* Row content */}
      </tbody>
    </table>
  </div>
</div>
```

### Search Bar

```tsx
<div className="flex items-center gap-4 bg-[var(--ff-bg-secondary)] p-4 rounded-lg border border-[var(--ff-border-light)]">
  <form className="flex-1 max-w-md">
    <div className="relative">
      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-[var(--ff-text-secondary)] h-4 w-4" />
      <input
        type="text"
        placeholder="Search..."
        className="w-full pl-10 pr-4 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] placeholder-[var(--ff-text-secondary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  </form>

  <button className="flex items-center gap-2 px-4 py-2 text-[var(--ff-text-secondary)] border border-[var(--ff-border-light)] rounded-lg hover:bg-[var(--ff-bg-tertiary)]">
    <Filter className="h-4 w-4" />
    Filters
  </button>
</div>
```

### Form Inputs

```tsx
<div className="space-y-1">
  <label className="block text-sm font-medium text-[var(--ff-text-primary)]">
    {label}
  </label>
  <input
    type={type}
    className="w-full px-3 py-2 bg-[var(--ff-bg-tertiary)] border border-[var(--ff-border-light)] rounded-lg text-[var(--ff-text-primary)] focus:outline-none focus:ring-2 focus:ring-blue-500"
    placeholder={placeholder}
  />
  {error && (
    <p className="text-sm text-red-400">{error}</p>
  )}
</div>
```

### Loading States

```tsx
<tr>
  <td colSpan={columnCount} className="px-4 py-8 text-center text-[var(--ff-text-secondary)]">
    <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500 mx-auto mb-2" />
    Loading...
  </td>
</tr>
```

### Empty States

```tsx
<tr>
  <td colSpan={columnCount} className="px-4 py-8 text-center text-[var(--ff-text-secondary)]">
    <FolderOpen className="mx-auto mb-2 h-12 w-12 text-[var(--ff-text-tertiary)]" />
    No items found
  </td>
</tr>
```

---

## FOUC Prevention

### Critical Implementation

Both `pages/_document.tsx` and `app/layout.tsx` contain inline blocking scripts that apply the theme BEFORE React hydrates:

```tsx
// In _document.tsx or layout.tsx
<script
  dangerouslySetInnerHTML={{
    __html: `
      (function() {
        try {
          var theme = localStorage.getItem('fibreflow-theme-preference') || 'dark';
          document.documentElement.setAttribute('data-theme', theme);
          document.documentElement.classList.add(theme);
        } catch (e) {}
      })();
    `,
  }}
/>
```

**DO NOT REMOVE these scripts - they prevent flash of unstyled content.**

### Theme Storage

- Key: `fibreflow-theme-preference`
- Values: `'dark'` | `'light'`
- Default: `'dark'`

---

## Responsive Design

### Breakpoints (Tailwind)

```scss
sm: 640px   // Mobile landscape
md: 768px   // Tablet
lg: 1024px  // Desktop
xl: 1280px  // Large desktop
2xl: 1536px // Extra large
```

### Grid Layouts

```tsx
// Summary cards
"grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4"

// Form layouts
"grid grid-cols-1 md:grid-cols-2 gap-4"

// Detail pages
"grid grid-cols-1 lg:grid-cols-3 gap-6"
```

---

## Verification Checklist

For every page, verify:

- [ ] Uses AppLayout wrapper
- [ ] Uses CSS variables (not hardcoded colors)
- [ ] Has consistent header with title and actions
- [ ] Has summary/stat cards section
- [ ] Has search and filter bar
- [ ] Table uses theme-aware styling
- [ ] Status badges use opacity variants
- [ ] Loading and empty states styled
- [ ] No double headers
- [ ] Responsive at all breakpoints
- [ ] All text is visible (contrast check)

---

## Audit Results (January 2026)

### Pages Verified Correct

| Page | Status |
|------|--------|
| `/maintenance` | Gold Standard |
| `/staff` | Verified |
| `/procurement` | Verified |
| `/procurement/sourcing` | Verified |
| `/fleet` | Verified |
| `/analytics` | Verified |
| `/dashboard` | Verified |
| +16 more pages | Verified |

### Issues Fixed

| Page | Issue | Fix |
|------|-------|-----|
| `/clients/new` | Missing AppLayout | Added wrapper |
| `/projects/new` | Missing AppLayout | Added wrapper |

### Verification Method

All pages verified via visual inspection on staging server (vf.fibreflow.app) comparing against `/maintenance` gold standard.

---

## Do's and Don'ts

### Do

- Use CSS custom properties for all colors
- Use Tailwind's opacity modifiers for status colors (`bg-green-500/20`)
- Wrap all pages in AppLayout
- Follow the standard page structure
- Use lucide-react icons consistently
- Test both themes (dark and light)

### Don't

- Hardcode color values
- Create custom button styles
- Use different icon libraries
- Change spacing patterns
- Skip loading/error states
- Forget mobile responsiveness
- Use inline styles

---

## Files Reference

| File | Purpose |
|------|---------|
| `src/styles/globals.css` | CSS variable definitions |
| `src/components/layout/AppLayout.tsx` | Main layout wrapper |
| `pages/_document.tsx` | FOUC prevention (Pages Router) |
| `app/layout.tsx` | FOUC prevention (App Router) |
| `src/components/ThemeProvider.tsx` | Theme context |

---

*Last Updated: January 22, 2026*
*Audit Status: All 23 pages verified unified*
