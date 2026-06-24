/**
 * POST /api/field/attendance-adjust
 *
 * Admin-initiated time correction for a field-worker attendance entry.
 * Inserts an attendance_adjustments row and immediately applies it through
 * the existing audited transaction (applyApprovedAdjustmentTxn) — never a
 * raw UPDATE of attendance_entries.
 *
 * Body: {
 *   entry_id:             string   — UUID of the attendance_entries row
 *   entry_updated_at:     string   — ISO timestamp; optimistic-lock guard
 *   reason:               string   — audit trail (≥10 chars)
 *   adjusted_clock_in_at?:  string | null  — ISO timestamp
 *   adjusted_clock_out_at?: string | null  — ISO timestamp
 * }
 *
 * At least one of adjusted_clock_in_at / adjusted_clock_out_at must be present.
 *
 * Returns 200 { data: { adjustment } } on success.
 * Returns 400 on validation failures.
 * Returns 404 when the entry doesn't exist.
 * Returns 409 when the week is locked, or when the optimistic lock loses a race
 *         (entry_changed / adjustment_not_pending from the txn).
 *
 * RBAC: people.staff.attendance.corrections, edit
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
  insertAdjustment,
  applyApprovedAdjustmentTxn,
  type AdjustmentKind,
} from '@/modules/attendance/corrections/queries';
import {
  isoWeekMonday,
  lookupActiveLock,
} from '@/modules/attendance/corrections/lockQueries';
import { sql } from '@/lib/db-pool';

/**
 * Derives the AdjustmentKind from which timestamps are being corrected.
 * Mirrors the logic the /my portal uses for worker-initiated corrections
 * (wrong_clock_in_time / wrong_clock_out_time), with wrong_clock_in_time
 * taking precedence when both are being adjusted.
 */
function deriveAdjustmentKind(
  cin: Date | null,
  cout: Date | null
): AdjustmentKind {
  if (cin && cout) return 'wrong_clock_in_time';
  if (cin) return 'wrong_clock_in_time';
  return 'wrong_clock_out_time';
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  const actor = (req as AuthenticatedNextApiRequest).user?.id;

  if (req.method !== 'POST') {
    apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
    return;
  }

  const b = req.body ?? {};
  const entryId = typeof b.entry_id === 'string' ? b.entry_id : '';
  const entryUpdatedAt = typeof b.entry_updated_at === 'string' ? b.entry_updated_at : '';
  const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
  const cin = b.adjusted_clock_in_at ? new Date(b.adjusted_clock_in_at as string) : null;
  const cout = b.adjusted_clock_out_at ? new Date(b.adjusted_clock_out_at as string) : null;

  // ── Input validation ────────────────────────────────────────────────────────

  if (!entryId || !entryUpdatedAt) {
    apiResponse.badRequest(res, 'entry_id and entry_updated_at are required');
    return;
  }
  if (reason.length < 10) {
    apiResponse.badRequest(res, 'reason must be at least 10 characters (audit requirement)');
    return;
  }
  if (!cin && !cout) {
    apiResponse.badRequest(
      res,
      'at least one of adjusted_clock_in_at / adjusted_clock_out_at is required'
    );
    return;
  }

  try {
    // ── Entry lookup ──────────────────────────────────────────────────────────

    const rows = await sql<{
      staff_id: string;
      work_date: string;
      site_geofence_id: string | null;
    }>`
      SELECT staff_id,
             to_char(work_date, 'YYYY-MM-DD') AS work_date,
             site_geofence_id
      FROM   attendance_entries
      WHERE  id = ${entryId}
      LIMIT  1
    `;
    const entry = rows[0];
    if (!entry) {
      apiResponse.notFound(res, 'Attendance entry', entryId);
      return;
    }

    // ── Payroll-week lock check ───────────────────────────────────────────────
    // Mirrors the check in pages/api/staff/attendance-manual-entry.ts:109–116.
    // A locked week must not receive new adjustments — the payroll has already
    // been exported and any mutation would silently diverge from the export.

    const weekMonday = isoWeekMonday(entry.work_date);
    const activeLock = await lookupActiveLock(weekMonday);
    if (activeLock) {
      apiResponse.conflict(
        res,
        `Week ${weekMonday} is locked; unlock first before adjusting this entry`
      );
      return;
    }

    // ── Insert adjustment (pending) ───────────────────────────────────────────

    const adjustmentKind = deriveAdjustmentKind(cin, cout);

    const adjustment = await insertAdjustment({
      entryId,
      requestedBy: actor ?? '',
      adjustmentKind,
      adjustedClockInAt: cin,
      adjustedClockOutAt: cout,
      adjustedSiteGeofenceId: entry.site_geofence_id,
      reason,
    });

    // ── Apply atomically through the audited transaction ──────────────────────
    // The txn transitions the adjustment → 'approved', applies the corrected
    // timestamps to the entry using optimistic-lock on entry.updated_at, and
    // deletes the daily summary so the reconcile cron recomputes. If the
    // optimistic lock loses the race, result.ok is 'conflict'.

    const result = await applyApprovedAdjustmentTxn({
      adjustmentId: adjustment.id,
      reviewerId: actor ?? '',
      reviewNote: 'Admin direct adjust (Field Workers page)',
      entryId,
      entryUpdatedAt,
      staffId: entry.staff_id,
      workDate: entry.work_date,
      adjustedClockInAt: cin,
      adjustedClockOutAt: cout,
      adjustedSiteGeofenceId: entry.site_geofence_id,
    });

    if (result.ok !== true) {
      apiResponse.conflict(res, `Adjust conflict: ${result.reason}`);
      return;
    }

    apiResponse.success(res, { adjustment: result.adjustment });
  } catch (err) {
    log.error('[field-attendance-adjust] failed', {
      entryId,
      error: err instanceof Error ? err.message : String(err),
    });
    apiResponse.internalError(res, err);
  }
}

export default withAuth(withPermission('people.staff.attendance.corrections', 'edit')(handler));
