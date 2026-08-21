import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import { resolveStaffIdForUser } from '@/modules/fleet/parking/staffLookup';
import { isValidUUID } from '@/modules/fleet/services/mileageUtils';
import { IncidentNotFoundError } from '@/modules/fleet/incidents/incidentRepository';
import {
  RetentionHoldAccessDeniedError, RetentionHoldConflictError, RetentionHoldValidationError,
  releaseRetentionHold, type RetentionHoldActorScope,
} from '@/modules/fleet/incidents/retention/holdService';

interface Request extends NextApiRequest { user?: { id: string; role: string } }

async function handler(req: Request, res: NextApiResponse): Promise<void> {
  const user = req.user;
  if (!user) return apiResponse.unauthorized(res);
  const incidentId = req.query.incidentId;
  if (typeof incidentId !== 'string' || !isValidUUID(incidentId)) {
    return apiResponse.badRequest(res, 'A valid incidentId is required');
  }
  const holdId = req.query.holdId;
  if (typeof holdId !== 'string' || !isValidUUID(holdId)) {
    return apiResponse.badRequest(res, 'A valid holdId is required');
  }
  const body = req.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return apiResponse.badRequest(res, 'Request body is required');
  }
  const { releaseReason } = body as Record<string, unknown>;
  if (typeof releaseReason !== 'string') return apiResponse.badRequest(res, 'releaseReason is required');

  try {
    const staffId = await resolveStaffIdForUser(user.id);
    const actor: RetentionHoldActorScope = { userId: user.id, staffId, role: user.role };
    // Both ids come from the path, never from the body; the service checks
    // that the hold really belongs to the incident the URL names.
    const hold = await releaseRetentionHold({ holdId, incidentId, releaseReason }, actor, new Date().toISOString());
    return apiResponse.success(res, hold);
  } catch (error) {
    if (error instanceof RetentionHoldValidationError) return apiResponse.badRequest(res, error.message);
    if (error instanceof RetentionHoldAccessDeniedError) return apiResponse.forbidden(res, error.message);
    if (error instanceof IncidentNotFoundError) return apiResponse.notFound(res, 'Retention hold', holdId);
    if (error instanceof RetentionHoldConflictError) return apiResponse.conflict(res, error.message);
    log.error('Failed to release Fleet retention hold', { error, holdId }, 'fleet');
    return apiResponse.internalError(res, error);
  }
}

async function route(req: Request, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  return withPermission('fleet.incidents', 'view')(handler)(req, res);
}
export default withAuth(route);
