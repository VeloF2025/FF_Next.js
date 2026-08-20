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
    // Bulk accepts acknowledgement only. Every incident is validated before any is mutated;
    // a conflict discovered mid-loop is returned in `outcome.conflicts`, not thrown, because
    // earlier ids have already committed by then (reviewTransitions.runBulkAcknowledge).
    const outcome = await bulkAcknowledgeIncidents(incidentIds, { userId: user.id, staffId, role: user.role }, null);
    return apiResponse.success(res, outcome);
  } catch (error) {
    if (error instanceof IncidentValidationError || error instanceof IncidentTransitionValidationError) return apiResponse.badRequest(res, error.message);
    if (error instanceof IncidentAccessDeniedError || error instanceof IncidentTransitionForbiddenError) return apiResponse.forbidden(res, error.message);
    if (error instanceof IncidentNotFoundError) return apiResponse.notFound(res, 'Incident');
    // Still reachable: runBulkAcknowledge's pre-validation pass rejects an already-terminal
    // incident before anything mutates. Only a conflict discovered mid-loop is returned as
    // data instead, because by then earlier ids have committed.
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
