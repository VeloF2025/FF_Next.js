# CSV Export Skill

## Overview
System-wide pattern for implementing CSV/Excel exports that respect current filters and selection state.

## Principle
**"What you see is what you export"** - The filtered/selected view in the UI defines exactly what gets exported.

## Implementation Pattern

### 1. API Endpoint Structure
```typescript
// pages/api/{module}/export.ts
import type { NextApiRequest, NextApiResponse } from 'next';
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';
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

// CSV escape function - handles commas, quotes, newlines
function escapeCSV(value: any): string {
  if (value === null || value === undefined) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

// Convert rows to CSV with headers
function toCSV(rows: ExportRow[]): string {
  if (rows.length === 0) return '';

  const columns: { key: keyof ExportRow; header: string }[] = [
    { key: 'id', header: 'ID' },
    // Define all columns with display names
  ];

  const headerRow = columns.map(c => c.header).join(',');
  const dataRows = rows.map(row =>
    columns.map(c => escapeCSV(row[c.key])).join(',')
  );

  return [headerRow, ...dataRows].join('\n');
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

    // Return CSV by default, JSON if requested
    if (format !== 'json') {
      const csv = toCSV(rows);
      const filename = `${module}-export-${dateFrom || 'all'}-to-${dateTo || 'all'}.csv`;

      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      return res.status(200).send(csv);
    }

    return res.status(200).json({
      success: true,
      data: rows,
      meta: { count: rows.length, filters: { dateFrom, dateTo, project, status } },
    });
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
const handleExport = useCallback(async () => {
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
    a.download = `${module}-export-${filters.dateFrom || 'all'}-to-${filters.dateTo || 'all'}.csv`;
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
  onClick={handleExport}
  disabled={isExporting}
  className="flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
  title="Export filtered data to CSV"
>
  <Download className={`h-4 w-4 ${isExporting ? 'animate-bounce' : ''}`} />
  {isExporting ? 'Exporting...' : 'Export CSV'}
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
- Support both CSV and JSON formats
- Green color for export button (action color)

### 4. Column Definitions
- Define columns with `key` (data field) and `header` (display name)
- Order columns logically (ID first, then primary fields, then details)
- Use clear, human-readable headers

## Existing Implementations

### Activate Module
- **API:** `/api/activate/export`
- **Filters:** dateFrom, dateTo, project, status
- **Fields:** DR number, project, steps (10), serials, agent info, activation status

## Checklist for New Exports

- [ ] Create `/api/{module}/export.ts` endpoint
- [ ] Match filter parameters with list API
- [ ] Include all relevant fields via JOINs
- [ ] Define columns with display headers
- [ ] Add export button to UI with loading state
- [ ] Pass current filters to export URL
- [ ] Handle download trigger in browser
- [ ] Test with various filter combinations
