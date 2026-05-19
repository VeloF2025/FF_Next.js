/**
 * Stock items API helpers for the field-stock PWA.
 *
 * standard_cost is the procurement module's unit-value column for stock items.
 * It is returned as a numeric string by the Postgres driver; we parse it to
 * a JS number. If absent or null, unitValueZar is null — the R5k cap guard
 * treats null as non-blocking client-side but warns; the server re-checks.
 */

import { request } from './request';

// =============================================================================
// Server row shape
// =============================================================================

/**
 * Server row shape returned by GET /api/procurement/field-stock/items.
 * Only the fields needed for PickItemStep (and SignAndSubmitStep) are mapped.
 */
interface StockItemRow {
  id: string;
  name: string;
  item_code: string | null;
  tracking_type: string;
  /** Per-unit value in ZAR excl VAT, from stock_items.standard_cost. */
  standard_cost: string | null;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Fetch all active stock items that use serial-number tracking.
 *
 * Uses GET /api/procurement/field-stock/items?trackingType=serial
 * which filters server-side (Branch 5 in items.ts). Client-side
 * search filtering is applied when `opts.search` is provided.
 *
 * The endpoint returns at most 100 rows. If the catalogue grows
 * beyond that, a dedicated paginated endpoint will be needed.
 * TODO(Task 2.7): evaluate if 100-row cap is sufficient in production.
 */
export async function fetchSerialStockItems(
  opts: { search?: string } = {}
): Promise<Array<{ id: string; name: string; sku: string | null; unitValueZar: number | null }>> {
  const params = new URLSearchParams({ trackingType: 'serial' });
  if (opts.search) {
    params.set('search', opts.search);
  }
  const rows = await request<StockItemRow[]>(
    `/api/procurement/field-stock/items?${params.toString()}`
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    sku: r.item_code ?? null,
    // standard_cost comes back as a numeric string from pg; parse to float.
    // Null means the item has no valuation — cap guard will warn but not block.
    unitValueZar: r.standard_cost != null ? parseFloat(r.standard_cost) : null,
  }));
}
