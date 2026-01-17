import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL!);

async function summary() {
  console.log('===================================================================');
  console.log('                    STOCK ITEMS SUMMARY                            ');
  console.log('===================================================================\n');

  // Stock items summary
  const items = await sql`
    SELECT COUNT(*) as total,
           COUNT(odoo_product_id) as from_odoo,
           SUM(qty_available) as total_stock
    FROM stock_items
  `;
  console.log('TOTALS:');
  console.log('  Total stock items:', items[0].total);
  console.log('  Synced from Odoo:', items[0].from_odoo);
  console.log('  Total Stock Qty:', Math.round(Number(items[0].total_stock || 0)).toLocaleString());

  // By category
  const byCat = await sql`
    SELECT category, COUNT(*) as count, SUM(qty_available) as stock
    FROM stock_items
    WHERE odoo_product_id IS NOT NULL
    GROUP BY category
    ORDER BY count DESC
  `;
  console.log('\nBY CATEGORY:');
  for (const c of byCat) {
    const stock = Math.round(Number(c.stock || 0)).toLocaleString();
    console.log(`  ${c.category}: ${c.count} items, ${stock} in stock`);
  }

  // Items with stock
  const withStock = await sql`
    SELECT item_code, category, qty_available, standard_cost
    FROM stock_items
    WHERE qty_available > 0
    ORDER BY qty_available DESC
    LIMIT 15
  `;
  console.log('\nTOP 15 BY STOCK LEVEL:');
  for (const i of withStock) {
    const cost = i.standard_cost ? 'R' + Number(i.standard_cost).toFixed(2) : 'N/A';
    const qty = Math.round(Number(i.qty_available)).toLocaleString();
    console.log(`  ${i.item_code.substring(0, 35).padEnd(35)} ${qty.padStart(10)} (${cost})`);
  }

  // Value summary
  const value = await sql`
    SELECT SUM(qty_available * COALESCE(standard_cost, 0)) as total_value
    FROM stock_items
    WHERE qty_available > 0
  `;
  const totalValue = Number(value[0].total_value || 0);
  console.log('\nTOTAL STOCK VALUE: R', totalValue.toLocaleString('en-ZA', { minimumFractionDigits: 2 }));
}

summary().catch(console.error);
