import { sql } from '@/lib/db-pool';
import { ATTENDANCE_WEEK_LOCK_NAMESPACE } from './lockQueries';
import type { AdjustmentKind, AdjustmentRow } from './types';

export interface InsertAdjustmentArgs {
  entryId: string;
  requestedBy: string;
  adjustmentKind: AdjustmentKind;
  adjustedClockInAt: Date | null;
  adjustedClockOutAt: Date | null;
  adjustedSiteGeofenceId: string | null;
  reason: string;
}

export async function insertAdjustment(args: InsertAdjustmentArgs): Promise<AdjustmentRow> {
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

export async function transitionAdjustmentStatus(args: {
  adjustmentId: string;
  reviewerId: string;
  newStatus: 'rejected' | 'cancelled';
  reviewNote: string | null;
}): Promise<AdjustmentRow | null> {
  if (args.newStatus !== 'rejected' && args.newStatus !== 'cancelled') {
    throw new Error('Approval must use the guarded approval service');
  }
  const rows = await sql<AdjustmentRow>`
    WITH target AS MATERIALIZED (
      SELECT a.id, e.work_date
      FROM attendance_adjustments a
      JOIN attendance_entries e ON e.id = a.entry_id
      WHERE a.id = ${args.adjustmentId} AND a.status = 'pending'
    ), week_guard AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(
        hashtext(${ATTENDANCE_WEEK_LOCK_NAMESPACE}::text),
        hashtext(TO_CHAR(date_trunc('week', target.work_date), 'YYYY-MM-DD'))
      ) FROM target
    ), unlocked AS MATERIALIZED (
      SELECT target.id FROM target, week_guard
      WHERE NOT EXISTS (
        SELECT 1 FROM attendance_weekly_locks wl
        WHERE wl.week_start_date = date_trunc('week', target.work_date)::date
          AND wl.unlocked_at IS NULL
      )
    )
    UPDATE attendance_adjustments a
    SET status      = ${args.newStatus},
        reviewed_by = ${args.reviewerId},
        reviewed_at = NOW(),
        review_note = ${args.reviewNote},
        updated_at  = NOW()
    FROM unlocked
    WHERE a.id = unlocked.id AND a.status = 'pending'
    RETURNING a.*
  `;
  return rows[0] ?? null;
}

export async function cancelOwnAdjustment(args: {
  adjustmentId: string;
  staffId: string;
}): Promise<AdjustmentRow | null> {
  const rows = await sql<AdjustmentRow>`
    WITH target AS MATERIALIZED (
      SELECT a.id, e.staff_id, e.work_date
      FROM attendance_adjustments a
      JOIN attendance_entries e ON e.id = a.entry_id
      WHERE a.id = ${args.adjustmentId}
        AND e.staff_id = ${args.staffId}
        AND a.status = 'pending'
    ), week_guard AS MATERIALIZED (
      SELECT pg_advisory_xact_lock(
        hashtext(${ATTENDANCE_WEEK_LOCK_NAMESPACE}::text),
        hashtext(TO_CHAR(date_trunc('week', target.work_date), 'YYYY-MM-DD'))
      ) FROM target
    ), unlocked AS MATERIALIZED (
      SELECT target.* FROM target, week_guard
      WHERE NOT EXISTS (
        SELECT 1 FROM attendance_weekly_locks wl
        WHERE wl.week_start_date = date_trunc('week', target.work_date)::date
          AND wl.unlocked_at IS NULL
      )
    ), cancelled AS (
      UPDATE attendance_adjustments a
      SET status = 'cancelled', reviewed_by = NULL,
          cancelled_by_staff_id = ${args.staffId}, reviewed_at = NOW(),
          review_note = 'self-cancelled by staff', updated_at = NOW()
      FROM unlocked
      WHERE a.id = unlocked.id AND a.status = 'pending'
      RETURNING a.*
    ), reopened AS (
      UPDATE attendance_day_exceptions de
      SET status = 'awaiting_worker', adjustment_id = NULL,
          result_version = result_version + 1, updated_at = NOW()
      FROM cancelled
      WHERE de.adjustment_id = cancelled.id AND de.status = 'awaiting_supervisor'
      RETURNING de.id, de.staff_id, de.work_date, de.result_version
    ), projection AS (
      UPDATE attendance_daily_summaries ds
      SET result_status = 'awaiting_worker', approved_regular_hrs = NULL,
          approved_overtime_hrs = NULL, approved_sunday_hrs = NULL,
          approved_holiday_hrs = NULL, approved_at = NULL, approved_by = NULL,
          result_version = reopened.result_version, computed_at = NOW()
      FROM reopened
      WHERE ds.staff_id = reopened.staff_id AND ds.work_date = reopened.work_date
    ), audit AS (
      INSERT INTO attendance_decision_events (
        entity_type, entity_key, action, actor_staff_id, reason, after_value
      ) SELECT 'day_exception', reopened.id::text, 'worker_cancelled_correction',
               ${args.staffId}, 'Worker cancelled pending correction',
               jsonb_build_object('status', 'awaiting_worker', 'resultVersion', reopened.result_version)
        FROM reopened
    )
    SELECT * FROM cancelled
  `;
  return rows[0] ?? null;
}
