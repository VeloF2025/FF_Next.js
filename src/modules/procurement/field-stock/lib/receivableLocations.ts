/**
 * Which stock locations may be chosen as the destination of an inbound delivery (a GRN).
 *
 * This lived inline in pages/procurement/grn/new.tsx and had drifted out of
 * agreement with the transfer form:
 *
 *   GRN       accepted 'warehouse' | 'internal'
 *   Transfers accepted 'warehouse' | 'site_store'
 *
 * 'internal' is not a member of LocationType at all, so that arm was dead —
 * and a site added as a Site Store showed up under Transfers while staying
 * invisible on the GRN screen. The GRN screen now accepts the same set.
 *
 * CreatePickingForm deliberately keeps its own per-picking-type rules rather
 * than calling this: a transfer may legitimately target a virtual location
 * (moving faulty stock into the Faulty Equipment Bin), which a goods receipt
 * may not.
 */
/** Location types that can physically hold received stock. */
export const RECEIVABLE_LOCATION_TYPES = ['warehouse', 'site_store'] as const;

/**
 * Structural rather than Pick<StockLocation, ...>: the GRN page carries its own
 * narrower local Location shape (locationType: string, isVirtual optional).
 */
export interface ReceivableInput {
  locationType: string;
  isVirtual?: boolean | null;
}

/**
 * Virtual locations (the Faulty Equipment Bin, Scrap, In Transit) are bookkeeping
 * buckets rather than places — you cannot receive a delivery into one.
 */
export function isReceivableLocation(location: ReceivableInput): boolean {
  if (location.isVirtual) return false;
  return (RECEIVABLE_LOCATION_TYPES as readonly string[]).includes(location.locationType);
}
