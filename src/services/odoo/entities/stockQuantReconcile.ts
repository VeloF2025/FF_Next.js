import { query } from '@/lib/db-pool';
import type { OdooClient } from '../odooClient';
import { loadProductMap, loadAndPersistLocationMap } from './stockQuantSeed';

export interface OdooAgg { stockItemId: string; locationId: string; name: string; quantity: number; }
export interface FfQuant { stockItemId: string; locationId: string; quantity: number; }
export interface DriftRow { name: string; stockItemId: string; locationId: string; odooQty: number; ffQty: number; delta: number; }
export interface ReconcileResult { matches: number; drift: DriftRow[]; }

/** Pure: compare Odoo-aggregated on-hand to FibreFlow stock_quants per (item, location). delta = ff - odoo. */
export function diffOdooVsFf(odoo: OdooAgg[], ff: FfQuant[]): ReconcileResult {
  const ffMap = new Map(ff.map((q) => [`${q.stockItemId}|${q.locationId}`, q.quantity]));
  let matches = 0;
  const drift: DriftRow[] = [];
  for (const o of odoo) {
    const ffQty = ffMap.get(`${o.stockItemId}|${o.locationId}`) ?? 0;
    if (Math.abs(o.quantity - ffQty) < 0.001) { matches++; continue; }
    drift.push({ name: o.name, stockItemId: o.stockItemId, locationId: o.locationId, odooQty: o.quantity, ffQty, delta: ffQty - o.quantity });
  }
  drift.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return { matches, drift };
}

/**
 * Read-only: pull live Odoo quants, map to FF ids (reusing the seed's loaders;
 * loadAndPersistLocationMap is called with dryRun=true so it does NOT persist),
 * aggregate to (ffStockItemId, ffLocationId), and diff against FF stock_quants.
 * Unmapped products/locations are excluded from the comparison.
 */
export async function reconcileStockQuantsVsOdoo(client: OdooClient): Promise<ReconcileResult> {
  const [locationMap, quants] = await Promise.all([
    loadAndPersistLocationMap(client, true), // dryRun=true => no writes
    client.getInternalStockQuants({ limit: 5000 }),
  ]);
  const productMap = await loadProductMap(quants);

  const aggMap = new Map<string, OdooAgg>();
  for (const q of quants) {
    const stockItemId = productMap.get(q.product_id[0]);
    const locationId = locationMap.get(q.location_id[0]);
    if (!stockItemId || !locationId) continue;
    const key = `${stockItemId}|${locationId}`;
    const existing = aggMap.get(key);
    if (existing) existing.quantity += q.quantity;
    else aggMap.set(key, { stockItemId, locationId, name: `${q.product_id[1]} @ ${q.location_id[1]}`, quantity: q.quantity });
  }

  const ffRows = await query<{ stock_item_id: string; location_id: string; quantity: string }>(
    'SELECT stock_item_id, location_id, SUM(quantity) AS quantity FROM stock_quants GROUP BY stock_item_id, location_id',
  );
  const ff: FfQuant[] = ffRows.map((r) => ({ stockItemId: String(r.stock_item_id), locationId: String(r.location_id), quantity: Number(r.quantity) }));

  return diffOdooVsFf([...aggMap.values()], ff);
}
