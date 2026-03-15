---
name: excel-export
description: System-wide Excel export pattern for FibreFlow. Filter-consistent exports using xlsx library with proper column widths and download triggers. USE WHEN implementing Excel exports or adding export buttons to modules.
user-invocable: false
---

# Excel Export Skill

## Overview
System-wide pattern for implementing Excel exports that respect current filters and selection state.

## Principle
**"What you see is what you export"** - The filtered/selected view in the UI defines exactly what gets exported.

## Implementation Pattern

### 1. API Endpoint Structure
```typescript
// pages/api/{module}/export.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';
import * as XLSX from 'xlsx';
import { log } from '@/lib/logger';

neonConfig.webSocketConstructor = ws;

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Define export row interface with ALL fields needed for export
interface ExportRow {
  // Core fields
  id: string;
  // Module-specific fields
  // ...
  // Calculated/joined fields
  // ...
}

// Convert rows to Excel workbook
function toExcel(rows: ExportRow[]): Buffer {
  // Define column headers
  const headers = ['ID', 'Name', 'Status', /* ... */];

  // Convert rows to array of arrays
  const data = rows.map((row) => [
    row.id,
    row.name,
    row.status ? 'Yes' : 'No',
    // ...
  ]);

  // Create worksheet
  const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);

  // Set column widths
  ws['!cols'] = [
    { wch: 12 }, // ID
    { wch: 20 }, // Name
    { wch: 10 }, // Status
    // ...
  ];

  // Create workbook
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Export');

  // Write to buffer
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    // Accept same filter params as list API
    const { dateFrom, dateTo, project, status, format } = req.query;

    // Build filter conditions (match list API logic)
    const conditions: string[] = [];
    const params: any[] = [];
    // ... build conditions ...

    // Query with JOINs for all related data
    const query = `
      SELECT ... FROM main_table
      LEFT JOIN related_table ON ...
      ${conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : ''}
      ORDER BY ...
    `;

    const result = await pool.query(query, params);

    // Transform with calculated fields
    const rows: ExportRow[] = result.rows.map(row => ({
      ...row,
      // Add calculated fields
    }));

    log.info('ExportAPI', `Exporting ${rows.length} rows`);

    // Return JSON if requested, Excel by default
    if (format === 'json') {
      return res.status(200).json({
        success: true,
        data: rows,
        meta: { count: rows.length, filters: { dateFrom, dateTo, project, status } },
      });
    }

    // Return as Excel file download (default)
    const excel = toExcel(rows);
    const filename = `${module}-export-${dateFrom || 'all'}-to-${dateTo || 'all'}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    return res.status(200).send(excel);
  } catch (error: any) {
    log.error('ExportAPI', 'Error exporting data', error);
    return res.status(500).json({ success: false, error: error.message });
  }
}
```

### 2. UI Component Pattern
```typescript
import { Download } from 'lucide-react';

// State for loading
const [isExporting, setIsExporting] = useState(false);

// Export handler using current filters
const handleExportExcel = useCallback(async () => {
  setIsExporting(true);
  try {
    // Build URL with current filter state
    const params = new URLSearchParams();
    if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
    if (filters.dateTo) params.set('dateTo', filters.dateTo);
    if (filters.project !== 'all') params.set('project', filters.project);
    if (filters.status !== 'all') params.set('status', filters.status);

    const url = `/api/${module}/export?${params.toString()}`;
    const response = await fetch(url);

    if (!response.ok) throw new Error('Export failed');

    // Trigger browser download
    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `${module}-export-${filters.dateFrom || 'all'}-to-${filters.dateTo || 'all'}.xlsx`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(downloadUrl);
    document.body.removeChild(a);
  } catch (err) {
    console.error('Export error:', err);
    alert('Failed to export data. Please try again.');
  } finally {
    setIsExporting(false);
  }
}, [filters]);

// Button component
<button
  onClick={handleExportExcel}
  disabled={isExporting}
  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
  title="Export filtered data to Excel"
>
  <Download className={`h-4 w-4 ${isExporting ? 'animate-bounce' : ''}`} />
  {isExporting ? 'Exporting...' : 'Export Excel'}
</button>
```

## Key Principles

### 1. Filter Consistency
- Export API accepts SAME filter parameters as list API
- Filter logic MUST match between list and export queries
- User sees exactly what they'll get

### 2. Complete Data
- Include ALL relevant fields, not just displayed columns
- JOIN with related tables for full context
- Include calculated fields (totals, statuses)

### 3. User Experience
- Show loading state on button
- Auto-name files with date range
- Support both Excel (default) and JSON formats
- Green color for export button (action color)
- Use `.xlsx` extension for Excel files

### 4. Column Definitions
- Define columns in headers array with display names
- Set column widths with `ws['!cols']` for readability
- Order columns logically (ID first, then primary fields, then details)
- Use clear, human-readable headers

### 5. Excel vs CSV
- **Prefer Excel (.xlsx)** - Better formatting, column widths, no encoding issues
- Use `xlsx` library (already installed in project)
- Set correct MIME type: `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`

## Existing Implementations

### Activate Module
- **API:** `/api/activate/export`
- **UI:** Dashboard (`/activate`) and QA Centre (`/activate/qa-centre`)
- **Filters:** dateFrom, dateTo, project, status
- **Fields:** DR number, project, submitted date, photo count, 10 steps, VLM status, feedback sent, sender info, activation status
- **Output:** Excel (.xlsx) with formatted columns

## Checklist for New Exports

- [ ] Create `/api/{module}/export.ts` endpoint
- [ ] Match filter parameters with list API
- [ ] Include all relevant fields via JOINs
- [ ] Define columns with display headers and widths
- [ ] Add export button to UI with loading state
- [ ] Pass current filters to export URL
- [ ] Handle download trigger in browser
- [ ] Use `.xlsx` extension and correct MIME type
- [ ] Test with various filter combinations

## Dependencies

```json
{
  "xlsx": "^0.18.5"
}
```

Already installed in the project - no additional installation needed.
