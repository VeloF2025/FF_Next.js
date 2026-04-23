/**
 * POST /api/my/attendance-corrections — staff submit a correction.
 * GET  /api/my/attendance-corrections — staff list their own submissions.
 *
 * Session-gated via /my portal HMAC cookie. The staff can only submit
 * corrections for entries they own (enforced by a SELECT-then-check on
 * entry.staff_id); list endpoint is likewise scoped to session.staffId.
 *
 * Submit rejects:
 *   - Entry not found, or not owned by this staff.
 *   - Entry's work_date falls in a locked payroll week.
 *   - Adjustment changes nothing (all adjusted_* fields empty) — the DB
 *     constraint catches this too but we 400 with a clear message.
 *   - Reason string shorter than 10 chars (loose spam guard).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { sql } from '@/lib/db-pool';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import type { AttendanceSession } from '@/modules/attendance/portal/types';
import {
  insertAdjustment,
  listOwnAdjustments,
  countOwnAdjustmentsByStatus,
  type AdjustmentKind,
  type AdjustmentStatus,
} from '@/modules/attendance/corrections/queries';
import {
  isoWeekMonday,
  lookupActiveLock,
} from '@/modules/attendance/corrections/lockQueries';
import {
  ADJUSTMENT_HINTS,
  ABSOLUTE_MIN_REASON_CHARS,
} from '@/modules/attendance/corrections/hintCatalogue';

const VALID_KINDS: readonly AdjustmentKind[] = [
  'forgot_clock_out',
  'wrong_clock_in_time',
  'wrong_clock_out_time',
  'wrong_site',
  'duplicate_entry',
  'other',
];

function parseDateOrNull(v: unknown): Date | null | 'invalid' {
  if (v == null || v === '') return null;
  if (typeof v !== 'string') return 'invalid';
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? 'invalid' : d;
}

async function handlePost(
  req: NextApiRequest,
  res: NextApiResponse,
  session: AttendanceSession
): Promise<void> {
  const body = (req.body ?? {}) as Record<string, unknown>;
  const entryId = typeof body.entry_id === 'string' ? body.entry_id : '';
  const adjustmentKind = body.adjustment_kind as AdjustmentKind | undefined;
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  const siteGeofenceId =
    typeof body.adjusted_site_geofence_id === 'string' ? body.adjusted_site_geofence_id : null;

  if (!entryId) {
    apiResponse.badRequest(res, 'entry_id is required');
    return;
  }
  if (!adjustmentKind || !VALID_KINDS.includes(adjustmentKind)) {
    apiResponse.badRequest(res, `adjustment_kind must be one of: ${VALID_KINDS.join(', ')}`);
    return;
  }
  // Per-kind minimum from the hint catalogue (floor = ABSOLUTE_MIN).
  // Keeps validator in lockstep with the placeholder text the staff
  // just read — a `duplicate_entry` prompt that asks for context must
  // enforce a length that can plausibly contain that context.
  const perKindMin = Math.max(
    ADJUSTMENT_HINTS[adjustmentKind].minReasonChars,
    ABSOLUTE_MIN_REASON_CHARS
  );
  if (reason.length < perKindMin) {
    apiResponse.badRequest(
      res,
      `reason must be at least ${perKindMin} characters for adjustment_kind='${adjustmentKind}'`
    );
    return;
  }

  const inAt = parseDateOrNull(body.adjusted_clock_in_at);
  const outAt = parseDateOrNull(body.adjusted_clock_out_at);
  if (inAt === 'invalid' || outAt === 'invalid') {
    apiResponse.badRequest(res, 'adjusted_clock_in_at and adjusted_clock_out_at must be ISO timestamps or null');
    return;
  }
  if (!inAt && !outAt && !siteGeofenceId) {
    apiResponse.badRequest(res, 'at least one of adjusted_clock_in_at, adjusted_clock_out_at, or adjusted_site_geofence_id must be provided');
    return;
  }

  // Own-the-entry check + fetch work_date for lock enforcement.
  const entries = await sql<{ staff_id: string; work_date: string }>`
    SELECT staff_id, work_date::text AS work_date
    FROM attendance_entries
    WHERE id = ${entryId}
    LIMIT 1
  `;
  const entry = entries[0];
  if (!entry) {
    apiResponse.notFound(res, 'Entry', entryId);
    return;
  }
  if (entry.staff_id !== session.staffId) {
    // IDOR guard: do not leak whether the entry exists or not under another staff.
    log.warn('[my-corrections] staff attempted to submit correction for foreign entry', {
      sessionStaffId: session.staffId,
      entryStaffId: entry.staff_id,
      entryId,
    });
    apiResponse.notFound(res, 'Entry', entryId);
    return;
  }

  const weekMonday = isoWeekMonday(entry.work_date);
  const activeLock = await lookupActiveLock(weekMonday);
  if (activeLock) {
    apiResponse.badRequest(
      res,
      `Week starting ${weekMonday} is locked for payroll; corrections require HR unlock first`
    );
    return;
  }

  try {
    const row = await insertAdjustment({
      entryId,
      requestedBy: session.staffId, // staff's own user/staff id; migration FK is users.id — the /my session already binds staff -> user.
      adjustmentKind,
      adjustedClockInAt: inAt,
      adjustedClockOutAt: outAt,
      adjustedSiteGeofenceId: siteGeofenceId,
      reason,
    });
    apiResponse.success(res, { adjustment: row });
  } catch (err) {
    log.error('[my-corrections] insert failed', {
      entryId,
      staffId: session.staffId,
      error: err instanceof Error ? err.message : String(err),
    });
    apiResponse.internalError(res, err);
  }
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

async function handler(
  req: NextApiRequest,
  res: NextApiResponse,
  session: AttendanceSession
): Promise<void> {
  if (req.method === 'POST') return handlePost(req, res, session);
  if (req.method === 'GET') return handleGet(req, res, session);
  apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET', 'POST']);
}

export default withMySession(handler);
