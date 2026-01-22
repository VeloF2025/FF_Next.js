# FibreFlow UI/UX Standard - VF Brand Theme
*Version 1.0 - Mandatory for ALL modules*

## 🎨 VISUAL IDENTITY

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

## 📐 STANDARD MODULE LAYOUT

### 1. Page Structure (MANDATORY)
Every module page MUST follow this exact structure:

```tsx
<div className="space-y-6">
  {/* 1. Header Section */}
  <ModuleHeader />
  
  {/* 2. Summary Cards */}
  <SummaryCards />
  
  {/* 3. Search & Filters Bar */}
  <SearchFiltersBar />
  
  {/* 4. Data Table */}
  <DataTable />
</div>
```

### 2. Module Header Component
**Location**: Top of page
**Structure**: Title/Description LEFT | Action Buttons RIGHT

```tsx
interface ModuleHeaderProps {
  title: string;
  description: string;
  onImport?: () => void;
  onExport?: () => void;
  onAdd: () => void;
  addButtonText: string; // e.g., "Add Client", "Add Project"
  itemCount?: number;
}

<div className="flex items-center justify-between">
  <div>
    <h1 className="text-2xl font-semibold text-gray-900">{title}</h1>
    <p className="text-gray-600 mt-1">{description}</p>
  </div>
  <div className="flex gap-3">
    {onImport && (
      <button className="inline-flex items-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
        <Upload className="h-4 w-4 mr-2" />
        Import
      </button>
    )}
    {onExport && (
      <button className="inline-flex items-center px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
        <Download className="h-4 w-4 mr-2" />
        Export
      </button>
    )}
    <button className="inline-flex items-center px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700">
      <Plus className="h-4 w-4 mr-2" />
      {addButtonText}
    </button>
  </div>
</div>
```

### 3. Summary Cards Component
**Location**: Below header
**Layout**: 4-5 cards in responsive grid

```tsx
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5 gap-4">
  <div className="bg-white p-6 rounded-lg border border-gray-200">
    <div className="flex items-center justify-between">
      <div>
        <p className="text-sm text-gray-600">{label}</p>
        <p className="text-2xl font-bold text-gray-900">{value}</p>
      </div>
      <div className="h-12 w-12 bg-blue-100 rounded-full flex items-center justify-center">
        <Icon className="h-6 w-6 text-blue-600" />
      </div>
    </div>
  </div>
</div>
```

### 4. Search & Filters Bar
**Location**: Above data table
**Structure**: Search input LEFT | Filter button RIGHT

```tsx
<div className="flex items-center gap-4 bg-white p-4 rounded-lg border border-gray-200">
  <form className="flex-1 max-w-md">
    <div className="relative">
      <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 h-4 w-4" />
      <input
        type="text"
        placeholder="Search {items}..."
        className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  </form>
  
  <button className="flex items-center gap-2 px-4 py-2 text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50">
    <Filter className="h-4 w-4" />
    Filters
  </button>
</div>
```

### 5. Data Table Component
**Location**: Main content area
**Structure**: Responsive table with consistent styling

```tsx
<div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
  <div className="overflow-x-auto">
    <table className="min-w-full divide-y divide-gray-200">
      <thead className="bg-gray-50">
        <tr>
          <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
            {columnName}
          </th>
        </tr>
      </thead>
      <tbody className="bg-white divide-y divide-gray-200">
        {/* Row content */}
      </tbody>
    </table>
  </div>
</div>
```

## 🎯 ACTION BUTTONS STANDARD

### Table Row Actions
**MANDATORY**: Use icon buttons with tooltips
**Order**: View → Edit → Delete
**Styling**: Gray default, blue on hover (except delete = red)

```tsx
<td className="px-4 py-4">
  <div className="flex items-center gap-2">
    <button
      onClick={() => navigate(`/app/${module}/${id}`)}
      className="p-1 text-gray-400 hover:text-blue-600"
      title="View"
    >
      <Eye className="h-4 w-4" />
    </button>
    <button
      onClick={() => navigate(`/app/${module}/${id}/edit`)}
      className="p-1 text-gray-400 hover:text-blue-600"
      title="Edit"
    >
      <Edit className="h-4 w-4" />
    </button>
    <button
      onClick={() => onDelete(id)}
      className="p-1 text-gray-400 hover:text-red-600"
      title="Delete"
    >
      <Trash2 className="h-4 w-4" />
    </button>
  </div>
</td>
```

## 📊 STATUS & PRIORITY BADGES

### Status Badge Colors
```tsx
const statusColors = {
  active: 'bg-green-100 text-green-800',
  inactive: 'bg-gray-100 text-gray-800',
  pending: 'bg-yellow-100 text-yellow-800',
  completed: 'bg-blue-100 text-blue-800',
  cancelled: 'bg-red-100 text-red-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  draft: 'bg-gray-100 text-gray-800'
};

<span className={`inline-flex px-2 py-1 text-xs font-medium rounded-full ${statusColors[status]}`}>
  {status}
</span>
```

### Priority Badge Colors
```tsx
const priorityColors = {
  low: 'bg-gray-100 text-gray-800',
  medium: 'bg-yellow-100 text-yellow-800',
  high: 'bg-orange-100 text-orange-800',
  critical: 'bg-red-100 text-red-800'
};
```

## 🔄 LOADING & EMPTY STATES

### Loading State
```tsx
<tr>
  <td colSpan={columnCount} className="px-4 py-8 text-center text-gray-500">
    <LoadingSpinner className="mx-auto mb-2" />
    Loading {module}...
  </td>
</tr>
```

### Empty State
```tsx
<tr>
  <td colSpan={columnCount} className="px-4 py-8 text-center text-gray-500">
    <EmptyIcon className="mx-auto mb-2 h-12 w-12 text-gray-300" />
    No {module} found
  </td>
</tr>
```

### Error State
```tsx
<tr>
  <td colSpan={columnCount} className="px-4 py-8 text-center text-red-600">
    <AlertCircle className="mx-auto mb-2 h-12 w-12" />
    Error loading {module}: {error.message}
  </td>
</tr>
```

## 📱 RESPONSIVE DESIGN

### Breakpoints
```scss
// Tailwind default breakpoints (MANDATORY)
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

## 🎨 FORM STANDARDS

### Input Fields
```tsx
<div className="space-y-1">
  <label className="block text-sm font-medium text-gray-700">
    {label}
  </label>
  <input
    type={type}
    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
    placeholder={placeholder}
  />
  {error && (
    <p className="text-sm text-red-600">{error}</p>
  )}
</div>
```

### Select Dropdowns
```tsx
<select className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
  <option value="">Select {label}</option>
  {options.map(option => (
    <option key={option.value} value={option.value}>
      {option.label}
    </option>
  ))}
</select>
```

### Form Buttons
```tsx
<div className="flex justify-end gap-3">
  <button
    type="button"
    onClick={onCancel}
    className="px-4 py-2 text-gray-700 bg-white border border-gray-300 rounded-lg hover:bg-gray-50"
  >
    Cancel
  </button>
  <button
    type="submit"
    className="px-4 py-2 text-white bg-blue-600 rounded-lg hover:bg-blue-700"
  >
    Save
  </button>
</div>
```

## 🗂️ MODULE-SPECIFIC PATTERNS

### Projects Module
- Use project status badges
- Show progress bars for completion
- Include client name in table
- Display budget with currency formatting

### Staff Module
- Show profile avatars/initials
- Display department and position
- Include availability status
- Show utilization percentage

### Procurement/BOQ Module
- Use approval workflow badges
- Show confidence scores for mapping
- Include progress indicators
- Display monetary values formatted

### Contractors Module
- Show RAG status prominently
- Display compliance indicators
- Include document expiry warnings
- Show team member counts

## ✅ IMPLEMENTATION CHECKLIST

For EVERY module, ensure:

- [ ] Header with title, description, and action buttons
- [ ] Summary cards showing key metrics
- [ ] Search bar with placeholder text
- [ ] Filter button (functional or placeholder)
- [ ] Responsive data table
- [ ] Consistent action buttons (Eye, Edit, Trash2)
- [ ] Status/priority badges with correct colors
- [ ] Loading, empty, and error states
- [ ] Responsive grid layouts
- [ ] Form styling consistency
- [ ] Mobile-friendly design
- [ ] Hover states on all interactive elements
- [ ] Focus states for accessibility
- [ ] Consistent spacing (using space-y-6)

## 🚫 WHAT NOT TO DO

- ❌ Don't create custom button styles - use standard classes
- ❌ Don't use different icon sets - stick to lucide-react
- ❌ Don't change spacing patterns - use Tailwind defaults
- ❌ Don't create one-off color schemes - use defined palette
- ❌ Don't skip loading/error states
- ❌ Don't forget mobile responsiveness
- ❌ Don't use inline styles - use Tailwind classes
- ❌ Don't create unique layouts for similar pages

## 📝 MIGRATION TASKS

1. **Projects Module** - Update to match standard
2. **Staff Module** - Align with pattern
3. **Procurement/BOQ** - Standardize UI
4. **Contractors** - Apply consistent styling
5. **All other modules** - Follow this guide

## 🎯 ENFORCEMENT

This standard is MANDATORY and will be:
- Checked in code reviews
- Validated by automated tests
- Required for PR approval
- Audited quarterly

---

## 🌙 DARK MODE STANDARD (Jan 2026)

### Theme Variables (MANDATORY)
Always use CSS custom properties for theme-aware colors:

```tsx
// ✅ CORRECT - Uses theme variables
className="bg-[var(--ff-bg-primary)] text-[var(--ff-text-primary)]"
className="border-[var(--ff-border-light)]"

// ❌ WRONG - Hardcoded colors
className="bg-gray-900 text-white"
className="border-gray-700"
```

### Common Theme Variables
| Variable | Purpose | Dark Value |
|----------|---------|------------|
| `--ff-bg-primary` | Main background | `#1a1d23` |
| `--ff-bg-secondary` | Card/panel bg | `#21242c` |
| `--ff-bg-tertiary` | Input/elevated bg | `#2a2e38` |
| `--ff-text-primary` | Main text | `#f3f4f6` |
| `--ff-text-secondary` | Muted text | `#9ca3af` |
| `--ff-border-light` | Subtle borders | `#374151` |

### FOUC Prevention
**Critical for App Router pages:** Both `pages/_document.tsx` and `app/layout.tsx` contain inline blocking scripts that apply the theme before React hydrates. DO NOT remove these scripts.

### Dark Mode Best Practices
1. **Always use CSS variables** - Never hardcode colors
2. **Test both themes** - Verify light mode still works
3. **Check form controls** - `color-scheme: dark` makes native inputs dark
4. **Status badges** - Use opacity variants (`bg-green-500/20 text-green-400`)

### Status Badge Colors (Dark Mode)
```tsx
const darkModeStatusColors = {
  active: 'bg-green-500/20 text-green-400',
  inactive: 'bg-gray-500/20 text-gray-400',
  pending: 'bg-yellow-500/20 text-yellow-400',
  completed: 'bg-blue-500/20 text-blue-400',
  cancelled: 'bg-red-500/20 text-red-400',
};
```

---

*Last Updated: 2026-01-22*
*Status: ACTIVE - All new development must follow these standards*