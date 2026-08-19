/**
 * Which day exceptions a staff member may still submit a correction for.
 *
 * The predicate is shared so the two callers cannot drift: the target
 * lookup (`GET /api/my/attendance-corrections?exception_id=`) and the
 * history screen, which uses it to decide whether to offer the
 * "request correction" affordance at all. A history link built without a
 * live exception id is a dead end — the POST route retired generic
 * corrections and answers 409.
 */

import { query } from '@/lib/db-pool';

/** Shared WHERE tail. `$1` = staff id; callers append their own filter. */
export const CORRECTION_ELIGIBILITY_SQL = `
    FROM attendance_day_exceptions de
    JOIN attendance_entries e
      ON e.id = de.entry_id AND e.staff_id = de.staff_id
    JOIN attendance_daily_summaries ds
      ON ds.staff_id = de.staff_id AND ds.work_date = de.work_date
    WHERE de.staff_id = $1::uuid
      AND de.kind = 'missing_clock_out'
      AND de.status = 'awaiting_worker'
      AND de.adjustment_id IS NULL
      AND de.resolved_at IS NULL
      AND de.entry_id IS NOT NULL
      AND e.clock_out_at IS NULL
      AND ds.result_version = de.result_version`;

export interface CorrectionTargetRow extends Record<string, unknown> {
  exception_id: string;
  entry_id: string;
}

/** The single open correction target for `exceptionId`, or null. */
export async function findCorrectionTarget(
  staffId: string,
  exceptionId: string,
): Promise<CorrectionTargetRow | null> {
  const rows = await query<CorrectionTargetRow>(
    `SELECT de.id::text AS exception_id, de.entry_id::text AS entry_id
    ${CORRECTION_ELIGIBILITY_SQL}
      AND de.id = $2::uuid
    LIMIT 1`,
    [staffId, exceptionId],
  );
  return rows[0] ?? null;
}

/**
 * entry id → open exception id, for the entries the caller is rendering.
 * Entries with no open exception are simply absent from the map.
 */
export async function mapOpenCorrectionsByEntry(
  staffId: string,
  entryIds: readonly string[],
): Promise<Map<string, string>> {
  if (entryIds.length === 0) return new Map();
  const rows = await query<CorrectionTargetRow>(
    `SELECT de.id::text AS exception_id, de.entry_id::text AS entry_id
    ${CORRECTION_ELIGIBILITY_SQL}
      AND de.entry_id = ANY($2::uuid[])
    ORDER BY de.created_at ASC`,
    [staffId, entryIds],
  );
  // Oldest first, first write wins: if an entry somehow carries two open
  // exceptions, the staff member is pointed at the one raised first.
  const byEntry = new Map<string, string>();
  for (const row of rows) {
    if (!byEntry.has(row.entry_id)) byEntry.set(row.entry_id, row.exception_id);
  }
  return byEntry;
}
