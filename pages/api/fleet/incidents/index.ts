import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import { resolveStaffIdForUser } from '@/modules/fleet/parking/staffLookup';
import { IncidentAccessDeniedError, listIncidentsForViewer } from '@/modules/fleet/incidents/reviewService';
import { IncidentValidationError, parseIncidentListQuery } from '@/modules/fleet/incidents/reviewValidation';

interface Request extends NextApiRequest { user?: { id: string; role: string } }

async function handler(req: Request, res: NextApiResponse): Promise<void> {
  const user = req.user;
  if (!user) return apiResponse.unauthorized(res);
  try {
    const filters = parseIncidentListQuery(req.query as Record<string, string | string[] | undefined>);
    const staffId = await resolveStaffIdForUser(user.id);
    const result = await listIncidentsForViewer(filters, { userId: user.id, staffId, role: user.role });
    return apiResponse.success(res, result);
  } catch (error) {
    if (error instanceof IncidentValidationError) return apiResponse.badRequest(res, error.message);
    if (error instanceof IncidentAccessDeniedError) return apiResponse.forbidden(res, error.message);
    log.error('Failed to list Fleet incidents', { error }, 'fleet');
    return apiResponse.internalError(res, error);
  }
}

async function route(req: Request, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  return withPermission('fleet.incidents', 'view')(handler)(req, res);
}
export default withAuth(route);
