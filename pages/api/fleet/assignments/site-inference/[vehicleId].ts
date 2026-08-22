import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import { canEditAssignmentProject } from '@/modules/fleet/assignments/projectScope';
import { getProposal } from '@/modules/fleet/assignments/inference/proposalQueries';
import {
  InferenceDecisionError,
  recordDecision,
  type DecisionInput,
} from '@/modules/fleet/assignments/inference/proposalRepository';
import type { InferenceDecision } from '@/modules/fleet/assignments/inference/types';
import { resolveStaffIdForUser } from '@/modules/fleet/parking/staffLookup';
import { isValidUUID } from '@/modules/fleet/services/mileageUtils';

interface DecisionRequest extends NextApiRequest {
  user?: { id: string; role: string };
}

const DECISIONS: readonly InferenceDecision[] = ['assigned', 'rejected', 'roaming_confirmed'];

interface ParsedDecision {
  input: DecisionInput;
  /** The project whose scope authorizes this decision, if any. */
  scopeProjectId: string | null;
}

function parseBody(value: unknown, inferredProjectId: string | null): ParsedDecision | string {
  const body = value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
  const raw = body.decision;
  if (typeof raw !== 'string' || !DECISIONS.includes(raw as InferenceDecision)) {
    return `decision must be one of ${DECISIONS.join(', ')}`;
  }
  const decision: InferenceDecision = raw as InferenceDecision;
  if (body.note !== undefined && body.note !== null
    && (typeof body.note !== 'string' || body.note.trim().length === 0 || body.note.length > 500)) {
    return 'note must be between 1 and 500 characters';
  }
  const note = typeof body.note === 'string' ? body.note.trim() : null;

  if (decision !== 'assigned') {
    return {
      input: { decision, decidedProjectId: null, decidedFrom: null, evidenceComputedAt: null, note },
      scopeProjectId: null,
    };
  }

  const override = body.overrideProjectId;
  if (override !== undefined && override !== null
    && (typeof override !== 'string' || !isValidUUID(override))) {
    return 'overrideProjectId must be a valid UUID';
  }
  const overrideProjectId = typeof override === 'string' ? override : null;
  // An assignment with no override takes the machine's project. If the machine
  // named none, there is nothing to accept and the caller must say which.
  const decidedProjectId = overrideProjectId ?? inferredProjectId;
  if (decidedProjectId === null) {
    return 'This proposal names no project; supply overrideProjectId to assign one';
  }
  return {
    input: {
      decision: 'assigned',
      decidedProjectId,
      decidedFrom: overrideProjectId === null ? 'inference' : 'override',
      evidenceComputedAt: null,
      note,
    },
    scopeProjectId: decidedProjectId,
  };
}

async function routeHandler(req: DecisionRequest, res: NextApiResponse) {
  const user = req.user;
  if (!user) return apiResponse.unauthorized(res);

  const vehicleId = req.query.vehicleId;
  if (typeof vehicleId !== 'string' || !isValidUUID(vehicleId)) {
    return apiResponse.badRequest(res, 'vehicleId must be a valid UUID');
  }

  const proposal = await getProposal(vehicleId);
  if (!proposal) return apiResponse.notFound(res, 'Site inference proposal', vehicleId);

  if (req.method === 'GET') return apiResponse.success(res, proposal);

  const parsed = parseBody(req.body, proposal.inferredProjectId);
  if (typeof parsed === 'string') return apiResponse.badRequest(res, parsed);

  // Rejecting or confirming roaming names no project, so it is authorized
  // against whatever the machine proposed instead - otherwise a scoped manager
  // could dismiss a proposal belonging to a project they cannot see.
  const scopeProjectId = parsed.scopeProjectId ?? proposal.inferredProjectId;
  const staffId = await resolveStaffIdForUser(user.id);
  if (scopeProjectId !== null
    && !await canEditAssignmentProject(user.id, staffId, user.role, scopeProjectId)) {
    return apiResponse.forbidden(res, 'You cannot decide proposals for this project');
  }
  if (scopeProjectId === null && user.role !== 'super_admin' && user.role !== 'admin') {
    return apiResponse.forbidden(res, 'Only an administrator can decide a proposal with no project');
  }

  try {
    await recordDecision(vehicleId, {
      ...parsed.input,
      evidenceComputedAt: new Date(proposal.computedAt),
    }, user.id);
    return apiResponse.success(res, await getProposal(vehicleId), 'Decision recorded');
  } catch (error) {
    if (error instanceof InferenceDecisionError) {
      return apiResponse.badRequest(res, error.message, { code: error.code });
    }
    log.error('Failed to record a site inference decision', { error, vehicleId }, 'fleet');
    return apiResponse.internalError(res, error);
  }
}

async function permissionRouted(req: DecisionRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'PATCH') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET', 'PATCH']);
  }
  const action = req.method === 'GET' ? 'view' : 'edit';
  return withPermission('fleet.assignments', action)(routeHandler)(req, res);
}

export default withAuth(permissionRouted);
