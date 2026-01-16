/**
 * Test Lawley BOQ Import
 * Run this script to test the enhanced BOQ import with the Lawley BOQ file
 *
 * Usage: node scripts/test-lawley-boq-import.cjs
 */

const { neon } = require('@neondatabase/serverless');
const XLSX = require('xlsx');
const path = require('path');

// Production database connection
const DATABASE_URL = 'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require&channel_binding=require';

// BOQ file path
const BOQ_FILE = '/home/hein/Downloads/LAW.01-00.798038.BoQ.20250417.V01 BOQ.xlsx';

// Test project ID - you may need to update this with an actual project ID
const TEST_PROJECT_ID = null; // Will be created if null

async function main() {
  console.log('🚀 Testing Lawley BOQ Import');
  console.log('=' .repeat(80));
  console.log(`📁 BOQ File: ${BOQ_FILE}`);
  console.log(`📍 Database: DEV (ep-aged-poetry-a9bbd8e9)`);
  console.log(`⏰ Time: ${new Date().toISOString()}`);

  const sql = neon(DATABASE_URL);

  try {
    // Step 1: Verify tables exist
    console.log('\n1️⃣ Verifying tables...');
    const tables = ['material_catalog', 'material_suppliers', 'budget_items', 'boq_category_mapping'];
    for (const table of tables) {
      const result = await sql`
        SELECT COUNT(*) as count FROM information_schema.tables
        WHERE table_name = ${table}
      `;
      console.log(`  ${result[0].count > 0 ? '✅' : '❌'} ${table}`);
    }

    // Step 2: Check category mappings
    console.log('\n2️⃣ Checking category mappings...');
    const mappings = await sql`SELECT COUNT(*) as count FROM boq_category_mapping`;
    console.log(`  📊 ${mappings[0].count} category mappings loaded`);

    if (parseInt(mappings[0].count) === 0) {
      console.log('  ⚠️  No mappings found - need to run migration 063');
      return;
    }

    // Step 3: Parse the BOQ file
    console.log('\n3️⃣ Parsing BOQ file...');
    const workbook = XLSX.readFile(BOQ_FILE);
    const worksheet = workbook.Sheets['Master Material List'];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });

    // Find header row
    let headerRow = 2;
    for (let i = 0; i < Math.min(10, data.length); i++) {
      const row = data[i];
      if (row && Array.isArray(row)) {
        const rowStr = row.join(' ').toLowerCase();
        if (rowStr.includes('item') && rowStr.includes('description')) {
          headerRow = i;
          break;
        }
      }
    }

    // Parse rows
    const rows = [];
    for (let i = headerRow + 1; i < data.length; i++) {
      const row = data[i];
      if (!row || row.length === 0) continue;

      const nonEmptyCells = row.filter(cell => cell !== '' && cell !== null && cell !== undefined);
      if (nonEmptyCells.length <= 1) continue;

      if (row[3] && String(row[3]).trim()) {
        rows.push({
          itemNo: typeof row[0] === 'number' ? row[0] : null,
          uom: String(row[1] || ''),
          itemCategory: String(row[2] || ''),
          description: String(row[3] || ''),
          quantity: typeof row[4] === 'number' ? row[4] : 0,
          itemCode: String(row[5] || ''),
          itemRate: typeof row[6] === 'number' ? row[6] : 0,
          photonicsRef: String(row[7] || ''),
          supplier: String(row[8] || ''),
          leadTime: String(row[9] || ''),
          totalCost: typeof row[10] === 'number' ? row[10] : 0,
        });
      }
    }

    console.log(`  📦 Found ${rows.length} items in BOQ`);

    // Filter items with quantities
    const itemsWithQty = rows.filter(r => r.quantity > 0);
    console.log(`  📦 ${itemsWithQty.length} items with quantities`);

    // Calculate total
    const totalValue = rows.reduce((sum, r) => sum + (r.quantity || 0) * (r.itemRate || 0), 0);
    console.log(`  💰 Total BOQ value: R${totalValue.toLocaleString('en-ZA', { minimumFractionDigits: 2 })}`);

    // Step 4: Test category mapping
    console.log('\n4️⃣ Testing category mapping...');
    const categories = [...new Set(rows.map(r => r.itemCategory).filter(c => c))];
    console.log(`  📂 ${categories.length} unique categories in BOQ`);

    let mappedCount = 0;
    let unmappedCategories = [];

    for (const category of categories) {
      const result = await sql`
        SELECT budget_category_code
        FROM boq_category_mapping
        WHERE LOWER(boq_category) = LOWER(${category})
        LIMIT 1
      `;

      if (result.length > 0) {
        mappedCount++;
      } else {
        unmappedCategories.push(category);
      }
    }

    console.log(`  ✅ ${mappedCount} categories mapped`);
    console.log(`  ⚠️  ${unmappedCategories.length} categories unmapped`);

    if (unmappedCategories.length > 0 && unmappedCategories.length <= 10) {
      console.log('  Unmapped categories:');
      unmappedCategories.forEach(c => console.log(`    - ${c}`));
    }

    // Step 5: Test function to map category
    console.log('\n5️⃣ Testing map_boq_to_budget_category function...');
    const testCategories = ['Drop Cable (Connectorised)', 'Poles (Creosote)', 'Cement Bag', 'Some Unknown Category'];

    for (const testCat of testCategories) {
      const result = await sql`SELECT map_boq_to_budget_category(${testCat}) as code`;
      console.log(`  "${testCat}" -> ${result[0].code}`);
    }

    // Step 6: Summarize by budget category
    console.log('\n6️⃣ BOQ Summary by Budget Category (estimated):');

    const categoryTotals = new Map();
    for (const row of rows) {
      const result = await sql`SELECT map_boq_to_budget_category(${row.itemCategory || ''}) as code`;
      const code = result[0].code;
      const amount = (row.quantity || 0) * (row.itemRate || 0);

      if (!categoryTotals.has(code)) {
        categoryTotals.set(code, { count: 0, amount: 0 });
      }
      const cat = categoryTotals.get(code);
      cat.count++;
      cat.amount += amount;
    }

    const sorted = [...categoryTotals.entries()].sort((a, b) => b[1].amount - a[1].amount);
    console.log('');
    console.log('  ' + '-'.repeat(70));
    console.log('  | Category'.padEnd(22) + '| Items'.padEnd(10) + '| Amount'.padEnd(25) + '|');
    console.log('  ' + '-'.repeat(70));
    for (const [code, data] of sorted) {
      const amountStr = 'R' + data.amount.toLocaleString('en-ZA', { minimumFractionDigits: 2 });
      console.log(`  | ${code.padEnd(20)}| ${String(data.count).padEnd(8)}| ${amountStr.padEnd(23)}|`);
    }
    console.log('  ' + '-'.repeat(70));
    const totalAmount = [...categoryTotals.values()].reduce((sum, d) => sum + d.amount, 0);
    const totalItems = [...categoryTotals.values()].reduce((sum, d) => sum + d.count, 0);
    console.log(`  | ${'TOTAL'.padEnd(20)}| ${String(totalItems).padEnd(8)}| ${'R' + totalAmount.toLocaleString('en-ZA', { minimumFractionDigits: 2 }).padEnd(22)}|`);
    console.log('  ' + '-'.repeat(70));

    console.log('\n' + '='.repeat(80));
    console.log('✅ Test completed successfully!');
    console.log('');
    console.log('To run the full import, use the API endpoint:');
    console.log('  POST /api/procurement/boq/import-enhanced');
    console.log('  with FormData containing: file, projectId');
    console.log('='.repeat(80));

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();
