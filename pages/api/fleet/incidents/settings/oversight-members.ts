import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import { IncidentValidationError } from '@/modules/fleet/incidents/reviewValidation';
import { parseOversightAddBody, parseOversightEndBody } from '@/modules/fleet/incidents/incidentSettingsValidation';
import { isActiveFibreFlowUser } from '@/modules/fleet/incidents/reviewScope';
import {
  IncidentSettingsValidationError, OversightMembershipConflictError, OversightMembershipNotFoundError,
  addOversightMember, endOversightMembership, listOversightMembers,
} from '@/modules/fleet/incidents/settingsRepository';

interface Request extends NextApiRequest { user?: { id: string; role: string } }

async function handleGet(req: Request, res: NextApiResponse): Promise<void> {
  const activeOnly = req.query.activeOnly !== 'false';
  return apiResponse.success(res, await listOversightMembers({ activeOnly }));
}

async function handlePost(req: Request, res: NextApiResponse): Promise<void> {
  const parsed = parseOversightAddBody(req.body);
  if (!await isActiveFibreFlowUser(parsed.userId)) return apiResponse.badRequest(res, 'userId must be an active FibreFlow user');
  // The session actor is always used for `added_by` — never any actorUserId in the request body.
  const created = await addOversightMember({ userId: parsed.userId, effectiveFrom: parsed.effectiveFrom, reason: parsed.reason, actorUserId: req.user!.id });
  return apiResponse.created(res, created);
}

async function handleDelete(req: Request, res: NextApiResponse): Promise<void> {
  const parsed = parseOversightEndBody(req.body);
  // Membership is ended, never deleted — full history stays queryable through GET.
  const ended = await endOversightMembership(parsed.membershipId, req.user!.id, parsed.reason, parsed.endedAt);
  return apiResponse.success(res, ended);
}

async function handler(req: Request, res: NextApiResponse): Promise<void> {
  const user = req.user;
  if (!user) return apiResponse.unauthorized(res);
  try {
    if (req.method === 'GET') return await handleGet(req, res);
    if (req.method === 'POST') return await handlePost(req, res);
    return await handleDelete(req, res);
  } catch (error) {
    if (error instanceof IncidentValidationError || error instanceof IncidentSettingsValidationError) return apiResponse.badRequest(res, error.message);
    if (error instanceof OversightMembershipConflictError) return apiResponse.conflict(res, error.message);
    if (error instanceof OversightMembershipNotFoundError) return apiResponse.notFound(res, 'Oversight membership');
    log.error('Failed to manage Fleet incident oversight membership', { error, method: req.method }, 'fleet');
    return apiResponse.internalError(res, error);
  }
}

async function route(req: Request, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET' && req.method !== 'POST' && req.method !== 'DELETE') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET', 'POST', 'DELETE']);
  }
  const action = req.method === 'GET' ? 'view' : 'edit';
  return withPermission('fleet.incidents-settings', action)(handler)(req, res);
}
export default withAuth(route);
