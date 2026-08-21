/**
 * Selection logic for the GRN "Source Purchase Order" picker.
 *
 * Kept out of the component so the receipt-state and search rules can be tested
 * directly. The GRN page loads every receivable PO once (621 rows in production
 * on 2026-08-21), so filtering is local — there is no search endpoint to call.
 */

/**
 * The receipt totals are optional because the GRN page's own PurchaseOrder
 * shape declares them so — an older API response can omit them, in which case
 * the PO reads as never-received rather than throwing.
 */
export interface PickerPurchaseOrder {
  id: string;
  poNumber: string;
  status?: string;
  supplierName: string;
  itemCount: number;
  grnCount?: number;
  totalOrdered?: number;
  totalReceived?: number;
}

export type PoReceiptState = 'not_received' | 'partially_received' | 'fully_received';

/** Quantity still to be booked in. Never negative: over-receipts read as 0 left. */
export function poOutstanding(po: PickerPurchaseOrder): number {
  return Math.max(0, (po.totalOrdered ?? 0) - (po.totalReceived ?? 0));
}

/**
 * Receipt state is derived from quantities, not from purchase_orders.status.
 *
 * The status column is maintained by a separate write path and can lag or
 * disagree with the goods_receipt_items totals; the quantities are what the
 * receiving clerk actually needs to act on.
 */
export function poReceiptState(po: PickerPurchaseOrder): PoReceiptState {
  if (!po.grnCount || po.grnCount <= 0) return 'not_received';
  return poOutstanding(po) > 0 ? 'partially_received' : 'fully_received';
}

/** A fully-received PO has nothing left to book in, so it cannot be chosen. */
export function isPoSelectable(po: PickerPurchaseOrder): boolean {
  return poReceiptState(po) !== 'fully_received';
}

/**
 * Ranking: part-received first.
 *
 * These are the POs with stock physically waiting to be booked in, and they are
 * the whole reason someone opens this picker twice for one order. They used to
 * sort BELOW every untouched PO, which put PO-2026-0237 at position 347 of 621
 * and read to the user as the order having been deleted.
 */
export function poSortRank(po: PickerPurchaseOrder): number {
  const state = poReceiptState(po);
  if (state === 'partially_received') return 0;
  if (state === 'fully_received') return 2;
  return 1;
}

/** Matches on PO number or supplier name, case- and whitespace-insensitive. */
export function poMatchesQuery(po: PickerPurchaseOrder, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return (
    (po.poNumber ?? '').toLowerCase().includes(needle) ||
    (po.supplierName ?? '').toLowerCase().includes(needle)
  );
}

/**
 * Filter by query, then order part-received first.
 *
 * Within a rank group the server's order (most recent first) is preserved:
 * filter() returns a fresh array and Array.prototype.sort is required to be
 * stable by ES2019, so no explicit index tiebreak is needed.
 */
export function filterAndRankPos(
  pos: PickerPurchaseOrder[],
  query: string
): PickerPurchaseOrder[] {
  return pos
    .filter((po) => poMatchesQuery(po, query))
    .sort((a, b) => poSortRank(a) - poSortRank(b));
}

/** Trailing badge text, or null when the PO has never been received against. */
export function poStateBadge(po: PickerPurchaseOrder): string | null {
  const state = poReceiptState(po);
  if (state === 'fully_received') return 'Fully received';
  if (state === 'partially_received') return `${poOutstanding(po)} outstanding`;
  return null;
}
