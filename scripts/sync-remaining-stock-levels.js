/**
 * Sync Remaining Stock Levels from Odoo
 *
 * Syncs stock.quant records from Odoo to FibreFlow stock_levels table.
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

  async getStockQuants(options = {}) {
    // Get stock quants with positive quantity
    const domain = [['quantity', '>', 0]];

    return this.call('stock.quant', 'search_read', [domain], {
      fields: [
        'id', 'product_id', 'location_id', 'quantity', 'reserved_quantity',
        'inventory_date', 'write_date'
      ],
      limit: options.limit || 500,
      order: 'write_date desc'
    });
  }
}

async function syncStockLevels() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║         SYNC STOCK LEVELS FROM ODOO                          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const client = new OdooClient();
  await client.authenticate();
  console.log('✓ Connected to Odoo\n');

  const sql = neon(process.env.DATABASE_URL);

  // Get product mapping (stock_item_id by odoo_product_id)
  const products = await sql`
    SELECT id, odoo_product_id FROM stock_items WHERE odoo_product_id IS NOT NULL
  `;
  const productMap = new Map(products.map(p => [p.odoo_product_id, p.id]));
  console.log(`Product mapping: ${productMap.size} products\n`);

  // Get existing synced quants
  const existingQuants = await sql`
    SELECT odoo_quant_id FROM stock_levels WHERE odoo_quant_id IS NOT NULL
  `;
  const existingSet = new Set(existingQuants.map(q => q.odoo_quant_id));
  console.log(`Already synced: ${existingSet.size} stock quants\n`);

  // Fetch stock quants from Odoo
  console.log('=== Fetching stock quants from Odoo ===');
  const quants = await client.getStockQuants({ limit: 500 });
  console.log(`Found ${quants.length} stock quants with positive quantity\n`);

  // Process quants
  console.log('=== Syncing stock levels ===');
  let created = 0, updated = 0, skipped = 0, errors = 0;

  for (const quant of quants) {
    try {
      const isExisting = existingSet.has(quant.id);
      const stockItemId = quant.product_id ? productMap.get(quant.product_id[0]) : null;

      // Skip if we can't link to a stock item
      if (!stockItemId) {
        skipped++;
        continue;
      }

      const locationName = quant.location_id ? quant.location_id[1] : 'Unknown';
      const qtyOnHand = quant.quantity || 0;
      const qtyReserved = quant.reserved_quantity || 0;

      if (isExisting) {
        // Update existing stock level (qty_available is auto-generated)
        await sql`
          UPDATE stock_levels SET
            location_name = ${locationName},
            odoo_location_id = ${quant.location_id ? quant.location_id[0] : null},
            qty_on_hand = ${qtyOnHand},
            qty_reserved = ${qtyReserved},
            last_count_date = ${quant.inventory_date ? new Date(quant.inventory_date) : null},
            odoo_synced_at = NOW(),
            last_odoo_sync = ${quant.write_date ? new Date(quant.write_date) : null},
            updated_at = NOW()
          WHERE odoo_quant_id = ${quant.id}
        `;
        updated++;
      } else {
        // Insert new stock level (qty_available is auto-generated from qty_on_hand - qty_reserved)
        await sql`
          INSERT INTO stock_levels (
            stock_item_id, odoo_quant_id, odoo_location_id,
            location_name, qty_on_hand, qty_reserved,
            last_count_date, odoo_synced_at, last_odoo_sync, created_at
          ) VALUES (
            ${stockItemId}, ${quant.id}, ${quant.location_id ? quant.location_id[0] : null},
            ${locationName}, ${qtyOnHand}, ${qtyReserved},
            ${quant.inventory_date ? new Date(quant.inventory_date) : null},
            NOW(), ${quant.write_date ? new Date(quant.write_date) : null}, NOW()
          )
        `;
        created++;
      }

      // Progress
      if ((created + updated) % 50 === 0 && (created + updated) > 0) {
        console.log(`  Progress: ${created} created, ${updated} updated, ${skipped} skipped`);
      }

    } catch (e) {
      errors++;
      console.log(`  Error on quant ${quant.id}: ${e.message.substring(0, 60)}`);
    }
  }

  // Final stats
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                         SYNC COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════');

  const finalStats = await sql`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE odoo_quant_id IS NOT NULL) as synced,
      SUM(qty_on_hand) as total_qty,
      SUM(qty_available) as available_qty
    FROM stock_levels
  `;

  const s = finalStats[0];
  console.log(`Total Stock Levels: ${s.total}`);
  console.log(`  Synced from Odoo: ${s.synced}`);
  console.log(`Total Qty On Hand: ${Number(s.total_qty || 0).toLocaleString()}`);
  console.log(`Total Qty Available: ${Number(s.available_qty || 0).toLocaleString()}`);
  console.log(`\nCreated: ${created}, Updated: ${updated}, Skipped: ${skipped}, Errors: ${errors}`);
}

syncStockLevels().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
