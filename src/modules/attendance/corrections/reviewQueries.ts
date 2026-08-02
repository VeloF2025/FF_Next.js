import { sql } from '@/lib/db-pool';
import type {
  AdjustmentRow,
  AdjustmentStatus,
  AdjustmentWithEntry,
  OwnAdjustmentStatusCounts,
} from './types';

const ZERO_COUNTS: OwnAdjustmentStatusCounts = {
  pending: 0,
  approved: 0,
  rejected: 0,
  cancelled: 0,
};

export async function countSupervisedAdjustmentsByStatus(
  scopedToStaffIds: string[] | null | undefined
): Promise<OwnAdjustmentStatusCounts> {
  if (scopedToStaffIds?.length === 0) return { ...ZERO_COUNTS };
  const rows =
    scopedToStaffIds == null
      ? await sql<{ status: AdjustmentStatus; count: string }>`
        SELECT a.status, COUNT(*)::text AS count
        FROM attendance_adjustments a GROUP BY a.status
      `
      : await sql<{ status: AdjustmentStatus; count: string }>`
        SELECT a.status, COUNT(*)::text AS count
        FROM attendance_adjustments a
        JOIN attendance_entries e ON e.id = a.entry_id
        WHERE e.staff_id = ANY(${scopedToStaffIds}::uuid[])
        GROUP BY a.status
      `;
  const out = { ...ZERO_COUNTS };
  for (const row of rows) out[row.status] = Number(row.count);
  return out;
}

export async function listAdjustmentsForReview(args: {
  statusFilter: AdjustmentStatus | 'all';
  limit: number;
  scopedToStaffIds?: string[] | null;
}): Promise<AdjustmentRow[]> {
  const safeLimit = Math.min(Math.max(Math.trunc(args.limit), 1), 200);
  const scope = args.scopedToStaffIds;
  if (scope?.length === 0) return [];

  if (args.statusFilter === 'all') {
    if (scope == null) return listAllUnscoped(safeLimit);
    return sql<AdjustmentRow>`
      SELECT a.*, e.staff_id AS entry_staff_id,
             e.work_date::text AS entry_work_date,
             e.clock_in_at::text AS entry_clock_in_at,
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

  if (scope == null) return listStatusUnscoped(args.statusFilter, safeLimit);
  return sql<AdjustmentRow>`
    SELECT a.*, e.staff_id AS entry_staff_id,
           e.work_date::text AS entry_work_date,
           e.clock_in_at::text AS entry_clock_in_at,
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

async function listAllUnscoped(limit: number): Promise<AdjustmentRow[]> {
  return sql<AdjustmentRow>`
    SELECT a.*, e.staff_id AS entry_staff_id,
           e.work_date::text AS entry_work_date,
           e.clock_in_at::text AS entry_clock_in_at,
           e.clock_out_at::text AS entry_clock_out_at,
           TRIM(COALESCE(s.first_name,'') || ' ' || COALESCE(s.last_name,'')) AS staff_full_name
    FROM attendance_adjustments a
    JOIN attendance_entries e ON e.id = a.entry_id
    JOIN staff s ON s.id = e.staff_id
    ORDER BY CASE a.status WHEN 'pending' THEN 0 ELSE 1 END ASC, a.created_at DESC
    LIMIT ${limit}
  `;
}

async function listStatusUnscoped(
  status: AdjustmentStatus,
  limit: number
): Promise<AdjustmentRow[]> {
  return sql<AdjustmentRow>`
    SELECT a.*, e.staff_id AS entry_staff_id,
           e.work_date::text AS entry_work_date,
           e.clock_in_at::text AS entry_clock_in_at,
           e.clock_out_at::text AS entry_clock_out_at,
           TRIM(COALESCE(s.first_name,'') || ' ' || COALESCE(s.last_name,'')) AS staff_full_name
    FROM attendance_adjustments a
    JOIN attendance_entries e ON e.id = a.entry_id
    JOIN staff s ON s.id = e.staff_id
    WHERE a.status = ${status}
    ORDER BY a.created_at DESC
    LIMIT ${limit}
  `;
}

export async function loadAdjustmentWithEntry(
  adjustmentId: string
): Promise<AdjustmentWithEntry | null> {
  const rows = await sql<
    AdjustmentRow & {
      e_id: string;
      e_staff_id: string;
      e_work_date: string;
      e_clock_in_at: string;
      e_clock_out_at: string | null;
      e_status: string;
      day_exception_id: string | null;
    }
  >`
    SELECT a.*, e.id AS e_id, e.staff_id AS e_staff_id,
           e.work_date::text AS e_work_date,
           e.clock_in_at::text AS e_clock_in_at,
           e.clock_out_at::text AS e_clock_out_at, e.status AS e_status,
           de.id AS day_exception_id
    FROM attendance_adjustments a
    JOIN attendance_entries e ON e.id = a.entry_id
    LEFT JOIN attendance_day_exceptions de ON de.adjustment_id = a.id
    WHERE a.id = ${adjustmentId}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) return null;
  return {
    dayExceptionId: row.day_exception_id,
    adjustment: {
      id: row.id,
      entry_id: row.entry_id,
      requested_by: row.requested_by,
      adjustment_kind: row.adjustment_kind,
      adjusted_clock_in_at: row.adjusted_clock_in_at,
      adjusted_clock_out_at: row.adjusted_clock_out_at,
      adjusted_site_geofence_id: row.adjusted_site_geofence_id,
      reason: row.reason,
      status: row.status,
      reviewed_by: row.reviewed_by,
      reviewed_at: row.reviewed_at,
      review_note: row.review_note,
      created_at: row.created_at,
      updated_at: row.updated_at,
    },
    entry: {
      id: row.e_id,
      staff_id: row.e_staff_id,
      work_date: row.e_work_date,
      clock_in_at: row.e_clock_in_at,
      clock_out_at: row.e_clock_out_at,
      status: row.e_status,
    },
  };
}
