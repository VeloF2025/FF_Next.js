import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import { resolveStaffIdForUser } from '@/modules/fleet/parking/staffLookup';
import { isValidUUID } from '@/modules/fleet/services/mileageUtils';
import { IncidentAccessDeniedError, IncidentNotFoundError, transitionIncident } from '@/modules/fleet/incidents/reviewService';
import { IncidentValidationError, parseTransitionBody } from '@/modules/fleet/incidents/reviewValidation';
import { IncidentTransitionConflictError, IncidentTransitionValidationError } from '@/modules/fleet/incidents/reviewTransitions';

interface Request extends NextApiRequest { user?: { id: string; role: string } }

async function handler(req: Request, res: NextApiResponse): Promise<void> {
  const user = req.user;
  if (!user) return apiResponse.unauthorized(res);
  const incidentId = req.query.incidentId;
  if (typeof incidentId !== 'string' || !isValidUUID(incidentId)) return apiResponse.badRequest(res, 'A valid incidentId is required');
  try {
    const parsed = parseTransitionBody(req.body);
    const staffId = await resolveStaffIdForUser(user.id);
    // The actor is always the authenticated session user — never a value from the request body.
    const result = await transitionIncident({
      incidentId, actionType: parsed.actionType, actorUserId: user.id, note: parsed.note, outcome: parsed.outcome,
      linkedIncidentReference: parsed.linkedIncidentReference, requestCorrelationId: parsed.requestCorrelationId,
    }, { userId: user.id, staffId, role: user.role });
    return apiResponse.success(res, result);
  } catch (error) {
    if (error instanceof IncidentValidationError || error instanceof IncidentTransitionValidationError) return apiResponse.badRequest(res, error.message);
    if (error instanceof IncidentAccessDeniedError) return apiResponse.forbidden(res, error.message);
    if (error instanceof IncidentNotFoundError) return apiResponse.notFound(res, 'Incident', incidentId);
    if (error instanceof IncidentTransitionConflictError) return apiResponse.conflict(res, error.message);
    log.error('Failed to act on Fleet incident', { error, incidentId }, 'fleet');
    return apiResponse.internalError(res, error);
  }
}

async function route(req: Request, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  return withPermission('fleet.incidents', 'edit')(handler)(req, res);
}
export default withAuth(route);
