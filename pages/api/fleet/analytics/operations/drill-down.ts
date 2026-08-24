/**
 * The incidents behind an operations analytics number (stage 8 task 7).
 *
 * Takes the same `op_*` filters as `../operations`, parsed by the same parser,
 * so a drill-down can never answer a different question than the card it was
 * opened from.
 *
 * `mode` is part of the answer, not an error code: `aggregate_only` means the
 * months asked about no longer have identifiable detail, and returning an empty
 * id list without saying so would read as "no incidents".
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import { OperationsFilterError, parseOperationsFilters } from '@/modules/fleet/incidents/analytics/operationsFilters';
import {
  OperationsAccessDeniedError, OperationsFilterConflictError, getOperationsDrillDown,
} from '@/modules/fleet/incidents/analytics/operationsAnalyticsService';
import { resolveStaffIdForUser } from '@/modules/fleet/parking/staffLookup';

interface Request extends NextApiRequest { user?: { id: string; role: string } }

async function handler(req: Request, res: NextApiResponse): Promise<void> {
  const user = req.user;
  if (!user) return apiResponse.unauthorized(res);
  const cursor = req.query.cursor;
  if (cursor !== undefined && typeof cursor !== 'string') {
    return apiResponse.badRequest(res, 'cursor must be given at most once');
  }
  try {
    const filters = parseOperationsFilters(req.query);
    const staffId = await resolveStaffIdForUser(user.id);
    const page = await getOperationsDrillDown(
      filters, { userId: user.id, staffId, role: user.role }, { cursor: cursor ?? null },
    );
    return apiResponse.success(res, page);
  } catch (error) {
    if (error instanceof OperationsFilterError) return apiResponse.badRequest(res, error.message);
    if (error instanceof OperationsFilterConflictError) return apiResponse.badRequest(res, error.message);
    if (error instanceof OperationsAccessDeniedError) return apiResponse.forbidden(res, error.message);
    log.error('Failed to build Fleet operations drill-down', { error }, 'fleet');
    return apiResponse.internalError(res, error);
  }
}

async function route(req: Request, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  return withPermission('fleet.incidents', 'view')(handler)(req, res);
}
export default withAuth(route);
