/**
 * serialIntake.ts — ONT/Gizzu stock-receipt (genesis) path.
 *
 * The sanctioned way to CREATE a brand-new stock_serials row. Inserts the
 * serial as `status='in_stock'`; the mig 387 AFTER-INSERT emit trigger then
 * writes a `received` genesis event (transition-matrix row `__new__ → in_stock`)
 * using the per-txn `ff.event_*` GUCs set by `withSerialEventContext`.
 *
 * This is the receive counterpart to `promoteSerial` (serialLifecycle.ts),
 * which only TRANSITIONS an existing serial. promoteSerial cannot create a
 * genesis row, so intake INSERTs directly with status='in_stock'. The ESLint
 * `no-direct-serial-status-write` rule targets only `UPDATE stock_serials SET`,
 * so a genesis INSERT is outside its scope (no allow-list entry needed).
 *
 * Idempotent: `ON CONFLICT (stock_item_id, serial_number) DO NOTHING` — an
 * already-received serial is skipped (no row, no status write, so the emit
 * trigger never fires). Safe to re-run on a schedule.
 */

import type { Pool } from 'pg';
import { withSerialEventContext } from '@/lib/db/serialEventContext';
import { log } from '@/lib/logger';

/** A single serial to receive into stock. */
export interface SerialIntakeItem {
  /** UUID of the stock_items row (e.g. FT-ONT / FT-GIZZU). */
  stockItemId: string;
  /** Cleaned serial number. */
  serialNumber: string;
  /** Warehouse / project stock_location UUID, or null. */
  locationId: string | null;
  /** Physical condition; defaults to 'new'. */
  condition?: string;
}

/** Attribution + reference shared by every serial in one intake run. */
export interface SerialIntakeContext {
  /** Free-text event attribution, e.g. 'ont_serial_import'. */
  sourceTable: string;
  /** Batch/run id — MUST be a UUID (the emit trigger casts it to ::uuid). */
  sourceId: string;
  /** Value written to stock_serials.received_reference. */
  receivedReference: string;
  /** Optional JSON payload recorded on each emitted `received` event. */
  payload?: Record<string, unknown>;
}

export interface SerialIntakeResult {
  /** Newly inserted (genuinely received) serials. */
  received: number;
  /** Serials that already existed and were skipped. */
  skipped: number;
}

/** Rows per transaction. Keeps each unit small while amortising round-trips. */
const CHUNK_SIZE = 500;

/**
 * Receive serials into stock as `in_stock`, emitting one `received` genesis
 * event per newly-inserted serial. Processes in transactional chunks.
 *
 * Atomicity is per-chunk, NOT per-run: if a later chunk throws, earlier chunks
 * are already committed. This is safe because intake is idempotent
 * (`ON CONFLICT DO NOTHING`) — re-running resumes from where it stopped — but
 * callers receive the error and should surface that the run was partial. The
 * count of serials received before the failure is logged here.
 */
export async function receiveSerials(
  pool: Pool,
  items: SerialIntakeItem[],
  ctx: SerialIntakeContext,
): Promise<SerialIntakeResult> {
  const result: SerialIntakeResult = { received: 0, skipped: 0 };

  for (let i = 0; i < items.length; i += CHUNK_SIZE) {
    const chunk = items.slice(i, i + CHUNK_SIZE);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let inserted = 0;
      await withSerialEventContext(
        client,
        { sourceTable: ctx.sourceTable, sourceId: ctx.sourceId, payload: ctx.payload },
        async () => {
          const res = await client.query(
            `INSERT INTO stock_serials
               (id, stock_item_id, serial_number, current_location_id,
                status, received_reference, received_date, condition)
             SELECT
               gen_random_uuid(), incoming.stock_item_id, incoming.serial_number,
               incoming.location_id, 'in_stock', $5, NOW(), incoming.condition
             FROM unnest($1::uuid[], $2::text[], $3::uuid[], $4::text[])
               AS incoming(stock_item_id, serial_number, location_id, condition)
             ON CONFLICT (stock_item_id, serial_number) DO NOTHING`,
            [
              chunk.map((item) => item.stockItemId),
              chunk.map((item) => item.serialNumber),
              chunk.map((item) => item.locationId),
              chunk.map((item) => item.condition ?? 'new'),
              ctx.receivedReference,
            ],
          );
          inserted = res.rowCount ?? 0;
        },
      );
      await client.query('COMMIT');
      result.received += inserted;
      result.skipped += chunk.length - inserted;
    } catch (err) {
      await client.query('ROLLBACK');
      log.error(
        'receiveSerials: chunk rolled back — run is partial (prior chunks committed)',
        {
          chunkStart: i,
          chunkSize: chunk.length,
          receivedBeforeFailure: result.received,
          error: err instanceof Error ? err.message : String(err),
        },
        'serialIntake',
      );
      throw err;
    } finally {
      client.release();
    }
  }

  log.info('receiveSerials: complete', { ...result, sourceTable: ctx.sourceTable }, 'serialIntake');
  return result;
}
