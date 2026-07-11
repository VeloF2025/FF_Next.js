/**
 * Stock availability validation for picking processing.
 *
 * Extracted from process.ts (already over the 300-line cap). Error messages
 * name the item and warehouse — the stores PWA shows them to field staff, and
 * raw UUIDs are unactionable there. Name lookups run only on failing lines
 * (and are memoized), so the happy path costs no extra queries.
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
    const quants = await txn.query<StockQuantRow>(
      `SELECT quantity FROM stock_quants WHERE stock_item_id = $1 AND location_id = $2 FOR UPDATE`,
      [line.stock_item_id, sourceLocationId],
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
