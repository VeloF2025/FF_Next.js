/**
 * SQL helpers for the attendance-corrections workflow.
 *
 * Split out of the API handlers so (1) they stay under the file-size cap,
 * (2) test mocks target the helpers instead of duplicating SQL strings
 * across 4 handler files.
 */

import { sql, transaction, type TxnClient } from '@/lib/db-pool';

export type AdjustmentKind =
  | 'forgot_clock_out'
  | 'wrong_clock_in_time'
  | 'wrong_clock_out_time'
  | 'wrong_site'
  | 'duplicate_entry'
  | 'other';

export type AdjustmentStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface AdjustmentRow extends Record<string, unknown> {
  id: string;
  entry_id: string;
  requested_by: string;
  adjustment_kind: AdjustmentKind;
  adjusted_clock_in_at: string | null;
  adjusted_clock_out_at: string | null;
  adjusted_site_geofence_id: string | null;
  reason: string;
  status: AdjustmentStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
  updated_at: string;
  // Joined from attendance_entries for supervisor context
  entry_staff_id?: string;
  entry_work_date?: string;
  entry_clock_in_at?: string;
  entry_clock_out_at?: string | null;
  staff_full_name?: string;
}

export async function insertAdjustment(args: {
  entryId: string;
  requestedBy: string;
  adjustmentKind: AdjustmentKind;
  adjustedClockInAt: Date | null;
  adjustedClockOutAt: Date | null;
  adjustedSiteGeofenceId: string | null;
  reason: string;
}): Promise<AdjustmentRow> {
  const rows = await sql<AdjustmentRow>`
    INSERT INTO attendance_adjustments (
      entry_id, requested_by, adjustment_kind,
      adjusted_clock_in_at, adjusted_clock_out_at, adjusted_site_geofence_id,
      reason, status
    ) VALUES (
      ${args.entryId}, ${args.requestedBy}, ${args.adjustmentKind},
      ${args.adjustedClockInAt ? args.adjustedClockInAt.toISOString() : null},
      ${args.adjustedClockOutAt ? args.adjustedClockOutAt.toISOString() : null},
      ${args.adjustedSiteGeofenceId},
      ${args.reason}, 'pending'
    )
    RETURNING *
  `;
  const row = rows[0];
  if (!row) throw new Error('insertAdjustment returned no row');
  return row;
}

/**
 * Transition an adjustment from 'pending' to a terminal status. Enforced by
 * WHERE clauses so a concurrent double-review returns zero rows — the
 * caller treats that as 409 conflict.
 */
export async function transitionAdjustmentStatus(args: {
  adjustmentId: string;
  reviewerId: string;
  newStatus: 'approved' | 'rejected' | 'cancelled';
  reviewNote: string | null;
}): Promise<AdjustmentRow | null> {
  const rows = await sql<AdjustmentRow>`
    UPDATE attendance_adjustments
    SET status      = ${args.newStatus},
        reviewed_by = ${args.reviewerId},
        reviewed_at = NOW(),
        review_note = ${args.reviewNote},
        updated_at  = NOW()
    WHERE id = ${args.adjustmentId}
      AND status = 'pending'
    RETURNING *
  `;
  return rows[0] ?? null;
}

/**
 * Staff-side own-submissions listing. Respects staff_id on the linked
 * attendance_entries so a requester-impersonator cannot see someone else's.
 */
export async function listOwnAdjustments(staffId: string, limit: number): Promise<AdjustmentRow[]> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  return sql<AdjustmentRow>`
    SELECT a.*,
           e.staff_id   AS entry_staff_id,
           e.work_date::text AS entry_work_date,
           e.clock_in_at::text  AS entry_clock_in_at,
           e.clock_out_at::text AS entry_clock_out_at
    FROM attendance_adjustments a
    JOIN attendance_entries e ON e.id = a.entry_id
    WHERE e.staff_id = ${staffId}
    ORDER BY a.created_at DESC
    LIMIT ${safeLimit}
  `;
}

/**
 * Supervisor-queue listing. Default filter = pending; pass 'all' to see
 * recently resolved too.
 */
export async function listAdjustmentsForReview(args: {
  statusFilter: AdjustmentStatus | 'all';
  limit: number;
  /**
   * When provided, filter to adjustments whose `entry.staff_id` is in
   * this set. Callers that bypass scope (super_admin / admin) pass
   * `null` to disable the filter. Empty array means "no scope — return
   * zero rows" (the viewer has no supervisees).
   *
   * Kept as an explicit parameter rather than a role check here so
   * this helper stays policy-free; the API handler composes scope +
   * RBAC.
   */
  scopedToStaffIds?: string[] | null;
}): Promise<AdjustmentRow[]> {
  const safeLimit = Math.min(Math.max(Math.trunc(args.limit), 1), 200);
  const scope = args.scopedToStaffIds;

  // Scope is explicit null → no filter (super_admin/admin path).
  // Scope is empty array → zero rows without a DB round-trip.
  if (scope !== null && scope !== undefined && scope.length === 0) {
    return [];
  }

  if (args.statusFilter === 'all') {
    if (scope === null || scope === undefined) {
      return sql<AdjustmentRow>`
        SELECT a.*,
               e.staff_id   AS entry_staff_id,
               e.work_date::text AS entry_work_date,
               e.clock_in_at::text  AS entry_clock_in_at,
               e.clock_out_at::text AS entry_clock_out_at,
               TRIM(COALESCE(s.first_name,'') || ' ' || COALESCE(s.last_name,'')) AS staff_full_name
        FROM attendance_adjustments a
        JOIN attendance_entries e ON e.id = a.entry_id
        JOIN staff s ON s.id = e.staff_id
        ORDER BY CASE a.status WHEN 'pending' THEN 0 ELSE 1 END ASC, a.created_at DESC
        LIMIT ${safeLimit}
      `;
    }
    return sql<AdjustmentRow>`
      SELECT a.*,
             e.staff_id   AS entry_staff_id,
             e.work_date::text AS entry_work_date,
             e.clock_in_at::text  AS entry_clock_in_at,
             e.clock_out_at::text AS entry_clock_out_at,
             TRIM(COALESCE(s.first_name,'') || ' ' || COALESCE(s.last_name,'')) AS staff_full_name
      FROM attendance_adjustments a
      JOIN attendance_entries e ON e.id = a.entry_id
      JOIN staff s ON s.id = e.staff_id
      WHERE e.staff_id = ANY(${scope}::uuid[])
      ORDER BY CASE a.status WHEN 'pending' THEN 0 ELSE 1 END ASC, a.created_at DESC
      LIMIT ${safeLimit}
    `;
  }

  if (scope === null || scope === undefined) {
    return sql<AdjustmentRow>`
      SELECT a.*,
             e.staff_id   AS entry_staff_id,
             e.work_date::text AS entry_work_date,
             e.clock_in_at::text  AS entry_clock_in_at,
             e.clock_out_at::text AS entry_clock_out_at,
             TRIM(COALESCE(s.first_name,'') || ' ' || COALESCE(s.last_name,'')) AS staff_full_name
      FROM attendance_adjustments a
      JOIN attendance_entries e ON e.id = a.entry_id
      JOIN staff s ON s.id = e.staff_id
      WHERE a.status = ${args.statusFilter}
      ORDER BY a.created_at DESC
      LIMIT ${safeLimit}
    `;
  }
  return sql<AdjustmentRow>`
    SELECT a.*,
           e.staff_id   AS entry_staff_id,
           e.work_date::text AS entry_work_date,
           e.clock_in_at::text  AS entry_clock_in_at,
           e.clock_out_at::text AS entry_clock_out_at,
           TRIM(COALESCE(s.first_name,'') || ' ' || COALESCE(s.last_name,'')) AS staff_full_name
    FROM attendance_adjustments a
    JOIN attendance_entries e ON e.id = a.entry_id
    JOIN staff s ON s.id = e.staff_id
    WHERE a.status = ${args.statusFilter}
      AND e.staff_id = ANY(${scope}::uuid[])
    ORDER BY a.created_at DESC
    LIMIT ${safeLimit}
  `;
}

export interface AdjustmentWithEntry {
  adjustment: AdjustmentRow;
  entry: {
    id: string;
    staff_id: string;
    work_date: string;
    clock_in_at: string;
    clock_out_at: string | null;
    status: string;
  };
}

export async function loadAdjustmentWithEntry(
  adjustmentId: string
): Promise<AdjustmentWithEntry | null> {
  const rows = await sql<AdjustmentRow & {
    e_id: string;
    e_staff_id: string;
    e_work_date: string;
    e_clock_in_at: string;
    e_clock_out_at: string | null;
    e_status: string;
  }>`
    SELECT a.*,
           e.id AS e_id, e.staff_id AS e_staff_id, e.work_date::text AS e_work_date,
           e.clock_in_at::text AS e_clock_in_at, e.clock_out_at::text AS e_clock_out_at,
           e.status AS e_status
    FROM attendance_adjustments a
    JOIN attendance_entries e ON e.id = a.entry_id
    WHERE a.id = ${adjustmentId}
    LIMIT 1
  `;
  const r = rows[0];
  if (!r) return null;
  return {
    adjustment: {
      id: r.id,
      entry_id: r.entry_id,
      requested_by: r.requested_by,
      adjustment_kind: r.adjustment_kind,
      adjusted_clock_in_at: r.adjusted_clock_in_at,
      adjusted_clock_out_at: r.adjusted_clock_out_at,
      adjusted_site_geofence_id: r.adjusted_site_geofence_id,
      reason: r.reason,
      status: r.status,
      reviewed_by: r.reviewed_by,
      reviewed_at: r.reviewed_at,
      review_note: r.review_note,
      created_at: r.created_at,
      updated_at: r.updated_at,
    },
    entry: {
      id: r.e_id,
      staff_id: r.e_staff_id,
      work_date: r.e_work_date,
      clock_in_at: r.e_clock_in_at,
      clock_out_at: r.e_clock_out_at,
      status: r.e_status,
    },
  };
}

/**
 * Atomic approve: transition adjustment → 'approved', apply the adjusted
 * fields to the underlying entry, and DELETE the affected daily summary
 * (so the nightly reconcile cron recomputes). All three writes run in a
 * single transaction; any step throwing rolls the others back.
 *
 * Optimistic concurrency: the entry UPDATE uses a `WHERE id = ? AND
 * updated_at = ?` guard so a concurrent auto-close / clock-out / earlier
 * approve that mutated the entry between the reviewer's page-load and
 * this call returns zero rows — caller treats as 409. Prevents the
 * race where the reconcile cron auto-closes with a capped clock_out
 * and our COALESCE-based UPDATE silently preserves the capped value.
 *
 * Reviewer MUST have already validated:
 *   - adjustment.status === 'pending' at load time (handler re-reads)
 *   - entry's ISO week is not locked
 *
 * Return shape:
 *   - `{ ok: true, adjustment }` on success
 *   - `{ ok: 'conflict', reason }` if the optimistic lock lost the race OR
 *     the adjustment state changed under us
 */
export type ApproveResult =
  | { ok: true; adjustment: AdjustmentRow }
  | { ok: 'conflict'; reason: 'adjustment_not_pending' | 'entry_changed' | 'entry_missing' };

export async function applyApprovedAdjustmentTxn(args: {
  adjustmentId: string;
  reviewerId: string;
  reviewNote: string | null;
  entryId: string;
  entryUpdatedAt: string;
  staffId: string;
  workDate: string;
  adjustedClockInAt: Date | null;
  adjustedClockOutAt: Date | null;
  adjustedSiteGeofenceId: string | null;
}): Promise<ApproveResult> {
  return transaction(async (txn: TxnClient) => {
    const transitioned = await txn.query<AdjustmentRow>(
      `UPDATE attendance_adjustments
       SET status = 'approved', reviewed_by = $1, reviewed_at = NOW(),
           review_note = $2, updated_at = NOW()
       WHERE id = $3 AND status = 'pending'
       RETURNING *`,
      [args.reviewerId, args.reviewNote, args.adjustmentId]
    );
    if (transitioned.length === 0) {
      return { ok: 'conflict', reason: 'adjustment_not_pending' };
    }

    const applied = await txn.query<{ id: string }>(
      `UPDATE attendance_entries
       SET clock_in_at      = COALESCE($1::timestamptz, clock_in_at),
           clock_out_at     = COALESCE($2::timestamptz, clock_out_at),
           site_geofence_id = COALESCE($3::uuid, site_geofence_id),
           updated_at       = NOW(),
           status           = CASE
                                WHEN status = 'open' AND $2::timestamptz IS NOT NULL THEN 'closed'
                                ELSE status
                              END
       WHERE id = $4 AND updated_at = $5::timestamptz
       RETURNING id`,
      [
        args.adjustedClockInAt ? args.adjustedClockInAt.toISOString() : null,
        args.adjustedClockOutAt ? args.adjustedClockOutAt.toISOString() : null,
        args.adjustedSiteGeofenceId,
        args.entryId,
        args.entryUpdatedAt,
      ]
    );
    if (applied.length === 0) {
      // Two possibilities: entry vanished, or updated_at moved (race).
      const stillExists = await txn.query<{ id: string }>(
        `SELECT id FROM attendance_entries WHERE id = $1 LIMIT 1`,
        [args.entryId]
      );
      return {
        ok: 'conflict',
        reason: stillExists.length === 0 ? 'entry_missing' : 'entry_changed',
      };
    }

    await txn.query(
      `DELETE FROM attendance_daily_summaries
       WHERE staff_id = $1 AND work_date = $2::date`,
      [args.staffId, args.workDate]
    );

    // Phase 2: a corrected clock_in_at / clock_out_at invalidates any
    // previously-reconciled Cartrack GPS verifications — the adjusted
    // timestamps change which Cartrack sample was nearest. Delete the
    // verification rows so the next cartrack-reconcile cron tick
    // re-computes with the updated timestamps. Safe no-op when
    // attendance_gps_verifications has no rows for this entry (e.g., the
    // entry didn't have a vehicle assignment).
    await txn.query(
      `DELETE FROM attendance_gps_verifications WHERE entry_id = $1`,
      [args.entryId]
    );

    const row = transitioned[0];
    if (!row) {
      // Defence-in-depth: transitioned.length > 0 was checked, so this
      // branch is unreachable under normal conditions. Throwing fails
      // the transaction loudly rather than returning an undefined row.
      throw new Error('applyApprovedAdjustmentTxn: transitioned row disappeared');
    }
    return { ok: true, adjustment: row };
  });
}
