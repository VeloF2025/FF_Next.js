/**
 * Stores Today aggregator — per-technician reconciliation for the
 * /my/stores/today PWA view.
 *
 * MODULE-TREE BOUNDARY (ADR):
 *   PWA-scoped per-stores-user views live in src/modules/field-stock-pwa/.
 *   Cross-contractor desktop views live in src/modules/field-stock/.
 *   Reason: the desktop reconciliationService.ts uses the Neon shim and
 *   has 3 conditional-SQL branches; rewriting it for this PR would risk
 *   the existing dashboard. Splitting by surface lets the new code live
 *   on @/lib/db-pool from day one. The deferred shim migration is
 *   tracked at the top of reconciliationService.ts.
 *
 * Scope: returns one row per technician that the *current* stores user
 * issued stock to today, with installed/returned counts and unaccounted
 * delta. Reads stock_pickings.created_by_staff_id (added by migration 371)
 * to scope the issued set, and stock_serial_events (Wave 1 event log) as
 * the canonical install signal — qa_photo_reviews was the original plan
 * source but its ont_consumption_id / ont_serial_scanned linkage is 0%
 * populated, so it's unusable; stock_serial_events is the reliable post-
 * Wave-1 fact-table.
 *
 * Counts are scoped to TODAY's-issued-serials only — an install/return
 * recorded today against a serial that wasn't issued today by this user
 * is correctly excluded.
 */

import { sql } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import type { StoresTodayRow } from '@/types/field-stock-pwa/storesToday';

export type { StoresTodayRow };

/**
 * Get today's per-technician reconciliation for a specific stores user.
 *
 * @param storesStaffId  staff.id of the authenticated stores user
 * @param dateSAST       ISO date string "YYYY-MM-DD"; server interprets in
 *                       the DB's default timezone (Africa/Johannesburg)
 */
export async function getTodayForStoresUser(
  storesStaffId: string,
  dateSAST: string,
): Promise<StoresTodayRow[]> {
  try {
    const rows = await sql<StoresTodayRow>`
      WITH issued_today AS (
        SELECT
          sp.technician_id,
          sp.technician_name,
          UNNEST(spl.serial_ids) AS serial_id,
          si.standard_cost
        FROM stock_pickings sp
        JOIN stock_picking_lines spl ON spl.picking_id = sp.id
        JOIN stock_items si ON si.id = spl.stock_item_id
        WHERE sp.created_by_staff_id = ${storesStaffId}
          AND sp.picking_type = 'issue'
          AND sp.created_at >= ${dateSAST}::date
          AND sp.created_at < ${dateSAST}::date + INTERVAL '1 day'
          AND sp.technician_id IS NOT NULL
          AND spl.serial_ids IS NOT NULL
          AND array_length(spl.serial_ids, 1) > 0
      ),
      issued_summary AS (
        SELECT
          technician_id,
          MAX(technician_name) AS technician_name,
          COUNT(*) AS issued_count,
          COALESCE(SUM(standard_cost), 0)::numeric AS issued_value_rand
        FROM issued_today
        GROUP BY technician_id
      ),
      installed_today AS (
        SELECT
          it.technician_id,
          COUNT(DISTINCT sse.serial_id) AS installed_count
        FROM issued_today it
        JOIN stock_serial_events sse ON sse.serial_id = it.serial_id
        WHERE sse.event_type IN ('installed_at_drop', 'activated')
          AND sse.occurred_at >= ${dateSAST}::date
          AND sse.occurred_at < ${dateSAST}::date + INTERVAL '1 day'
        GROUP BY it.technician_id
      ),
      returned_today AS (
        SELECT
          it.technician_id,
          COUNT(DISTINCT srl.serial_id) AS returned_count
        FROM issued_today it
        JOIN stock_return_lines srl ON srl.serial_id = it.serial_id
        JOIN stock_returns sr ON sr.id = srl.return_id
        WHERE sr.created_at >= ${dateSAST}::date
          AND sr.created_at < ${dateSAST}::date + INTERVAL '1 day'
        GROUP BY it.technician_id
      )
      SELECT
        i.technician_id::text AS technician_id,
        COALESCE(i.technician_name, '') AS technician_name,
        i.issued_count::int AS issued_count,
        i.issued_value_rand::numeric AS issued_value_rand,
        COALESCE(ins.installed_count, 0)::int AS installed_count,
        COALESCE(ret.returned_count, 0)::int AS returned_count,
        (i.issued_count - COALESCE(ins.installed_count, 0) - COALESCE(ret.returned_count, 0))::int AS unaccounted_count
      FROM issued_summary i
      LEFT JOIN installed_today ins ON ins.technician_id = i.technician_id
      LEFT JOIN returned_today ret ON ret.technician_id = i.technician_id
      ORDER BY unaccounted_count DESC, technician_name ASC;
    `;
    // pg-node returns NUMERIC as string to preserve precision. Parse to
    // number at this boundary — rand values fit JS number safely up to
    // ~9 trillion, well above any realistic daily issue value.
    return rows.map((r) => ({
      ...r,
      issued_value_rand: typeof r.issued_value_rand === 'string'
        ? Number(r.issued_value_rand)
        : r.issued_value_rand,
    }));
  } catch (error) {
    log.error('getTodayForStoresUser failed', { error, storesStaffId, dateSAST }, 'storesTodayService');
    throw error;
  }
}
