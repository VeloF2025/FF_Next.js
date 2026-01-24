/**
 * Generate Procurement Analytics Report
 *
 * Exports a comprehensive report of all procurement data to a file.
 */

const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

async function generateReport() {
  const sql = neon(process.env.DATABASE_URL);
  const reportDate = new Date().toISOString().split('T')[0];
  const reportTime = new Date().toISOString().split('T')[1].split('.')[0];

  let report = '';

  const addLine = (text = '') => { report += text + '\n'; };
  const addSection = (title) => {
    addLine('\n' + '═'.repeat(70));
    addLine(title.toUpperCase());
    addLine('═'.repeat(70));
  };

  // Header
  addLine('╔══════════════════════════════════════════════════════════════════════╗');
  addLine('║                    PROCUREMENT ANALYTICS REPORT                       ║');
  addLine('║                    FibreFlow / VelocityFibre                          ║');
  addLine('╚══════════════════════════════════════════════════════════════════════╝');
  addLine();
  addLine(`Report Generated: ${reportDate} at ${reportTime}`);
  addLine(`Data Source: Odoo + FibreFlow Database`);

  // ============= EXECUTIVE SUMMARY =============
  addSection('EXECUTIVE SUMMARY');

  const summary = await sql`
    SELECT
      (SELECT COUNT(*) FROM goods_receipt_notes) as grn_count,
      (SELECT COUNT(*) FROM goods_receipt_items) as grn_items,
      (SELECT SUM(quantity_received) FROM goods_receipt_items) as total_qty_received,
      (SELECT COUNT(*) FROM purchase_orders) as po_count,
      (SELECT SUM(total_amount) FROM purchase_orders) as po_value,
      (SELECT COUNT(*) FROM vendor_invoices) as invoice_count,
      (SELECT SUM(amount_total) FROM vendor_invoices) as invoice_total,
      (SELECT SUM(amount_residual) FROM vendor_invoices WHERE payment_status != 'paid') as outstanding,
      (SELECT COUNT(*) FROM stock_items) as product_count,
      (SELECT SUM(qty_on_hand) FROM stock_levels) as stock_units,
      (SELECT COUNT(*) FROM suppliers) as supplier_count,
      (SELECT COUNT(*) FROM rfqs) as rfq_count
  `;

  const s = summary[0];
  addLine();
  addLine(`  📦 Goods Receipt Notes (GRNs):     ${Number(s.grn_count).toLocaleString().padStart(10)}`);
  addLine(`     └─ Line Items:                  ${Number(s.grn_items).toLocaleString().padStart(10)}`);
  addLine(`     └─ Total Qty Received:          ${Number(s.total_qty_received || 0).toLocaleString().padStart(10)}`);
  addLine();
  addLine(`  📋 Purchase Orders:                ${Number(s.po_count).toLocaleString().padStart(10)}`);
  addLine(`     └─ Total Value:              R ${Number(s.po_value || 0).toLocaleString().padStart(12)}`);
  addLine();
  addLine(`  🧾 Vendor Invoices:                ${Number(s.invoice_count).toLocaleString().padStart(10)}`);
  addLine(`     └─ Total Invoiced:           R ${Number(s.invoice_total || 0).toLocaleString().padStart(12)}`);
  addLine(`     └─ Outstanding:              R ${Number(s.outstanding || 0).toLocaleString().padStart(12)}`);
  addLine();
  addLine(`  📊 Stock Items/Products:           ${Number(s.product_count).toLocaleString().padStart(10)}`);
  addLine(`     └─ Total Units On-Hand:         ${Number(s.stock_units || 0).toLocaleString().padStart(10)}`);
  addLine();
  addLine(`  🏢 Suppliers:                      ${Number(s.supplier_count).toLocaleString().padStart(10)}`);
  addLine(`  📝 RFQs:                           ${Number(s.rfq_count).toLocaleString().padStart(10)}`);

  // ============= SUPPLIER ANALYSIS =============
  addSection('SUPPLIER ANALYSIS');

  const supplierSpend = await sql`
    SELECT
      s.name,
      COUNT(DISTINCT po.id) as po_count,
      SUM(po.total_amount) as po_value,
      COUNT(DISTINCT g.id) as grn_count,
      COUNT(DISTINCT vi.id) as invoice_count,
      SUM(vi.amount_total) as invoice_total
    FROM suppliers s
    LEFT JOIN purchase_orders po ON s.id = po.supplier_id
    LEFT JOIN goods_receipt_notes g ON s.id = g.supplier_id
    LEFT JOIN vendor_invoices vi ON s.odoo_partner_id = vi.odoo_partner_id
    GROUP BY s.id, s.name
    ORDER BY SUM(po.total_amount) DESC NULLS LAST
  `;

  addLine();
  addLine('Supplier                                      │ POs │  PO Value     │ GRNs │ Invoices │ Inv Value');
  addLine('─'.repeat(110));

  for (const sup of supplierSpend) {
    const name = (sup.name || 'Unknown').substring(0, 45).padEnd(45);
    const pos = String(sup.po_count || 0).padStart(3);
    const poVal = ('R ' + Number(sup.po_value || 0).toLocaleString()).padStart(13);
    const grns = String(sup.grn_count || 0).padStart(4);
    const invs = String(sup.invoice_count || 0).padStart(8);
    const invVal = ('R ' + Number(sup.invoice_total || 0).toLocaleString()).padStart(11);
    addLine(`${name} │ ${pos} │ ${poVal} │ ${grns} │ ${invs} │ ${invVal}`);
  }

  // ============= GRN ANALYSIS =============
  addSection('GOODS RECEIPT NOTES (GRNs)');

  const grnByMonth = await sql`
    SELECT
      TO_CHAR(delivery_date, 'YYYY-MM') as month,
      COUNT(*) as grn_count,
      COUNT(DISTINCT supplier_id) as suppliers,
      SUM((SELECT SUM(quantity_received) FROM goods_receipt_items gi WHERE gi.grn_id = g.id)) as qty
    FROM goods_receipt_notes g
    WHERE delivery_date IS NOT NULL
    GROUP BY 1
    ORDER BY 1 DESC
    LIMIT 12
  `;

  addLine();
  addLine('Monthly GRN Activity:');
  addLine();
  addLine('Month    │ GRNs │ Suppliers │ Qty Received');
  addLine('─'.repeat(50));

  for (const m of grnByMonth) {
    const bar = '█'.repeat(Math.min(30, Math.round(Number(m.grn_count) / 7)));
    addLine(`${m.month} │ ${String(m.grn_count).padStart(4)} │ ${String(m.suppliers).padStart(9)} │ ${Number(m.qty || 0).toLocaleString().padStart(12)} ${bar}`);
  }

  // Top received products
  addLine();
  addLine('Top 20 Most Received Products:');
  addLine();

  const topProducts = await sql`
    SELECT
      gi.item_code,
      gi.item_description,
      SUM(gi.quantity_received) as qty,
      COUNT(DISTINCT gi.grn_id) as grn_count
    FROM goods_receipt_items gi
    GROUP BY gi.item_code, gi.item_description
    ORDER BY SUM(gi.quantity_received) DESC
    LIMIT 20
  `;

  addLine('Product Code          │ Qty Received │ GRNs │ Description');
  addLine('─'.repeat(100));

  for (const p of topProducts) {
    const code = (p.item_code || 'N/A').padEnd(20);
    const qty = Number(p.qty).toLocaleString().padStart(12);
    const grns = String(p.grn_count).padStart(4);
    const desc = (p.item_description || '').substring(0, 50);
    addLine(`${code} │ ${qty} │ ${grns} │ ${desc}`);
  }

  // ============= PURCHASE ORDERS =============
  addSection('PURCHASE ORDERS');

  const poByMonth = await sql`
    SELECT
      TO_CHAR(created_at, 'YYYY-MM') as month,
      COUNT(*) as po_count,
      SUM(total_amount) as total
    FROM purchase_orders
    WHERE total_amount > 0
    GROUP BY 1
    ORDER BY 1 DESC
    LIMIT 12
  `;

  addLine();
  addLine('Monthly PO Spend:');
  addLine();
  addLine('Month    │ POs │ Total Value');
  addLine('─'.repeat(45));

  for (const m of poByMonth) {
    const bar = '▓'.repeat(Math.min(25, Math.round(Number(m.total) / 2000000)));
    addLine(`${m.month} │ ${String(m.po_count).padStart(3)} │ R ${Number(m.total).toLocaleString().padStart(14)} ${bar}`);
  }

  // ============= INVOICES =============
  addSection('VENDOR INVOICES');

  const invoiceStats = await sql`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE payment_status = 'paid') as paid,
      COUNT(*) FILTER (WHERE payment_status = 'not_paid') as unpaid,
      COUNT(*) FILTER (WHERE payment_status = 'partial') as partial,
      SUM(amount_total) as total_amount,
      SUM(amount_total) FILTER (WHERE payment_status = 'paid') as paid_amount,
      SUM(amount_residual) as outstanding
    FROM vendor_invoices
  `;

  const inv = invoiceStats[0];
  addLine();
  addLine(`Total Invoices:    ${inv.total}`);
  addLine(`  Paid:            ${inv.paid} (R ${Number(inv.paid_amount || 0).toLocaleString()})`);
  addLine(`  Unpaid:          ${inv.unpaid}`);
  addLine(`  Partial:         ${inv.partial || 0}`);
  addLine();
  addLine(`Total Invoiced:    R ${Number(inv.total_amount || 0).toLocaleString()}`);
  addLine(`Outstanding:       R ${Number(inv.outstanding || 0).toLocaleString()}`);

  // Invoice list
  addLine();
  addLine('Invoice Details:');
  addLine();

  const invoices = await sql`
    SELECT
      vi.invoice_number,
      s.name as supplier,
      vi.invoice_date,
      vi.amount_total,
      vi.payment_status,
      vi.amount_residual
    FROM vendor_invoices vi
    LEFT JOIN suppliers s ON vi.supplier_id = s.id
    ORDER BY vi.invoice_date DESC
  `;

  addLine('Invoice #           │ Supplier                          │ Date       │ Amount       │ Status   │ Outstanding');
  addLine('─'.repeat(115));

  for (const i of invoices) {
    const num = (i.invoice_number || 'N/A').padEnd(19);
    const sup = (i.supplier || 'Unknown').substring(0, 33).padEnd(33);
    const date = i.invoice_date ? new Date(i.invoice_date).toISOString().split('T')[0] : 'N/A';
    const amt = ('R ' + Number(i.amount_total || 0).toLocaleString()).padStart(12);
    const status = (i.payment_status || 'unknown').padEnd(8);
    const out = ('R ' + Number(i.amount_residual || 0).toLocaleString()).padStart(11);
    addLine(`${num} │ ${sup} │ ${date} │ ${amt} │ ${status} │ ${out}`);
  }

  // ============= STOCK LEVELS =============
  addSection('INVENTORY / STOCK LEVELS');

  const stockByLocation = await sql`
    SELECT
      location_name,
      COUNT(*) as items,
      SUM(qty_on_hand) as qty,
      SUM(qty_reserved) as reserved,
      SUM(qty_available) as available
    FROM stock_levels
    GROUP BY location_name
    ORDER BY SUM(qty_on_hand) DESC
  `;

  addLine();
  addLine('Stock by Location:');
  addLine();
  addLine('Location                            │ Items │ On-Hand      │ Reserved    │ Available');
  addLine('─'.repeat(90));

  for (const loc of stockByLocation) {
    const name = (loc.location_name || 'Unknown').padEnd(35);
    const items = String(loc.items).padStart(5);
    const qty = Number(loc.qty || 0).toLocaleString().padStart(12);
    const res = Number(loc.reserved || 0).toLocaleString().padStart(11);
    const avail = Number(loc.available || 0).toLocaleString().padStart(11);
    addLine(`${name} │ ${items} │ ${qty} │ ${res} │ ${avail}`);
  }

  // Low stock alerts
  addLine();
  addLine('Low Stock Alerts (< 50 units):');
  addLine();

  const lowStock = await sql`
    SELECT
      si.item_code, si.description, sl.qty_on_hand, sl.location_name
    FROM stock_levels sl
    JOIN stock_items si ON sl.stock_item_id = si.id
    WHERE sl.qty_on_hand > 0 AND sl.qty_on_hand < 50
    ORDER BY sl.qty_on_hand ASC
    LIMIT 20
  `;

  if (lowStock.length > 0) {
    for (const s of lowStock) {
      addLine(`  ⚠️  ${String(s.qty_on_hand).padStart(5)} │ ${(s.item_code || 'N/A').padEnd(25)} │ ${s.location_name || 'Unknown'}`);
    }
  } else {
    addLine('  No low stock alerts');
  }

  // ============= DATA QUALITY =============
  addSection('DATA QUALITY & SYNC STATUS');

  const quality = await sql`
    SELECT
      (SELECT COUNT(*) FROM goods_receipt_notes WHERE odoo_picking_id IS NOT NULL) as grns_synced,
      (SELECT COUNT(*) FROM goods_receipt_notes WHERE odoo_picking_id IS NULL) as grns_manual,
      (SELECT COUNT(*) FROM goods_receipt_items WHERE odoo_move_id IS NOT NULL) as items_synced,
      (SELECT COUNT(*) FROM stock_items WHERE odoo_product_id IS NOT NULL) as products_synced,
      (SELECT COUNT(*) FROM suppliers WHERE odoo_partner_id IS NOT NULL) as suppliers_synced,
      (SELECT COUNT(*) FROM stock_levels WHERE odoo_quant_id IS NOT NULL) as levels_synced,
      (SELECT COUNT(*) FROM vendor_invoices WHERE odoo_move_id IS NOT NULL) as invoices_synced,
      (SELECT MAX(odoo_synced_at) FROM goods_receipt_notes) as last_grn_sync,
      (SELECT MAX(odoo_synced_at) FROM vendor_invoices) as last_invoice_sync
  `;

  const q = quality[0];
  addLine();
  addLine('Odoo Sync Status:');
  addLine();
  addLine(`  ✅ GRNs synced:           ${q.grns_synced}`);
  addLine(`  ✅ GRN Items synced:      ${q.items_synced}`);
  addLine(`  ✅ Products synced:       ${q.products_synced}`);
  addLine(`  ✅ Suppliers synced:      ${q.suppliers_synced}`);
  addLine(`  ✅ Stock Levels synced:   ${q.levels_synced}`);
  addLine(`  ✅ Invoices synced:       ${q.invoices_synced}`);
  addLine();
  addLine(`Last GRN Sync:     ${q.last_grn_sync ? new Date(q.last_grn_sync).toISOString() : 'Never'}`);
  addLine(`Last Invoice Sync: ${q.last_invoice_sync ? new Date(q.last_invoice_sync).toISOString() : 'Never'}`);

  // Footer
  addLine();
  addLine('═'.repeat(70));
  addLine('END OF REPORT');
  addLine('═'.repeat(70));

  // Write to file
  const filename = `procurement-report-${reportDate}.txt`;
  const filepath = path.join(__dirname, '..', 'reports', filename);

  // Ensure reports directory exists
  const reportsDir = path.join(__dirname, '..', 'reports');
  if (!fs.existsSync(reportsDir)) {
    fs.mkdirSync(reportsDir, { recursive: true });
  }

  fs.writeFileSync(filepath, report);

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║              REPORT GENERATED SUCCESSFULLY                    ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log();
  console.log(`Report saved to: ${filepath}`);
  console.log(`Report size: ${(report.length / 1024).toFixed(1)} KB`);
  console.log(`Lines: ${report.split('\n').length}`);

  return filepath;
}

generateReport().catch(e => {
  console.error('Error generating report:', e.message);
  process.exit(1);
});
