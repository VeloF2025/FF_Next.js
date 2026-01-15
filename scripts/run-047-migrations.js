/**
 * Migration Runner: PRD-047 Project Import System
 *
 * Runs the following migrations:
 * - 047a: Add missing columns to sow_drops
 * - 047b: Standardize sow_fibre columns
 * - 047c: Add unique constraints for upsert
 *
 * Usage:
 *   DATABASE_URL='...' node scripts/run-047-migrations.js
 *
 * Or with environment:
 *   node scripts/run-047-migrations.js --env=dev|prod
 */

const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

// Database configurations
const DB_CONFIGS = {
  dev: 'postgresql://neondb_owner:npg_aRNLhZc1G2CD@ep-aged-poetry-a9bbd8e9.gwc.azure.neon.tech/neondb?sslmode=require',
  prod: 'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require'
};

// Migration files in order
const MIGRATIONS = [
  '047a_sow_drops_missing_columns.sql',
  '047b_sow_fibre_standardize.sql',
  '047c_sow_unique_constraints.sql'
];

async function runMigration(sql, migrationFile) {
  const filePath = path.join(__dirname, 'migrations', migrationFile);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Migration file not found: ${filePath}`);
  }

  const migrationSql = fs.readFileSync(filePath, 'utf8');

  console.log(`\n📄 Running: ${migrationFile}`);
  console.log('─'.repeat(50));

  // Split by semicolon but handle DO blocks properly
  const statements = splitSqlStatements(migrationSql);

  for (const statement of statements) {
    const trimmed = statement.trim();
    if (!trimmed || trimmed.startsWith('--')) continue;

    try {
      await sql.unsafe(trimmed);
      // Show first 60 chars of statement
      const preview = trimmed.replace(/\s+/g, ' ').substring(0, 60);
      console.log(`  ✓ ${preview}...`);
    } catch (error) {
      // Some errors are expected (IF NOT EXISTS, etc)
      if (error.message.includes('already exists')) {
        console.log(`  ⏭ Skipped (already exists)`);
      } else if (error.message.includes('does not exist')) {
        console.log(`  ⏭ Skipped (does not exist)`);
      } else {
        throw error;
      }
    }
  }

  console.log(`✅ Completed: ${migrationFile}`);
}

function splitSqlStatements(sql) {
  // Handle DO $$ blocks specially
  const statements = [];
  let current = '';
  let inDoBlock = false;

  const lines = sql.split('\n');

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Skip comment-only lines at statement boundaries
    if (!current.trim() && trimmedLine.startsWith('--')) {
      continue;
    }

    current += line + '\n';

    // Track DO blocks
    if (trimmedLine.startsWith('DO $$') || trimmedLine.startsWith('DO $')) {
      inDoBlock = true;
    }

    if (inDoBlock && (trimmedLine === '$$;' || trimmedLine.endsWith('$$ ;') || trimmedLine.endsWith('$$;'))) {
      inDoBlock = false;
      statements.push(current.trim());
      current = '';
      continue;
    }

    // Regular statement end (not in DO block)
    if (!inDoBlock && trimmedLine.endsWith(';') && !trimmedLine.startsWith('--')) {
      statements.push(current.trim());
      current = '';
    }
  }

  // Add any remaining content
  if (current.trim()) {
    statements.push(current.trim());
  }

  return statements;
}

async function verifySchema(sql) {
  console.log('\n🔍 Verifying Schema Changes');
  console.log('═'.repeat(50));

  // Check drops columns
  const dropsColumns = await sql`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'drops'
    ORDER BY ordinal_position
  `;

  console.log('\n📋 drops table - new columns:');
  const expectedDropsCols = ['cable_type', 'cable_spec', 'cable_capacity', 'start_point', 'end_point', 'municipality', 'pon_no', 'zone_no', 'raw_data'];
  const dropsColNames = dropsColumns.map(c => c.column_name);

  for (const col of expectedDropsCols) {
    const exists = dropsColNames.includes(col);
    console.log(`  ${exists ? '✓' : '✗'} ${col}`);
  }

  // Check fibre_segments columns
  const fibreColumns = await sql`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_name = 'fibre_segments'
    ORDER BY ordinal_position
  `;

  console.log('\n📋 fibre_segments table - new columns:');
  const expectedFibreCols = ['segment_id', 'cable_size', 'layer', 'pon_no', 'zone_no', 'string_completed', 'is_complete', 'raw_data'];
  const fibreColNames = fibreColumns.map(c => c.column_name);

  for (const col of expectedFibreCols) {
    const exists = fibreColNames.includes(col);
    console.log(`  ${exists ? '✓' : '✗'} ${col}`);
  }

  // Check constraints
  const constraints = await sql`
    SELECT conname, conrelid::regclass as table_name
    FROM pg_constraint
    WHERE conrelid::regclass::text IN ('drops', 'poles', 'fibre_segments')
    AND contype = 'u'
  `;

  console.log('\n📋 Unique constraints:');
  for (const con of constraints) {
    console.log(`  ✓ ${con.conname} on ${con.table_name}`);
  }

  // Check indexes
  const indexes = await sql`
    SELECT indexname, tablename
    FROM pg_indexes
    WHERE indexname LIKE 'idx_drops_%' OR indexname LIKE 'idx_fibre_%'
  `;

  console.log('\n📋 New Indexes:');
  for (const idx of indexes) {
    console.log(`  ✓ ${idx.indexname} on ${idx.tablename}`);
  }
}

async function main() {
  // Determine environment
  const args = process.argv.slice(2);
  let env = 'dev'; // Default to dev for safety

  for (const arg of args) {
    if (arg.startsWith('--env=')) {
      env = arg.split('=')[1];
    }
  }

  // Get database URL
  let dbUrl = process.env.DATABASE_URL || DB_CONFIGS[env];

  if (!dbUrl) {
    console.error('❌ No database URL. Use DATABASE_URL env var or --env=dev|prod');
    process.exit(1);
  }

  // Mask password in output
  const maskedUrl = dbUrl.replace(/:[^:@]+@/, ':***@');

  console.log('🚀 PRD-047 Migration Runner');
  console.log('═'.repeat(50));
  console.log(`Environment: ${env.toUpperCase()}`);
  console.log(`Database: ${maskedUrl}`);
  console.log(`Migrations: ${MIGRATIONS.length}`);
  console.log('═'.repeat(50));

  // Confirm if production
  if (env === 'prod') {
    console.log('\n⚠️  WARNING: Running on PRODUCTION database!');
    console.log('Press Ctrl+C to cancel, or wait 5 seconds to continue...\n');
    await new Promise(resolve => setTimeout(resolve, 5000));
  }

  const sql = neon(dbUrl);

  try {
    // Run each migration
    for (const migration of MIGRATIONS) {
      await runMigration(sql, migration);
    }

    // Verify changes
    await verifySchema(sql);

    console.log('\n' + '═'.repeat(50));
    console.log('✅ All migrations completed successfully!');
    console.log('═'.repeat(50));

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    console.error(error);
    process.exit(1);
  }
}

main();
