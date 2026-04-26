/**
 * GET  /api/staff/attendance-report?slug=<slug>&...inputs
 * POST /api/staff/attendance-report                          (POST mirror for long staffIds[] payloads)
 *
 * Pulse · Reports dispatcher (PRD-061 Phase C). Validates the slug,
 * resolves scope (re-using Phase A's helper), runs the per-report query
 * via the runner, and returns:
 *
 *   { rows, columns, notes, slug, scopeNote }
 *
 * Errors map to:
 *   - ReportValidationError → 400
 *   - ReportTooLargeError   → 413
 *   - everything else       → 500 with structured log line
 *
 * Telemetry (FR-REPORT-COM-02) is logged inside the runner regardless of
 * whether this handler returns success or rethrows.
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

  try {
    const input = await parseAndScopeInput(rawQuery, user, slug);
    const result = await runReport(slug, input, user);
    apiResponse.success(res, {
      slug,
      rows: result.rows,
      columns: result.columns,
      notes: result.notes,
      scopeNote: input.scope.note,
    });
  } catch (err) {
    if (err instanceof ReportValidationError) {
      apiResponse.badRequest(res, err.message);
      return;
    }
    if (err instanceof ReportTooLargeError) {
      // ErrorCode.PAYLOAD_TOO_LARGE maps to 413 + the standard envelope
      // (with `meta.timestamp`) that the rest of the project emits.
      apiResponse.error(
        res,
        ErrorCode.PAYLOAD_TOO_LARGE,
        `Result has ${err.rowCount} rows; over the ${REPORT_ROW_CAP} cap. Narrow your filters.`,
      );
      return;
    }
    log.error('[attendance-report] failed', {
      userId: user.id,
      slug,
      error: err instanceof Error ? err.message : String(err),
    });
    apiResponse.internalError(res, err);
  }
}

export default withAuth(
  withPermission('people.staff.attendance.search', 'view')(handler)
);
