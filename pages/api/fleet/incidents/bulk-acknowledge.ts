import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import { resolveStaffIdForUser } from '@/modules/fleet/parking/staffLookup';
import { IncidentAccessDeniedError, IncidentNotFoundError, bulkAcknowledgeIncidents } from '@/modules/fleet/incidents/reviewService';
import { IncidentValidationError, parseBulkAcknowledgeBody } from '@/modules/fleet/incidents/reviewValidation';
import { IncidentTransitionConflictError, IncidentTransitionForbiddenError, IncidentTransitionValidationError } from '@/modules/fleet/incidents/reviewTransitions';

interface Request extends NextApiRequest { user?: { id: string; role: string } }

async function handler(req: Request, res: NextApiResponse): Promise<void> {
  const user = req.user;
  if (!user) return apiResponse.unauthorized(res);
  try {
    const incidentIds = parseBulkAcknowledgeBody(req.body);
    const staffId = await resolveStaffIdForUser(user.id);
    // Bulk accepts acknowledgement only — every incident is validated before any is mutated (reviewTransitions.runBulkAcknowledge).
    const outcome = await bulkAcknowledgeIncidents(incidentIds, { userId: user.id, staffId, role: user.role }, null);
    return apiResponse.success(res, outcome);
  } catch (error) {
    if (error instanceof IncidentValidationError || error instanceof IncidentTransitionValidationError) return apiResponse.badRequest(res, error.message);
    if (error instanceof IncidentAccessDeniedError || error instanceof IncidentTransitionForbiddenError) return apiResponse.forbidden(res, error.message);
    if (error instanceof IncidentNotFoundError) return apiResponse.notFound(res, 'Incident');
    if (error instanceof IncidentTransitionConflictError) return apiResponse.conflict(res, error.message);
    log.error('Failed to bulk-acknowledge Fleet incidents', { error }, 'fleet');
    return apiResponse.internalError(res, error);
  }
}

async function route(req: Request, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  return withPermission('fleet.incidents', 'edit')(handler)(req, res);
}
export default withAuth(route);
