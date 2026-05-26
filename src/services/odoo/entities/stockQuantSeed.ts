import type { OdooStockQuant } from '../odooClient';

export interface SeedRow { stockItemId: string; locationId: string; quantity: number; }
export type SeedGap =
  | { kind: 'product'; odooId: number; name: string; quantity: number; location: string }
  | { kind: 'location'; odooId: number; name: string; quantity: number; product: string };
export interface SeedPlan { rows: SeedRow[]; gaps: SeedGap[]; }

/**
 * Pure: turn raw Odoo quants into the proposed (item, location, qty) seed set.
 * productMap: odoo product_id -> FF stock_items.id
 * locationMap: odoo location_id -> FF stock_locations.id
 * Unmapped products/locations become gaps (reported, never silently dropped).
 */
export function buildSeedPlan(
  quants: OdooStockQuant[],
  productMap: Map<number, string>,
  locationMap: Map<number, string>,
): SeedPlan {
  const agg = new Map<string, SeedRow>();
  const gaps: SeedGap[] = [];

  for (const q of quants) {
    const [pid, pname] = q.product_id;
    const [lid, lname] = q.location_id;
    const stockItemId = productMap.get(pid);
    if (!stockItemId) {
      gaps.push({ kind: 'product', odooId: pid, name: pname, quantity: q.quantity, location: lname });
      continue;
    }
    const locationId = locationMap.get(lid);
    if (!locationId) {
      gaps.push({ kind: 'location', odooId: lid, name: lname, quantity: q.quantity, product: pname });
      continue;
    }
    const key = `${stockItemId}|${locationId}`;
    const existing = agg.get(key);
    if (existing) existing.quantity += q.quantity;
    else agg.set(key, { stockItemId, locationId, quantity: q.quantity });
  }
  return { rows: [...agg.values()], gaps };
}
