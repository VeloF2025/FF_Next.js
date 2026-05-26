import type { TxnClient } from '@/lib/db-pool';

export interface GrnLine {
  stockItemId: string;
  quantityReceived: number;
  quantityRejected: number;
  lotNumber: string | null;
}

export interface PostGrnArgs {
  lines: GrnLine[];
  destinationLocationId: string;
  vendorsLocationId: string;
}

/**
 * Post the accepted lines of one GRN inside an existing transaction:
 *  - upsert stock_quants at the destination (canonical location-only key)
 *  - insert a balancing field_stock_movements receipt (Vendors -> destination)
 *  - keep the legacy global qty_available cache in sync (additive; not a cutover)
 * Returns total accepted quantity. Lines with no stockItemId or <=0 accepted are skipped.
 */
export async function postGrnReceiptLines(txn: TxnClient, args: PostGrnArgs): Promise<number> {
  const { lines, destinationLocationId, vendorsLocationId } = args;
  let totalAccepted = 0;

  for (const l of lines) {
    const accepted = Number(l.quantityReceived || 0) - Number(l.quantityRejected || 0);
    if (!l.stockItemId || accepted <= 0) continue;

    await txn.query(
      `INSERT INTO stock_quants (id, stock_item_id, location_id, lot_number, quantity, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (stock_item_id, location_id, COALESCE(lot_number,''))
       DO UPDATE SET quantity = stock_quants.quantity + EXCLUDED.quantity, updated_at = NOW()`,
      [l.stockItemId, destinationLocationId, l.lotNumber, accepted],
    );

    await txn.query(
      `INSERT INTO field_stock_movements
         (id, stock_item_id, movement_type, from_location_id, to_location_id, quantity, reference, performed_at, created_at)
       VALUES (gen_random_uuid(), $1, 'receipt', $2, $3, $4, 'GRN', NOW(), NOW())`,
      [l.stockItemId, vendorsLocationId, destinationLocationId, accepted],
    );

    await txn.query(
      `UPDATE stock_items SET qty_available = COALESCE(qty_available,0) + $2, updated_at = NOW() WHERE id = $1`,
      [l.stockItemId, accepted],
    );

    totalAccepted += accepted;
  }
  return totalAccepted;
}
