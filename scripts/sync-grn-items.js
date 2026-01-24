/**
 * Sync GRN Line Items (stock.move) from Odoo
 *
 * This script syncs the detailed line items for all GRNs that have been
 * synced from Odoo but don't have their line items yet.
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
        params: {
          service: 'common',
          method: 'authenticate',
          args: [this.db, this.username, this.password, {}]
        },
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
        params: {
          service: 'object',
          method: 'execute_kw',
          args: [this.db, this.uid, this.password, model, method, args, kwargs]
        },
        id: Date.now()
      })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.data?.message || data.error.message);
    return data.result;
  }

  async getStockMoves(pickingIds) {
    if (!pickingIds || pickingIds.length === 0) return [];

    return this.call('stock.move', 'search_read', [
      [['picking_id', 'in', pickingIds], ['state', '=', 'done']]
    ], {
      fields: [
        'id', 'reference', 'picking_id', 'product_id', 'product_uom',
        'product_uom_qty', 'quantity', 'location_id', 'location_dest_id',
        'state', 'origin', 'date'
      ],
      limit: 5000
    });
  }
}

async function syncGRNItems() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║         SYNC GRN LINE ITEMS FROM ODOO                        ║');
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

  // Get all GRNs with odoo_picking_id that need items synced
  console.log('=== Finding GRNs needing line items ===');
  const grnsNeedingItems = await sql`
    SELECT g.id as grn_id, g.grn_number, g.odoo_picking_id,
           (SELECT COUNT(*) FROM goods_receipt_items gi WHERE gi.grn_id = g.id) as item_count
    FROM goods_receipt_notes g
    WHERE g.odoo_picking_id IS NOT NULL
    ORDER BY g.created_at
  `;

  const grnsWithNoItems = grnsNeedingItems.filter(g => Number(g.item_count) === 0);
  console.log(`Total GRNs with Odoo ID: ${grnsNeedingItems.length}`);
  console.log(`GRNs needing items: ${grnsWithNoItems.length}\n`);

  if (grnsWithNoItems.length === 0) {
    console.log('All GRNs already have line items synced!');
    return;
  }

  // Get product mapping
  const products = await sql`
    SELECT id, odoo_product_id, item_code FROM stock_items WHERE odoo_product_id IS NOT NULL
  `;
  const productMap = new Map(products.map(p => [p.odoo_product_id, { id: p.id, code: p.item_code }]));
  console.log(`Product mapping: ${productMap.size} products\n`);

  // Process in batches of 50 GRNs
  const batchSize = 50;
  let totalItemsCreated = 0;
  let totalErrors = 0;

  for (let i = 0; i < grnsWithNoItems.length; i += batchSize) {
    const batch = grnsWithNoItems.slice(i, i + batchSize);
    const pickingIds = batch.map(g => g.odoo_picking_id);

    console.log(`Processing batch ${Math.floor(i/batchSize) + 1}/${Math.ceil(grnsWithNoItems.length/batchSize)} (${batch.length} GRNs)`);

    try {
      // Fetch stock.move records for this batch
      const moves = await client.getStockMoves(pickingIds);
      console.log(`  Found ${moves.length} stock moves`);

      // Group moves by picking_id
      const movesByPicking = new Map();
      for (const move of moves) {
        if (!move.picking_id) continue;
        const pickingId = move.picking_id[0];
        if (!movesByPicking.has(pickingId)) {
          movesByPicking.set(pickingId, []);
        }
        movesByPicking.get(pickingId).push(move);
      }

      // Insert items for each GRN
      for (const grn of batch) {
        const grnMoves = movesByPicking.get(grn.odoo_picking_id) || [];

        for (const move of grnMoves) {
          try {
            const productInfo = move.product_id ? productMap.get(move.product_id[0]) : null;

            // Check if item already exists
            const existing = await sql`
              SELECT id FROM goods_receipt_items
              WHERE grn_id = ${grn.grn_id} AND odoo_move_id = ${move.id}
              LIMIT 1
            `;

            if (existing.length > 0) {
              // Update existing
              await sql`
                UPDATE goods_receipt_items SET
                  quantity_received = ${move.quantity || 0},
                  odoo_synced_at = NOW()
                WHERE id = ${existing[0].id}
              `;
            } else {
              // Insert new
              await sql`
                INSERT INTO goods_receipt_items (
                  grn_id,
                  stock_item_id,
                  item_code,
                  item_description,
                  quantity_expected,
                  quantity_received,
                  quantity_rejected,
                  uom,
                  odoo_move_id,
                  odoo_synced_at
                ) VALUES (
                  ${grn.grn_id},
                  ${productInfo?.id || null},
                  ${productInfo?.code || (move.product_id ? move.product_id[1].split(']')[0].replace('[', '') : null)},
                  ${move.product_id ? move.product_id[1] : 'Unknown Product'},
                  ${move.product_uom_qty || 0},
                  ${move.quantity || 0},
                  0,
                  ${move.product_uom ? move.product_uom[1] : 'unit'},
                  ${move.id},
                  NOW()
                )
              `;
            }
            totalItemsCreated++;
          } catch (itemError) {
            totalErrors++;
            if (totalErrors <= 5) {
              console.log(`  Error on move ${move.id}: ${itemError.message}`);
            }
          }
        }
      }

      console.log(`  Items created: ${totalItemsCreated}`);

    } catch (batchError) {
      console.log(`  Batch error: ${batchError.message}`);
      totalErrors++;
    }

    // Small delay between batches
    await new Promise(r => setTimeout(r, 500));
  }

  // Final stats
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                         SYNC COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════');

  const finalStats = await sql`
    SELECT
      COUNT(*) as total_items,
      COUNT(DISTINCT grn_id) as grns_with_items,
      SUM(quantity_received) as total_qty
    FROM goods_receipt_items
  `;

  console.log(`Total GRN Items: ${finalStats[0].total_items}`);
  console.log(`GRNs with Items: ${finalStats[0].grns_with_items}`);
  console.log(`Total Qty Received: ${Number(finalStats[0].total_qty || 0).toLocaleString()}`);
  console.log(`Errors: ${totalErrors}`);
}

syncGRNItems().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
