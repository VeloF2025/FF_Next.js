/**
 * Explore Odoo Data Inventory
 * Shows all available data in Odoo to identify sync gaps
 */

class OdooClient {
  constructor() {
    this.url = 'https://velocityfibre.odoo.com';
    this.db = 'velocityfibre';
    this.username = 'jacques@velocityfibre.co.za';
    this.password = 'Ledene9685@';
    this.uid = null;
  }

  async auth() {
    const r = await fetch(`${this.url}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', method: 'call', id: 1,
        params: { service: 'common', method: 'authenticate',
          args: [this.db, this.username, this.password, {}] }
      })
    });
    this.uid = (await r.json()).result;
    return this.uid;
  }

  async count(model, domain = []) {
    const r = await fetch(`${this.url}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', method: 'call', id: Date.now(),
        params: { service: 'object', method: 'execute_kw',
          args: [this.db, this.uid, this.password, model, 'search_count', [domain]] }
      })
    });
    const data = await r.json();
    if (data.error) throw new Error(data.error.message);
    return data.result;
  }

  async read(model, domain, fields, limit = 10) {
    const r = await fetch(`${this.url}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', method: 'call', id: Date.now(),
        params: { service: 'object', method: 'execute_kw',
          args: [this.db, this.uid, this.password, model, 'search_read', [domain], { fields, limit }] }
      })
    });
    const data = await r.json();
    if (data.error) throw new Error(data.error.message);
    return data.result;
  }
}

async function explore() {
  const client = new OdooClient();
  await client.auth();

  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║              ODOO DATA INVENTORY                             ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const models = [
    // Core Data
    { model: 'res.partner', name: 'Partners (all contacts)', domain: [] },
    { model: 'res.partner', name: '  └─ Suppliers', domain: [['supplier_rank', '>', 0]] },
    { model: 'res.partner', name: '  └─ Customers', domain: [['customer_rank', '>', 0]] },
    { model: 'product.product', name: 'Products (variants)', domain: [] },
    { model: 'product.template', name: 'Product Templates', domain: [] },
    { model: 'product.category', name: 'Product Categories', domain: [] },

    // Purchasing
    { model: 'purchase.order', name: 'Purchase Orders', domain: [] },
    { model: 'purchase.order', name: '  └─ Confirmed/Done', domain: [['state', 'in', ['purchase', 'done']]] },
    { model: 'purchase.order.line', name: 'PO Line Items', domain: [] },

    // Inventory/Stock
    { model: 'stock.picking', name: 'Stock Pickings (all)', domain: [] },
    { model: 'stock.picking', name: '  └─ Receipts (GRNs)', domain: [['picking_type_code', '=', 'incoming']] },
    { model: 'stock.picking', name: '  └─ Deliveries', domain: [['picking_type_code', '=', 'outgoing']] },
    { model: 'stock.picking', name: '  └─ Internal Transfers', domain: [['picking_type_code', '=', 'internal']] },
    { model: 'stock.move', name: 'Stock Moves', domain: [] },
    { model: 'stock.quant', name: 'Stock Quants (on-hand)', domain: [] },
    { model: 'stock.location', name: 'Stock Locations', domain: [] },
    { model: 'stock.warehouse', name: 'Warehouses', domain: [] },
    { model: 'stock.inventory', name: 'Inventory Adjustments', domain: [] },

    // Accounting
    { model: 'account.move', name: 'Journal Entries (all)', domain: [] },
    { model: 'account.move', name: '  └─ Vendor Bills', domain: [['move_type', '=', 'in_invoice']] },
    { model: 'account.move', name: '  └─ Customer Invoices', domain: [['move_type', '=', 'out_invoice']] },
    { model: 'account.move', name: '  └─ Vendor Credits', domain: [['move_type', '=', 'in_refund']] },
    { model: 'account.move', name: '  └─ Customer Credits', domain: [['move_type', '=', 'out_refund']] },
    { model: 'account.move.line', name: 'Journal Items', domain: [] },
    { model: 'account.payment', name: 'Payments', domain: [] },
    { model: 'account.account', name: 'Chart of Accounts', domain: [] },

    // Documents
    { model: 'ir.attachment', name: 'Attachments/Files', domain: [] },

    // Other modules (may not exist)
    { model: 'fleet.vehicle', name: 'Fleet Vehicles', domain: [], optional: true },
    { model: 'fleet.vehicle.log.services', name: 'Fleet Services', domain: [], optional: true },
    { model: 'project.project', name: 'Projects', domain: [], optional: true },
    { model: 'project.task', name: 'Tasks', domain: [], optional: true },
    { model: 'hr.employee', name: 'Employees', domain: [], optional: true },
  ];

  console.log('Model                                    │ Count    │ Status');
  console.log('─'.repeat(70));

  const results = [];

  for (const m of models) {
    try {
      const count = await client.count(m.model, m.domain);
      const name = m.name.padEnd(40);
      const countStr = String(count).padStart(8);
      console.log(`${name} │ ${countStr} │ ✓`);
      results.push({ ...m, count });
    } catch (e) {
      if (m.optional) {
        console.log(`${m.name.padEnd(40)} │ ${'N/A'.padStart(8)} │ (not installed)`);
      } else {
        console.log(`${m.name.padEnd(40)} │ ${'ERROR'.padStart(8)} │ ${e.message.substring(0, 20)}`);
      }
    }
  }

  // Summary
  console.log('\n' + '═'.repeat(70));
  console.log('SYNC STATUS COMPARISON');
  console.log('═'.repeat(70) + '\n');

  // Get FibreFlow counts for comparison
  const { neon } = require('@neondatabase/serverless');
  const sql = neon(process.env.DATABASE_URL);

  const ffCounts = await sql`
    SELECT
      (SELECT COUNT(*) FROM suppliers) as suppliers,
      (SELECT COUNT(*) FROM suppliers WHERE odoo_partner_id IS NOT NULL) as suppliers_synced,
      (SELECT COUNT(*) FROM stock_items) as products,
      (SELECT COUNT(*) FROM stock_items WHERE odoo_product_id IS NOT NULL) as products_synced,
      (SELECT COUNT(*) FROM purchase_orders) as pos,
      (SELECT COUNT(*) FROM goods_receipt_notes) as grns,
      (SELECT COUNT(*) FROM goods_receipt_notes WHERE odoo_picking_id IS NOT NULL) as grns_synced,
      (SELECT COUNT(*) FROM goods_receipt_items) as grn_items,
      (SELECT COUNT(*) FROM stock_levels) as stock_levels,
      (SELECT COUNT(*) FROM stock_levels WHERE odoo_quant_id IS NOT NULL) as stock_synced,
      (SELECT COUNT(*) FROM vendor_invoices) as invoices,
      (SELECT COUNT(*) FROM vendor_invoices WHERE odoo_move_id IS NOT NULL) as invoices_synced,
      (SELECT COUNT(*) FROM vendor_invoice_items) as invoice_items
  `;

  const ff = ffCounts[0];

  const odooSuppliers = results.find(r => r.name.includes('Suppliers'))?.count || 0;
  const odooProducts = results.find(r => r.model === 'product.product' && r.name === 'Products (variants)')?.count || 0;
  const odooPOs = results.find(r => r.name === 'Purchase Orders')?.count || 0;
  const odooGRNs = results.find(r => r.name.includes('Receipts (GRNs)'))?.count || 0;
  const odooMoves = results.find(r => r.name === 'Stock Moves')?.count || 0;
  const odooQuants = results.find(r => r.name.includes('Stock Quants'))?.count || 0;
  const odooInvoices = results.find(r => r.name.includes('Vendor Bills'))?.count || 0;
  const odooAttachments = results.find(r => r.name.includes('Attachments'))?.count || 0;

  console.log('Data Type              │ Odoo      │ FibreFlow │ Synced    │ Gap');
  console.log('─'.repeat(70));

  const compare = (name, odoo, ff, synced) => {
    const gap = odoo - synced;
    const gapStr = gap > 0 ? `⚠️  ${gap}` : '✅ 0';
    console.log(`${name.padEnd(22)} │ ${String(odoo).padStart(9)} │ ${String(ff).padStart(9)} │ ${String(synced).padStart(9)} │ ${gapStr}`);
  };

  compare('Suppliers', odooSuppliers, ff.suppliers, ff.suppliers_synced);
  compare('Products', odooProducts, ff.products, ff.products_synced);
  compare('Purchase Orders', odooPOs, ff.pos, 0); // POs not synced from Odoo
  compare('GRNs (Receipts)', odooGRNs, ff.grns, ff.grns_synced);
  compare('Stock Moves', odooMoves, ff.grn_items, ff.grn_items);
  compare('Stock Levels', odooQuants, ff.stock_levels, ff.stock_synced);
  compare('Vendor Invoices', odooInvoices, ff.invoices, ff.invoices_synced);
  compare('Attachments', odooAttachments, 0, 0);

  // Not synced summary
  console.log('\n' + '═'.repeat(70));
  console.log('DATA NOT YET SYNCED TO FIBREFLOW');
  console.log('═'.repeat(70) + '\n');

  const notSynced = [
    { name: 'Purchase Orders from Odoo', reason: 'POs created in FF, not pulled from Odoo' },
    { name: 'Deliveries (Outgoing)', count: results.find(r => r.name.includes('Deliveries'))?.count },
    { name: 'Internal Transfers', count: results.find(r => r.name.includes('Internal Transfers'))?.count },
    { name: 'Customer Invoices', count: results.find(r => r.name.includes('Customer Invoices'))?.count },
    { name: 'Payments', count: results.find(r => r.name === 'Payments')?.count },
    { name: 'Attachments/Documents', count: odooAttachments },
  ];

  for (const item of notSynced) {
    if (item.count !== undefined) {
      console.log(`  • ${item.name}: ${item.count} records`);
    } else if (item.reason) {
      console.log(`  • ${item.name} - ${item.reason}`);
    }
  }
}

explore().catch(e => {
  console.error('Error:', e.message);
  process.exit(1);
});
