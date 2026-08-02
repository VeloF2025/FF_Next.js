/**
 * POST /api/my/attendance-corrections — staff submit an exception-linked correction.
 * GET  /api/my/attendance-corrections — staff list their own submissions.
 *
 * Session-gated via /my portal HMAC cookie. POST delegates to the canonical
 * required-correction transaction when `exception_id` is present. Generic
 * unlinked submissions are retired so a correction cannot bypass the durable
 * day-exception state machine. GET/DELETE remain scoped to session.staffId.
 *
 * The delegated transaction validates ownership, required action, adjusted
 * evidence, week-lock state, and reason length under the canonical locks.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { sql } from '@/lib/db-pool';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import type { AttendanceSession } from '@/modules/attendance/portal/types';
import {
  listOwnAdjustments,
  countOwnAdjustmentsByStatus,
  cancelOwnAdjustment,
  type AdjustmentStatus,
} from '@/modules/attendance/corrections/queries';
import { handleRequiredCorrection } from '@/modules/attendance/workflow/requiredCorrectionRoute';
import { handleRequiredCorrectionTarget } from '@/modules/attendance/workflow/requiredCorrectionTargetRoute';

async function handlePost(
  req: NextApiRequest,
  res: NextApiResponse,
  session: AttendanceSession
): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const exceptionId = typeof body.exception_id === 'string' ? body.exception_id : '';
  if (exceptionId) {
    await handleRequiredCorrection(body, exceptionId, res, session);
    return;
  }
  apiResponse.conflict(
    res,
    'Generic attendance corrections are retired; submit the required day exception instead'
  );
}

const VALID_STATUSES: readonly (AdjustmentStatus | 'all')[] = [
  'pending',
  'approved',
  'rejected',
  'cancelled',
  'all',
];

async function handleGet(
  req: NextApiRequest,
  res: NextApiResponse,
  session: AttendanceSession
): Promise<void> {
  if (await handleRequiredCorrectionTarget(req, res, session)) return;
  const limitRaw = typeof req.query.limit === 'string' ? Number(req.query.limit) : 30;
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.trunc(limitRaw) : 30;

  const rawStatus = typeof req.query.status === 'string' ? req.query.status : 'all';
  if (!VALID_STATUSES.includes(rawStatus as AdjustmentStatus | 'all')) {
    apiResponse.badRequest(
      res,
      `status must be one of: ${VALID_STATUSES.join(', ')}`
    );
    return;
  }
  const statusFilter = rawStatus as AdjustmentStatus | 'all';

  try {
    // List + counts in parallel — counts power the UI badge ("3 pending")
    // and must always reflect the full per-staff total, not the filtered
    // page, so the badge doesn't lie when the staff is viewing `status=approved`.
    const [rows, counts] = await Promise.all([
      listOwnAdjustments(session.staffId, limit, statusFilter),
      countOwnAdjustmentsByStatus(session.staffId),
    ]);
    apiResponse.success(res, {
      adjustments: rows,
      counts,
      statusFilter,
    });
  } catch (err) {
    log.error('[my-corrections] list failed', {
      staffId: session.staffId,
      statusFilter,
      error: err instanceof Error ? err.message : String(err),
    });
    apiResponse.internalError(res, err);
  }
}

async function handleDelete(
  req: NextApiRequest,
  res: NextApiResponse,
  session: AttendanceSession
): Promise<void> {
  const adjustmentId =
    typeof req.query.adjustment_id === 'string' ? req.query.adjustment_id : '';
  if (!adjustmentId) {
    apiResponse.badRequest(res, 'adjustment_id query param is required');
    return;
  }

  try {
    const cancelled = await cancelOwnAdjustment({
      adjustmentId,
      staffId: session.staffId,
    });
    if (cancelled) {
      apiResponse.success(res, { adjustment: cancelled });
      return;
    }
    // The atomic UPDATE returned zero rows — one of three reasons. Do
    // a single disambiguating read so the UI can render the right
    // message ("not yours / not found" vs "already approved — talk to
    // your supervisor if you need to reverse it"). IDOR-safe: we
    // 404 on both "truly missing" and "exists but not yours" so a
    // caller can't enumerate other staff's adjustment ids.
    const rows = await sql<{
      status: AdjustmentStatus; staff_id: string; period_locked: boolean;
    }>`
      SELECT a.status, e.staff_id, EXISTS (
        SELECT 1 FROM attendance_weekly_locks wl
        WHERE wl.week_start_date = date_trunc('week', e.work_date)::date
          AND wl.unlocked_at IS NULL
      ) AS period_locked
      FROM attendance_adjustments a
      JOIN attendance_entries e ON e.id = a.entry_id
      WHERE a.id = ${adjustmentId}
      LIMIT 1
    `;
    const row = rows[0];
    if (!row || row.staff_id !== session.staffId) {
      log.warn('[my-corrections] cancel 404 — not found or not owner', {
        sessionStaffId: session.staffId,
        adjustmentId,
      });
      apiResponse.notFound(res, 'Adjustment', adjustmentId);
      return;
    }
    if (row.status === 'pending' && row.period_locked) {
      apiResponse.conflict(res, 'The attendance period is locked', { reason: 'period_locked' });
      return;
    }
    apiResponse.conflict(
      res,
      `Adjustment is already ${row.status}; only pending adjustments can be self-cancelled`
    );
  } catch (err) {
    log.error('[my-corrections] cancel failed', {
      staffId: session.staffId,
      adjustmentId,
      error: err instanceof Error ? err.message : String(err),
    });
    apiResponse.internalError(res, err);
  }
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
  session: AttendanceSession
): Promise<void> {
  if (req.method === 'POST') return handlePost(req, res, session);
  if (req.method === 'GET') return handleGet(req, res, session);
  if (req.method === 'DELETE') return handleDelete(req, res, session);
  apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', [
    'GET',
    'POST',
    'DELETE',
  ]);
}

export default withMySession(handler);
