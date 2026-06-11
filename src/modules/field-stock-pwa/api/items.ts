/**
 * Stock items API helpers for the field-stock PWA.
 *
 * Fetches all active, issuable stock items regardless of tracking type
 * (serial, lot, quantity, none). standard_cost is the procurement module's
 * unit-value column; returned as a numeric string by the Postgres driver and
 * parsed to a JS number here. If absent or null, unitValueZar is null — the
 * R5k cap guard treats null as non-blocking client-side but warns; the server
 * re-checks.
 */

import { request } from './request';

// =============================================================================
// Server row shape
// =============================================================================

/**
 * Server row shape returned by GET /api/my/stores/items.
 * Only the fields needed for PickItemStep (and SignAndSubmitStep) are mapped.
 */
interface StockItemRow {
  id: string;
  name: string;
  item_code: string | null;
  tracking_type: string;
  uom: string | null;
  /** Per-unit value in ZAR excl VAT, from stock_items.standard_cost. */
  standard_cost: string | null;
}

// =============================================================================
// Public types
// =============================================================================

export type PwaTrackingType = 'serial' | 'lot' | 'quantity' | 'none';

const VALID_TRACKING_TYPES = new Set<string>(['serial', 'lot', 'quantity', 'none']);

export interface PwaIssuableItem {
  id: string;
  name: string;
  sku: string | null;
  trackingType: PwaTrackingType;
  uom: string | null;
  unitValueZar: number | null;
}

// =============================================================================
// Public API
// =============================================================================

/**
 * Fetch all active, issuable stock items (every tracking type).
 * No trackingType param → the endpoint returns all types (items endpoint
 * change lands in the same PR).
 *
 * The endpoint returns at most 100 rows. If the catalogue grows
 * beyond that, a dedicated paginated endpoint will be needed.
 */
export async function fetchIssuableStockItems(
  opts: { search?: string } = {}
): Promise<PwaIssuableItem[]> {
  const params = new URLSearchParams();
  if (opts.search) params.set('search', opts.search);
  const qs = params.toString();
  const rows = await request<StockItemRow[]>(
    `/api/my/stores/items${qs ? `?${qs}` : ''}`
  );
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    sku: r.item_code ?? null,
    // Unknown DB values default to 'quantity' — safest path (qty + proof
    // photo) rather than pretending the item is serial-scannable.
    trackingType: VALID_TRACKING_TYPES.has(r.tracking_type)
      ? (r.tracking_type as PwaTrackingType)
      : 'quantity',
    uom: r.uom ?? null,
    // standard_cost comes back as a numeric string from pg; parse to float.
    // Null means the item has no valuation — cap guard will warn but not block.
    unitValueZar: r.standard_cost != null ? parseFloat(r.standard_cost) : null,
  }));
}
