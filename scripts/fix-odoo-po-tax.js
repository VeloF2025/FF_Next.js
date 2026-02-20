/**
 * Fix Odoo PO Tax Amounts
 *
 * The Odoo sync script was inserting line items without tax_rate,
 * so the DB trigger never calculated tax_amount on items, and
 * the PO-level tax_amount stayed at 0.
 *
 * This script sets tax_rate=15 on all Odoo PO items that are missing it,
 * triggering the DB triggers to recalculate tax_amount on items and PO totals.
 *
 * Usage: DATABASE_URL=... node scripts/fix-odoo-po-tax.js
 */

const { neon } = require('@neondatabase/serverless');

async function main() {
  const sql = neon(process.env.DATABASE_URL);

  console.log('=== Fix Odoo PO Tax Amounts ===\n');

  // Show current state
  const before = await sql`
    SELECT po.po_number, po.subtotal, po.tax_amount, po.total_amount,
           COUNT(poi.id) as item_count,
           COUNT(poi.id) FILTER (WHERE poi.tax_rate IS NULL OR poi.tax_rate = 0) as items_missing_tax
    FROM purchase_orders po
    JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
    WHERE po.odoo_po_id IS NOT NULL
    GROUP BY po.id, po.po_number, po.subtotal, po.tax_amount, po.total_amount
    ORDER BY po.po_number
  `;

  console.log('BEFORE fix:');
  for (const row of before) {
    console.log(`  ${row.po_number}: subtotal=${row.subtotal}, tax=${row.tax_amount}, total=${row.total_amount} (${row.items_missing_tax}/${row.item_count} items missing tax)`);
  }

  // Update line items with missing tax_rate
  // The BEFORE trigger (tr_poi_calc) will recalculate tax_amount = total_price * tax_rate / 100
  // The AFTER trigger (tr_poi_totals) will recalculate PO subtotal, tax_amount, total_amount
  const updated = await sql`
    UPDATE purchase_order_items
    SET tax_rate = 15
    WHERE purchase_order_id IN (
      SELECT id FROM purchase_orders WHERE odoo_po_id IS NOT NULL
    )
    AND (tax_rate IS NULL OR tax_rate = 0)
    RETURNING id
  `;

  console.log(`\nUpdated ${updated.length} line items with tax_rate=15\n`);

  // Show after state
  const after = await sql`
    SELECT po.po_number, po.subtotal, po.tax_amount, po.total_amount,
           COUNT(poi.id) as item_count
    FROM purchase_orders po
    JOIN purchase_order_items poi ON poi.purchase_order_id = po.id
    WHERE po.odoo_po_id IS NOT NULL
    GROUP BY po.id, po.po_number, po.subtotal, po.tax_amount, po.total_amount
    ORDER BY po.po_number
  `;

  console.log('AFTER fix:');
  for (const row of after) {
    const vat = parseFloat(row.tax_amount);
    const sub = parseFloat(row.subtotal);
    const pct = sub > 0 ? (vat / sub * 100).toFixed(1) : '0.0';
    console.log(`  ${row.po_number}: subtotal=R${sub.toFixed(2)}, tax=R${vat.toFixed(2)} (${pct}%), total=R${parseFloat(row.total_amount).toFixed(2)}`);
  }

  // Also set tax_rate on the PO header for display purposes
  await sql`
    UPDATE purchase_orders
    SET tax_rate = 15
    WHERE odoo_po_id IS NOT NULL
    AND (tax_rate IS NULL OR tax_rate = 0)
  `;

  console.log('\nDone!');
}

main().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
