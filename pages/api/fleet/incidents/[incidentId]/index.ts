import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import { resolveStaffIdForUser } from '@/modules/fleet/parking/staffLookup';
import { isValidUUID } from '@/modules/fleet/services/mileageUtils';
import { IncidentAccessDeniedError, IncidentNotFoundError, getIncidentDetailForViewer } from '@/modules/fleet/incidents/reviewService';

interface Request extends NextApiRequest { user?: { id: string; role: string } }

async function handler(req: Request, res: NextApiResponse): Promise<void> {
  const user = req.user;
  if (!user) return apiResponse.unauthorized(res);
  const incidentId = req.query.incidentId;
  if (typeof incidentId !== 'string' || !isValidUUID(incidentId)) return apiResponse.badRequest(res, 'A valid incidentId is required');
  try {
    const staffId = await resolveStaffIdForUser(user.id);
    const detail = await getIncidentDetailForViewer(incidentId, { userId: user.id, staffId, role: user.role });
    return apiResponse.success(res, detail);
  } catch (error) {
    if (error instanceof IncidentNotFoundError) return apiResponse.notFound(res, 'Incident', incidentId);
    if (error instanceof IncidentAccessDeniedError) return apiResponse.forbidden(res, error.message);
    log.error('Failed to load Fleet incident detail', { error, incidentId }, 'fleet');
    return apiResponse.internalError(res, error);
  }
}

async function route(req: Request, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  return withPermission('fleet.incidents', 'view')(handler)(req, res);
}
export default withAuth(route);
