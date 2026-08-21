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
 * Idempotent: `ON CONFLICT (stock_item_id, serial_number) DO UPDATE` that
 * touches ONLY unconfirmed field_intake rows, stamping source_confirmed_at.
 * An ordinary already-received serial matches no WHERE and is skipped (no row,
 * no status write, so the emit
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
  /**
   * Warehouse stock_location UUID, or null.
   *
   * When it comes from a SharePoint workbook tab this is PROVISIONAL — the tab
   * denotes allocation, not physical presence, so the row is written with
   * location_confirmed = false (migration 512) until a physical receipt
   * confirms it.
   */
  locationId: string | null;
  /**
   * projects.id this stock is EARMARKED for, or null when the tab could not be
   * resolved to exactly one project. This is what the workbook tab actually
   * means; it is not a claim about where the unit is.
   */
  allocatedToProjectId?: string | null;
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
  /**
   * field_intake serials the sheet has now caught up with. These were issued
   * from a scanned carton before the workbook listed them (migration 515);
   * this run confirmed them, so they drop off the unconfirmed ageing report.
   */
  confirmed: number;
}

/** Rows per transaction. Keeps each unit small while amortising round-trips. */
const CHUNK_SIZE = 500;

/**
 * Receive serials into stock as `in_stock`, emitting one `received` genesis
 * event per newly-inserted serial. Processes in transactional chunks.
 *
 * Atomicity is per-chunk, NOT per-run: if a later chunk throws, earlier chunks
 * are already committed. This is safe because intake is idempotent
 * (the upsert below) — re-running resumes from where it stopped — but
 * callers receive the error and should surface that the run was partial. The
 * count of serials received before the failure is logged here.
 */
export async function receiveSerials(
  pool: Pool,
  items: SerialIntakeItem[],
  ctx: SerialIntakeContext,
): Promise<SerialIntakeResult> {
  const result: SerialIntakeResult = { received: 0, skipped: 0, confirmed: 0 };

  // Deduplicate on the conflict target BEFORE chunking. This is load-bearing,
  // not tidiness: `ON CONFLICT DO UPDATE` raises "command cannot affect row a
  // second time" if one statement proposes the same (stock_item_id,
  // serial_number) twice, which aborts the chunk and, because the error is
  // rethrown, the whole run. The previous `DO NOTHING` tolerated duplicates
  // silently, so this hazard arrived with the confirmation logic.
  //
  // The source is a hand-maintained workbook that already carries junk rows,
  // so a repeated serial is a question of when, not whether. Verified against
  // Postgres 2026-08-21: DO NOTHING inserts 2 of 3 and survives; DO UPDATE
  // errors on the same input.
  const seenKeys = new Set<string>();
  const uniqueItems: SerialIntakeItem[] = [];
  let duplicatesDropped = 0;
  for (const item of items) {
    const key = `${item.stockItemId}\u0000${item.serialNumber}`;
    if (seenKeys.has(key)) { duplicatesDropped += 1; continue; }
    seenKeys.add(key);
    uniqueItems.push(item);
  }
  if (duplicatesDropped > 0) {
    // Counted as skipped so the totals still add up to what the caller sent.
    result.skipped += duplicatesDropped;
    log.warn('receiveSerials: dropped duplicate serials from the source', {
      duplicatesDropped,
      received: items.length,
      unique: uniqueItems.length,
    }, 'field-stock/serialIntake');
  }

  for (let i = 0; i < uniqueItems.length; i += CHUNK_SIZE) {
    const chunk = uniqueItems.slice(i, i + CHUNK_SIZE);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      let inserted = 0;
      let confirmed = 0;
      await withSerialEventContext(
        client,
        { sourceTable: ctx.sourceTable, sourceId: ctx.sourceId, payload: ctx.payload },
        async () => {
          const res = await client.query(
            `INSERT INTO stock_serials
               (id, stock_item_id, serial_number, current_location_id,
                allocated_to_project_id,
                status, received_reference, received_date, condition)
             SELECT
               gen_random_uuid(), incoming.stock_item_id, incoming.serial_number,
               incoming.location_id, incoming.allocated_to_project_id,
               'in_stock', $6, NOW(), incoming.condition
             FROM unnest($1::uuid[], $2::text[], $3::uuid[], $4::uuid[], $5::text[])
               AS incoming(stock_item_id, serial_number, location_id,
                           allocated_to_project_id, condition)
             ON CONFLICT (stock_item_id, serial_number) DO UPDATE
               SET source_confirmed_at = NOW(), updated_at = NOW()
               WHERE stock_serials.provenance = 'field_intake'
                 AND stock_serials.source_confirmed_at IS NULL
             RETURNING (xmax = 0) AS was_insert`,
            [
              chunk.map((item) => item.stockItemId),
              chunk.map((item) => item.serialNumber),
              chunk.map((item) => item.locationId),
              chunk.map((item) => item.allocatedToProjectId ?? null),
              chunk.map((item) => item.condition ?? 'new'),
              ctx.receivedReference,
            ],
          );
          // With DO UPDATE, rowCount counts confirmations as well as inserts,
          // which would inflate `received` and make a sync that imported
          // nothing look productive. `xmax = 0` is true only for a genuine
          // INSERT, so the two are counted apart.
          const rows = (res.rows ?? []) as Array<{ was_insert: boolean }>;
          inserted = rows.filter((r) => r.was_insert).length;
          confirmed = rows.length - inserted;
        },
      );
      await client.query('COMMIT');
      result.received += inserted;
      result.confirmed += confirmed;
      // A confirmation is not a skip: the row was already there, but the sheet
      // catching up with it is the event the ageing report waits for.
      result.skipped += chunk.length - inserted - confirmed;
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
