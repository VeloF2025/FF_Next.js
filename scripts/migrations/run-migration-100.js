/**
 * Migration 100: Fix Missing Tables (quotes, warehouses view)
 * Run: node scripts/migrations/run-migration-100.js
 */

const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('❌ DATABASE_URL environment variable is required');
    process.exit(1);
  }

  console.log('🚀 Running Migration 100: Fix Missing Tables');
  console.log('   - Creating quotes table');
  console.log('   - Creating quote_items table');
  console.log('   - Creating warehouses view');
  console.log('   - Fixing stock_levels FK');
  console.log('');

  const sql = neon(databaseUrl);

  try {
    // Read the migration SQL
    const migrationPath = path.join(__dirname, '100_fix_missing_tables.sql');
    const migrationSql = fs.readFileSync(migrationPath, 'utf8');

    // Split by semicolons and filter out empty statements
    const statements = migrationSql
      .split(/;(?=(?:[^']*'[^']*')*[^']*$)/) // Split on ; but not inside quotes
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    console.log(`📝 Executing ${statements.length} statements...\n`);

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];

      // Skip empty or comment-only statements
      if (!statement || statement.startsWith('--')) continue;

      try {
        await sql.transaction(async (tx) => {
          await tx.unsafe(statement);
        });

        // Log progress for key statements
        if (statement.includes('CREATE TABLE IF NOT EXISTS quotes')) {
          console.log('✅ Created quotes table');
        } else if (statement.includes('CREATE TABLE IF NOT EXISTS quote_items')) {
          console.log('✅ Created quote_items table');
        } else if (statement.includes('CREATE OR REPLACE VIEW warehouses')) {
          console.log('✅ Created warehouses view');
        } else if (statement.includes('generate_quote_number')) {
          console.log('✅ Created quote number generator');
        } else if (statement.includes('create_quote_from_rfq_response')) {
          console.log('✅ Created RFQ response to quote function');
        }
      } catch (err) {
        // Ignore "already exists" errors
        if (err.message?.includes('already exists') ||
            err.message?.includes('duplicate key')) {
          console.log(`⚠️  Skipped (already exists): ${statement.substring(0, 50)}...`);
        } else {
          console.error(`❌ Error executing statement ${i + 1}:`);
          console.error(`   Statement: ${statement.substring(0, 100)}...`);
          console.error(`   Error: ${err.message}`);
        }
      }
    }

    // Verify the migration
    console.log('\n🔍 Verifying migration...');

    const quotesCheck = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'quotes'
      ) as exists
    `;

    const quoteItemsCheck = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'quote_items'
      ) as exists
    `;

    const warehousesCheck = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.views
        WHERE table_name = 'warehouses'
      ) as exists
    `;

    console.log(`   quotes table: ${quotesCheck[0].exists ? '✅' : '❌'}`);
    console.log(`   quote_items table: ${quoteItemsCheck[0].exists ? '✅' : '❌'}`);
    console.log(`   warehouses view: ${warehousesCheck[0].exists ? '✅' : '❌'}`);

    if (quotesCheck[0].exists && quoteItemsCheck[0].exists && warehousesCheck[0].exists) {
      console.log('\n✅ Migration 100 completed successfully!');
    } else {
      console.log('\n⚠️  Migration completed with some missing objects');
    }

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  }
}

runMigration();
