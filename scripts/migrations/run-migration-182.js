/**
 * Run Migration 182: Procurement Audit Trail
 *
 * Creates audit_logs, fault_reports tables and alters
 * stock_locations, stock_serials, stock_movements for
 * audit trail / state machine / reversal support.
 *
 * Usage:
 *   node scripts/migrations/run-migration-182.js
 *
 * Requires DATABASE_URL environment variable.
 */

const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const sqlFile = path.join(__dirname, '182_procurement_audit_trail.sql');
  if (!fs.existsSync(sqlFile)) {
    console.error(`ERROR: Migration file not found: ${sqlFile}`);
    process.exit(1);
  }

  console.log('\n========================================');
  console.log('Migration 182: Procurement Audit Trail');
  console.log('========================================\n');

  const sql = neon(dbUrl);
  const migrationSql = fs.readFileSync(sqlFile, 'utf8');

  // Split by semicolons, respecting $$ blocks
  const statements = [];
  let currentStatement = '';
  let inDollarQuote = false;

  for (const line of migrationSql.split('\n')) {
    const dollarMatches = (line.match(/\$\$/g) || []).length;
    if (dollarMatches % 2 === 1) {
      inDollarQuote = !inDollarQuote;
    }

    currentStatement += line + '\n';

    if (line.trim().endsWith(';') && !inDollarQuote) {
      const stmt = currentStatement.trim();
      if (stmt && !stmt.startsWith('--')) {
        statements.push(stmt);
      }
      currentStatement = '';
    }
  }

  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  for (const stmt of statements) {
    if (!stmt || stmt.startsWith('--')) continue;

    try {
      await sql.unsafe(stmt);
      successCount++;
    } catch (err) {
      if (
        err.message.includes('already exists') ||
        err.message.includes('duplicate key') ||
        err.message.includes('does nothing')
      ) {
        skipCount++;
      } else {
        errorCount++;
        console.log(`  WARNING: ${err.message.substring(0, 120)}`);
      }
    }
  }

  console.log(`Completed: ${successCount} succeeded, ${skipCount} skipped, ${errorCount} errors\n`);

  // Verify new tables
  console.log('Verifying tables...\n');
  const tables = ['audit_logs', 'fault_reports'];

  for (const table of tables) {
    try {
      const result = await sql`
        SELECT COUNT(*) as count
        FROM information_schema.tables
        WHERE table_schema = 'public'
        AND table_name = ${table}
      `;
      if (result[0].count > 0) {
        console.log(`  OK: ${table}`);
      } else {
        console.log(`  MISSING: ${table}`);
      }
    } catch (err) {
      console.log(`  ERROR: ${table} - ${err.message}`);
    }
  }

  // Verify new columns
  console.log('\nVerifying new columns...\n');
  const columns = [
    { table: 'stock_locations', column: 'bin_type' },
    { table: 'stock_serials', column: 'previous_status' },
    { table: 'stock_serials', column: 'status_changed_at' },
    { table: 'stock_serials', column: 'status_changed_by' },
    { table: 'stock_serials', column: 'fault_report_id' },
    { table: 'stock_movements', column: 'is_reversed' },
    { table: 'stock_movements', column: 'original_movement_id' },
  ];

  for (const { table, column } of columns) {
    try {
      const result = await sql`
        SELECT COUNT(*) as count
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = ${table}
        AND column_name = ${column}
      `;
      if (result[0].count > 0) {
        console.log(`  OK: ${table}.${column}`);
      } else {
        console.log(`  MISSING: ${table}.${column}`);
      }
    } catch (err) {
      console.log(`  ERROR: ${table}.${column} - ${err.message}`);
    }
  }

  console.log('\n========================================');
  console.log('Migration 182 Complete');
  console.log('========================================\n');
}

runMigration().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
