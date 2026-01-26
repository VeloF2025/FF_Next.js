# Filter-Aware CSV/Excel Exports

> **Pattern established:** 2026-01-26
> **Reference commit:** `51dbdd1e`

## Overview

All list pages with export functionality should:
1. Export only what matches current filters (what user sees)
2. Show dynamic button text indicating export scope
3. Generate descriptive filenames with filter info

## Implementation Pattern

### 1. Dynamic Button Text

```tsx
// Show what will be exported based on active filters
<button onClick={handleExport}>
  <Download className="w-4 h-4" />
  Export {hasActiveFilters ? getFilterLabel() : 'All'} CSV
</button>
```

**Examples:**
- No filters: "Export All CSV"
- Status filter: "Export Active CSV"
- Multiple filters: "Export Filtered CSV"

### 2. Descriptive Filename

```typescript
const handleExport = async () => {
  // Build filter parts for filename
  const filterParts: string[] = [];
  if (filter.status) filterParts.push(filter.status);
  if (filter.type) filterParts.push(filter.type.replace(/\s+/g, '-'));
  if (searchTerm) filterParts.push('search');

  const filterSuffix = filterParts.length > 0
    ? `-${filterParts.join('-')}`
    : '-all';

  // Result: staff-active-engineering-2026-01-26.csv
  a.download = `${module}${filterSuffix}-${dateStr}.csv`;
};
```

### 3. API-Side Filtering (for server exports)

```typescript
// pages/api/module/export.ts
export default async function handler(req, res) {
  const { status, type, dateFrom, dateTo } = req.query;

  let query = 'SELECT * FROM table WHERE 1=1';
  const params: any[] = [];

  if (status) {
    params.push(status);
    query += ` AND status = $${params.length}`;
  }
  // ... more filters

  const { rows } = await pool.query(query, params);

  // Set descriptive filename in header
  const filterParts = [status, type].filter(Boolean);
  const suffix = filterParts.length > 0 ? `-${filterParts.join('-')}` : '-all';

  res.setHeader('Content-Disposition',
    `attachment; filename="${module}${suffix}-${date}.csv"`);
  res.setHeader('Content-Type', 'text/csv');
  res.send(csvData);
}
```

## Implemented Components

| Component | File | Filter Fields |
|-----------|------|---------------|
| Staff List | `src/modules/staff/components/StaffList.tsx` | status, department, position, searchTerm |
| Staff Header | `src/modules/staff/components/StaffListHeader.tsx` | Receives filter prop |
| Client List | `src/modules/clients/components/ClientList.tsx` | status, type, searchTerm |
| Client Header | `src/modules/clients/components/ClientListHeader.tsx` | Receives filter prop |
| Project List | `src/modules/projects/components/ProjectList.tsx` | selectedStatus[], selectedPriority[], searchTerm |
| Project Header | `src/modules/projects/components/ProjectListHeader.tsx` | hasFilters, filterLabel props |
| DR List | `src/modules/activate/components/DrListPage.tsx` | statusFilter, projectFilter, dateFrom, dateTo |
| WA Logs | `src/modules/communications/whatsapp/components/LogsTab.tsx` | direction, status, project, drop_number |
| Offline Devices | `src/modules/activate/components/reporting/OfflineDevicesReports.tsx` | zone, bucket, matchStatus, serialMismatchOnly |
| Serial Swaps | `src/modules/activate/components/reporting/SerialSwapReports.tsx` | project, dateRange |
| Serial Mismatch | `src/modules/activate/components/reporting/SerialMismatchReports.tsx` | project, dateRange |

## Key Principles

1. **WYSIWYG exports** - What You See Is What You Get
2. **Descriptive filenames** - User knows what's in the file
3. **Consistent UX** - Same pattern across all modules
4. **Filter state visible** - Button text shows export scope

## Common Pitfalls

- **Don't export all when filtered** - Always check filter state
- **Sanitize filter values for filename** - Replace spaces, remove special chars
- **Handle empty filter arrays** - `[]` is falsy for `.length` but truthy otherwise
- **Date range in filename** - Include when date filters are active
