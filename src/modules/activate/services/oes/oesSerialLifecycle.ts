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
 * 'activated', promote the corresponding `stock_serials` row from
 * `installed` → `activated` via the canonical promoteSerial() path
 * (mig 387 matrix row 73, event_type='activated').
 *
 * DORMANT PRE-CUTOVER: mig 364 TRIGGER 3 (`trg_oes_pp_data_after_insert_activate`)
 * fires on `oes_pp_data` INSERT/UPDATE and directly sets `stock_serials.status →
 * 'activated'` before this application-layer code runs. By the time we reach
 * this point, TRIGGER 3 has already raced ahead — the per-serial guard
 * (`serial.status !== 'installed'`) sees status='activated' and skips the row.
 * This is expected and accepted (Hein, 2026-05-28).
 * See cascadePpResolution.ts inline doc and PR body for full background.
 *
 * POST-CUTOVER (Track 7): TRIGGER 3 is retired. This function becomes the
 * sole application-layer writer for the OES `installed → activated` transition.
 *
 * Guard logic:
 *   - Serial not in stock_serials → skip (no stock record to promote).
 *   - Serial status ≠ 'installed' → skip (already promoted by TRIGGER 3
 *     pre-cutover, or in a later/different state).
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
      if (!serial) continue; // Serial not in stock_serials — skip.
      if (serial.status !== 'installed') continue; // Guard: TRIGGER 3 pre-cutover race or wrong state — skip.

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

      logger.info('OES serial promoted installed→activated', {
        serial_number: row.serial_number,
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
