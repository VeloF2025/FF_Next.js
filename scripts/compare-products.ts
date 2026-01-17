/**
 * Compare Products/Materials between Odoo and FibreFlow
 */

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

interface OdooProduct {
  id: number;
  name: string;
  default_code: string | false;
  type: string;
  categ_id: [number, string] | false;
  uom_id: [number, string] | false;
  list_price: number;
  standard_price: number;
  qty_available: number;
  virtual_available: number;
  purchase_ok: boolean;
  sale_ok: boolean;
}

async function compare() {
  console.log('===================================================================');
  console.log('         ODOO vs FIBREFLOW PRODUCT/MATERIAL COMPARISON            ');
  console.log('===================================================================\n');

  // =========================================================================
  // FIBREFLOW DATA
  // =========================================================================
  console.log('=== FIBREFLOW MATERIALS ===\n');

  // Material Catalog
  const ffMaterials = await sql<{
    id: string;
    item_code: string;
    description: string;
    category: string;
    budget_category: string;
    uom: string;
    standard_rate: number;
  }[]>`
    SELECT id, item_code, description, category, budget_category, uom, standard_rate
    FROM material_catalog
    ORDER BY category, item_code
  `;

  console.log('Material Catalog:', ffMaterials.length, 'items');

  // Group by category
  const ffByCategory = new Map<string, typeof ffMaterials>();
  for (const m of ffMaterials) {
    const cat = m.category || 'Uncategorized';
    if (!ffByCategory.has(cat)) ffByCategory.set(cat, []);
    ffByCategory.get(cat)!.push(m);
  }

  console.log('\nBy Category:');
  for (const [cat, items] of Array.from(ffByCategory.entries()).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${cat}: ${items.length}`);
  }

  // Stock Items
  const ffStockItems = await sql<{
    id: string;
    item_code: string;
    name: string;
    category: string;
    uom: string;
    standard_cost: number;
  }[]>`
    SELECT id, item_code, name, category, uom, standard_cost
    FROM stock_items
    ORDER BY category, item_code
  `;

  console.log('\nStock Items:', ffStockItems.length, 'items');
  for (const item of ffStockItems) {
    console.log(`  - [${item.item_code}] ${item.name} (${item.category})`);
  }

  // =========================================================================
  // ODOO DATA
  // =========================================================================
  console.log('\n=== ODOO PRODUCTS ===\n');

  const client = new OdooClient(ODOO_CONFIG);
  await client.testConnection();

  // Get ALL products (not just 200)
  const odooProducts = await client.searchRead<OdooProduct>('product.product', {
    fields: [
      'id', 'name', 'default_code', 'type', 'categ_id', 'uom_id',
      'list_price', 'standard_price', 'qty_available', 'virtual_available',
      'purchase_ok', 'sale_ok',
    ],
    limit: 1000,
  });

  console.log('Total Products:', odooProducts.length);

  // Filter purchasable products
  const purchasable = odooProducts.filter(p => p.purchase_ok);
  console.log('Purchasable (purchase_ok=true):', purchasable.length);

  // Group by category
  const odooByCategory = new Map<string, OdooProduct[]>();
  for (const p of odooProducts) {
    const cat = p.categ_id ? p.categ_id[1] : 'Uncategorized';
    if (!odooByCategory.has(cat)) odooByCategory.set(cat, []);
    odooByCategory.get(cat)!.push(p);
  }

  console.log('\nBy Category:');
  for (const [cat, items] of Array.from(odooByCategory.entries()).sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${cat}: ${items.length}`);
  }

  // Group by type
  const byType = new Map<string, number>();
  for (const p of odooProducts) {
    byType.set(p.type, (byType.get(p.type) || 0) + 1);
  }
  console.log('\nBy Type:');
  for (const [type, count] of byType) {
    console.log(`  ${type}: ${count}`);
  }

  // Products with stock
  const withStock = odooProducts.filter(p => p.qty_available > 0);
  console.log('\nWith Current Stock:', withStock.length);

  // Products with item codes
  const withCodes = odooProducts.filter(p => p.default_code && p.default_code !== 'N/A');
  console.log('With Item Codes:', withCodes.length);

  // =========================================================================
  // DETAILED CATEGORY BREAKDOWN
  // =========================================================================
  console.log('\n===================================================================');
  console.log('                    ODOO PRODUCTS BY CATEGORY                      ');
  console.log('===================================================================\n');

  for (const [cat, items] of Array.from(odooByCategory.entries()).sort((a, b) => a[0].localeCompare(b[0]))) {
    console.log(`\n--- ${cat} (${items.length} items) ---`);

    // Show items with stock first
    const sorted = [...items].sort((a, b) => b.qty_available - a.qty_available);

    for (const p of sorted.slice(0, 15)) {
      const code = p.default_code && p.default_code !== 'N/A' ? `[${p.default_code}]` : '';
      const stock = p.qty_available > 0 ? ` (Stock: ${p.qty_available})` : '';
      const price = p.standard_price > 0 ? ` R${p.standard_price.toFixed(2)}` : '';
      console.log(`  ${code} ${p.name.substring(0, 60)}${stock}${price}`);
    }
    if (items.length > 15) {
      console.log(`  ... and ${items.length - 15} more`);
    }
  }

  // =========================================================================
  // MATCHING ANALYSIS
  // =========================================================================
  console.log('\n===================================================================');
  console.log('                      MATCHING ANALYSIS                            ');
  console.log('===================================================================\n');

  // Try to match Odoo products to FF materials by name similarity
  const matches: Array<{
    odoo: OdooProduct;
    ff: typeof ffMaterials[0] | null;
    matchType: string;
  }> = [];

  for (const odooP of odooProducts) {
    const odooName = odooP.name.toLowerCase();
    const odooCode = (odooP.default_code || '').toLowerCase();

    // Try exact code match
    let ffMatch = ffMaterials.find(m =>
      m.item_code && m.item_code.toLowerCase() === odooCode && odooCode !== 'n/a'
    );

    if (ffMatch) {
      matches.push({ odoo: odooP, ff: ffMatch, matchType: 'code' });
      continue;
    }

    // Try name contains
    ffMatch = ffMaterials.find(m =>
      m.description && (
        m.description.toLowerCase().includes(odooName) ||
        odooName.includes(m.description.toLowerCase())
      )
    );

    if (ffMatch) {
      matches.push({ odoo: odooP, ff: ffMatch, matchType: 'name' });
    } else {
      matches.push({ odoo: odooP, ff: null, matchType: 'none' });
    }
  }

  const exactMatches = matches.filter(m => m.matchType === 'code');
  const nameMatches = matches.filter(m => m.matchType === 'name');
  const noMatches = matches.filter(m => m.matchType === 'none');

  console.log('Match Results:');
  console.log('  Exact code matches:', exactMatches.length);
  console.log('  Name similarity matches:', nameMatches.length);
  console.log('  No match (Odoo only):', noMatches.length);

  if (nameMatches.length > 0) {
    console.log('\nSample Name Matches:');
    for (const m of nameMatches.slice(0, 10)) {
      console.log(`  Odoo: "${m.odoo.name}"`);
      console.log(`  FF:   "${m.ff?.description}"`);
      console.log('');
    }
  }

  // Products in Odoo with stock but not in FF
  const odooOnlyWithStock = noMatches.filter(m => m.odoo.qty_available > 0);
  if (odooOnlyWithStock.length > 0) {
    console.log('\n--- ODOO PRODUCTS WITH STOCK (Not in FF) ---');
    console.log('These are actively used in procurement:\n');
    for (const m of odooOnlyWithStock.sort((a, b) => b.odoo.qty_available - a.odoo.qty_available)) {
      const cat = m.odoo.categ_id ? m.odoo.categ_id[1] : 'N/A';
      console.log(`  [${m.odoo.id}] ${m.odoo.name}`);
      console.log(`       Category: ${cat}, Stock: ${m.odoo.qty_available}, Cost: R${m.odoo.standard_price.toFixed(2)}`);
    }
  }

  // =========================================================================
  // RECOMMENDATIONS
  // =========================================================================
  console.log('\n===================================================================');
  console.log('                      RECOMMENDATIONS                              ');
  console.log('===================================================================\n');

  console.log('1. ODOO AS SOURCE OF TRUTH FOR PROCUREMENT:');
  console.log(`   - ${odooProducts.length} products in Odoo (vs ${ffMaterials.length} in FF material_catalog)`);
  console.log(`   - ${withStock.length} products have current stock levels`);
  console.log(`   - ${purchasable.length} are marked as purchasable`);

  console.log('\n2. CATEGORY MAPPING:');
  console.log('   Odoo Categories → FF Budget Categories:');
  console.log('   - Activations → Activations');
  console.log('   - Backhaul → Backhaul');
  console.log('   - Optical → Optical');
  console.log('   - Poles → Poles');
  console.log('   - Stringing → Stringing');
  console.log('   - FiberTime → FiberTime');

  console.log('\n3. DATA QUALITY:');
  const withValidCodes = odooProducts.filter(p => p.default_code && p.default_code !== 'N/A' && p.default_code.length > 2);
  console.log(`   - Products with valid item codes: ${withValidCodes.length}/${odooProducts.length}`);
  console.log(`   - Products with pricing: ${odooProducts.filter(p => p.standard_price > 0).length}/${odooProducts.length}`);
  console.log(`   - Products with UOM: ${odooProducts.filter(p => p.uom_id).length}/${odooProducts.length}`);

  console.log('\n4. SUGGESTED ACTION:');
  console.log('   Option A: Sync Odoo products to FF stock_items (for inventory tracking)');
  console.log('   Option B: Sync Odoo products to FF material_catalog (for BOQ matching)');
  console.log('   Option C: Create new unified product table with Odoo as primary source');
}

compare().catch(console.error);
