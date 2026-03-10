/**
 * Asset Export API
 * GET /api/assets/export — export assets as CSV with optional filters
 *
 * Accepts the same filter params as GET /api/assets:
 *   search, status[], categoryId[], condition[], calibrationDueWithinDays
 * Plus: limit (default 5000 — effectively "all")
 */

import { NextRequest, NextResponse } from 'next/server';
import { getDbConnection } from '@/modules/assets/utils/db';
import { log } from '@/lib/logger';
import { escapeCSV } from '@/lib/csv';

export const dynamic = 'force-dynamic';

function fmtDate(v: unknown): string {
  if (!v) return '';
  const d = new Date(v as string);
  return isNaN(d.getTime()) ? '' : (d.toISOString().split('T')[0] ?? '');
}

function fmtMoney(v: unknown): string {
  const n = Number(v);
  return isNaN(n) ? '' : n.toFixed(2);
}

const COLUMNS = [
  { key: 'asset_number', label: 'Asset Number' },
  { key: 'name', label: 'Name' },
  { key: 'category_name', label: 'Category' },
  { key: 'serial_number', label: 'Serial Number' },
  { key: 'barcode', label: 'Barcode' },
  { key: 'manufacturer', label: 'Manufacturer' },
  { key: 'model', label: 'Model' },
  { key: 'status', label: 'Status' },
  { key: 'condition', label: 'Condition' },
  { key: 'current_location', label: 'Location' },
  { key: 'current_assignee_name', label: 'Assigned To' },
  { key: 'assigned_since', label: 'Assigned Since' },
  { key: 'purchase_date', label: 'Purchase Date' },
  { key: 'purchase_price', label: 'Purchase Price' },
  { key: 'currency', label: 'Currency' },
  { key: 'current_book_value', label: 'Book Value' },
  { key: 'accumulated_depreciation', label: 'Accum. Depreciation' },
  { key: 'useful_life_years', label: 'Useful Life (yrs)' },
  { key: 'salvage_value', label: 'Salvage Value' },
  { key: 'warranty_end_date', label: 'Warranty End' },
  { key: 'requires_calibration', label: 'Requires Calibration' },
  { key: 'last_calibration_date', label: 'Last Calibration' },
  { key: 'next_calibration_date', label: 'Next Calibration' },
  { key: 'calibration_provider', label: 'Calibration Provider' },
  { key: 'last_maintenance_date', label: 'Last Maintenance' },
  { key: 'next_maintenance_date', label: 'Next Maintenance' },
  { key: 'po_number', label: 'PO Number' },
  { key: 'grn_number', label: 'GRN Number' },
  { key: 'notes', label: 'Notes' },
  { key: 'created_at', label: 'Created' },
];

const DATE_KEYS = new Set([
  'purchase_date', 'warranty_end_date', 'assigned_since',
  'last_calibration_date', 'next_calibration_date',
  'last_maintenance_date', 'next_maintenance_date', 'created_at',
]);

const MONEY_KEYS = new Set([
  'purchase_price', 'current_book_value', 'accumulated_depreciation', 'salvage_value',
]);

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const search = searchParams.get('search') || '';
    const statuses = searchParams.getAll('status').filter(Boolean);
    const categoryIds = searchParams.getAll('categoryId').filter(Boolean);
    const conditions = searchParams.getAll('condition').filter(Boolean);
    const calibDays = searchParams.get('calibrationDueWithinDays');

    const sql = getDbConnection();

    // Build query with JOINed category name
    // Use explicit branches (no conditional SQL fragments — Neon gotcha)
    let rows;

    if (search) {
      const pattern = `%${search}%`;
      rows = await sql`
        SELECT a.*, c.name AS category_name
        FROM assets a
        LEFT JOIN asset_categories c ON c.id = a.category_id
        WHERE a.name ILIKE ${pattern}
           OR a.serial_number ILIKE ${pattern}
           OR a.asset_number ILIKE ${pattern}
           OR a.manufacturer ILIKE ${pattern}
           OR a.model ILIKE ${pattern}
        ORDER BY a.asset_number
      `;
    } else if (statuses.length > 0 && categoryIds.length > 0) {
      rows = await sql`
        SELECT a.*, c.name AS category_name
        FROM assets a
        LEFT JOIN asset_categories c ON c.id = a.category_id
        WHERE a.status = ANY(${statuses})
          AND a.category_id = ANY(${categoryIds})
        ORDER BY a.asset_number
      `;
    } else if (statuses.length > 0) {
      rows = await sql`
        SELECT a.*, c.name AS category_name
        FROM assets a
        LEFT JOIN asset_categories c ON c.id = a.category_id
        WHERE a.status = ANY(${statuses})
        ORDER BY a.asset_number
      `;
    } else if (categoryIds.length > 0) {
      rows = await sql`
        SELECT a.*, c.name AS category_name
        FROM assets a
        LEFT JOIN asset_categories c ON c.id = a.category_id
        WHERE a.category_id = ANY(${categoryIds})
        ORDER BY a.asset_number
      `;
    } else if (conditions.length > 0) {
      rows = await sql`
        SELECT a.*, c.name AS category_name
        FROM assets a
        LEFT JOIN asset_categories c ON c.id = a.category_id
        WHERE a.condition = ANY(${conditions})
        ORDER BY a.asset_number
      `;
    } else if (calibDays) {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() + parseInt(calibDays, 10));
      rows = await sql`
        SELECT a.*, c.name AS category_name
        FROM assets a
        LEFT JOIN asset_categories c ON c.id = a.category_id
        WHERE a.requires_calibration = true
          AND a.next_calibration_date <= ${dueDate.toISOString().split('T')[0]}
        ORDER BY a.next_calibration_date
      `;
    } else {
      rows = await sql`
        SELECT a.*, c.name AS category_name
        FROM assets a
        LEFT JOIN asset_categories c ON c.id = a.category_id
        ORDER BY a.asset_number
      `;
    }

    // Build CSV
    const BOM = '\uFEFF';
    const header = COLUMNS.map((c) => escapeCSV(c.label)).join(',');

    const dataLines = rows.map((row: Record<string, unknown>) =>
      COLUMNS.map((col) => {
        const v = row[col.key];
        if (DATE_KEYS.has(col.key)) return escapeCSV(fmtDate(v));
        if (MONEY_KEYS.has(col.key)) return escapeCSV(fmtMoney(v));
        if (col.key === 'requires_calibration') return escapeCSV(v ? 'Yes' : 'No');
        return escapeCSV(v ?? '');
      }).join(',')
    );

    const csv = BOM + [header, ...dataLines].join('\n');
    const filename = `assets-export-${new Date().toISOString().split('T')[0]}.csv`;

    return new NextResponse(csv, {
      status: 200,
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (error) {
    log.error('Asset export failed', { error }, 'assets:export');
    return NextResponse.json(
      { error: 'Failed to export assets' },
      { status: 500 }
    );
  }
}
