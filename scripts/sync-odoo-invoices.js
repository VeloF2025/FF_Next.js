/**
 * Sync Vendor Bills (Invoices) from Odoo
 *
 * Syncs account.move records with move_type='in_invoice' (vendor bills)
 * from Odoo to FibreFlow vendor_invoices table.
 */

const { neon } = require('@neondatabase/serverless');

class OdooClient {
  constructor(config) {
    this.url = config.url;
    this.db = config.db;
    this.username = config.username;
    this.password = config.password;
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

  async getVendorBills(options = {}) {
    const domain = [['move_type', '=', 'in_invoice']];
    if (options.state) {
      domain.push(['state', '=', options.state]);
    }

    return this.call('account.move', 'search_read', [domain], {
      fields: [
        'id', 'name', 'partner_id', 'invoice_date', 'invoice_date_due', 'date',
        'amount_total', 'amount_untaxed', 'amount_tax', 'amount_residual',
        'state', 'payment_state', 'ref', 'invoice_origin', 'currency_id',
        'invoice_line_ids'
      ],
      limit: options.limit || 500,
      order: 'invoice_date desc'
    });
  }

  async getInvoiceLines(lineIds) {
    if (!lineIds || lineIds.length === 0) return [];

    return this.call('account.move.line', 'search_read', [
      [['id', 'in', lineIds], ['display_type', '=', 'product']]
    ], {
      fields: [
        'id', 'move_id', 'product_id', 'name', 'quantity', 'price_unit',
        'discount', 'price_subtotal', 'price_total', 'tax_ids',
        'product_uom_id'
      ],
      limit: 1000
    });
  }
}

async function syncInvoices() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║         SYNC VENDOR INVOICES FROM ODOO                       ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const client = new OdooClient({
    url: 'https://velocityfibre.odoo.com',
    db: 'velocityfibre',
    username: 'jacques@velocityfibre.co.za',
    password: 'Ledene9685@'
  });

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

  // Get existing synced invoices
  const existingInvoices = await sql`
    SELECT odoo_move_id FROM vendor_invoices WHERE odoo_move_id IS NOT NULL
  `;
  const existingSet = new Set(existingInvoices.map(i => i.odoo_move_id));
  console.log(`Already synced: ${existingSet.size} invoices\n`);

  // Fetch all vendor bills from Odoo
  console.log('=== Fetching vendor bills from Odoo ===');
  const bills = await client.getVendorBills({ limit: 500 });
  console.log(`Found ${bills.length} vendor bills\n`);

  // Collect all line IDs
  const allLineIds = [];
  for (const bill of bills) {
    if (bill.invoice_line_ids && bill.invoice_line_ids.length > 0) {
      allLineIds.push(...bill.invoice_line_ids);
    }
  }
  console.log(`Fetching ${allLineIds.length} invoice lines...`);

  const allLines = await client.getInvoiceLines(allLineIds);
  console.log(`Retrieved ${allLines.length} line items\n`);

  // Group lines by move_id
  const linesByMove = new Map();
  for (const line of allLines) {
    if (!line.move_id) continue;
    const moveId = line.move_id[0];
    if (!linesByMove.has(moveId)) {
      linesByMove.set(moveId, []);
    }
    linesByMove.get(moveId).push(line);
  }

  // Process bills
  console.log('=== Syncing invoices ===');
  let created = 0, updated = 0, errors = 0;

  for (const bill of bills) {
    try {
      const supplierId = bill.partner_id ? supplierMap.get(bill.partner_id[0]) : null;
      const isExisting = existingSet.has(bill.id);

      // Map Odoo state to FF status
      const status = bill.state === 'posted' ? 'posted' : bill.state === 'draft' ? 'draft' : bill.state;
      const paymentStatus = bill.payment_state || 'not_paid';

      if (isExisting) {
        // Update existing invoice
        await sql`
          UPDATE vendor_invoices SET
            invoice_number = ${bill.name},
            reference = ${bill.ref || null},
            supplier_id = ${supplierId},
            invoice_date = ${bill.invoice_date ? new Date(bill.invoice_date) : null},
            due_date = ${bill.invoice_date_due ? new Date(bill.invoice_date_due) : null},
            accounting_date = ${bill.date ? new Date(bill.date) : null},
            amount_untaxed = ${bill.amount_untaxed || 0},
            amount_tax = ${bill.amount_tax || 0},
            amount_total = ${bill.amount_total || 0},
            amount_residual = ${bill.amount_residual || 0},
            status = ${status},
            payment_status = ${paymentStatus},
            odoo_origin = ${bill.invoice_origin || null},
            odoo_synced_at = NOW(),
            currency = ${bill.currency_id ? bill.currency_id[1] : 'ZAR'}
          WHERE odoo_move_id = ${bill.id}
        `;
        updated++;
      } else {
        // Insert new invoice
        const result = await sql`
          INSERT INTO vendor_invoices (
            invoice_number, reference, supplier_id,
            invoice_date, due_date, accounting_date,
            amount_untaxed, amount_tax, amount_total, amount_residual,
            status, payment_status,
            odoo_move_id, odoo_partner_id, odoo_origin, odoo_synced_at,
            currency
          ) VALUES (
            ${bill.name}, ${bill.ref || null}, ${supplierId},
            ${bill.invoice_date ? new Date(bill.invoice_date) : null},
            ${bill.invoice_date_due ? new Date(bill.invoice_date_due) : null},
            ${bill.date ? new Date(bill.date) : null},
            ${bill.amount_untaxed || 0}, ${bill.amount_tax || 0},
            ${bill.amount_total || 0}, ${bill.amount_residual || 0},
            ${status}, ${paymentStatus},
            ${bill.id}, ${bill.partner_id ? bill.partner_id[0] : null},
            ${bill.invoice_origin || null}, NOW(),
            ${bill.currency_id ? bill.currency_id[1] : 'ZAR'}
          )
          RETURNING id
        `;

        // Sync line items for new invoice
        const invoiceId = result[0].id;
        const lines = linesByMove.get(bill.id) || [];

        for (const line of lines) {
          const stockItemId = line.product_id ? productMap.get(line.product_id[0]) : null;

          await sql`
            INSERT INTO vendor_invoice_items (
              invoice_id, stock_item_id, product_code, description,
              quantity, unit_price, discount_percent, subtotal,
              uom, odoo_line_id, odoo_product_id, odoo_synced_at
            ) VALUES (
              ${invoiceId}, ${stockItemId},
              ${line.product_id ? line.product_id[1].split(']')[0].replace('[', '') : null},
              ${line.name || 'No description'},
              ${line.quantity || 1}, ${line.price_unit || 0},
              ${line.discount || 0}, ${line.price_subtotal || 0},
              ${line.product_uom_id ? line.product_uom_id[1] : 'unit'},
              ${line.id}, ${line.product_id ? line.product_id[0] : null}, NOW()
            )
          `;
        }

        created++;
      }

      // Progress
      if ((created + updated) % 5 === 0) {
        console.log(`  Progress: ${created} created, ${updated} updated`);
      }

    } catch (e) {
      errors++;
      console.log(`  Error on ${bill.name}: ${e.message}`);
    }
  }

  // Final stats
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                         SYNC COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════');

  const finalStats = await sql`
    SELECT
      COUNT(*) as total_invoices,
      SUM(amount_total) as total_amount,
      COUNT(*) FILTER (WHERE payment_status = 'paid') as paid,
      COUNT(*) FILTER (WHERE payment_status = 'not_paid') as unpaid
    FROM vendor_invoices
  `;

  const itemStats = await sql`
    SELECT COUNT(*) as total_items FROM vendor_invoice_items
  `;

  console.log(`Total Invoices: ${finalStats[0].total_invoices}`);
  console.log(`  Paid: ${finalStats[0].paid}`);
  console.log(`  Unpaid: ${finalStats[0].unpaid}`);
  console.log(`Total Amount: R ${Number(finalStats[0].total_amount || 0).toLocaleString()}`);
  console.log(`Invoice Items: ${itemStats[0].total_items}`);
  console.log(`\nCreated: ${created}, Updated: ${updated}, Errors: ${errors}`);
}

syncInvoices().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
