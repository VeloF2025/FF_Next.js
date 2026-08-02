/**
 * POST /api/field/attendance-adjust
 *
 * Admin-initiated time correction for a field-worker attendance entry.
 * Creates and applies an audited adjustment in one guarded transaction —
 * never a raw UPDATE of attendance_entries.
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
 * Returns 401 when the request is unauthenticated.
 * Returns 404 when the entry doesn't exist.
 * Returns 409 when the week is locked, or when the optimistic lock loses a race
 *         (entry_changed / adjustment_not_pending from the txn).
 *
 * RBAC: people.staff.attendance.corrections, edit
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, withPermission, type AuthenticatedNextApiRequest } from '@/lib/auth/middleware';
import type { AdjustmentKind } from '@/modules/attendance/corrections/queries';
import { createAndApproveAdjustmentTxn } from '@/modules/attendance/corrections/guardedApproval';
import { isoWeekMonday } from '@/modules/attendance/corrections/lockQueries';
import { sql } from '@/lib/db-pool';

/**
 * Derives the AdjustmentKind from which timestamps are being corrected.
 * When BOTH times are corrected, records 'wrong_clock_in_time' as the kind —
 * this is a label only; the txn still applies both adjusted timestamps to the entry.
 */
function deriveAdjustmentKind(cin: Date | null, _cout: Date | null): AdjustmentKind {
  if (cin) return 'wrong_clock_in_time';
  return 'wrong_clock_out_time';
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  // Mirrors attendance-manual-entry.ts:49–52: guard missing user before any logic.
  const actor = (req as AuthenticatedNextApiRequest).user?.id;
  if (!actor) {
    apiResponse.unauthorized(res);
    return;
  }

  if (req.method !== 'POST') {
    apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
    return;
  }

  const b = req.body ?? {};
  const entryId = typeof b.entry_id === 'string' ? b.entry_id : '';
  const entryUpdatedAt = typeof b.entry_updated_at === 'string' ? b.entry_updated_at : '';
  const reason = typeof b.reason === 'string' ? b.reason.trim() : '';

  // Parse optional timestamps — validate immediately after parsing.
  const cinRaw = b.adjusted_clock_in_at;
  const coutRaw = b.adjusted_clock_out_at;
  const cin = cinRaw ? new Date(cinRaw as string) : null;
  const cout = coutRaw ? new Date(coutRaw as string) : null;
  let targetWeek: string | null = null;

  // ── Input validation ──────────────────────────────────────────────────────

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
  // Validate parsed dates — new Date('not-a-date') yields Invalid Date whose
  // .toISOString() throws a TypeError, producing a 500 instead of a clean 400.
  if (cin && Number.isNaN(cin.getTime())) {
    apiResponse.badRequest(res, 'adjusted_clock_in_at must be a valid ISO timestamp');
    return;
  }
  if (cout && Number.isNaN(cout.getTime())) {
    apiResponse.badRequest(res, 'adjusted_clock_out_at must be a valid ISO timestamp');
    return;
  }

  try {
    // attendance_adjustments.requested_by references staff(id), while
    // reviewed_by records the authenticated users(id) decision actor.
    const actorStaffRows = await sql<{ id: string }>`
      SELECT id FROM staff WHERE user_id = ${actor} ORDER BY id LIMIT 2
    `;
    const actorStaffId = actorStaffRows[0]?.id;
    if (actorStaffRows.length !== 1 || !actorStaffId) {
      log.warn('[field-attendance-adjust] actor staff link is missing or ambiguous', {
        userId: actor, linkedStaffCount: actorStaffRows.length,
      });
      apiResponse.conflict(res, 'Your user account must link to exactly one staff record');
      return;
    }

    // ── Entry lookup ────────────────────────────────────────────────────────

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

    targetWeek = isoWeekMonday(entry.work_date);
    const adjustmentKind = deriveAdjustmentKind(cin, cout);

    // Guard, pending insert, approval, entry update, and projection
    // invalidation share one transaction. A lock race therefore cannot leave
    // an orphan pending adjustment behind.
    const result = await createAndApproveAdjustmentTxn({
      requestedBy: actorStaffId,
      reviewerId: actor,
      reviewNote: 'Admin direct adjust (Field Workers page)',
      entryId,
      entryUpdatedAt,
      staffId: entry.staff_id,
      workDate: entry.work_date,
      adjustedClockInAt: cin,
      adjustedClockOutAt: cout,
      adjustedSiteGeofenceId: entry.site_geofence_id,
      adjustmentKind,
      reason,
    });

    if (result.ok !== true) {
      apiResponse.conflict(res, `Adjust conflict: ${result.reason}`);
      return;
    }

    apiResponse.success(res, { adjustment: result.adjustment });
  } catch (err) {
    if (isPeriodLockedError(err)) {
      apiResponse.conflict(
        res,
        `Week ${targetWeek ?? 'unknown'} is locked; unlock first before adjusting this entry`
      );
      return;
    }
    log.error('[field-attendance-adjust] failed', {
      entryId,
      error: err instanceof Error ? err.message : String(err),
    });
    apiResponse.internalError(res, err);
  }
}

function isPeriodLockedError(error: unknown): boolean {
  return !!error && typeof error === 'object' && 'code' in error && error.code === 'period_locked';
}

export default withAuth(withPermission('people.staff.attendance.corrections', 'edit')(handler));
