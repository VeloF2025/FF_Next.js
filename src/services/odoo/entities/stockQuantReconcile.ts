import { query } from '@/lib/db-pool';
import { log } from '@/lib/logger';
import type { OdooClient } from '../odooClient';
import { loadProductMap, loadAndPersistLocationMap } from './stockQuantSeed';

export interface OdooAgg { stockItemId: string; locationId: string; name: string; quantity: number; }
export interface FfQuant { stockItemId: string; locationId: string; quantity: number; }
export interface DriftRow { name: string; stockItemId: string; locationId: string; odooQty: number; ffQty: number; delta: number; }
export interface ReconcileResult { matches: number; drift: DriftRow[]; }

/** Pure: compare Odoo-aggregated on-hand to FibreFlow stock_quants per (item, location). delta = ff - odoo. */
export function diffOdooVsFf(odoo: OdooAgg[], ff: FfQuant[]): ReconcileResult {
  const odooMap = new Map(odoo.map((o) => [`${o.stockItemId}|${o.locationId}`, o]));
  const ffMap = new Map(ff.map((q) => [`${q.stockItemId}|${q.locationId}`, q]));
  const keys = new Set<string>([...odooMap.keys(), ...ffMap.keys()]);
  let matches = 0;
  const drift: DriftRow[] = [];
  for (const key of keys) {
    const o = odooMap.get(key);
    const f = ffMap.get(key);
    const odooQty = o?.quantity ?? 0;
    const ffQty = f?.quantity ?? 0;
    if (Math.abs(odooQty - ffQty) < 0.001) { matches++; continue; }
    const src = o ?? f;
    if (!src) continue; // unreachable: key always comes from the union
    const name = o?.name ?? `(FF-only) item ${src.stockItemId} @ ${src.locationId}`;
    drift.push({ name, stockItemId: src.stockItemId, locationId: src.locationId, odooQty, ffQty, delta: ffQty - odooQty });
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
  if (quants.length >= 5000) log.warn('Odoo quant fetch hit the 5000 limit — reconcile may be incomplete', { module: 'odoo:stockQuantReconcile' });

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
