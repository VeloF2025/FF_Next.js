import type { OdooStockQuant } from '../odooClient';
import { transaction, query } from '@/lib/db-pool';
import type { OdooClient } from '../odooClient';
import { odooLocationToFfCode } from '../stockLocationMap';

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

export interface SeedRunResult { dryRun: boolean; rows: SeedRow[]; gaps: SeedGap[]; committed: number; }

/** Build the product map: odoo product_id -> FF stock_items.id (key: odoo_product_id). */
export async function loadProductMap(): Promise<Map<number, string>> {
  const rows = await query<{ id: string; odoo_product_id: number }>(
    'SELECT id, odoo_product_id FROM stock_items WHERE odoo_product_id IS NOT NULL',
  );
  return new Map(rows.map((r) => [Number(r.odoo_product_id), String(r.id)]));
}

/**
 * Build the location map: odoo location_id -> FF stock_locations.id, and (when not
 * a dry run) persist it into odoo_location_mappings. Resolution path:
 * Odoo complete_name -> FF code (pure map) -> stock_locations.id.
 */
export async function loadAndPersistLocationMap(
  client: OdooClient, dryRun: boolean,
): Promise<Map<number, string>> {
  const odooLocs = await client.getStockLocations({
    domain: [['usage', '=', 'internal']], fields: ['id', 'complete_name', 'usage'], limit: 500,
  });
  const codeRows = await query<{ id: string; code: string }>('SELECT id, code FROM stock_locations');
  const codeToId = new Map(codeRows.map((r) => [r.code, String(r.id)]));
  const map = new Map<number, string>();
  for (const loc of odooLocs) {
    const code = odooLocationToFfCode(loc.complete_name);
    if (!code) continue;
    const ffId = codeToId.get(code);
    if (!ffId) continue;
    map.set(loc.id, ffId);
    // odoo_location_mappings is idempotent metadata (ON CONFLICT) persisted outside
    // the quant-seed transaction; the quant + movement writes are the ACID boundary.
    if (!dryRun) {
      await query(
        `INSERT INTO odoo_location_mappings (id, odoo_location_id, ff_location_id, ff_warehouse_code, is_active, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, true, NOW(), NOW())
         ON CONFLICT (odoo_location_id)
         DO UPDATE SET ff_location_id = EXCLUDED.ff_location_id, ff_warehouse_code = EXCLUDED.ff_warehouse_code, updated_at = NOW()`,
        [loc.id, ffId, code],
      );
    }
  }
  return map;
}

/** Resolve the VENDORS virtual location id (created by migration 382). */
async function getVendorsLocationId(): Promise<string> {
  const rows = await query<{ id: string }>("SELECT id FROM stock_locations WHERE code = 'VENDORS' LIMIT 1");
  if (!rows[0]) throw new Error('VENDORS location missing — run migration 382 first');
  return String(rows[0].id);
}

/**
 * Seed stock_quants opening balances from live Odoo. Dry run computes the plan
 * and reports gaps without writing. Commit upserts quants (absolute opening qty)
 * + a balancing 'receipt' movement (Vendors -> destination) tagged ODOO_OPENING,
 * inside a single transaction.
 */
export async function seedStockQuantsFromOdoo(
  client: OdooClient, opts: { dryRun: boolean },
): Promise<SeedRunResult> {
  const { dryRun } = opts;
  const [productMap, locationMap, quants] = await Promise.all([
    loadProductMap(),
    loadAndPersistLocationMap(client, dryRun),
    client.getInternalStockQuants({ limit: 5000 }),
  ]);
  if (quants.length >= 5000) console.warn(`WARNING: Odoo quant fetch hit the 5000 limit — results may be truncated.`);
  const { rows, gaps } = buildSeedPlan(quants, productMap, locationMap);
  if (dryRun) return { dryRun, rows, gaps, committed: 0 };

  const vendorsId = await getVendorsLocationId();
  let committed = 0;
  await transaction(async (txn) => {
    for (const r of rows) {
      await txn.query(
        `INSERT INTO stock_quants (id, stock_item_id, location_id, quantity, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, NOW(), NOW())
         ON CONFLICT (stock_item_id, location_id, COALESCE(lot_number,''))
         DO UPDATE SET quantity = EXCLUDED.quantity, updated_at = NOW()`,
        [r.stockItemId, r.locationId, r.quantity],
      );
      await txn.query(
        `INSERT INTO field_stock_movements
           (id, stock_item_id, movement_type, from_location_id, to_location_id, quantity, reference, performed_at, created_at)
         VALUES (gen_random_uuid(), $1, 'receipt', $2, $3, $4, 'ODOO_OPENING', NOW(), NOW())`,
        [r.stockItemId, vendorsId, r.locationId, r.quantity],
      );
      committed++;
    }
  });
  return { dryRun, rows, gaps, committed };
}
