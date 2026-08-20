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

    const serialIds = line.serial_ids ?? [];
    if (serialIds.length > 0) {
      const serialRows = await txn.query<{
        id: string;
        status: string;
        current_location_id: string | null;
      }>(
        `SELECT id, status, current_location_id FROM stock_serials
          WHERE id = ANY($1::uuid[]) FOR UPDATE`,
        [serialIds],
      );
      const byId = new Map(serialRows.map((r) => [r.id, r]));
      const unusable = serialIds.filter((id) => {
        const row = byId.get(id);
        if (!row) return true;
        if (row.status !== 'available' && row.status !== 'in_stock') return true;
        // A serial with no recorded location is allowed — missing data is not a
        // contradiction, the same rule the scan step applies.
        return row.current_location_id !== null && row.current_location_id !== sourceLocationId;
      });

      if (unusable.length > 0) {
        errors[line.stock_item_id] =
          `${unusable.length} of ${serialIds.length} ${await itemLabel(line.stock_item_id)} serials are not in stock at ${await locationName()}`;
        continue;
      }

      // The serials decide. The quants comparison is recorded, never enforced:
      // stock_quants is an opening-balance snapshot with no consumption
      // postings, so requiring it here refuses handouts that are physically
      // on the shelf. Drift is written to stock_quant_drift_log (migration 507)
      // so it stays measurable until PWA receiving records physical moves.
      const driftQuants = await txn.query<StockQuantRow>(
        `SELECT quantity FROM stock_quants
          WHERE stock_item_id = $1 AND location_id = $2 AND COALESCE(lot_number, '') = COALESCE($3, '')`,
        [line.stock_item_id, sourceLocationId, line.lot_number ?? null],
      );
      const quantsOnHand = Number(driftQuants[0]?.quantity ?? 0);
      if (quantsOnHand < serialIds.length) {
        await txn.query(
          `INSERT INTO stock_quant_drift_log
             (picking_line_id, stock_item_id, location_id, serials_counted, quants_on_hand)
           VALUES ($1, $2, $3, $4, $5)`,
          [line.id, line.stock_item_id, sourceLocationId, serialIds.length, quantsOnHand],
        );
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
