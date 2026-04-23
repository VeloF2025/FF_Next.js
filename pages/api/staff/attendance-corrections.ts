/**
 * GET /api/staff/attendance-corrections?status=pending|approved|rejected|cancelled|all&limit=N
 *
 * Supervisor review queue. Default status=pending, limit=50.
 * RBAC: people.staff.attendance.corrections, view.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import {
  withAuth,
  withPermission,
  type AuthenticatedNextApiRequest,
} from '@/lib/auth/middleware';
import {
  listAdjustmentsForReview,
  type AdjustmentStatus,
} from '@/modules/attendance/corrections/queries';
import { staffIdsSupervisedBy } from '@/services/attendance/supervisorScope';
import { getStaffIdForUser } from '@/services/staff/staffAccessService';

const VALID_STATUSES: readonly (AdjustmentStatus | 'all')[] = [
  'pending',
  'approved',
  'rejected',
  'cancelled',
  'all',
];

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'GET') {
    apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
    return;
  }
  const rawStatus = typeof req.query.status === 'string' ? req.query.status : 'pending';
  if (!VALID_STATUSES.includes(rawStatus as AdjustmentStatus | 'all')) {
    apiResponse.badRequest(res, `status must be one of: ${VALID_STATUSES.join(', ')}`);
    return;
  }
  const statusFilter = rawStatus as AdjustmentStatus | 'all';
  const limitRaw = typeof req.query.limit === 'string' ? Number(req.query.limit) : 50;
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.trunc(limitRaw) : 50;

  try {
    // Scope the review queue to staff the viewer supervises. super_admin
    // / admin see everything (scope=null disables the filter). A viewer
    // without a linked staff record OR with no supervisees gets an empty
    // list — consistent with the per-item gate on corrections-review.
    const user = (req as AuthenticatedNextApiRequest).user;
    let scopedToStaffIds: string[] | null;
    if (user.role === 'super_admin' || user.role === 'admin') {
      scopedToStaffIds = null;
    } else {
      const viewerStaffId = await getStaffIdForUser(user.id);
      scopedToStaffIds = viewerStaffId
        ? await staffIdsSupervisedBy(viewerStaffId)
        : [];
    }

    const adjustments = await listAdjustmentsForReview({
      statusFilter,
      limit,
      scopedToStaffIds,
    });
    apiResponse.success(res, { adjustments, statusFilter });
  } catch (err) {
    log.error('[staff-corrections-list] failed', {
      statusFilter,
      error: err instanceof Error ? err.message : String(err),
    });
    apiResponse.internalError(res, err);
  }
}

export default withAuth(
  withPermission('people.staff.attendance.corrections', 'view')(handler)
);
