# FibreFlow UI/UX Specification

> **Version:** 1.0.0
> **Last Updated:** January 2026
> **Theme:** Dark Mode (System Default)

This document defines the uniform UI/UX standards for the FibreFlow application. All components and pages must conform to these specifications.

---

## Table of Contents

1. [Color Palette](#color-palette)
2. [Typography](#typography)
3. [Spacing & Layout](#spacing--layout)
4. [Stat Cards](#stat-cards)
5. [Badges](#badges)
6. [Buttons](#buttons)
7. [Dropdowns & Selects](#dropdowns--selects)
8. [Tables](#tables)
9. [Cards & Containers](#cards--containers)
10. [Form Inputs](#form-inputs)
11. [Tabs & Navigation](#tabs--navigation)
12. [Modals & Dialogs](#modals--dialogs)
13. [Icons](#icons)
14. [Toasts & Notifications](#toasts--notifications)

---

## Color Palette

### Background Colors
| Token | Hex | Usage |
|-------|-----|-------|
| `bg-primary` | `#0f1419` | Page background |
| `bg-secondary` | `#1a1d23` | Card backgrounds |
| `bg-tertiary` | `#1e2128` | Elevated surfaces, modals |
| `bg-hover` | `#2a2f38` | Hover states |
| `bg-active` | `#374151` | Active/selected states |

### Text Colors
| Token | Hex | Usage |
|-------|-----|-------|
| `text-primary` | `#f3f4f6` | Primary text, headings |
| `text-secondary` | `#9ca3af` | Secondary text, labels |
| `text-tertiary` | `#6b7280` | Muted text, placeholders |
| `text-accent` | `#60a5fa` | Links, interactive text |

### Border Colors
| Token | Hex | Usage |
|-------|-----|-------|
| `border-primary` | `#374151` | Card borders, dividers |
| `border-secondary` | `#4b5563` | Input borders |
| `border-focus` | `#3b82f6` | Focus states |

### Status Colors
| Status | Background | Text | Border |
|--------|------------|------|--------|
| Success | `#064e3b` | `#a7f3d0` | `#059669` |
| Warning | `#78350f` | `#fde68a` | `#d97706` |
| Error | `#7f1d1d` | `#fecaca` | `#dc2626` |
| Info | `#1e3a5f` | `#93c5fd` | `#3b82f6` |

### Semantic Colors
| Purpose | Color | Hex |
|---------|-------|-----|
| Primary (Actions) | Blue | `#3b82f6` |
| Secondary | Gray | `#6b7280` |
| Accent | Cyan | `#06b6d4` |
| Destructive | Red | `#ef4444` |

---

## Typography

### Font Family
- **Primary:** Inter, system-ui, sans-serif
- **Monospace:** JetBrains Mono, Consolas, monospace

### Font Sizes
| Token | Size | Line Height | Usage |
|-------|------|-------------|-------|
| `text-xs` | 12px | 16px | Badges, captions |
| `text-sm` | 14px | 20px | Body text, labels |
| `text-base` | 16px | 24px | Default body |
| `text-lg` | 18px | 28px | Subheadings |
| `text-xl` | 20px | 28px | Card titles |
| `text-2xl` | 24px | 32px | Section headers |
| `text-3xl` | 30px | 36px | Page titles |

### Font Weights
| Token | Weight | Usage |
|-------|--------|-------|
| `font-normal` | 400 | Body text |
| `font-medium` | 500 | Labels, buttons |
| `font-semibold` | 600 | Headings, stat values |
| `font-bold` | 700 | Page titles |

---

## Spacing & Layout

### Spacing Scale
| Token | Size | Usage |
|-------|------|-------|
| `space-1` | 4px | Tight padding |
| `space-2` | 8px | Icon gaps |
| `space-3` | 12px | Small padding |
| `space-4` | 16px | Standard padding |
| `space-5` | 20px | Medium padding |
| `space-6` | 24px | Card padding |
| `space-8` | 32px | Section spacing |

### Grid Gaps
| Context | Gap Size |
|---------|----------|
| Stat card grid | `gap-6` (24px) |
| Card grid | `gap-4` (16px) |
| Form fields | `gap-4` (16px) |
| Button groups | `gap-2` (8px) |

### Border Radius
| Token | Size | Usage |
|-------|------|-------|
| `rounded-sm` | 4px | Badges |
| `rounded` | 6px | Buttons, inputs |
| `rounded-lg` | 8px | Cards |
| `rounded-xl` | 12px | Modals |

---

## Stat Cards

### Standard Style (Recommended)
All stat cards should follow this unified pattern:

```tsx
<div className="bg-[#1a1d23] rounded-lg p-6 border border-gray-700/50">
  <div className="flex items-center justify-between">
    <div>
      <p className="text-sm text-gray-400 mb-1">{label}</p>
      <p className="text-2xl font-semibold text-white">{value}</p>
      {subtitle && <p className="text-xs text-gray-500 mt-1">{subtitle}</p>}
    </div>
    <div className="w-12 h-12 rounded-lg bg-{color}-500/20 flex items-center justify-center">
      <Icon className="w-6 h-6 text-{color}-400" />
    </div>
  </div>
</div>
```

### Icon Colors by Type
| Type | Icon Background | Icon Color |
|------|-----------------|------------|
| Total/Count | `bg-blue-500/20` | `text-blue-400` |
| Active/Success | `bg-green-500/20` | `text-green-400` |
| Warning/Pending | `bg-yellow-500/20` | `text-yellow-400` |
| Error/Critical | `bg-red-500/20` | `text-red-400` |
| Financial/Value | `bg-purple-500/20` | `text-purple-400` |
| Progress | `bg-cyan-500/20` | `text-cyan-400` |

### Layout
- Icon position: **Right side** (consistent across all pages)
- Grid: `grid-cols-2 lg:grid-cols-4 gap-6`
- No colored left borders (clean look)

---

## Badges

### Standard Style
```tsx
<span className="px-2 py-1 text-xs font-medium rounded bg-{color}-500/20 text-{color}-400">
  {text}
</span>
```

### Text Casing
- **Status badges:** UPPERCASE (e.g., "ACTIVE", "PENDING", "DRAFT")
- **Type badges:** Title Case (e.g., "High Priority", "Fiber Cable")
- **Count badges:** Numeric only

### Color Mapping
| Status | Background | Text |
|--------|------------|------|
| Active/Approved/Completed | `bg-green-500/20` | `text-green-400` |
| Pending/In Progress | `bg-yellow-500/20` | `text-yellow-400` |
| Draft/New | `bg-gray-500/20` | `text-gray-400` |
| Error/Cancelled/Rejected | `bg-red-500/20` | `text-red-400` |
| Info/Sent | `bg-blue-500/20` | `text-blue-400` |
| Warning/Overdue | `bg-orange-500/20` | `text-orange-400` |

### Size Variants
| Size | Classes |
|------|---------|
| Small | `px-1.5 py-0.5 text-[10px]` |
| Default | `px-2 py-1 text-xs` |
| Large | `px-3 py-1.5 text-sm` |

---

## Buttons

### Primary Button
```tsx
<button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-lg transition-colors">
  {children}
</button>
```

### Secondary Button
```tsx
<button className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-gray-200 font-medium rounded-lg border border-gray-600 transition-colors">
  {children}
</button>
```

### Ghost Button
```tsx
<button className="px-4 py-2 text-gray-400 hover:text-white hover:bg-gray-700/50 font-medium rounded-lg transition-colors">
  {children}
</button>
```

### Destructive Button
```tsx
<button className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white font-medium rounded-lg transition-colors">
  {children}
</button>
```

### Size Variants
| Size | Padding | Font |
|------|---------|------|
| Small | `px-3 py-1.5` | `text-sm` |
| Default | `px-4 py-2` | `text-sm` |
| Large | `px-6 py-3` | `text-base` |

### Icon Buttons
```tsx
<button className="p-2 text-gray-400 hover:text-white hover:bg-gray-700/50 rounded-lg transition-colors">
  <Icon className="w-5 h-5" />
</button>
```

---

## Dropdowns & Selects

### Standard Select (CRITICAL - Dark Theme)
All dropdowns MUST use dark theme styling:

```tsx
<select className="w-full px-3 py-2 bg-[#1a1d23] border border-gray-600 rounded-lg text-white focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none">
  <option value="">Select option</option>
</select>
```

### Dropdown Menu (Custom)
```tsx
<div className="absolute z-50 mt-1 w-full bg-[#1e2128] border border-gray-600 rounded-lg shadow-xl overflow-hidden">
  <div className="py-1">
    <button className="w-full px-4 py-2 text-left text-gray-200 hover:bg-gray-700/50">
      Option
    </button>
  </div>
</div>
```

### Key Requirements
- Background: `bg-[#1a1d23]` or `bg-[#1e2128]`
- Border: `border-gray-600`
- Text: `text-white` or `text-gray-200`
- Hover: `hover:bg-gray-700/50`
- **NEVER use white backgrounds**

---

## Tables

### Standard Table
```tsx
<div className="overflow-x-auto">
  <table className="w-full">
    <thead>
      <tr className="border-b border-gray-700">
        <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wider">
          Header
        </th>
      </tr>
    </thead>
    <tbody className="divide-y divide-gray-700/50">
      <tr className="hover:bg-gray-800/50 transition-colors">
        <td className="px-4 py-4 text-sm text-gray-200">
          Cell
        </td>
      </tr>
    </tbody>
  </table>
</div>
```

### Table Specifications
| Element | Style |
|---------|-------|
| Header bg | Transparent |
| Header text | `text-gray-400 text-xs uppercase` |
| Row padding | `px-4 py-4` |
| Row hover | `hover:bg-gray-800/50` |
| Dividers | `divide-gray-700/50` |
| Cell text | `text-sm text-gray-200` |

---

## Cards & Containers

### Standard Card
```tsx
<div className="bg-[#1a1d23] rounded-lg border border-gray-700/50 overflow-hidden">
  <div className="p-6">
    {/* Content */}
  </div>
</div>
```

### Card with Header
```tsx
<div className="bg-[#1a1d23] rounded-lg border border-gray-700/50 overflow-hidden">
  <div className="px-6 py-4 border-b border-gray-700/50">
    <h3 className="text-lg font-semibold text-white">{title}</h3>
  </div>
  <div className="p-6">
    {/* Content */}
  </div>
</div>
```

### Card Grid
```tsx
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
  {/* Cards */}
</div>
```

---

## Form Inputs

### Text Input
```tsx
<input
  type="text"
  className="w-full px-3 py-2 bg-[#1a1d23] border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
  placeholder="Enter text..."
/>
```

### Search Input with Icon
```tsx
<div className="relative">
  <SearchIcon className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
  <input
    type="text"
    className="w-full pl-10 pr-4 py-2 bg-[#1a1d23] border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none"
    placeholder="Search..."
  />
</div>
```

### Textarea
```tsx
<textarea
  className="w-full px-3 py-2 bg-[#1a1d23] border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 outline-none resize-none"
  rows={4}
/>
```

### Label
```tsx
<label className="block text-sm font-medium text-gray-300 mb-1">
  {labelText}
</label>
```

---

## Tabs & Navigation

### Standard Tabs
```tsx
<div className="border-b border-gray-700">
  <nav className="flex gap-6">
    <button className="px-1 py-4 text-sm font-medium text-blue-400 border-b-2 border-blue-400">
      Active Tab
    </button>
    <button className="px-1 py-4 text-sm font-medium text-gray-400 hover:text-white border-b-2 border-transparent">
      Inactive Tab
    </button>
  </nav>
</div>
```

### Pill Tabs
```tsx
<div className="flex gap-2 p-1 bg-gray-800/50 rounded-lg">
  <button className="px-4 py-2 text-sm font-medium rounded-md bg-blue-600 text-white">
    Active
  </button>
  <button className="px-4 py-2 text-sm font-medium rounded-md text-gray-400 hover:text-white">
    Inactive
  </button>
</div>
```

---

## Modals & Dialogs

### Modal Container
```tsx
<div className="fixed inset-0 z-50 flex items-center justify-center">
  {/* Backdrop */}
  <div className="absolute inset-0 bg-black/60" onClick={onClose} />

  {/* Modal */}
  <div className="relative bg-[#1e2128] rounded-xl border border-gray-700 shadow-2xl w-full max-w-lg mx-4">
    {/* Header */}
    <div className="px-6 py-4 border-b border-gray-700">
      <h2 className="text-xl font-semibold text-white">{title}</h2>
    </div>

    {/* Body */}
    <div className="p-6">
      {children}
    </div>

    {/* Footer */}
    <div className="px-6 py-4 border-t border-gray-700 flex justify-end gap-3">
      <button className="px-4 py-2 text-gray-400 hover:text-white">Cancel</button>
      <button className="px-4 py-2 bg-blue-600 text-white rounded-lg">Confirm</button>
    </div>
  </div>
</div>
```

---

## Icons

### Icon Sizes
| Context | Size |
|---------|------|
| In buttons | `w-5 h-5` |
| In stat cards | `w-6 h-6` |
| Standalone small | `w-4 h-4` |
| Hero icons | `w-8 h-8` |

### Icon Library
- Primary: **Heroicons** (outline variant preferred)
- Secondary: **Lucide React** for specialized icons

### Icon Colors
- Default: `text-gray-400`
- Hover: `text-white`
- Active: `text-blue-400`
- Match parent status colors when in badges/status contexts

---

## Toasts & Notifications

### Toast Styles (react-hot-toast)
```tsx
<Toaster
  position="top-right"
  toastOptions={{
    duration: 4000,
    style: {
      background: '#1e2128',
      color: '#e5e7eb',
      padding: '16px',
      borderRadius: '8px',
      border: '1px solid #374151',
    },
    success: {
      style: { background: '#064e3b', color: '#a7f3d0', border: '1px solid #059669' },
    },
    error: {
      style: { background: '#7f1d1d', color: '#fecaca', border: '1px solid #dc2626' },
    },
  }}
/>
```

---

## Component Checklist

Use this checklist when reviewing components for compliance:

- [ ] Uses dark theme backgrounds (`#1a1d23` or darker)
- [ ] Text uses appropriate gray scale (`text-gray-200` to `text-gray-500`)
- [ ] Borders use `border-gray-700` or `border-gray-600`
- [ ] Interactive elements have hover states
- [ ] Focus states use `focus:border-blue-500 focus:ring-1 focus:ring-blue-500`
- [ ] Dropdowns/selects have dark backgrounds (NO white)
- [ ] Badges use consistent casing (UPPERCASE for status)
- [ ] Stat cards have icons on the right
- [ ] Buttons match the specified variants
- [ ] Spacing follows the scale (multiples of 4px)

---

## FOUC Prevention (Flash of Unstyled Content)

### The Problem
When navigating between pages, users may see a brief flash of light-themed content before dark mode is applied. This occurs because React's `useEffect` runs **after** the initial paint.

### The Solution
Both `pages/_document.tsx` (Pages Router) and `app/layout.tsx` (App Router) contain inline blocking scripts that apply the theme **before** React hydrates.

### Critical Implementation

#### 1. Server-Side Rendering
```tsx
// Both layouts render with dark class by default
<html lang="en" className="dark">
  <body style={{ backgroundColor: '#1a1d23' }}>
```

#### 2. Blocking Theme Script
```javascript
// Runs BEFORE React hydration
(function() {
  var DARK_BG = '#1a1d23';
  var LIGHT_BG = '#ffffff';
  try {
    var stored = localStorage.getItem('fibreflow-theme-preference');
    var theme = 'dark'; // Default
    if (stored) {
      var pref = JSON.parse(stored);
      if (pref.theme === 'light' || pref.theme === 'dark') {
        theme = pref.theme;
      }
    }
    var isDark = theme === 'dark';
    document.documentElement.classList.toggle('dark', isDark);
    document.documentElement.style.colorScheme = isDark ? 'dark' : 'light';
    document.body.style.backgroundColor = isDark ? DARK_BG : LIGHT_BG;
  } catch (e) {
    document.documentElement.classList.add('dark');
  }
})();
```

### Key Points
| Requirement | Implementation |
|-------------|----------------|
| Script placement | Inside `<body>`, before content |
| Script type | Blocking (NO `async` or `defer`) |
| Default theme | Dark (`#1a1d23`) |
| Storage key | `fibreflow-theme-preference` |
| CSS property | `color-scheme: dark` for native form controls |

### Files to Maintain
- `pages/_document.tsx` - Pages Router layout
- `app/layout.tsx` - App Router layout
- `src/contexts/ThemeContext.tsx` - Runtime theme management

**WARNING:** Do NOT remove the inline scripts from either layout file. They are critical for preventing theme flash.

---

## Migration Notes

### Issues to Fix (from Audit)
1. **Staff Page Dropdown** - White background needs dark theme styling
2. **Stat Card Inconsistency** - Multiple styles need unification to standard
3. **Badge Casing** - Mixed casing needs standardization to UPPERCASE for status

### Shared Components to Create/Update
- `src/components/ui/StatCard.tsx` - Unified stat card component
- `src/components/ui/Badge.tsx` - Unified badge component
- `src/components/ui/Select.tsx` - Dark theme select component

---

*Last Updated: January 2026*
*This specification is the single source of truth for FibreFlow UI/UX standards.*
