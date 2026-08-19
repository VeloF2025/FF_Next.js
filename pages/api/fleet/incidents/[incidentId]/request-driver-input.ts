import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import { resolveStaffIdForUser } from '@/modules/fleet/parking/staffLookup';
import { isValidUUID } from '@/modules/fleet/services/mileageUtils';
import { IncidentNotFoundError } from '@/modules/fleet/incidents/incidentRepository';
import {
  DriverInputAccessDeniedError,
  DriverInputRequestConflictError,
  DriverInputRequestValidationError,
  requestDriverInput,
  type DriverInputActorScope,
} from '@/modules/fleet/incidents/driver/requestInputService';
import type { RequestDriverInputCommand } from '@/modules/fleet/incidents/driver/types';

interface Request extends NextApiRequest { user?: { id: string; role: string } }

type ParsedRequestBody = Omit<RequestDriverInputCommand, 'incidentId'>;

/** Type-shape validation only. Semantic validation (blank-guidance normalization, respondBy future-instant check, and idempotency-key content rules) lives in `requestDriverInput` itself, so both API and any future non-HTTP caller share one rule set. */
function parseBody(body: unknown): ParsedRequestBody {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new DriverInputRequestValidationError('Request body is required');
  const value = body as Record<string, unknown>;

  const idempotencyKey = value.idempotencyKey;
  if (typeof idempotencyKey !== 'string' || !idempotencyKey.trim()) throw new DriverInputRequestValidationError('idempotencyKey is required');

  const guidance = value.guidance;
  if (guidance !== undefined && guidance !== null && typeof guidance !== 'string') {
    throw new DriverInputRequestValidationError('guidance must be a string');
  }
  const respondBy = value.respondBy;
  if (respondBy !== undefined && respondBy !== null && typeof respondBy !== 'string') {
    throw new DriverInputRequestValidationError('respondBy must be a string');
  }

  return {
    guidance: (guidance as string | null | undefined) ?? null,
    respondBy: (respondBy as string | null | undefined) ?? null,
    idempotencyKey,
  };
}

async function handler(req: Request, res: NextApiResponse): Promise<void> {
  const user = req.user;
  if (!user) return apiResponse.unauthorized(res);
  const incidentId = req.query.incidentId;
  if (typeof incidentId !== 'string' || !isValidUUID(incidentId)) return apiResponse.badRequest(res, 'A valid incidentId is required');

  try {
    const parsed = parseBody(req.body);
    const staffId = await resolveStaffIdForUser(user.id);
    // The actor scope is always the authenticated session — never a value from the request body.
    const actorScope: DriverInputActorScope = { userId: user.id, staffId, role: user.role };
    const result = await requestDriverInput({ incidentId, ...parsed }, actorScope);
    return apiResponse.success(res, result);
  } catch (error) {
    if (error instanceof DriverInputRequestValidationError) return apiResponse.badRequest(res, error.message);
    if (error instanceof DriverInputAccessDeniedError) return apiResponse.forbidden(res, error.message);
    if (error instanceof IncidentNotFoundError) return apiResponse.notFound(res, 'Incident', incidentId);
    if (error instanceof DriverInputRequestConflictError) return apiResponse.conflict(res, error.message);
    log.error('Failed to request Fleet driver input', { error, incidentId }, 'fleet');
    return apiResponse.internalError(res, error);
  }
}

async function route(req: Request, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  return withPermission('fleet.incidents', 'edit')(handler)(req, res);
}
export default withAuth(route);
