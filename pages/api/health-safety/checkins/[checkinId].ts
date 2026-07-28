/**
 * PATCH /api/health-safety/checkins/[checkinId] — H&S officer clears a blocked
 * worker.
 *
 * Clearing is an H&S-module action gated by the existing
 * `projects.health-safety` edit permission (via withHsPermission), not a new
 * "supervisor" role: inventing a parallel role system for one action would be
 * a bigger change than the feature it serves. Hein's decision, 2026-07-28.
 *
 * The override is recorded as its own clearance state (`cleared_by_override`)
 * rather than flipping the row to `cleared`, so the safety file can always
 * distinguish "was never blocked" from "was blocked and a named person let
 * them work".
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { getAuthUser } from '@/lib/auth';
import { log } from '@/lib/logger';
import { logHsActivity } from '@/modules/health-safety/services/activityLog';
import { clearBlockedCheckin } from '@/modules/health-safety/services/checkinWrite';
import { withHsPermission } from '@/modules/health-safety/services/hsAuth';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { checkinId } = req.query;
  if (!checkinId || typeof checkinId !== 'string') {
    return apiResponse.badRequest(res, 'checkinId is required');
  }
  if (!UUID_RE.test(checkinId)) {
    return apiResponse.badRequest(res, 'checkinId must be a uuid');
  }
  if (req.method !== 'PATCH') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['PATCH']);
  }

  try {
    const user = getAuthUser(req);
    if (!user?.id) {
      // An override must name who made it — the DB enforces this too.
      return apiResponse.badRequest(res, 'An authenticated user is required to clear a check-in');
    }

    const note =
      typeof req.body?.clearance_note === 'string' && req.body.clearance_note.trim() !== ''
        ? req.body.clearance_note.trim()
        : null;
    if (!note) {
      // A bare override with no reason is unauditable, which defeats the point
      // of recording the override separately from a clean clearance.
      return apiResponse.badRequest(
        res,
        'clearance_note is required — record why this worker was cleared'
      );
    }

    const cleared = await clearBlockedCheckin(checkinId, { clearedBy: user.id, note });
    if (!cleared) {
      // Either it does not exist, or it is not blocked (already cleared, or
      // cleared by another officer between this officer loading the board and
      // acting on it).
      return apiResponse.conflict(
        res,
        'That check-in is not currently blocked — reload the board; it may already have been cleared'
      );
    }

    await logHsActivity({
      activityType: 'daily_checkin_cleared',
      entityType: 'daily_checkin',
      entityId: cleared.id as string,
      description: `Daily check-in cleared for ${cleared.worker_name}`,
      metadata: {
        blocked_reasons: cleared.blocked_reasons,
        checkin_date: cleared.checkin_date,
        note,
      },
      user,
    });

    return apiResponse.success(res, cleared);
  } catch (error) {
    log.error('[H&S Checkin Clear API] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withHsPermission(handler);
