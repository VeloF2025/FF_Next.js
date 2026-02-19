/**
 * Data Reconciliation Check
 * Run: npx tsx scripts/data-reconciliation-check.ts
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) { console.error('No DATABASE_URL'); process.exit(1); }
  const sql = neon(dbUrl);

  console.log('=== REMAINING RECONCILIATION STATS ===\n');

  // Stock levels columns
  const cols = await sql`
    SELECT column_name FROM information_schema.columns WHERE table_name = 'stock_levels' ORDER BY ordinal_position
  `;
  console.log('stock_levels columns:', cols.map(c => c.column_name).join(', '));

  // Stock levels stats
  const levels = await sql`
    SELECT
      COUNT(*) as records,
      COUNT(DISTINCT stock_item_id) as unique_items,
      SUM(qty_on_hand) as total_qty,
      SUM(qty_reserved) as total_reserved
    FROM stock_levels
  `;
  console.log('\nSTOCK LEVELS:', levels[0]);

  // Stock locations
  const locations = await sql`SELECT name, location_type FROM stock_locations ORDER BY name`;
  console.log('\nSTOCK LOCATIONS (' + locations.length + '):');
  for (const loc of locations) console.log('  ', loc.name, '(' + loc.location_type + ')');

  // PO-GRN cross check
  const poGrnCheck = await sql`
    SELECT
      (SELECT COUNT(DISTINCT purchase_order_id) FROM goods_receipt_notes WHERE purchase_order_id IS NOT NULL) as pos_with_grns,
      (SELECT COUNT(*) FROM purchase_orders) as total_pos
  `;
  console.log('\nPOs that have GRNs:', poGrnCheck[0].pos_with_grns, 'of', poGrnCheck[0].total_pos);

  // PO qty ordered vs received
  const qtyCheck = await sql`
    SELECT
      SUM(quantity_ordered) as ordered,
      SUM(quantity_received) as received,
      ROUND(SUM(quantity_received)::numeric / NULLIF(SUM(quantity_ordered), 0) * 100, 1) as receipt_pct
    FROM purchase_order_items
    JOIN purchase_orders po ON po.id = purchase_order_items.purchase_order_id
    WHERE po.status = 'approved'
  `;
  console.log('\nAPPROVED POs qty: ordered=' + qtyCheck[0].ordered + ', received=' + qtyCheck[0].received + ', ' + qtyCheck[0].receipt_pct + '% received');

  // Stock value calculation
  const stockValue = await sql`
    SELECT
      SUM(si.qty_available * si.unit_price) as total_value,
      COUNT(CASE WHEN si.unit_price > 0 AND si.qty_available > 0 THEN 1 END) as priced_items,
      COUNT(CASE WHEN (si.unit_price = 0 OR si.unit_price IS NULL) AND si.qty_available > 0 THEN 1 END) as unpriced_items
    FROM stock_items si
  `;
  console.log('\nSTOCK VALUE: R' + Number(stockValue[0].total_value || 0).toLocaleString());
  console.log('  Priced items with stock:', stockValue[0].priced_items);
  console.log('  Unpriced items with stock:', stockValue[0].unpriced_items);

  // Value breakdown: what's the dashboard showing for stock value?
  const dashValue = await sql`
    SELECT
      SUM(COALESCE(unit_price, 0) * COALESCE(qty_available, 0)) as calculated_value,
      COUNT(*) as total_items,
      COUNT(CASE WHEN unit_price > 0 THEN 1 END) as items_with_price
    FROM stock_items
  `;
  console.log('\nDASHBOARD VALUE CHECK:', dashValue[0]);

  console.log('\n=== RECONCILIATION COMPLETE ===');
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
