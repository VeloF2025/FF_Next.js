import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import { AssignmentServiceError } from '@/modules/fleet/assignments/bulkAssignmentService';
import {
  authorizedAssignmentProjectIds,
  canEditAssignmentProject,
} from '@/modules/fleet/assignments/projectScope';
import { getProposal } from '@/modules/fleet/assignments/inference/proposalQueries';
import { ApplyProposalError, applyProposal, revertProposal } from '@/modules/fleet/assignments/inference/applyService';
import { resolveStaffIdForUser } from '@/modules/fleet/parking/staffLookup';
import { isValidUUID } from '@/modules/fleet/services/mileageUtils';

interface ApplyRequest extends NextApiRequest {
  user?: { id: string; role: string };
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

interface ApplyBody {
  vehicleId: string;
  startDate: string;
  endDate: string;
  confirmWarnings: boolean;
}

function parseApplyBody(value: unknown): ApplyBody | string {
  const body = value !== null && typeof value === 'object' ? value as Record<string, unknown> : {};
  if (typeof body.vehicleId !== 'string' || !isValidUUID(body.vehicleId)) {
    return 'vehicleId must be a valid UUID';
  }
  if (typeof body.startDate !== 'string' || !ISO_DATE.test(body.startDate)) {
    return 'startDate must be YYYY-MM-DD';
  }
  if (typeof body.endDate !== 'string' || !ISO_DATE.test(body.endDate)) {
    return 'endDate must be YYYY-MM-DD';
  }
  if (body.endDate < body.startDate) return 'endDate must not precede startDate';
  if (body.confirmWarnings !== undefined && typeof body.confirmWarnings !== 'boolean') {
    return 'confirmWarnings must be a boolean';
  }
  return {
    vehicleId: body.vehicleId, startDate: body.startDate, endDate: body.endDate,
    confirmWarnings: body.confirmWarnings === true,
  };
}

/**
 * Authorizes every project the proposal touches before either branch runs.
 *
 * applyService asserts scope too, but that is defence in depth for callers that
 * bypass this route; the route needs its own check because reverting previously
 * had none at all, and applying only got one deep inside commitAssignments -
 * after `no_driver` and `no_site_for_project` had already leaked.
 */
async function authorizeVehicle(
  vehicleId: string, userId: string, staffId: string | null, role: string,
): Promise<boolean> {
  const proposal = await getProposal(vehicleId);
  if (!proposal) return false;
  const touched = [proposal.decidedProjectId, proposal.inferredProjectId]
    .filter((projectId): projectId is string => typeof projectId === 'string');
  if (touched.length === 0) return role === 'super_admin' || role === 'admin';
  for (const projectId of new Set(touched)) {
    if (!await canEditAssignmentProject(userId, staffId, role, projectId)) return false;
  }
  return true;
}

/** Maps a service error's own status onto the matching apiResponse helper. */
function sendServiceError(res: NextApiResponse, status: number, message: string, code: string): void {
  const details = { code };
  if (status === 404) return apiResponse.notFound(res, message, code);
  if (status === 403) return apiResponse.forbidden(res, message);
  if (status === 400) return apiResponse.badRequest(res, message, details);
  return apiResponse.conflict(res, message, details);
}

async function routeHandler(req: ApplyRequest, res: NextApiResponse) {
  const user = req.user;
  if (!user) return apiResponse.unauthorized(res);

  const staffId = await resolveStaffIdForUser(user.id);
  const allProjects = user.role === 'super_admin' || user.role === 'admin';
  const authorizedProjectIds = await authorizedAssignmentProjectIds(user.id, staffId, user.role, 'edit');
  const scope = { allProjects, authorizedProjectIds };
  const actor = { userId: user.id, staffId: staffId ?? undefined, role: user.role };

  try {
    if (req.method === 'POST') {
      const body = parseApplyBody(req.body);
      if (typeof body === 'string') return apiResponse.badRequest(res, body);
      if (!await authorizeVehicle(body.vehicleId, user.id, staffId, user.role)) {
        return apiResponse.forbidden(res, 'You cannot apply proposals for this project');
      }
      const result = await applyProposal(body.vehicleId, {
        startDate: body.startDate, endDate: body.endDate, confirmWarnings: body.confirmWarnings,
      }, scope, actor);
      return apiResponse.created(res, result, 'Proposal applied to the roster');
    }

    const body = req.body !== null && typeof req.body === 'object'
      ? req.body as Record<string, unknown> : {};
    if (typeof body.vehicleId !== 'string' || !isValidUUID(body.vehicleId)) {
      return apiResponse.badRequest(res, 'vehicleId must be a valid UUID');
    }
    if (typeof body.endDate !== 'string' || !ISO_DATE.test(body.endDate)) {
      return apiResponse.badRequest(res, 'endDate must be YYYY-MM-DD');
    }
    if (!await authorizeVehicle(body.vehicleId, user.id, staffId, user.role)) {
      return apiResponse.forbidden(res, 'You cannot revert proposals for this project');
    }
    await revertProposal(body.vehicleId, body.endDate, scope, actor);
    return apiResponse.success(res, { vehicleId: body.vehicleId }, 'Application reverted');
  } catch (error) {
    if (error instanceof ApplyProposalError) return sendServiceError(res, error.status, error.message, error.code);
    if (error instanceof AssignmentServiceError) return sendServiceError(res, error.status, error.message, error.code);
    log.error('Failed to apply a site inference proposal', { error }, 'fleet');
    return apiResponse.internalError(res, error);
  }
}

async function permissionRouted(req: ApplyRequest, res: NextApiResponse) {
  if (req.method !== 'POST' && req.method !== 'DELETE') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST', 'DELETE']);
  }
  return withPermission('fleet.assignments', 'edit')(routeHandler)(req, res);
}

export default withAuth(permissionRouted);
