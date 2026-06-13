/**
 * Write helpers for `olt_mismatch_records`, shared by both queue-processing
 * paths (the inline endpoint processor and the continuation service) so the
 * mutations can never drift:
 *  - `insertMismatchIfNew` — upsert a mismatch with active-row dedup.
 *  - `resolveMatchedDrop`  — auto-resolve stale rows when a DR now matches.
 *
 * `insertMismatchIfNew`: SELECT-then-UPDATE/INSERT with an ON CONFLICT backstop;
 * the partial unique index `idx_olt_mismatch_drop_active_uniq` guarantees at
 * most one active row per drop even under concurrent workers.
 *
 * Status-mismatch priority: a status_mismatch and a serial fix describe two
 * independent problems on the same drop. A pending serial fix must NOT be
 * overwritten by a status_mismatch, and a status_mismatch IS allowed to be
 * created alongside an already-fixed serial. Non-status-mismatch upserts behave
 * exactly as before (fixed→skip, pending/not_found/empty/other-dr→update).
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import type { PoolClient } from 'pg';

export interface MismatchUpsert {
  importId: string;
  dropNumber: string;
  oltSerial: string;
  wrongOneMapSerial: string | null;
  fixStatus: string;
  hasUpsSwap: boolean;
  oesBatchId: string;
  oesSource: string;
  investigationContext?: string | null;
}

/**
 * True when a serialised investigation_context describes a status_mismatch.
 * `investigation_context` is a TEXT column, so `pg` always returns a JSON
 * string (never a parsed object) — and every writer passes a JSON.stringify'd
 * value or null. We therefore only need the string case.
 */
function isStatusMismatchContext(context: string | null | undefined): boolean {
  if (!context) return false;
  try {
    return JSON.parse(context)?.reason === 'status_mismatch';
  } catch {
    return false; // malformed JSON is not a status_mismatch
  }
}

export async function insertMismatchIfNew(
  client: PoolClient,
  data: MismatchUpsert
): Promise<void> {
  const isNewStatusMismatch = isStatusMismatchContext(data.investigationContext);

  const existing = await client.query(
    `SELECT id, fix_status, olt_serial, investigation_context
     FROM olt_mismatch_records
     WHERE drop_number = $1 ORDER BY created_at DESC LIMIT 1`,
    [data.dropNumber]
  );

  if (existing.rows.length > 0) {
    const ex = existing.rows[0];
    const isExistingStatusMismatch = isStatusMismatchContext(ex.investigation_context);

    if (ex.fix_status === 'fixed'
        && ex.olt_serial?.toUpperCase() === data.oltSerial.toUpperCase()) {
      // Serial already fixed. A new status_mismatch is a distinct problem, so
      // let it through to INSERT; anything else is a duplicate — skip.
      if (!(isNewStatusMismatch && !isExistingStatusMismatch)) {
        return;
      }
    } else if (['pending', 'empty_serial', 'not_found', 'serial_other_dr'].includes(ex.fix_status)) {
      // A pending serial fix outranks a status_mismatch — don't overwrite it.
      if (isNewStatusMismatch && !isExistingStatusMismatch) {
        return;
      }
      await client.query(
        `UPDATE olt_mismatch_records
         SET olt_serial = $1, wrong_onemap_serial = $2,
             has_ups_swap = $3, detection_source = 'auto',
             oes_batch_id = $4, onemap_source = $5,
             fix_status = $6, investigation_context = $7
         WHERE id = $8`,
        [data.oltSerial, data.wrongOneMapSerial, data.hasUpsSwap,
         data.oesBatchId, data.oesSource, data.fixStatus,
         data.investigationContext || null, ex.id]
      );
      return;
    }
  }

  // ON CONFLICT backstops the app-layer SELECT-then-INSERT above: if two workers
  // race past the SELECT and both reach this INSERT for the same drop, the
  // partial unique index (idx_olt_mismatch_drop_active_uniq) forces one side to
  // take the UPDATE branch instead of creating a second row.
  await client.query(
    `INSERT INTO olt_mismatch_records
      (import_id, drop_number, olt_serial, wrong_onemap_serial, fix_status,
       has_ups_swap, detection_source, oes_batch_id, onemap_source, investigation_context)
     VALUES ($1, $2, $3, $4, $5, $6, 'auto', $7, $8, $9)
     ON CONFLICT (drop_number)
       WHERE fix_status IN ('pending','needs_investigation','not_found','empty_serial','needs_reinvestigation','serial_other_dr')
     DO UPDATE SET
       olt_serial = EXCLUDED.olt_serial,
       wrong_onemap_serial = EXCLUDED.wrong_onemap_serial,
       has_ups_swap = EXCLUDED.has_ups_swap,
       detection_source = 'auto',
       oes_batch_id = EXCLUDED.oes_batch_id,
       onemap_source = EXCLUDED.onemap_source,
       fix_status = EXCLUDED.fix_status,
       investigation_context = EXCLUDED.investigation_context`,
    [data.importId, data.dropNumber, data.oltSerial, data.wrongOneMapSerial,
     data.fixStatus, data.hasUpsSwap, data.oesBatchId, data.oesSource,
     data.investigationContext || null]
  );
}

/**
 * Auto-resolve a drop whose OES serial now matches 1Map on re-check. If an
 * earlier run left an auto-detected record for this drop (e.g. a stale
 * 'not_found' from before 1Map caught up), reconcile it so it drops out of the
 * investigate / non-invoiceable lists instead of lingering forever. No-op when
 * no such row exists.
 *
 * Deliberately scoped:
 *  - only auto-detected states (NOT needs_investigation / needs_reinvestigation):
 *    those are human-review verdicts and must not be silently auto-closed.
 *  - skip rows with an open ticket: NOC owns that lifecycle.
 */
export async function resolveMatchedDrop(
  client: PoolClient,
  dropNumber: string
): Promise<void> {
  await client.query(
    `UPDATE olt_mismatch_records
     SET fix_status = 'resolved',
         resolution_type = 'auto_verified_match',
         resolution_notes = 'Auto-resolved: OES serial now matches 1Map on re-check',
         resolved_at = NOW()
     WHERE drop_number = $1
       AND maintenance_ticket_id IS NULL
       AND fix_status IN ('pending','not_found','empty_serial','serial_other_dr')`,
    [dropNumber]
  );
}
