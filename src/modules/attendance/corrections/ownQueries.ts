import { sql } from '@/lib/db-pool';
import type { AdjustmentRow, AdjustmentStatus, OwnAdjustmentStatusCounts } from './types';

export async function listOwnAdjustments(
  staffId: string,
  limit: number,
  statusFilter: AdjustmentStatus | 'all' = 'all'
): Promise<AdjustmentRow[]> {
  const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 100);
  if (statusFilter === 'all') {
    return sql<AdjustmentRow>`
      SELECT a.*,
             e.staff_id AS entry_staff_id, e.work_date::text AS entry_work_date,
             e.clock_in_at::text AS entry_clock_in_at,
             e.clock_out_at::text AS entry_clock_out_at
      FROM attendance_adjustments a
      JOIN attendance_entries e ON e.id = a.entry_id
      WHERE e.staff_id = ${staffId}
      ORDER BY CASE a.status WHEN 'pending' THEN 0 ELSE 1 END ASC, a.created_at DESC
      LIMIT ${safeLimit}
    `;
  }
  return sql<AdjustmentRow>`
    SELECT a.*,
           e.staff_id AS entry_staff_id, e.work_date::text AS entry_work_date,
           e.clock_in_at::text AS entry_clock_in_at,
           e.clock_out_at::text AS entry_clock_out_at
    FROM attendance_adjustments a
    JOIN attendance_entries e ON e.id = a.entry_id
    WHERE e.staff_id = ${staffId} AND a.status = ${statusFilter}
    ORDER BY a.created_at DESC
    LIMIT ${safeLimit}
  `;
}

export async function countOwnAdjustmentsByStatus(
  staffId: string
): Promise<OwnAdjustmentStatusCounts> {
  const rows = await sql<{ status: AdjustmentStatus; count: string }>`
    SELECT a.status, COUNT(*)::text AS count
    FROM attendance_adjustments a
    JOIN attendance_entries e ON e.id = a.entry_id
    WHERE e.staff_id = ${staffId}
    GROUP BY a.status
  `;
  const out: OwnAdjustmentStatusCounts = {
    pending: 0,
    approved: 0,
    rejected: 0,
    cancelled: 0,
  };
  for (const row of rows) out[row.status] = Number(row.count);
  return out;
}
