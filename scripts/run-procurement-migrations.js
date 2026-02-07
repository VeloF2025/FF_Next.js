/**
 * Run Procurement Portal Migrations (Phase 1)
 * PRD-050: Comprehensive Procurement Portal
 *
 * Usage:
 *   node scripts/run-procurement-migrations.js [--prod]
 *
 * By default runs on DEV database. Use --prod flag for production.
 */

const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

// Database URLs
const DEV_DATABASE_URL = 'process.env.DATABASE_URL';
const PROD_DATABASE_URL = 'process.env.DATABASE_URL';

// Migration files in order
const MIGRATIONS = [
  '049_purchase_requisitions.sql',
  '050_purchase_orders.sql',
  '051_goods_receipt_notes.sql',
  '052_approval_workflows.sql'
];

async function runMigrations() {
  const isProd = process.argv.includes('--prod');
  const dbUrl = isProd ? PROD_DATABASE_URL : DEV_DATABASE_URL;
  const dbName = isProd ? 'PRODUCTION' : 'DEVELOPMENT';

  console.log(`\n========================================`);
  console.log(`PRD-050: Procurement Portal Migrations`);
  console.log(`========================================`);
  console.log(`Database: ${dbName}`);
  console.log(`Migrations: ${MIGRATIONS.length}`);
  console.log(`========================================\n`);

  if (isProd) {
    console.log('⚠️  WARNING: Running on PRODUCTION database!');
    console.log('    Press Ctrl+C within 5 seconds to cancel...\n');
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  const sql = neon(dbUrl);

  for (const migrationFile of MIGRATIONS) {
    const filePath = path.join(__dirname, 'migrations', migrationFile);

    if (!fs.existsSync(filePath)) {
      console.log(`❌ File not found: ${migrationFile}`);
      continue;
    }

    console.log(`📄 Running: ${migrationFile}`);

    try {
      const migrationSql = fs.readFileSync(filePath, 'utf8');

      // Split by semicolons but handle function definitions with $$ blocks
      const statements = [];
      let currentStatement = '';
      let inDollarQuote = false;

      for (const line of migrationSql.split('\n')) {
        // Check for $$ blocks
        const dollarMatches = (line.match(/\$\$/g) || []).length;
        if (dollarMatches % 2 === 1) {
          inDollarQuote = !inDollarQuote;
        }

        currentStatement += line + '\n';

        // If we hit a semicolon and we're not in a $$ block
        if (line.trim().endsWith(';') && !inDollarQuote) {
          const stmt = currentStatement.trim();
          if (stmt && !stmt.startsWith('--')) {
            statements.push(stmt);
          }
          currentStatement = '';
        }
      }

      // Execute each statement
      let successCount = 0;
      let skipCount = 0;

      for (const stmt of statements) {
        // Skip empty statements and comments
        if (!stmt || stmt.startsWith('--')) continue;

        try {
          await sql.unsafe(stmt);
          successCount++;
        } catch (err) {
          // Check if it's a "already exists" type error
          if (err.message.includes('already exists') ||
              err.message.includes('duplicate key') ||
              err.message.includes('does nothing')) {
            skipCount++;
          } else {
            console.log(`   ⚠️  Warning: ${err.message.substring(0, 100)}`);
          }
        }
      }

      console.log(`   ✅ Completed: ${successCount} statements, ${skipCount} skipped\n`);

    } catch (err) {
      console.log(`   ❌ Error: ${err.message}\n`);
    }
  }

  // Verify tables exist
  console.log(`\n========================================`);
  console.log(`Verifying Tables...`);
  console.log(`========================================\n`);

  const tables = [
    'purchase_requisitions',
    'purchase_requisition_items',
    'purchase_orders',
    'purchase_order_items',
    'goods_receipt_notes',
    'goods_receipt_items',
    'approval_workflows',
    'approval_levels',
    'approval_requests',
    'approval_history'
  ];

  for (const table of tables) {
    try {
      const result = await sql`
        SELECT COUNT(*) as count
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = ${table}
      `;

      if (result[0].count > 0) {
        console.log(`   ✅ ${table}`);
      } else {
        console.log(`   ❌ ${table} - NOT FOUND`);
      }
    } catch (err) {
      console.log(`   ❌ ${table} - Error: ${err.message}`);
    }
  }

  console.log(`\n========================================`);
  console.log(`Migration Complete!`);
  console.log(`========================================\n`);
}

runMigrations().catch(console.error);
