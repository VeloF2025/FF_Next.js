/**
 * GET  /api/staff/attendance-search-export?format=xlsx|csv&...filters
 * POST /api/staff/attendance-search-export   (POST mirror for very long staffIds[])
 *
 * XLSX/CSV export of the Pulse Search result (PRD-061 Phase A, FR-SEARCH-07).
 * Honours the same filters and the same scope as the list endpoint — clients
 * cannot escape supervisor scope by switching to the export route.
 *
 * Caps at MAX_TOTAL_ROWS rows; sets `X-Pulse-Truncated: true` header when the
 * cap was hit so the UI can warn the user that their export is partial.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import * as XLSX from 'xlsx';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import {
  withAuth,
  withPermission,
  type AuthenticatedNextApiRequest,
} from '@/lib/auth/middleware';
import {
  parseFilters,
  parseSort,
  resolveScope,
  runSearchForExport,
  ValidationError,
  type RawQuery,
  type SearchRow,
} from '@/services/attendance/searchQueries';

type ExportFormat = 'xlsx' | 'csv';

interface ExportRow extends Record<string, string | number> {
  date: string;
  employee_id: string;
  staff: string;
  department: string;
  site: string;
  clock_in: string;
  clock_out: string;
  regular_hrs: number;
  overtime_hrs: number;
  sunday_hrs: number;
  holiday_hrs: number;
  night_hrs: number;
  wage_amount_rand: number;
  exception_count: number;
  exception_kinds: string;
}

const EXPORT_COLUMNS: ReadonlyArray<keyof ExportRow> = [
  'date',
  'employee_id',
  'staff',
  'department',
  'site',
  'clock_in',
  'clock_out',
  'regular_hrs',
  'overtime_hrs',
  'sunday_hrs',
  'holiday_hrs',
  'night_hrs',
  'wage_amount_rand',
  'exception_count',
  'exception_kinds',
];

function shapeRow(r: SearchRow): ExportRow {
  return {
    date: r.work_date,
    employee_id: r.employee_id ?? '',
    staff: r.full_name,
    department: r.department ?? '',
    site: r.primary_site_name ?? '',
    clock_in: r.first_clock_in_at ?? '',
    clock_out: r.last_clock_out_at ?? '',
    regular_hrs: r.regular_hrs,
    overtime_hrs: r.overtime_hrs,
    sunday_hrs: r.sunday_hrs,
    holiday_hrs: r.holiday_hrs,
    night_hrs: r.night_hrs,
    wage_amount_rand: r.wage_amount_cents === null ? 0 : r.wage_amount_cents / 100,
    exception_count: r.exceptions_count,
    exception_kinds: r.exception_kinds.join(';'),
  };
}

function buildCsv(records: ExportRow[]): string {
  const header = EXPORT_COLUMNS.join(',');
  const lines = [header];
  for (const r of records) {
    const cells = EXPORT_COLUMNS.map((col) => {
      const v = r[col];
      const s = v === undefined || v === null ? '' : String(v);
      // RFC4180 CSV quoting: wrap if the cell has a comma, quote, or newline,
      // and double up any embedded quotes.
      if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    });
    lines.push(cells.join(','));
  }
  return lines.join('\r\n');
}

function defaultFilename(format: ExportFormat, dateFrom: string, dateTo: string): string {
  return `pulse-search-${dateFrom}_to_${dateTo}.${format}`;
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET', 'POST']);
    return;
  }

  const rawQuery: RawQuery = req.method === 'POST'
    ? { ...(req.query as RawQuery), ...((req.body as RawQuery) ?? {}) }
    : (req.query as RawQuery);

  const user = (req as AuthenticatedNextApiRequest).user;
  if (!user?.id) {
    apiResponse.unauthorized(res);
    return;
  }

  const formatRaw = typeof rawQuery.format === 'string' ? rawQuery.format.toLowerCase() : 'xlsx';
  if (formatRaw !== 'xlsx' && formatRaw !== 'csv') {
    apiResponse.badRequest(res, "format must be 'xlsx' or 'csv'");
    return;
  }
  const format: ExportFormat = formatRaw;

  let filters;
  let sort;
  try {
    filters = parseFilters(rawQuery);
    sort = parseSort(rawQuery);
  } catch (err) {
    if (err instanceof ValidationError) {
      apiResponse.badRequest(res, err.message);
      return;
    }
    throw err;
  }

  try {
    const scope = await resolveScope(user);
    const result = await runSearchForExport({ filters, scope, sort });
    const records = result.rows.map(shapeRow);
    const filename = defaultFilename(format, filters.dateFrom, filters.dateTo);

    if (result.rowsTruncated) {
      res.setHeader('X-Pulse-Truncated', 'true');
      log.warn('[attendance-search-export] result truncated to MAX_TOTAL_ROWS', {
        userId: user.id,
        dateFrom: filters.dateFrom,
        dateTo: filters.dateTo,
        rowCount: records.length,
      });
    }

    if (format === 'csv') {
      const body = buildCsv(records);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.status(200).send(body);
      return;
    }

    // XLSX: pass EXPORT_COLUMNS so column order is fixed even when records is
    // empty or the underlying SearchRow shape gains a new field that we don't
    // want to leak into the export.
    const worksheet = XLSX.utils.json_to_sheet(records, {
      header: EXPORT_COLUMNS.map(String),
    });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Pulse Search');
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(buffer);
  } catch (err) {
    log.error('[attendance-search-export] failed', {
      userId: user.id,
      format,
      dateFrom: filters.dateFrom,
      dateTo: filters.dateTo,
      error: err instanceof Error ? err.message : String(err),
    });
    apiResponse.internalError(res, err);
  }
}

export default withAuth(
  withPermission('people.staff.attendance.search', 'view')(handler)
);
