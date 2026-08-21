import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import { resolveStaffIdForUser } from '@/modules/fleet/parking/staffLookup';
import { isValidUUID } from '@/modules/fleet/services/mileageUtils';
import { IncidentNotFoundError } from '@/modules/fleet/incidents/incidentRepository';
import { RETENTION_HOLD_CATEGORIES } from '@/modules/fleet/incidents/analytics/types';
import type { RetentionHoldCategory } from '@/modules/fleet/incidents/analytics/types';
import {
  RetentionHoldAccessDeniedError, RetentionHoldConflictError, RetentionHoldValidationError,
  createRetentionHold, listIncidentHoldsForViewer, type RetentionHoldActorScope,
} from '@/modules/fleet/incidents/retention/holdService';

interface Request extends NextApiRequest { user?: { id: string; role: string } }

interface ParsedCreateBody {
  category: RetentionHoldCategory;
  reason: string;
  ownerUserId: string;
  nextReviewAt: string;
}

/**
 * Shape validation only. Whether the category is permitted right now, whether
 * the review date is inside the effective maximum, and whether the owner is an
 * active user are settings-dependent decisions and belong to the service, so
 * one rule set serves HTTP and any future non-HTTP caller.
 */
function parseCreateBody(body: unknown): ParsedCreateBody {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new RetentionHoldValidationError('Request body is required');
  }
  const value = body as Record<string, unknown>;
  const category = value.category;
  if (typeof category !== 'string' || !(RETENTION_HOLD_CATEGORIES as readonly string[]).includes(category)) {
    throw new RetentionHoldValidationError('category must be one of the known retention hold categories');
  }
  const reason = value.reason;
  if (typeof reason !== 'string') throw new RetentionHoldValidationError('reason is required');
  const ownerUserId = value.ownerUserId;
  if (typeof ownerUserId !== 'string') throw new RetentionHoldValidationError('ownerUserId is required');
  const nextReviewAt = value.nextReviewAt;
  if (typeof nextReviewAt !== 'string') throw new RetentionHoldValidationError('nextReviewAt is required');
  return { category: category as RetentionHoldCategory, reason, ownerUserId, nextReviewAt };
}

async function handler(req: Request, res: NextApiResponse): Promise<void> {
  const user = req.user;
  if (!user) return apiResponse.unauthorized(res);
  const incidentId = req.query.incidentId;
  if (typeof incidentId !== 'string' || !isValidUUID(incidentId)) {
    return apiResponse.badRequest(res, 'A valid incidentId is required');
  }

  try {
    const staffId = await resolveStaffIdForUser(user.id);
    // The actor is always the authenticated session — never a body value.
    const actor: RetentionHoldActorScope = { userId: user.id, staffId, role: user.role };
    if (req.method === 'GET') {
      return apiResponse.success(res, await listIncidentHoldsForViewer(incidentId, actor));
    }
    const parsed = parseCreateBody(req.body);
    const hold = await createRetentionHold({ incidentId, ...parsed }, actor, new Date().toISOString());
    return apiResponse.success(res, hold);
  } catch (error) {
    if (error instanceof RetentionHoldValidationError) return apiResponse.badRequest(res, error.message);
    if (error instanceof RetentionHoldAccessDeniedError) return apiResponse.forbidden(res, error.message);
    if (error instanceof IncidentNotFoundError) return apiResponse.notFound(res, 'Incident', incidentId);
    if (error instanceof RetentionHoldConflictError) return apiResponse.conflict(res, error.message);
    log.error('Failed to handle Fleet retention holds', { error, incidentId }, 'fleet');
    return apiResponse.internalError(res, error);
  }
}

async function route(req: Request, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET', 'POST']);
  }
  return withPermission('fleet.incidents', 'view')(handler)(req, res);
}
export default withAuth(route);
