/**
 * GET  /api/staff/attendance-report-export?slug=...&format=xlsx|csv&...inputs
 * POST /api/staff/attendance-report-export
 *
 * XLSX/CSV export sibling of /api/staff/attendance-report. Reuses the
 * runner so the export and the on-screen result come from the same SQL
 * — no chance of column drift between the two surfaces.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
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
import {
  serializeReportCsv,
  serializeReportXlsx,
} from '@/services/attendance/reports/exportSerializers';

type ExportFormat = 'xlsx' | 'csv';

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
      res.status(200).send(serializeReportCsv(result.rows, result.columns));
      return;
    }

    const buffer = serializeReportXlsx(result.rows, result.columns, slug);
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

// #1992: the report export carries the same wage/BCEA data as the report
// itself, so it requires the stricter management permission too.
export default withAuth(
  withPermission('people.staff.attendance.manage', 'view')(handler)
);
