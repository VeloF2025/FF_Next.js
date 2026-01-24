/**
 * Sync Remaining GRNs from Odoo
 *
 * Syncs all GRNs (stock.picking with incoming type) from Odoo,
 * including any that may have been missed in previous syncs.
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

  async getGRNs(options = {}) {
    // Get all incoming pickings (receipts/GRNs)
    const domain = [['picking_type_code', '=', 'incoming']];

    return this.call('stock.picking', 'search_read', [domain], {
      fields: [
        'id', 'name', 'partner_id', 'scheduled_date', 'date_done',
        'state', 'origin', 'purchase_id',
        'location_id', 'location_dest_id'
      ],
      limit: options.limit || 500,
      order: 'date_done desc, scheduled_date desc'
    });
  }

  async getStockMoves(pickingIds) {
    if (!pickingIds || pickingIds.length === 0) return [];

    return this.call('stock.move', 'search_read', [
      [['picking_id', 'in', pickingIds]]
    ], {
      fields: [
        'id', 'picking_id', 'product_id', 'product_uom_qty', 'quantity',
        'price_unit', 'state', 'date'
      ],
      limit: 2000
    });
  }
}

async function syncGRNs() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║         SYNC REMAINING GRNs FROM ODOO                        ║');
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
  console.log(`Supplier mapping: ${supplierMap.size} suppliers`);

  // Get PO mapping
  const pos = await sql`
    SELECT id, odoo_po_id FROM purchase_orders WHERE odoo_po_id IS NOT NULL
  `;
  const poMap = new Map(pos.map(p => [p.odoo_po_id, p.id]));
  console.log(`PO mapping: ${poMap.size} POs`);

  // Get product mapping
  const products = await sql`
    SELECT id, odoo_product_id FROM stock_items WHERE odoo_product_id IS NOT NULL
  `;
  const productMap = new Map(products.map(p => [p.odoo_product_id, p.id]));
  console.log(`Product mapping: ${productMap.size} products\n`);

  // Get existing synced GRNs
  const existingGRNs = await sql`
    SELECT odoo_picking_id FROM goods_receipt_notes WHERE odoo_picking_id IS NOT NULL
  `;
  const existingSet = new Set(existingGRNs.map(g => g.odoo_picking_id));
  console.log(`Already synced: ${existingSet.size} GRNs\n`);

  // Fetch all GRNs from Odoo
  console.log('=== Fetching GRNs from Odoo ===');
  const grns = await client.getGRNs({ limit: 500 });
  console.log(`Found ${grns.length} GRNs in Odoo\n`);

  // Collect all picking IDs to fetch their moves
  const allPickingIds = grns.map(g => g.id);
  console.log(`Fetching stock moves for ${allPickingIds.length} pickings...`);

  const allMoves = await client.getStockMoves(allPickingIds);
  console.log(`Retrieved ${allMoves.length} moves\n`);

  // Group moves by picking_id
  const movesByPicking = new Map();
  for (const move of allMoves) {
    if (!move.picking_id) continue;
    const pickingId = move.picking_id[0];
    if (!movesByPicking.has(pickingId)) {
      movesByPicking.set(pickingId, []);
    }
    movesByPicking.get(pickingId).push(move);
  }

  // Process GRNs
  console.log('=== Syncing GRNs ===');
  let created = 0, updated = 0, errors = 0, itemsCreated = 0;

  for (const grn of grns) {
    try {
      const isExisting = existingSet.has(grn.id);
      const supplierId = grn.partner_id ? supplierMap.get(grn.partner_id[0]) : null;
      const poId = grn.purchase_id ? poMap.get(grn.purchase_id[0]) : null;

      // Map Odoo state to FF status
      const statusMap = {
        'draft': 'pending',
        'waiting': 'pending',
        'confirmed': 'pending',
        'assigned': 'in_progress',
        'done': 'received',
        'cancel': 'cancelled'
      };
      const status = statusMap[grn.state] || grn.state;

      if (isExisting) {
        // Update existing GRN
        await sql`
          UPDATE goods_receipt_notes SET
            grn_number = ${grn.name},
            supplier_id = ${supplierId},
            purchase_order_id = ${poId},
            delivery_date = ${grn.date_done ? new Date(grn.date_done) : grn.scheduled_date ? new Date(grn.scheduled_date) : null},
            status = ${status},
            updated_at = NOW()
          WHERE odoo_picking_id = ${grn.id}
        `;
        updated++;
      } else {
        // Insert new GRN
        const result = await sql`
          INSERT INTO goods_receipt_notes (
            grn_number, supplier_id, purchase_order_id,
            delivery_date, status,
            odoo_picking_id, created_at
          ) VALUES (
            ${grn.name}, ${supplierId}, ${poId},
            ${grn.date_done ? new Date(grn.date_done) : grn.scheduled_date ? new Date(grn.scheduled_date) : null},
            ${status}, ${grn.id}, NOW()
          )
          RETURNING id
        `;

        // Sync line items for new GRN
        const grnId = result[0].id;
        const moves = movesByPicking.get(grn.id) || [];

        for (const move of moves) {
          const stockItemId = move.product_id ? productMap.get(move.product_id[0]) : null;

          try {
            // Check if already exists
            const existing = await sql`
              SELECT id FROM goods_receipt_items
              WHERE grn_id = ${grnId} AND odoo_move_id = ${move.id}
              LIMIT 1
            `;

            if (existing.length === 0) {
              await sql`
                INSERT INTO goods_receipt_items (
                  grn_id, stock_item_id, item_description,
                  quantity_expected, quantity_received,
                  unit_price, status,
                  odoo_move_id, created_at
                ) VALUES (
                  ${grnId}, ${stockItemId},
                  ${move.product_id ? move.product_id[1] : 'No description'},
                  ${move.product_uom_qty || 0}, ${move.quantity || 0},
                  ${move.price_unit || 0}, ${move.state === 'done' ? 'received' : 'pending'},
                  ${move.id}, NOW()
                )
              `;
              itemsCreated++;
            }
          } catch (e) {
            // Ignore individual item errors
          }
        }

        created++;
      }

      // Progress
      if ((created + updated) % 20 === 0 && (created + updated) > 0) {
        console.log(`  Progress: ${created} created, ${updated} updated, ${itemsCreated} items`);
      }

    } catch (e) {
      errors++;
      console.log(`  Error on ${grn.name}: ${e.message.substring(0, 60)}`);
    }
  }

  // Final stats
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                         SYNC COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════');

  const finalStats = await sql`
    SELECT
      COUNT(*) as total_grns,
      COUNT(*) FILTER (WHERE odoo_picking_id IS NOT NULL) as synced,
      COUNT(*) FILTER (WHERE status = 'received') as received,
      (SELECT COUNT(*) FROM goods_receipt_items) as total_items,
      (SELECT SUM(quantity_received) FROM goods_receipt_items) as total_qty
    FROM goods_receipt_notes
  `;

  const s = finalStats[0];
  console.log(`Total GRNs: ${s.total_grns}`);
  console.log(`  Synced from Odoo: ${s.synced}`);
  console.log(`  Received: ${s.received}`);
  console.log(`Total Items: ${s.total_items}`);
  console.log(`Total Qty Received: ${Number(s.total_qty || 0).toLocaleString()}`);
  console.log(`\nCreated: ${created}, Updated: ${updated}, Items: ${itemsCreated}, Errors: ${errors}`);
}

syncGRNs().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
