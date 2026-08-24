/**
 * Scoped operations analytics (stage 8 task 7).
 *
 * Gated on `fleet.incidents:view`, the same permission as the incident queue —
 * the retained half of this response is derived from incidents the caller can
 * already open there, and the historic half is anonymised. There is no separate
 * analytics permission because there is no separate audience.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import { OperationsFilterError, parseOperationsFilters } from '@/modules/fleet/incidents/analytics/operationsFilters';
import {
  OperationsAccessDeniedError, OperationsFilterConflictError, getOperationsAnalytics,
} from '@/modules/fleet/incidents/analytics/operationsAnalyticsService';
import { resolveStaffIdForUser } from '@/modules/fleet/parking/staffLookup';

interface Request extends NextApiRequest { user?: { id: string; role: string } }

async function handler(req: Request, res: NextApiResponse): Promise<void> {
  const user = req.user;
  if (!user) return apiResponse.unauthorized(res);
  try {
    const filters = parseOperationsFilters(req.query);
    const staffId = await resolveStaffIdForUser(user.id);
    const report = await getOperationsAnalytics(filters, { userId: user.id, staffId, role: user.role });
    return apiResponse.success(res, report);
  } catch (error) {
    if (error instanceof OperationsFilterError) return apiResponse.badRequest(res, error.message);
    if (error instanceof OperationsFilterConflictError) return apiResponse.badRequest(res, error.message);
    if (error instanceof OperationsAccessDeniedError) return apiResponse.forbidden(res, error.message);
    // Never fall through to an empty report: a zero that is really a failure is
    // read as "nothing happened", which is the one answer this must not give.
    log.error('Failed to build Fleet operations analytics', { error }, 'fleet');
    return apiResponse.internalError(res, error);
  }
}

async function route(req: Request, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  return withPermission('fleet.incidents', 'view')(handler)(req, res);
}
export default withAuth(route);
