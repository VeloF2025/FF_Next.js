/**
 * Deep Data Reconciliation Check — Post-Odoo Sync
 * Run: npx tsx scripts/deep-reconciliation-check.ts
 *
 * Checks relational integrity, balance consistency, orphans, and mismatches.
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { neon } from '@neondatabase/serverless';

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) { console.error('No DATABASE_URL'); process.exit(1); }
  const sql = neon(dbUrl);

  let issues = 0;
  const warn = (msg: string) => { issues++; console.log(`  ⚠️  ${msg}`); };
  const ok = (msg: string) => { console.log(`  ✅ ${msg}`); };

  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║      DEEP POST-ODOO RECONCILIATION CHECK            ║');
  console.log('╚══════════════════════════════════════════════════════╝\n');

  // ── 1. Stock Items schema check ──
  console.log('1. STOCK ITEMS SCHEMA');
  const siCols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'stock_items' ORDER BY ordinal_position
  `;
  const colNames = siCols.map(c => c.column_name);
  console.log(`   Columns: ${colNames.length}`);
  const hasQtyAvail = colNames.includes('qty_available');
  const hasStandardCost = colNames.includes('standard_cost');
  const hasLastPurchasePrice = colNames.includes('last_purchase_price');
  const hasListPrice = colNames.includes('list_price');
  if (hasQtyAvail) ok('qty_available exists');
  else warn('qty_available MISSING from stock_items');
  const priceColName = hasStandardCost ? 'standard_cost' : hasLastPurchasePrice ? 'last_purchase_price' : hasListPrice ? 'list_price' : null;
  if (priceColName) ok(`Price column: ${priceColName}`);
  else warn('No price column found');

  // ── 2. Stock qty: stock_items.qty_available vs stock_levels.qty_on_hand ──
  console.log('\n2. STOCK QUANTITY CONSISTENCY');
  const qtyMismatch = await sql`
    SELECT si.id, si.item_code, si.description,
           si.qty_available AS items_qty,
           sl.qty_on_hand AS levels_qty,
           (si.qty_available - sl.qty_on_hand) AS diff
    FROM stock_items si
    JOIN stock_levels sl ON sl.stock_item_id = si.id
    WHERE ABS(si.qty_available - sl.qty_on_hand) > 0.01
    LIMIT 20
  `;
  if (qtyMismatch.length === 0) ok('stock_items.qty_available matches stock_levels.qty_on_hand for all items');
  else warn(`${qtyMismatch.length} items have qty mismatch between stock_items and stock_levels`);
  for (const m of qtyMismatch.slice(0, 5)) {
    console.log(`     ${m.item_code}: items=${m.items_qty}, levels=${m.levels_qty}, diff=${m.diff}`);
  }

  // ── 3. PO totals vs sum of line items ──
  console.log('\n3. PURCHASE ORDER TOTALS');
  const poTotalCheck = await sql`
    SELECT po.id, po.po_number, po.total_amount AS header_total,
           SUM(poi.total_price) AS lines_total,
           ABS(po.total_amount - SUM(poi.total_price)) AS diff
    FROM purchase_orders po
    JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
    GROUP BY po.id, po.po_number, po.total_amount
    HAVING ABS(po.total_amount - SUM(poi.total_price)) > 1
    ORDER BY ABS(po.total_amount - SUM(poi.total_price)) DESC
    LIMIT 10
  `;
  if (poTotalCheck.length === 0) ok('All PO header totals match line item sums (±R1)');
  else warn(`${poTotalCheck.length} POs have header vs line total mismatch (>R1)`);
  for (const p of poTotalCheck.slice(0, 5)) {
    console.log(`     ${p.po_number}: header=R${Number(p.header_total).toLocaleString()}, lines=R${Number(p.lines_total).toLocaleString()}, diff=R${Number(p.diff).toFixed(2)}`);
  }

  // ── 4. Orphaned GRN items (grn_id not in goods_receipt_notes) ──
  console.log('\n4. ORPHANED RECORDS');
  const orphanGrnItems = await sql`
    SELECT COUNT(*) AS cnt FROM goods_receipt_items gi
    LEFT JOIN goods_receipt_notes grn ON grn.id = gi.grn_id
    WHERE grn.id IS NULL
  `;
  if (Number(orphanGrnItems[0].cnt) === 0) ok('No orphaned GRN items');
  else warn(`${orphanGrnItems[0].cnt} GRN items have no parent GRN`);

  const orphanPoItems = await sql`
    SELECT COUNT(*) AS cnt FROM purchase_order_items poi
    LEFT JOIN purchase_orders po ON po.id = poi.purchase_order_id
    WHERE po.id IS NULL
  `;
  if (Number(orphanPoItems[0].cnt) === 0) ok('No orphaned PO items');
  else warn(`${orphanPoItems[0].cnt} PO items have no parent PO`);

  const orphanMoveItems = await sql`
    SELECT COUNT(*) AS cnt FROM stock_movement_items smi
    LEFT JOIN stock_movements sm ON sm.id = smi.stock_movement_id
    WHERE sm.id IS NULL
  `;
  if (Number(orphanMoveItems[0].cnt) === 0) ok('No orphaned movement items');
  else warn(`${orphanMoveItems[0].cnt} movement items have no parent movement`);

  // ── 5. GRN-PO linkage ──
  console.log('\n5. GRN-PO LINKAGE');
  const grnPo = await sql`
    SELECT
      COUNT(*) AS total_grns,
      COUNT(purchase_order_id) AS linked,
      COUNT(*) - COUNT(purchase_order_id) AS unlinked
    FROM goods_receipt_notes
  `;
  ok(`${grnPo[0].linked}/${grnPo[0].total_grns} GRNs linked to POs (${grnPo[0].unlinked} unlinked)`);
  if (Number(grnPo[0].unlinked) > 5) warn(`${grnPo[0].unlinked} GRNs have no PO link — may need investigation`);

  // ── 6. PO received qty vs GRN received qty ──
  // NOTE: PO items and GRN items are NOT cross-linked at the item level
  // (po_item_id is null, stock_item_id on PO items is null). Both qty_received
  // values were independently imported from Odoo and represent different things:
  //   - PO items: ordered qty that was marked received per PO line
  //   - GRN items: qty physically delivered and inspected
  // A gap is expected — GRNs can include extra items, partial deliveries, etc.
  console.log('\n6. PO vs GRN QUANTITY RECONCILIATION');
  const poVsGrn = await sql`
    SELECT
      SUM(poi.quantity_received) AS po_received,
      (SELECT SUM(gi.quantity_received) FROM goods_receipt_items gi
       JOIN goods_receipt_notes grn ON grn.id = gi.grn_id
       WHERE grn.purchase_order_id IS NOT NULL) AS grn_received
    FROM purchase_order_items poi
    JOIN purchase_orders po ON po.id = poi.purchase_order_id
    WHERE po.status NOT IN ('draft', 'cancelled')
  `;
  const poRcv = Number(poVsGrn[0].po_received || 0);
  const grnRcv = Number(poVsGrn[0].grn_received || 0);
  const pctDiff = poRcv > 0 ? Math.abs(poRcv - grnRcv) / poRcv * 100 : 0;
  ok(`PO received: ${poRcv.toLocaleString()}, GRN received: ${grnRcv.toLocaleString()} (${pctDiff.toFixed(1)}% gap — expected, see note above)`);

  // ── 7. Serial status integrity ──
  console.log('\n7. SERIAL NUMBER INTEGRITY');
  const serialCheck = await sql`
    SELECT status, COUNT(*) AS cnt
    FROM stock_serials
    GROUP BY status
    ORDER BY cnt DESC
  `;
  for (const s of serialCheck) {
    console.log(`   ${String(s.status).padEnd(15)} ${s.cnt}`);
  }
  const faultySerials = await sql`
    SELECT COUNT(*) AS cnt FROM stock_serials
    WHERE status = 'faulty' AND fault_report_id IS NULL
  `;
  if (Number(faultySerials[0].cnt) === 0) ok('All faulty serials have a fault report');
  else warn(`${faultySerials[0].cnt} faulty serials have no fault_report_id`);

  // ── 8. Stock movements balance ──
  console.log('\n8. STOCK MOVEMENTS');
  const movementStats = await sql`
    SELECT
      COUNT(*) AS total,
      COUNT(CASE WHEN status = 'completed' THEN 1 END) AS completed,
      COUNT(CASE WHEN status = 'pending' THEN 1 END) AS pending,
      COUNT(CASE WHEN is_reversed = true THEN 1 END) AS reversed
    FROM stock_movements
  `;
  ok(`${movementStats[0].total} movements: ${movementStats[0].completed} completed, ${movementStats[0].pending} pending, ${movementStats[0].reversed} reversed`);

  // ── 9. Vendor invoices linkage ──
  console.log('\n9. VENDOR INVOICES');
  const invoiceCheck = await sql`
    SELECT
      COUNT(*) AS total,
      COUNT(purchase_order_id) AS linked_to_po,
      SUM(amount_total) AS total_value
    FROM vendor_invoices
  `;
  ok(`${invoiceCheck[0].total} invoices, ${invoiceCheck[0].linked_to_po} linked to POs, R${Number(invoiceCheck[0].total_value || 0).toLocaleString()} total`);

  // ── 10. Stock value calculation ──
  console.log('\n10. STOCK VALUE');
  if (priceColName) {
    const priceCol = priceColName;
    const stockVal = await sql.query(
      `SELECT
        SUM(COALESCE(${priceCol}, 0) * COALESCE(qty_available, 0)) AS total_value,
        COUNT(CASE WHEN ${priceCol} > 0 AND qty_available > 0 THEN 1 END) AS priced_with_stock,
        COUNT(CASE WHEN (${priceCol} = 0 OR ${priceCol} IS NULL) AND qty_available > 0 THEN 1 END) AS unpriced_with_stock
      FROM stock_items`
    );
    ok(`Total stock value: R${Number(stockVal[0].total_value || 0).toLocaleString()}`);
    console.log(`   Priced items with stock: ${stockVal[0].priced_with_stock}`);
    console.log(`   Unpriced items with stock: ${stockVal[0].unpriced_with_stock}`);
    if (Number(stockVal[0].unpriced_with_stock) > 10) warn(`${stockVal[0].unpriced_with_stock} items have stock but no price — value calculation incomplete`);
  } else {
    warn('Cannot calculate stock value — no price column found');
  }

  // ── 11. Reorder rules check ──
  console.log('\n11. REORDER RULES');
  const reorderCheck = await sql`
    SELECT
      COUNT(CASE WHEN reorder_quantity > 0 THEN 1 END) AS with_reorder,
      COUNT(CASE WHEN qty_available <= COALESCE(min_stock_level, 0) AND min_stock_level > 0 THEN 1 END) AS below_min,
      COUNT(CASE WHEN qty_available <= COALESCE(reorder_quantity, 0) AND reorder_quantity > 0 THEN 1 END) AS below_reorder
    FROM stock_items
  `;
  ok(`${reorderCheck[0].with_reorder} items have reorder rules`);
  if (Number(reorderCheck[0].below_min) > 0) warn(`${reorderCheck[0].below_min} items are BELOW minimum quantity`);
  if (Number(reorderCheck[0].below_reorder) > 0) console.log(`   ℹ️  ${reorderCheck[0].below_reorder} items are at/below reorder point`);

  // ── 12. Fleet data ──
  console.log('\n12. FLEET');
  const fleetCheck = await sql`
    SELECT
      (SELECT COUNT(*) FROM fleet_vehicles) AS vehicles,
      (SELECT COUNT(*) FROM fleet_service_logs) AS service_logs,
      (SELECT COUNT(*) FROM fleet_vehicles WHERE current_odometer > 0) AS with_odometer
  `;
  ok(`${fleetCheck[0].vehicles} vehicles, ${fleetCheck[0].with_odometer} with odometer, ${fleetCheck[0].service_logs} service logs`);

  // ── Summary ──
  console.log('\n╔══════════════════════════════════════════════════════╗');
  if (issues === 0) {
    console.log('║  ✅ ALL CHECKS PASSED — No issues found              ║');
  } else {
    console.log(`║  ⚠️  ${String(issues).padEnd(2)} ISSUES FOUND — Review warnings above     ║`);
  }
  console.log('╚══════════════════════════════════════════════════════╝');
}

main().catch((err) => {
  console.error('FATAL:', err.message);
  process.exit(1);
});
