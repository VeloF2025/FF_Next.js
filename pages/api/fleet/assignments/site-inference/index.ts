import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import { authorizedAssignmentProjectIds } from '@/modules/fleet/assignments/projectScope';
import { recomputeProposals } from '@/modules/fleet/assignments/inference/inferenceService';
import { listProposals } from '@/modules/fleet/assignments/inference/proposalQueries';
import { scopeProposals } from '@/modules/fleet/assignments/inference/proposalScope';
import { DEFAULT_WINDOW_DAYS } from '@/modules/fleet/assignments/inference/types';
import { resolveStaffIdForUser } from '@/modules/fleet/parking/staffLookup';

interface InferenceRequest extends NextApiRequest {
  user?: { id: string; role: string };
}

const OUTCOMES = ['confident', 'roaming', 'insufficient_data', 'no_aoi_coverage'] as const;
type Outcome = (typeof OUTCOMES)[number];

function parseWindowDays(value: unknown): number | string {
  if (value === undefined) return DEFAULT_WINDOW_DAYS;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isInteger(parsed) || parsed < 7 || parsed > 180) {
    return 'windowDays must be a whole number between 7 and 180';
  }
  return parsed;
}

function isAdmin(role: string): boolean {
  return role === 'super_admin' || role === 'admin';
}

async function handleList(req: InferenceRequest, res: NextApiResponse, userId: string, role: string) {
  const outcome = req.query.outcome;
  if (outcome !== undefined && (typeof outcome !== 'string' || !OUTCOMES.includes(outcome as Outcome))) {
    return apiResponse.badRequest(res, `outcome must be one of ${OUTCOMES.join(', ')}`);
  }
  const undecided = req.query.undecidedOnly;
  if (undecided !== undefined && undecided !== 'true' && undecided !== 'false') {
    return apiResponse.badRequest(res, 'undecidedOnly must be true or false');
  }

  const staffId = await resolveStaffIdForUser(userId);
  const authorized = await authorizedAssignmentProjectIds(userId, staffId, role, 'view');
  const proposals = await listProposals({
    outcome: outcome as Outcome | undefined,
    undecidedOnly: undecided === 'true',
  });
  return apiResponse.success(res, scopeProposals(proposals, authorized, isAdmin(role)));
}

async function routeHandler(req: InferenceRequest, res: NextApiResponse) {
  const user = req.user;
  if (!user) return apiResponse.unauthorized(res);

  if (req.method === 'GET') {
    try {
      return await handleList(req, res, user.id, user.role);
    } catch (error) {
      log.error('Failed to list fleet site inference proposals', { error }, 'fleet');
      return apiResponse.internalError(res, error);
    }
  }

  // Recompute rewrites machine evidence for every vehicle, so it is not a
  // project-scoped action - only an all-projects actor may trigger it.
  if (!isAdmin(user.role)) {
    return apiResponse.forbidden(res, 'Only an administrator can recompute site inference');
  }
  const body = req.body !== null && typeof req.body === 'object' ? req.body as Record<string, unknown> : {};
  const windowDays = parseWindowDays(body.windowDays);
  if (typeof windowDays === 'string') return apiResponse.badRequest(res, windowDays);

  try {
    const summary = await recomputeProposals({ windowDays });
    return apiResponse.success(res, {
      windowStart: summary.window.start.toISOString(),
      windowEnd: summary.window.end.toISOString(),
      vehicles: summary.results.length,
      counts: summary.counts,
    }, 'Site inference recomputed');
  } catch (error) {
    log.error('Failed to recompute fleet site inference proposals', { error, windowDays }, 'fleet');
    return apiResponse.internalError(res, error);
  }
}

async function permissionRouted(req: InferenceRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET', 'POST']);
  }
  const action = req.method === 'GET' ? 'view' : 'edit';
  return withPermission('fleet.assignments', action)(routeHandler)(req, res);
}

export default withAuth(permissionRouted);
