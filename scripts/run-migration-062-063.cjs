/**
 * Migration Runner for 062 and 063
 * - 062_material_catalog_budget_items.sql
 * - 063_fiber_budget_categories.sql
 */
const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

// Production database connection
const DATABASE_URL = 'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require&channel_binding=require';
const sql = neon(DATABASE_URL);

async function runMigration(filename) {
  console.log(`\n${'='.repeat(80)}`);
  console.log(`Running: ${filename}`);
  console.log('='.repeat(80));

  const filePath = path.join(__dirname, 'migrations', filename);
  const content = fs.readFileSync(filePath, 'utf8');

  // Split by semicolons but keep DO blocks together
  // This is a simplified approach - we'll run statement by statement
  const statements = [];
  let currentStatement = '';
  let inDollarBlock = false;

  for (const line of content.split('\n')) {
    const trimmedLine = line.trim();

    // Skip comments
    if (trimmedLine.startsWith('--') && !inDollarBlock) {
      continue;
    }

    // Track $$ blocks
    if (trimmedLine.includes('$$')) {
      const dollarCount = (trimmedLine.match(/\$\$/g) || []).length;
      if (dollarCount % 2 === 1) {
        inDollarBlock = !inDollarBlock;
      }
    }

    currentStatement += line + '\n';

    // End of statement (semicolon outside $$ block)
    if (trimmedLine.endsWith(';') && !inDollarBlock) {
      const stmt = currentStatement.trim();
      if (stmt && !stmt.startsWith('--')) {
        statements.push(stmt);
      }
      currentStatement = '';
    }
  }

  // Run each statement
  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];
    if (!stmt || stmt.length < 5) continue;

    // Extract first meaningful line for display
    const firstLine = stmt.split('\n').find(l => l.trim() && !l.trim().startsWith('--')) || stmt.substring(0, 60);
    const preview = firstLine.substring(0, 80).replace(/\s+/g, ' ').trim();

    try {
      await sql.unsafe(stmt);
      successCount++;
      console.log(`  ✅ [${i + 1}/${statements.length}] ${preview}...`);
    } catch (err) {
      // Some errors are expected (e.g., "already exists")
      if (err.message.includes('already exists') ||
          err.message.includes('does not exist') ||
          err.message.includes('duplicate key')) {
        console.log(`  ⚠️  [${i + 1}/${statements.length}] ${preview}... (${err.message.split('\n')[0]})`);
        successCount++;
      } else {
        console.error(`  ❌ [${i + 1}/${statements.length}] ${preview}...`);
        console.error(`      Error: ${err.message}`);
        errorCount++;
      }
    }
  }

  console.log(`\nResults: ${successCount} succeeded, ${errorCount} failed`);
  return errorCount === 0;
}

async function verifyTables() {
  console.log('\n' + '='.repeat(80));
  console.log('Verifying Tables');
  console.log('='.repeat(80));

  const tables = [
    'material_catalog',
    'material_suppliers',
    'budget_items',
    'material_match_history',
    'boq_category_mapping'
  ];

  for (const table of tables) {
    try {
      const result = await sql`
        SELECT COUNT(*) as count FROM information_schema.tables
        WHERE table_name = ${table}
      `;
      const exists = result[0].count > 0;
      console.log(`  ${exists ? '✅' : '❌'} ${table}: ${exists ? 'exists' : 'NOT FOUND'}`);
    } catch (err) {
      console.log(`  ❌ ${table}: Error checking - ${err.message}`);
    }
  }

  // Check columns added to existing tables
  console.log('\nChecking columns on existing tables:');

  const columnChecks = [
    { table: 'boq_items', column: 'material_catalog_id' },
    { table: 'boq_items', column: 'item_code' },
    { table: 'boq_items', column: 'budget_category_id' },
    { table: 'purchase_order_items', column: 'budget_item_id' },
    { table: 'purchase_order_items', column: 'material_catalog_id' }
  ];

  for (const check of columnChecks) {
    try {
      const result = await sql`
        SELECT COUNT(*) as count FROM information_schema.columns
        WHERE table_name = ${check.table} AND column_name = ${check.column}
      `;
      const exists = result[0].count > 0;
      console.log(`  ${exists ? '✅' : '❌'} ${check.table}.${check.column}: ${exists ? 'exists' : 'NOT FOUND'}`);
    } catch (err) {
      console.log(`  ❌ ${check.table}.${check.column}: Error - ${err.message}`);
    }
  }

  // Check category mappings count
  try {
    const result = await sql`SELECT COUNT(*) as count FROM boq_category_mapping`;
    console.log(`\n  📊 boq_category_mapping: ${result[0].count} mappings`);
  } catch (err) {
    console.log(`\n  ❌ Could not count boq_category_mapping: ${err.message}`);
  }
}

async function main() {
  console.log('🚀 Starting Migrations 062 & 063');
  console.log(`📍 Database: DEV (ep-aged-poetry-a9bbd8e9)`);
  console.log(`⏰ Time: ${new Date().toISOString()}`);

  try {
    // Run migration 062
    const m062 = await runMigration('062_material_catalog_budget_items.sql');

    // Run migration 063
    const m063 = await runMigration('063_fiber_budget_categories.sql');

    // Verify
    await verifyTables();

    console.log('\n' + '='.repeat(80));
    if (m062 && m063) {
      console.log('✅ All migrations completed successfully!');
    } else {
      console.log('⚠️  Migrations completed with some errors (check above)');
    }
    console.log('='.repeat(80));

  } catch (err) {
    console.error('\n❌ Migration failed:', err);
    process.exit(1);
  }
}

main();
