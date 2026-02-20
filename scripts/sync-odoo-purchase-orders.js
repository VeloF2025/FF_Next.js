/**
 * Sync Purchase Orders from Odoo
 *
 * Syncs purchase.order records from Odoo to FibreFlow purchase_orders table.
 */

const { neon } = require('@neondatabase/serverless');

class OdooClient {
  constructor() {
    this.url = 'https://velocityfibre.odoo.com';
    this.db = 'velocityfibre';
    this.username = 'jacques@velocityfibre.co.za';
    this.password = 'Ledene9685@';
    this.uid = null;
  }

  async authenticate() {
    const response = await fetch(`${this.url}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'call',
        params: { service: 'common', method: 'authenticate', args: [this.db, this.username, this.password, {}] },
        id: 1
      })
    });
    const data = await response.json();
    this.uid = data.result;
    if (!this.uid) throw new Error('Authentication failed');
    return this.uid;
  }

  async call(model, method, args, kwargs = {}) {
    const response = await fetch(`${this.url}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'call',
        params: { service: 'object', method: 'execute_kw', args: [this.db, this.uid, this.password, model, method, args, kwargs] },
        id: Date.now()
      })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.data?.message || data.error.message);
    return data.result;
  }

  async getPurchaseOrders(options = {}) {
    const domain = [];
    if (options.state) {
      domain.push(['state', 'in', options.state]);
    }

    return this.call('purchase.order', 'search_read', [domain], {
      fields: [
        'id', 'name', 'partner_id', 'partner_ref', 'date_order', 'date_planned',
        'amount_untaxed', 'amount_tax', 'amount_total', 'state', 'invoice_status',
        'currency_id', 'order_line', 'picking_ids', 'invoice_ids',
        'date_approve', 'user_id', 'origin'
      ],
      limit: options.limit || 500,
      order: 'date_order desc'
    });
  }

  async getPOLines(lineIds) {
    if (!lineIds || lineIds.length === 0) return [];

    return this.call('purchase.order.line', 'search_read', [
      [['id', 'in', lineIds]]
    ], {
      fields: [
        'id', 'order_id', 'product_id', 'name', 'product_qty', 'qty_received',
        'qty_invoiced', 'price_unit', 'price_subtotal', 'price_total',
        'product_uom_id', 'date_planned'
      ],
      limit: 2000
    });
  }
}

async function syncPurchaseOrders() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║         SYNC PURCHASE ORDERS FROM ODOO                       ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const client = new OdooClient();
  await client.authenticate();
  console.log('✓ Connected to Odoo\n');

  const sql = neon(process.env.DATABASE_URL);

  // Get supplier mapping
  const suppliers = await sql`
    SELECT id, odoo_partner_id FROM suppliers WHERE odoo_partner_id IS NOT NULL
  `;
  const supplierMap = new Map(suppliers.map(s => [s.odoo_partner_id, s.id]));
  console.log(`Supplier mapping: ${supplierMap.size} suppliers\n`);

  // Get product mapping
  const products = await sql`
    SELECT id, odoo_product_id FROM stock_items WHERE odoo_product_id IS NOT NULL
  `;
  const productMap = new Map(products.map(p => [p.odoo_product_id, p.id]));
  console.log(`Product mapping: ${productMap.size} products\n`);

  // Get existing synced POs
  const existingPOs = await sql`
    SELECT odoo_po_id FROM purchase_orders WHERE odoo_po_id IS NOT NULL
  `;
  const existingSet = new Set(existingPOs.map(p => p.odoo_po_id));
  console.log(`Already synced: ${existingSet.size} POs\n`);

  // Fetch all POs from Odoo
  console.log('=== Fetching purchase orders from Odoo ===');
  const orders = await client.getPurchaseOrders({ limit: 500 });
  console.log(`Found ${orders.length} purchase orders\n`);

  // Collect all line IDs
  const allLineIds = [];
  for (const po of orders) {
    if (po.order_line && po.order_line.length > 0) {
      allLineIds.push(...po.order_line);
    }
  }
  console.log(`Fetching ${allLineIds.length} PO lines...`);

  const allLines = await client.getPOLines(allLineIds);
  console.log(`Retrieved ${allLines.length} line items\n`);

  // Group lines by order_id
  const linesByOrder = new Map();
  for (const line of allLines) {
    if (!line.order_id) continue;
    const orderId = line.order_id[0];
    if (!linesByOrder.has(orderId)) {
      linesByOrder.set(orderId, []);
    }
    linesByOrder.get(orderId).push(line);
  }

  // Process orders
  console.log('=== Syncing purchase orders ===');
  let created = 0, updated = 0, errors = 0;

  for (const po of orders) {
    try {
      const supplierId = po.partner_id ? supplierMap.get(po.partner_id[0]) : null;
      const isExisting = existingSet.has(po.id);

      // Map Odoo state to FF status
      const statusMap = {
        'draft': 'draft',
        'sent': 'sent',
        'to approve': 'pending_approval',
        'purchase': 'approved',
        'done': 'completed',
        'cancel': 'cancelled'
      };
      const status = statusMap[po.state] || po.state;

      // Calculate amounts
      const subtotal = po.amount_untaxed || 0;
      const taxAmount = po.amount_tax || 0;
      const totalAmount = po.amount_total || 0;

      if (isExisting) {
        // Update existing PO
        await sql`
          UPDATE purchase_orders SET
            po_number = ${po.name},
            supplier_id = ${supplierId},
            supplier_reference = ${po.partner_ref || null},
            order_date = ${po.date_order ? new Date(po.date_order) : null},
            expected_delivery_date = ${po.date_planned ? new Date(po.date_planned) : null},
            subtotal = ${subtotal},
            tax_amount = ${taxAmount},
            total_amount = ${totalAmount},
            status = ${status},
            approved_at = ${po.date_approve ? new Date(po.date_approve) : null},
            currency = ${po.currency_id ? po.currency_id[1] : 'ZAR'},
            updated_at = NOW()
          WHERE odoo_po_id = ${po.id}
        `;
        updated++;
      } else {
        // Insert new PO
        // Get Odoo user name for created_by
        const createdBy = po.user_id ? po.user_id[1] : 'Odoo Sync';

        const result = await sql`
          INSERT INTO purchase_orders (
            po_number, supplier_id, supplier_reference,
            order_date, expected_delivery_date,
            subtotal, tax_amount, total_amount,
            status, approved_at,
            currency, odoo_po_id, created_by, created_at
          ) VALUES (
            ${po.name}, ${supplierId}, ${po.partner_ref || null},
            ${po.date_order ? new Date(po.date_order) : null},
            ${po.date_planned ? new Date(po.date_planned) : null},
            ${subtotal}, ${taxAmount}, ${totalAmount},
            ${status},
            ${po.date_approve ? new Date(po.date_approve) : null},
            ${po.currency_id ? po.currency_id[1] : 'ZAR'},
            ${po.id}, ${createdBy}, NOW()
          )
          RETURNING id
        `;

        // Sync line items for new PO
        const poId = result[0].id;
        const lines = linesByOrder.get(po.id) || [];

        for (const line of lines) {
          const stockItemId = line.product_id ? productMap.get(line.product_id[0]) : null;

          // Calculate tax rate from Odoo's subtotal/total (e.g. 15% VAT)
          const lineSubtotal = line.price_subtotal || 0;
          const lineTotal = line.price_total || 0;
          const lineTaxRate = lineSubtotal > 0
            ? Math.round((lineTotal - lineSubtotal) / lineSubtotal * 10000) / 100
            : 0;

          try {
            await sql`
              INSERT INTO purchase_order_items (
                purchase_order_id, stock_item_id, item_code, item_description,
                quantity_ordered, quantity_received, quantity_invoiced,
                unit_price, total_price, tax_rate,
                uom, expected_delivery_date,
                odoo_line_id, created_at
              ) VALUES (
                ${poId}, ${stockItemId},
                ${line.product_id ? line.product_id[1].split(']')[0].replace('[', '') : null},
                ${line.name || 'No description'},
                ${line.product_qty || 0}, ${line.qty_received || 0}, ${line.qty_invoiced || 0},
                ${line.price_unit || 0}, ${lineSubtotal}, ${lineTaxRate},
                ${line.product_uom_id ? line.product_uom_id[1] : 'unit'},
                ${line.date_planned ? new Date(line.date_planned) : null},
                ${line.id}, NOW()
              )
            `;
          } catch (e) {
            console.log(`  Warning: Could not insert line item: ${e.message.substring(0, 50)}`);
          }
        }

        created++;
      }

      // Progress
      if ((created + updated) % 20 === 0) {
        console.log(`  Progress: ${created} created, ${updated} updated`);
      }

    } catch (e) {
      errors++;
      console.log(`  Error on ${po.name}: ${e.message}`);
    }
  }

  // Final stats
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                         SYNC COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════');

  const finalStats = await sql`
    SELECT
      COUNT(*) as total_pos,
      COUNT(*) FILTER (WHERE odoo_po_id IS NOT NULL) as synced,
      SUM(total_amount) as total_value,
      COUNT(*) FILTER (WHERE status = 'approved') as approved,
      COUNT(*) FILTER (WHERE status = 'completed') as completed
    FROM purchase_orders
  `;

  console.log(`Total POs: ${finalStats[0].total_pos}`);
  console.log(`  Synced from Odoo: ${finalStats[0].synced}`);
  console.log(`  Approved: ${finalStats[0].approved}`);
  console.log(`  Completed: ${finalStats[0].completed}`);
  console.log(`Total Value: R ${Number(finalStats[0].total_value || 0).toLocaleString()}`);
  console.log(`\nCreated: ${created}, Updated: ${updated}, Errors: ${errors}`);
}

syncPurchaseOrders().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
