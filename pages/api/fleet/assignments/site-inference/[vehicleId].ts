import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import {
  authorizedAssignmentProjectIds,
  canEditAssignmentProject,
} from '@/modules/fleet/assignments/projectScope';
import { getProposal, type SiteInferenceProposal } from '@/modules/fleet/assignments/inference/proposalQueries';
import { scopeProposals } from '@/modules/fleet/assignments/inference/proposalScope';
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

function isAdmin(role: string): boolean {
  return role === 'super_admin' || role === 'admin';
}

/**
 * Redacts a single proposal the same way the list route redacts many. Returns
 * null when nothing of it is visible - the caller gets a 404 rather than a 403,
 * so the response does not confirm that the vehicle exists.
 */
async function visibleProposal(
  proposal: SiteInferenceProposal,
  userId: string,
  staffId: string | null,
  role: string,
): Promise<SiteInferenceProposal | null> {
  const authorized = await authorizedAssignmentProjectIds(userId, staffId, role, 'view');
  return scopeProposals([proposal], authorized, isAdmin(role))[0] ?? null;
}

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

  const expected = body.expectedRevision;
  if (expected !== undefined && expected !== null
    && (typeof expected !== 'number' || !Number.isInteger(expected) || expected < 1)) {
    return 'expectedRevision must be a positive whole number';
  }
  const expectedRevision = typeof expected === 'number' ? expected : null;

  if (decision !== 'assigned') {
    return {
      input: {
        decision, decidedProjectId: null, decidedFrom: null, evidenceComputedAt: null,
        note, expectedRevision,
      },
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
      expectedRevision,
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
  const staffId = await resolveStaffIdForUser(user.id);

  if (req.method === 'GET') {
    // The list route redacts; this one used to hand back the raw row, which let
    // a scoped manager read any proposal by guessing a vehicle id.
    const visible = await visibleProposal(proposal, user.id, staffId, user.role);
    if (!visible) return apiResponse.notFound(res, 'Site inference proposal', vehicleId);
    return apiResponse.success(res, visible);
  }

  const parsed = parseBody(req.body, proposal.inferredProjectId);
  if (typeof parsed === 'string') return apiResponse.badRequest(res, parsed);

  // Two projects need authorizing, not one: the project being decided ONTO, and
  // the project an existing decision already points AT. Checking only the former
  // let a decision made for an out-of-scope project be taken over unseen.
  //
  // Rejecting or confirming roaming names no project, so it falls back to
  // whatever the machine proposed.
  const scopeProjectIds = [
    parsed.scopeProjectId ?? proposal.inferredProjectId,
    proposal.decidedProjectId,
  ].filter((projectId): projectId is string => typeof projectId === 'string');
  for (const projectId of new Set(scopeProjectIds)) {
    if (!await canEditAssignmentProject(user.id, staffId, user.role, projectId)) {
      return apiResponse.forbidden(res, 'You cannot decide proposals for this project');
    }
  }
  if (scopeProjectIds.length === 0 && !isAdmin(user.role)) {
    return apiResponse.forbidden(res, 'Only an administrator can decide a proposal with no project');
  }

  // Compare-and-set is enforced in SQL too, but refusing here means a caller
  // working from a stale view never reaches the write at all.
  if (parsed.input.expectedRevision !== proposal.decisionRevision) {
    return apiResponse.conflict(res,
      'Someone else changed this decision while you were looking at it; reload and decide again',
      { code: 'stale_decision' });
  }

  try {
    await recordDecision(vehicleId, {
      ...parsed.input,
      evidenceComputedAt: new Date(proposal.computedAt),
    }, user.id);
    const updated = await getProposal(vehicleId);
    return apiResponse.success(res,
      updated === null ? null : await visibleProposal(updated, user.id, staffId, user.role),
      'Decision recorded');
  } catch (error) {
    if (error instanceof InferenceDecisionError) {
      return error.code === 'already_applied' || error.code === 'stale_decision'
        ? apiResponse.conflict(res, error.message, { code: error.code })
        : apiResponse.badRequest(res, error.message, { code: error.code });
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
