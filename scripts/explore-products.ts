import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { OdooClient } from '../src/services/odoo/odooClient';

const sql = neon(process.env.DATABASE_URL!);

const ODOO_CONFIG = {
  url: 'https://velocityfibre.odoo.com',
  db: 'velocityfibre',
  username: 'jacques@velocityfibre.co.za',
  password: 'Ledene9685@',
};

async function explore() {
  console.log('=== FIBREFLOW PRODUCT/MATERIAL TABLES ===\n');

  // Check stock_items
  const stockItemsCols = await sql`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'stock_items'
    ORDER BY ordinal_position
  `;
  if (stockItemsCols.length > 0) {
    console.log('stock_items columns:');
    for (const c of stockItemsCols) {
      console.log('  -', c.column_name + ':', c.data_type);
    }
    const stockCount = await sql`SELECT COUNT(*) as count FROM stock_items`;
    console.log('  Total records:', stockCount[0].count);
  }

  // Check material_catalog
  const materialCols = await sql`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'material_catalog'
    ORDER BY ordinal_position
  `;
  if (materialCols.length > 0) {
    console.log('\nmaterial_catalog columns:');
    for (const c of materialCols) {
      console.log('  -', c.column_name + ':', c.data_type);
    }
    const materialCount = await sql`SELECT COUNT(*) as count FROM material_catalog`;
    console.log('  Total records:', materialCount[0].count);
  }

  console.log('\n=== ODOO PRODUCTS ===\n');

  const client = new OdooClient(ODOO_CONFIG);
  await client.testConnection();

  // Get product categories
  const categories = await client.searchRead<{
    id: number;
    name: string;
    complete_name: string;
  }>('product.category', {
    fields: ['id', 'name', 'complete_name'],
    limit: 50,
  });
  console.log('Product Categories:', categories.length);
  for (const cat of categories.slice(0, 10)) {
    console.log('  -', `[${cat.id}]`, cat.complete_name);
  }
  if (categories.length > 10) {
    console.log('  ... and', categories.length - 10, 'more');
  }

  // Get products
  const products = await client.searchRead<{
    id: number;
    name: string;
    default_code: string | false;
    type: string;
    categ_id: [number, string] | false;
    uom_id: [number, string] | false;
    list_price: number;
    standard_price: number;
  }>('product.product', {
    fields: ['id', 'name', 'default_code', 'type', 'categ_id', 'uom_id', 'list_price', 'standard_price'],
    limit: 200,
  });

  console.log('\nProducts:', products.length);
  const byCategory = new Map<string, number>();
  for (const p of products) {
    const cat = p.categ_id ? p.categ_id[1] : 'Uncategorized';
    byCategory.set(cat, (byCategory.get(cat) || 0) + 1);
  }

  console.log('\nBy category:');
  for (const [cat, count] of Array.from(byCategory.entries()).sort((a, b) => b[1] - a[1])) {
    console.log('  -', cat + ':', count);
  }

  console.log('\nSample products:');
  for (const p of products.slice(0, 10)) {
    console.log('  -', `[${p.id}]`, p.default_code || 'N/A', '-', p.name.substring(0, 50));
  }

  // Check stock.picking (transfers/deliveries)
  console.log('\n=== ODOO STOCK TRANSFERS ===\n');

  const pickings = await client.searchRead<{
    id: number;
    name: string;
    state: string;
    picking_type_id: [number, string] | false;
    scheduled_date: string;
    partner_id: [number, string] | false;
  }>('stock.picking', {
    fields: ['id', 'name', 'state', 'picking_type_id', 'scheduled_date', 'partner_id'],
    limit: 100,
  });

  console.log('Stock Pickings:', pickings.length);

  const byState = new Map<string, number>();
  const byType = new Map<string, number>();
  for (const p of pickings) {
    byState.set(p.state, (byState.get(p.state) || 0) + 1);
    const type = p.picking_type_id ? p.picking_type_id[1] : 'Unknown';
    byType.set(type, (byType.get(type) || 0) + 1);
  }

  console.log('\nBy state:');
  for (const [state, count] of byState) {
    console.log('  -', state + ':', count);
  }

  console.log('\nBy type:');
  for (const [type, count] of byType) {
    console.log('  -', type + ':', count);
  }

  console.log('\nPending transfers (assigned):');
  const pending = pickings.filter(p => p.state === 'assigned');
  for (const p of pending.slice(0, 10)) {
    console.log('  -', `[${p.id}]`, p.name, '-', p.picking_type_id?.[1] || 'N/A');
  }
}

explore().catch(console.error);
