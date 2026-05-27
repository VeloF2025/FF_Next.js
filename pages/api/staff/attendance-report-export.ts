/**
 * GET  /api/staff/attendance-report-export?slug=...&format=xlsx|csv&...inputs
 * POST /api/staff/attendance-report-export
 *
 * XLSX/CSV export sibling of /api/staff/attendance-report. Reuses the
 * runner so the export and the on-screen result come from the same SQL
 * — no chance of column drift between the two surfaces.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import * as XLSX from 'xlsx';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import {
  withAuth,
  withPermission,
  type AuthenticatedNextApiRequest,
} from '@/lib/auth/middleware';
import {
  isReportSlug,
  parseAndScopeInput,
  ReportTooLargeError,
  ReportValidationError,
  runReport,
  REPORT_ROW_CAP,
} from '@/services/attendance/reports/runner';
import type { RawQuery } from '@/services/attendance/searchQueries';
import type { ReportColumn } from '@/services/attendance/reports/types';

type ExportFormat = 'xlsx' | 'csv';

function fmtCellValue(v: unknown, col: ReportColumn): string | number {
  if (v === undefined || v === null) return '';
  if (col.format === 'currency_rand' && typeof v === 'number') return Number(v.toFixed(2));
  if (col.format === 'integer' && typeof v === 'number') return Math.trunc(v);
  if (col.format === 'number' && typeof v === 'number') return Number(v.toFixed(2));
  if (typeof v === 'number') return v;
  return String(v);
}

function buildCsv(rows: Array<Record<string, unknown>>, columns: ReadonlyArray<ReportColumn>): string {
  const header = columns.map((c) => c.label).join(',');
  const lines = [header];
  for (const r of rows) {
    const cells = columns.map((c) => {
      const raw = fmtCellValue(r[c.key], c);
      const s = String(raw);
      // RFC4180 quoting
      if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    });
    lines.push(cells.join(','));
  }
  return lines.join('\r\n');
}

function buildSheetData(
  rows: Array<Record<string, unknown>>,
  columns: ReadonlyArray<ReportColumn>
): Record<string, string | number>[] {
  return rows.map((r) => {
    const obj: Record<string, string | number> = {};
    for (const c of columns) obj[c.label] = fmtCellValue(r[c.key], c);
    return obj;
  });
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET', 'POST']);
    return;
  }
  const user = (req as AuthenticatedNextApiRequest).user;
  if (!user?.id) {
    apiResponse.unauthorized(res);
    return;
  }

  const rawQuery: RawQuery = req.method === 'POST'
    ? { ...(req.query as RawQuery), ...((req.body as RawQuery) ?? {}) }
    : (req.query as RawQuery);

  const slug = typeof rawQuery.slug === 'string' ? rawQuery.slug : '';
  if (!isReportSlug(slug)) {
    apiResponse.badRequest(res, `Unknown report slug: ${slug}`);
    return;
  }
  const formatRaw = typeof rawQuery.format === 'string' ? rawQuery.format.toLowerCase() : 'xlsx';
  if (formatRaw !== 'xlsx' && formatRaw !== 'csv') {
    apiResponse.badRequest(res, "format must be 'xlsx' or 'csv'");
    return;
  }
  const format: ExportFormat = formatRaw;

  try {
    const input = await parseAndScopeInput(rawQuery, user, slug);
    const result = await runReport(slug, input, user);
    const filename = `pulse-${slug}-${input.dateFrom ?? input.month ?? 'export'}.${format}`;

    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.status(200).send(buildCsv(result.rows, result.columns));
      return;
    }

    const sheetData = buildSheetData(result.rows, result.columns);
    // json_to_sheet's `header` ensures column order even when rows are
    // empty (keeps the export schema stable for payroll consumers).
    const worksheet = XLSX.utils.json_to_sheet(sheetData, {
      header: result.columns.map((c) => c.label),
    });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, slug.slice(0, 31)); // sheet name 31-char cap
    const buffer = XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer;
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(buffer);
  } catch (err) {
    if (err instanceof ReportValidationError) {
      apiResponse.badRequest(res, err.message);
      return;
    }
    if (err instanceof ReportTooLargeError) {
      apiResponse.error(
        res,
        ErrorCode.PAYLOAD_TOO_LARGE,
        `Result has ${err.rowCount} rows; over the ${REPORT_ROW_CAP} cap. Narrow your filters.`,
      );
      return;
    }
    log.error('[attendance-report-export] failed', {
      userId: user.id,
      slug,
      format,
      error: err instanceof Error ? err.message : String(err),
    });
    apiResponse.internalError(res, err);
  }
}

export default withAuth(
  withPermission('people.staff.attendance.search', 'view')(handler)
);
