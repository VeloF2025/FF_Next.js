/**
 * POST /api/fleet/parking/requests/[requestId]/decide
 *
 * Approve or reject a driver's parking address request. Gated on `edit` of
 * fleet.parking-requests, not `view`: migration 483 grants viewer no access to
 * this page at all, and manager edit-but-not-delete.
 */
import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import { decideRequest } from '@/modules/fleet/parking/approvalQueries';
import { notifyParkingChangeDecided } from '@/modules/fleet/parking/decisionNotifications';
import { resolveStaffIdForUser } from '@/modules/fleet/parking/staffLookup';
import type { DecisionOutcome } from '@/modules/fleet/parking/types';

interface AuthedRequest extends NextApiRequest {
  user?: { id: string; role: string };
}

const OUTCOMES: DecisionOutcome[] = ['approved', 'rejected'];

async function handler(req: AuthedRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }

  const userId = req.user?.id;
  if (!userId) return apiResponse.unauthorized(res, 'Authentication required');

  const requestId = req.query.requestId;
  if (typeof requestId !== 'string' || requestId.length === 0) {
    return apiResponse.badRequest(res, 'A single requestId is required');
  }

  const body = (req.body ?? {}) as { outcome?: unknown; decisionNote?: unknown };
  const outcome = body.outcome;
  if (typeof outcome !== 'string' || !OUTCOMES.includes(outcome as DecisionOutcome)) {
    return apiResponse.badRequest(res, 'outcome must be "approved" or "rejected"');
  }
  const decisionNote =
    typeof body.decisionNote === 'string' && body.decisionNote.trim().length > 0
      ? body.decisionNote.trim()
      : null;

  try {
    const result = await decideRequest({
      requestId,
      outcome: outcome as DecisionOutcome,
      decidedByUserId: userId,
      decidedByStaffId: await resolveStaffIdForUser(userId),
      decisionNote,
    });

    if (!result.ok) {
      if (result.reason === 'not_found') {
        return apiResponse.notFound(res, 'Parking request', requestId);
      }
      return apiResponse.conflict(
        res,
        result.reason === 'not_pending'
          ? 'That request has already been decided.'
          : 'That driver is no longer assigned to the vehicle, so the address cannot be approved.'
      );
    }

    // Fire-and-forget: the decision is committed, and the helper swallows and
    // logs its own failures.
    void notifyParkingChangeDecided({
      driverStaffId: result.driverStaffId,
      registration: result.registration,
      outcome: outcome as DecisionOutcome,
      decisionNote,
      requestId,
    });

    return apiResponse.success(res, { decided: true });
  } catch (err) {
    log.error('[fleet/parking] decision failed', { error: err, requestId }, 'fleet');
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(withPermission('fleet.parking-requests', 'edit')(handler));
