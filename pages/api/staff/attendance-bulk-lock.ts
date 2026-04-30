/**
 * POST /api/staff/attendance-bulk-lock
 *
 * Body: {
 *   week_start_dates: string[],         // ISO Monday YYYY-MM-DD, ≥1
 *   reason: string,                     // ≥ 10 chars
 *   staff_ids?: string[]                // optional intersection; never expands scope
 * }
 *
 * FR-BULK-* compliance:
 *   - 04: confirm modal data shape — caller sends reason text inline
 *   - 05: every implied/explicit staff_id is scope-checked BEFORE the
 *         transaction opens. Out-of-scope = 403 for the whole batch.
 *   - 06: one audit row per affected staff per week, all sharing a
 *         single batch_id. Append-only.
 *   - 07: requires `people.staff.attendance.bulk_lock` (super_admin /
 *         admin only — see migration 332).
 *
 * Returns { batch_id, weeks, locks_created, staff_audited }.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import {
  withAuth,
  withPermission,
  type AuthenticatedNextApiRequest,
} from '@/lib/auth/middleware';
import {
  BulkConflict,
  BulkScopeViolation,
  BulkValidationError,
  runBulkLock,
  validateReason,
} from '@/services/attendance/bulkActions';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map((x) => String(x)).filter((s) => s.length > 0);
  return [];
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
    return;
  }
  const user = (req as AuthenticatedNextApiRequest).user;
  if (!user?.id) {
    apiResponse.unauthorized(res);
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;

  let weekStartDates: string[];
  let reason: string;
  let staffIdsOverride: string[] | undefined;
  try {
    weekStartDates = asStringArray(body.week_start_dates);
    if (weekStartDates.length === 0) {
      throw new BulkValidationError('week_start_dates must be a non-empty array');
    }
    reason = validateReason(body.reason);
    const overrideRaw = asStringArray(body.staff_ids);
    if (overrideRaw.length > 0) {
      const bad = overrideRaw.filter((id) => !UUID_RE.test(id));
      if (bad.length > 0) {
        throw new BulkValidationError(`staff_ids contains ${bad.length} non-UUID value(s)`);
      }
      staffIdsOverride = overrideRaw;
    }
  } catch (err) {
    if (err instanceof BulkValidationError) {
      apiResponse.badRequest(res, err.message);
      return;
    }
    throw err;
  }

  try {
    const result = await runBulkLock(user, {
      weekStartDates,
      reason,
      staffIdsOverride,
    });
    log.info('[bulk-lock] ok', {
      userId: user.id,
      batchId: result.batchId,
      weeks: result.weeks,
      staffAudited: result.staffAudited,
      locksCreated: result.locksCreated,
    });
    apiResponse.success(res, {
      batch_id: result.batchId,
      weeks: result.weeks,
      locks_created: result.locksCreated,
      staff_audited: result.staffAudited,
    });
  } catch (err) {
    if (err instanceof BulkValidationError) {
      apiResponse.badRequest(res, err.message);
      return;
    }
    if (err instanceof BulkScopeViolation) {
      apiResponse.error(
        res,
        ErrorCode.FORBIDDEN,
        err.message,
        { outOfScopeStaffIds: err.outOfScopeStaffIds.slice(0, 20) }
      );
      return;
    }
    if (err instanceof BulkConflict) {
      apiResponse.error(res, ErrorCode.CONFLICT, err.message);
      return;
    }
    log.error('[bulk-lock] failed', {
      userId: user.id,
      weekStartDates,
      error: err instanceof Error ? err.message : String(err),
    });
    apiResponse.internalError(res, err);
  }
}

export default withAuth(
  withPermission('people.staff.attendance.bulk_lock', 'create')(handler)
);
