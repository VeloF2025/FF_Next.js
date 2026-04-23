/**
 * GET    /api/staff/attendance-weekly-locks
 *   list recent locks (default 50)
 *
 * POST   /api/staff/attendance-weekly-locks
 *   body: { week_start_date, lock_reason?, action: 'lock' | 'unlock', unlock_reason? }
 *   lock/unlock a specific ISO-week Monday.
 *
 * RBAC: people.staff.attendance.locks. Lock requires create; unlock
 * requires edit.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import {
  withAuth,
  withPermission,
  type AuthenticatedNextApiRequest,
} from '@/lib/auth/middleware';
import { userHasPermission } from '@/lib/permissions';
import {
  listLocks,
  upsertWeeklyLock,
  unlockWeek,
} from '@/modules/attendance/corrections/lockQueries';

function isMondayYmd(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  if (d.toISOString().slice(0, 10) !== s) return false;
  return d.getUTCDay() === 1;
}

async function handleGet(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  const limitRaw = typeof req.query.limit === 'string' ? Number(req.query.limit) : 50;
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.trunc(limitRaw) : 50;
  try {
    const locks = await listLocks(limit);
    apiResponse.success(res, { locks });
  } catch (err) {
    log.error('[staff-weekly-locks] list failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    apiResponse.internalError(res, err);
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  const authed = req as AuthenticatedNextApiRequest;
  const actor = authed.user?.id;
  if (!actor) {
    apiResponse.unauthorized(res);
    return;
  }
  const body = (req.body ?? {}) as Record<string, unknown>;
  const weekStart = typeof body.week_start_date === 'string' ? body.week_start_date : '';
  const action = body.action as 'lock' | 'unlock' | undefined;
  const lockReason = typeof body.lock_reason === 'string' ? body.lock_reason.trim() : null;
  const unlockReason = typeof body.unlock_reason === 'string' ? body.unlock_reason.trim() : '';

  if (!isMondayYmd(weekStart)) {
    apiResponse.badRequest(res, 'week_start_date must be a Monday YYYY-MM-DD');
    return;
  }
  if (action !== 'lock' && action !== 'unlock') {
    apiResponse.badRequest(res, "action must be 'lock' or 'unlock'");
    return;
  }

  // Per-action permission gate. The outer withPermission('view') lets
  // any lock-viewer reach this handler (site_supervisor needs view to
  // see the locks panel); the action-level check here enforces that
  // only roles with create can lock, edit can unlock. RBAC migration 320
  // grants site_supervisor view:true, create:false, edit:false — so
  // supervisor reaches here but bounces at 403.
  const requiredAction = action === 'lock' ? 'create' : 'edit';
  if (authed.user.role !== 'super_admin') {
    const allowed = await userHasPermission(
      actor,
      'people.staff.attendance.locks',
      requiredAction
    );
    if (!allowed) {
      apiResponse.error(
        res,
        ErrorCode.FORBIDDEN,
        `Missing ${requiredAction} permission on people.staff.attendance.locks`
      );
      return;
    }
  }

  try {
    if (action === 'lock') {
      const row = await upsertWeeklyLock({
        weekStartDate: weekStart,
        lockedBy: actor,
        lockReason: lockReason && lockReason.length > 0 ? lockReason : null,
      });
      apiResponse.success(res, { lock: row });
      return;
    }
    if (!unlockReason || unlockReason.length < 10) {
      apiResponse.badRequest(res, 'unlock_reason must be at least 10 characters (audit requirement)');
      return;
    }
    const row = await unlockWeek({
      weekStartDate: weekStart,
      unlockedBy: actor,
      unlockReason,
    });
    if (!row) {
      apiResponse.notFound(res, 'ActiveLock', weekStart);
      return;
    }
    apiResponse.success(res, { lock: row });
  } catch (err) {
    log.error('[staff-weekly-locks] action failed', {
      weekStart,
      action,
      error: err instanceof Error ? err.message : String(err),
    });
    apiResponse.internalError(res, err);
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method === 'GET') return handleGet(req, res);
  if (req.method === 'POST') return handlePost(req, res);
  apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET', 'POST']);
}

// Both methods gated on people.staff.attendance.locks view; POST handler
// internally differentiates lock (create) vs unlock (edit). A stricter
// split would use two separate endpoints; kept together to match the
// codebase's one-endpoint-per-resource convention for lock management.
export default withAuth(
  withPermission('people.staff.attendance.locks', 'view')(handler)
);
