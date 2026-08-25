/**
 * The operations analytics report as a download (stage 8 task 8).
 *
 * The same request as `../operations` with a different Accept: the same `op_*`
 * parser, the same service, the same viewer. Nothing is queried here that the
 * screen does not query, which is what makes a workbook and the page it was
 * taken from the same answer rather than two opinions.
 *
 * The failure mode a download has and a JSON response does not is a 200 with a
 * well-formed, empty spreadsheet — indistinguishable, once it is on someone's
 * disk, from a period in which nothing happened. So the response headers are
 * set only once the bytes exist, and every failure leaves as JSON.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import { OperationsFilterError, parseOperationsFilters } from '@/modules/fleet/incidents/analytics/operationsFilters';
import {
  OperationsAccessDeniedError, OperationsFilterConflictError, getOperationsAnalytics,
} from '@/modules/fleet/incidents/analytics/operationsAnalyticsService';
import { buildOperationsWorkbook } from '@/modules/fleet/incidents/analytics/operationsWorkbook';
import { getEffectiveAnalyticsRetentionSettings } from '@/modules/fleet/incidents/analytics/settingsRepository';
import { resolveIncidentScope } from '@/modules/fleet/incidents/reviewScope';
import { resolveStaffIdForUser } from '@/modules/fleet/parking/staffLookup';

const XLSX_CONTENT_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

interface Request extends NextApiRequest { user?: { id: string; role: string } }

async function handler(req: Request, res: NextApiResponse): Promise<void> {
  const user = req.user;
  if (!user) return apiResponse.unauthorized(res);
  try {
    const filters = parseOperationsFilters(req.query);
    const staffId = await resolveStaffIdForUser(user.id);

    // Asked of the same authority `resolveRange` consults, so the label on the
    // file cannot describe a wider or narrower population than the figures in
    // it. A null here is the permission having gone away between the gate and
    // this line, and a file that says nothing about its scope is worse than no
    // file.
    const scope = await resolveIncidentScope(user.id, staffId, user.role);
    if (scope === null) return apiResponse.forbidden(res, 'You cannot view Fleet operations analytics');

    const generatedAt = new Date().toISOString();
    const settings = await getEffectiveAnalyticsRetentionSettings(generatedAt);
    const report = await getOperationsAnalytics(filters, { userId: user.id, staffId, role: user.role });
    const workbook = await buildOperationsWorkbook(report, {
      generatedAt,
      scopeLabel: scope.unrestricted ? 'All projects' : 'Projects you manage',
      anonymityMinContributors: settings.anonymityMinContributors,
    });

    res.setHeader('Content-Type', XLSX_CONTENT_TYPE);
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="fleet-operations-${filters.start}-to-${filters.end}.xlsx"`,
    );
    res.status(200).end(workbook);
    return;
  } catch (error) {
    if (error instanceof OperationsFilterError) return apiResponse.badRequest(res, error.message);
    if (error instanceof OperationsFilterConflictError) return apiResponse.badRequest(res, error.message);
    if (error instanceof OperationsAccessDeniedError) return apiResponse.forbidden(res, error.message);
    log.error('Failed to export Fleet operations analytics', { error }, 'fleet');
    return apiResponse.internalError(res, error);
  }
}

/** Built once. Rebuilding the gate per request wraps the handler afresh on every call. */
const guardedHandler = withPermission('fleet.incidents', 'view')(handler);

async function route(req: Request, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  return guardedHandler(req, res);
}
export default withAuth(route);
