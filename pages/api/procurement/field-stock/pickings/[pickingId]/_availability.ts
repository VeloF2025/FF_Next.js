/**
 * Stock availability validation for picking processing.
 *
 * Extracted from process.ts (already over the 300-line cap). Error messages
 * name the item and warehouse — the stores PWA shows them to field staff, and
 * raw UUIDs are unactionable there. Name lookups run only on failing lines
 * (and are memoized), so the happy path costs no extra queries.
 *
 * Serial-tracked lines are validated against the SERIALS, not stock_quants.
 * stock_quants is a 26-May-2026 Odoo opening-balance snapshot with no
 * consumption postings; requiring a row from it refused genuine handouts
 * through 2026-07 (PCK-000009/10). The quants comparison still runs and any
 * disagreement is written to stock_quant_drift_log (migration 507) so the
 * drift stays measurable — but it no longer blocks an issue whose serials are
 * demonstrably on the shelf.
 */

import type { TxnClient } from '@/lib/db-pool';
import { log } from '@/lib/logger';

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Write one drift observation without ever endangering the issue itself.
 *
 * This is diagnostics: it must not be able to fail the handout it is observing —
 * that is the exact class of failure this file's serial path exists to end
 * (PCK-000009/10, where a bookkeeping check refused stock that was on the shelf).
 *
 * A plain try/catch is NOT enough. A failed statement poisons the surrounding
 * Postgres transaction: every subsequent statement returns 25P02 until rollback,
 * so catching the JS error would still doom the picking. The SAVEPOINT gives the
 * insert its own sub-transaction that can be rolled back on its own.
 */
async function recordDrift(
  txn: TxnClient,
  d: {
    lineId: string;
    stockItemId: string;
    sourceLocationId: string;
    serialsCounted: number;
    quantsOnHand: number;
  },
): Promise<void> {
  try {
    await txn.query('SAVEPOINT drift_log', []);
  } catch (error) {
    log.warn('drift log: could not open savepoint, skipping', { error }, 'field-stock/availability');
    return;
  }
  try {
    await txn.query(
      `INSERT INTO stock_quant_drift_log
         (picking_line_id, stock_item_id, location_id, serials_counted, quants_on_hand)
       VALUES ($1, $2, $3, $4, $5)`,
      [d.lineId, d.stockItemId, d.sourceLocationId, d.serialsCounted, d.quantsOnHand],
    );
    await txn.query('RELEASE SAVEPOINT drift_log', []);
  } catch (error) {
    // Table missing on an environment where 507 has not run, transient error —
    // any of it. Roll back only the insert and let the picking proceed.
    log.warn('drift log: insert failed, issue continues', { error }, 'field-stock/availability');
    await txn.query('ROLLBACK TO SAVEPOINT drift_log', []);
  }
}

export interface PickingLine {
  id: string;
  stock_item_id: string;
  planned_quantity: number;
  serial_ids?: string[];
  lot_number?: string | null;
  unit_cost?: number | null;
}

interface StockQuantRow extends Record<string, unknown> {
  quantity: number;
}

/** Verify every picking line has sufficient stock at source (runs inside txn with FOR UPDATE). */
export async function validateStockAvailability(
  txn: TxnClient,
  lines: PickingLine[],
  sourceLocationId: string,
): Promise<{ valid: true } | { valid: false; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};
  let sourceName: string | null = null;
  const locationName = async (): Promise<string> => {
    if (sourceName === null) {
      const rows = await txn.query<{ name: string | null }>(
        `SELECT name FROM stock_locations WHERE id = $1`,
        [sourceLocationId],
      );
      // || not ??: an empty-string name must fall back too, not render blank.
      sourceName = rows[0]?.name || sourceLocationId;
    }
    return sourceName;
  };
  const itemLabels = new Map<string, string>();
  const itemLabel = async (stockItemId: string): Promise<string> => {
    const cached = itemLabels.get(stockItemId);
    if (cached) return cached;
    const rows = await txn.query<{ item_code: string | null; name: string | null }>(
      `SELECT item_code, name FROM stock_items WHERE id = $1`,
      [stockItemId],
    );
    const label = rows[0]?.item_code || rows[0]?.name || stockItemId;
    itemLabels.set(stockItemId, label);
    return label;
  };
  for (const line of lines) {
    if (!line || !line.stock_item_id) continue;

    const rawSerialIds = line.serial_ids ?? [];
    if (rawSerialIds.length > 0) {
      // De-duplicate: one physical serial listed twice must not count as two
      // units. Non-UUID entries are kept and resolve to "unusable" below rather
      // than reaching the ::uuid[] cast, which would throw 22P02 and abort the
      // whole picking with an opaque 500.
      const serialIds = [...new Set(rawSerialIds)];
      const castable = serialIds.filter((id) => UUID_SHAPE.test(id));

      const serialRows = castable.length
        ? await txn.query<{ id: string; status: string; current_location_id: string | null }>(
            `SELECT id, status, current_location_id FROM stock_serials
              WHERE id = ANY($1::uuid[]) FOR UPDATE`,
            [castable],
          )
        : [];
      const byId = new Map(serialRows.map((r) => [r.id, r]));
      const unusable = serialIds.filter((id) => {
        const row = byId.get(id);
        if (!row) return true;
        return row.status !== 'available' && row.status !== 'in_stock';
      });

      // Being recorded at a DIFFERENT warehouse no longer blocks. That location
      // is an assumption from a workbook tab that denotes allocation, not
      // presence (27.5% accurate, measured 2026-08-21), and stock legitimately
      // moves between sites. Refusing here is what produced the 2026-07 dead
      // end: the technician had already signed. Counted so the divergence is
      // visible instead of silent — the scan step warns the storeman.
      const elsewhere = serialIds.filter((id) => {
        const row = byId.get(id);
        return !!row && row.current_location_id !== null
          && row.current_location_id !== sourceLocationId;
      });
      if (elsewhere.length > 0) {
        log.warn(
          'issue: serials recorded at another warehouse — allowed, not blocked',
          { count: elsewhere.length, of: serialIds.length, sourceLocationId, lineId: line.id },
          'field-stock/availability',
        );
      }

      if (unusable.length > 0) {
        errors[line.stock_item_id] =
          `${unusable.length} of ${serialIds.length} ${await itemLabel(line.stock_item_id)} serials are not in stock at ${await locationName()}`;
        continue;
      }

      // The serial-path analogue of the quants shortfall check below: after
      // de-duplication there must be at least as many distinct serials as the
      // quantity this line issues.
      if (serialIds.length < line.planned_quantity) {
        errors[line.stock_item_id] =
          `Insufficient ${await itemLabel(line.stock_item_id)} serials at ${await locationName()}: required ${line.planned_quantity}, scanned ${serialIds.length}`;
        continue;
      }

      // The serials decide. The quants comparison is recorded, never enforced:
      // stock_quants is an opening-balance snapshot with no consumption
      // postings, so requiring it here refuses handouts that are physically
      // on the shelf. Drift is written to stock_quant_drift_log (migration 507)
      // so it stays measurable until PWA receiving records physical moves.
      //
      // Deliberately NO `FOR UPDATE` here, unlike the quants path below: this
      // read never gates the decision, and locking a row we do not decrement
      // would add contention (and lock-ordering risk) for a diagnostic. The
      // logged figure may therefore be a moment stale. That is intended.
      const driftQuants = await txn.query<StockQuantRow>(
        `SELECT quantity FROM stock_quants
          WHERE stock_item_id = $1 AND location_id = $2 AND COALESCE(lot_number, '') = COALESCE($3, '')`,
        [line.stock_item_id, sourceLocationId, line.lot_number ?? null],
      );
      const quantsOnHand = Number(driftQuants[0]?.quantity ?? 0);
      if (quantsOnHand < serialIds.length) {
        await recordDrift(txn, {
          lineId: line.id,
          stockItemId: line.stock_item_id,
          sourceLocationId,
          serialsCounted: serialIds.length,
          quantsOnHand,
        });
      }
      continue;
    }

    // Lot-scoped: check the exact lot this line draws from (or the bulk/null-lot
    // row), matching how the custody and transfer paths decrement. Without the
    // lot filter a lot-tracked item with multiple lots at one location would take
    // an arbitrary lot's quantity here (quants[0]) yet the decrement would hit a
    // specific lot — an availability check that doesn't match what's decremented.
    const quants = await txn.query<StockQuantRow>(
      `SELECT quantity FROM stock_quants
        WHERE stock_item_id = $1 AND location_id = $2 AND COALESCE(lot_number, '') = COALESCE($3, '')
        FOR UPDATE`,
      [line.stock_item_id, sourceLocationId, line.lot_number ?? null],
    );
    if (quants.length === 0) {
      errors[line.stock_item_id] =
        `No stock of ${await itemLabel(line.stock_item_id)} recorded at ${await locationName()}`;
      continue;
    }
    const available = Number(quants[0]!.quantity);
    if (available < line.planned_quantity) {
      errors[line.stock_item_id] =
        `Insufficient stock of ${await itemLabel(line.stock_item_id)} at ${await locationName()}: required ${line.planned_quantity}, available ${available}`;
    }
  }
  return Object.keys(errors).length > 0 ? { valid: false, errors } : { valid: true };
}
