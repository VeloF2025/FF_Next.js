/**
 * oesSerialLifecycle.ts — Sprint E Track 2.6
 *
 * Application-layer serial lifecycle step for the OES activation path.
 * Extracted from oesPostImportService.ts to keep that file under 300 lines
 * and to enable direct testing of the helper.
 */

import pool from '@/lib/db';
import { createLogger } from '@/lib/logger';
import { promoteSerial } from '@/modules/procurement/field-stock/services/serialLifecycle';

const logger = createLogger('oes/oesSerialLifecycle');

export interface OesSerialRow {
  serial_number: string;
  drop_number: string;
}

/**
 * Sprint E Track 2.6 — OES activation serial lifecycle step.
 *
 * For each serial whose `oes_pp_data.resolution_status` was just set to
 * 'activated', promote the corresponding `stock_serials` row to `activated`
 * via the canonical promoteSerial() path.
 *
 * Two source states are valid for an OES activation, both matrix-allowed:
 *   - `installed` → `activated`  (mig 387, event_type='activated') — the normal
 *     path: the serial was recorded as installed at a drop, OES then activates.
 *   - `in_stock`  → `activated`  (mig 393, event_type='activated_on_oes') — the
 *     reconciliation path: OES reports the serial Active but we never recorded
 *     an install event for it (bulk-imported direct to stock, or a field
 *     install we never captured). Without mig 393 these raised FF001 and stayed
 *     stuck in_stock — the Group A bug (issue #1860, ~14,474 serials).
 *
 * DORMANT PRE-CUTOVER: mig 364 TRIGGER 3 (`trg_oes_pp_data_after_insert_activate`)
 * fired on `oes_pp_data` INSERT/UPDATE and directly set `stock_serials.status →
 * 'activated'` before this code ran. POST-CUTOVER (Track 7) TRIGGER 3 is
 * retired and this function is the sole application-layer activation writer.
 *
 * Guard logic:
 *   - Serial not in stock_serials → skip (no stock record; stock-receipt gap,
 *     tracked separately in issue #1864 — NOT created here).
 *   - status already 'activated' → skip (idempotent; TRIGGER 3 race pre-cutover
 *     or a re-run).
 *   - status 'installed' or 'in_stock' → promote to 'activated'.
 *   - any OTHER state (issued / allocated_to_project / available / faulty /
 *     returned / scrapped) has no matrix transition to 'activated' → LOG a
 *     warning and skip. Never silently swallowed: an OES activation arriving
 *     for such a serial is unexpected and worth surfacing for triage.
 *
 * Idempotency: sourceId=serial.id + sourceTable='oes_activations' → the
 * partial-index dedup on stock_serial_events (WHERE source_id IS NOT NULL)
 * prevents a duplicate event if this runs twice for the same serial.
 *
 * Errors are caught per-serial and logged; a single failure does not abort
 * the remaining batch (best-effort, mirrors the fire-and-forget posture of
 * triggerPpActivationCheck in oesPostImportService.ts).
 */
export async function promoteOesActivatedSerials(
  rows: ReadonlyArray<OesSerialRow>,
): Promise<void> {
  for (const row of rows) {
    try {
      // Resolve stock_serials.id + current status (needed by promoteSerial).
      const result = await pool.query<{ id: string; status: string }>(
        `SELECT id, status
           FROM stock_serials
          WHERE serial_number = $1
          LIMIT 1`,
        [row.serial_number],
      );

      const serial = result.rows[0];
      if (!serial) continue;                          // Not in stock_serials — out of scope (issue #1864).
      if (serial.status === 'activated') continue;    // Idempotent: already activated (TRIGGER 3 race / re-run).

      // Only 'installed' and 'in_stock' have a matrix transition to 'activated'
      // (mig 387 + mig 393). Any other state has no →activated edge: surface it
      // rather than silently skipping or letting promoteSerial raise FF001.
      // Note: the legacy 'available' state is intentionally NOT promoted here —
      // the Track 5 backfill renamed all 'available' rows to 'in_stock' (0
      // remain), and there is no available→activated matrix row, so an
      // 'available' serial would warn+skip safely rather than FF001. If
      // 'available' rows ever reappear, this warning is the signal to act.
      if (serial.status !== 'installed' && serial.status !== 'in_stock') {
        logger.warn('OES activation: serial in a state with no transition to activated — skipped for triage', {
          serial_number: row.serial_number,
          status:        serial.status,
          drop_number:   row.drop_number,
        });
        continue;
      }

      await promoteSerial(pool, {
        serialId:    serial.id,
        toStatus:    'activated',
        sourceTable: 'oes_activations',
        // sourceId must be a UUID (trigger casts ff.event_source_id → uuid).
        // Use serial.id — each serial activates once; dedup partial index
        // (WHERE source_id IS NOT NULL) prevents duplicate events on re-runs.
        sourceId:    serial.id,
        payload: {
          serial_number: row.serial_number,
          drop_number:   row.drop_number,
          activated_via: 'oes_post_import',
        },
      });

      // from_state determines the emitted event_type: 'installed'→activated
      // emits 'activated'; 'in_stock'→activated emits 'activated_on_oes'.
      logger.info('OES serial promoted to activated', {
        serial_number: row.serial_number,
        from_status:   serial.status,
        drop_number:   row.drop_number,
      });
    } catch (err) {
      logger.warn('OES serial promotion failed (non-blocking)', {
        serial_number: row.serial_number,
        drop_number:   row.drop_number,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
}

/**
 * Durable reconciliation for the OES activation path (issue #1860 regrowth).
 *
 * `promoteOesActivatedSerials()` above only ever sees the *pre-provision
 * resolution delta* — serials whose `oes_pp_data` row was just flipped to
 * 'activated' by the nightly import (oesPostImportService passes
 * `activatedResult.rows`). A serial that goes Active on OES WITHOUT transiting
 * the PP list is never passed to it, so its `stock_serials` row stays
 * 'in_stock' indefinitely. The one-time backfill
 * (scripts/backfill-oes-in-stock-activated.ts) cleared the historical cohort,
 * but without this pass the gap regrows (~tens/day: D1-1 climbed 0 → 1155
 * between 2026-05-31 and 2026-06-14).
 *
 * This runs a full scan for serials Active on OES (with activation_date +
 * drop_number) still stuck `in_stock`/`installed`, and promotes each via the
 * same sanctioned `promoteOesActivatedSerials()` helper — idempotent, because
 * already-'activated' serials are skipped by its status guard. Intended to run
 * once per nightly OES import, AFTER the PP-delta promotion.
 *
 * Returns `{ scanned }` — the number of pre-activated serials the scan found
 * (i.e. candidates handed to the promoter), NOT a promoted count. Per-serial
 * promote / skip / failure outcomes are already logged by
 * promoteOesActivatedSerials.
 *
 * Cost: this is the same join the one-time backfill and the nightly verify
 * monitor already run — a hash join over indexed serial_number columns
 * (idx_oes_serial, idx_stock_serials_number) the planner keeps well under a
 * second. It runs once per import, so no pagination or date bound is applied —
 * a date bound would also defeat the "catch every stuck serial" contract.
 */
export async function reconcileInStockOesActivated(): Promise<{ scanned: number }> {
  const { rows } = await pool.query<OesSerialRow>(
    `SELECT DISTINCT ON (ss.id) oa.serial_number, oa.drop_number
       FROM oes_activations oa
       JOIN stock_serials ss ON ss.serial_number = oa.serial_number
      WHERE oa.status = 'Active'
        AND oa.activation_date IS NOT NULL
        AND oa.drop_number IS NOT NULL
        AND ss.status IN ('in_stock', 'installed')
      ORDER BY ss.id, oa.activation_date DESC`,
  );

  if (rows.length > 0) {
    logger.info('OES reconciliation: serials Active on OES still pre-activated — promoting', {
      count: rows.length,
    });
    await promoteOesActivatedSerials(rows);
  }
  return { scanned: rows.length };
}
