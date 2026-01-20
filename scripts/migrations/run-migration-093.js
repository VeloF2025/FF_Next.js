/**
 * Migration Runner: 093_fleet_calibration_audit.sql
 * Fleet Vehicle Calibration and Audit Trail System
 *
 * Run with: node scripts/migrations/run-migration-093.js
 */

const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('❌ DATABASE_URL environment variable is not set');
    console.log('\nUsage:');
    console.log('  DATABASE_URL="postgresql://..." node scripts/migrations/run-migration-093.js');
    process.exit(1);
  }

  console.log('🚀 Running migration: 093_fleet_calibration_audit.sql');
  console.log('   - Fleet Vehicle Calibration table');
  console.log('   - Fleet Audit Log table');
  console.log('   - Calibration status view');
  console.log('');

  const sql = neon(databaseUrl);

  // Read the migration file
  const migrationPath = path.join(__dirname, '093_fleet_calibration_audit.sql');
  const migrationSql = fs.readFileSync(migrationPath, 'utf8');

  // Parse SQL properly handling $$ delimited blocks
  function parseSqlStatements(sqlContent) {
    const statements = [];
    let current = '';
    let inDollarQuote = false;

    const lines = sqlContent.split('\n');

    for (const line of lines) {
      // Skip pure comment lines at the start of statements
      if (!current.trim() && line.trim().startsWith('--')) {
        continue;
      }

      current += line + '\n';

      // Check for $$ delimiters
      const dollarMatches = line.match(/\$\$/g);
      if (dollarMatches) {
        for (const match of dollarMatches) {
          inDollarQuote = !inDollarQuote;
        }
      }

      // If not in $$ block and line ends with semicolon, we have a complete statement
      if (!inDollarQuote && line.trim().endsWith(';')) {
        const stmt = current.trim();
        if (stmt && !stmt.split('\n').every(l => l.trim().startsWith('--') || !l.trim())) {
          statements.push(stmt);
        }
        current = '';
      }
    }

    return statements;
  }

  const statements = parseSqlStatements(migrationSql);

  console.log(`📋 Found ${statements.length} SQL statements to execute`);
  console.log('');

  let successCount = 0;
  let skipCount = 0;

  for (let i = 0; i < statements.length; i++) {
    const stmt = statements[i];

    // Extract first meaningful line for logging
    const firstLine = stmt.split('\n').find(line =>
      line.trim() && !line.trim().startsWith('--')
    ) || stmt.substring(0, 60);

    try {
      // Use sql.unsafe for raw SQL execution
      await sql.unsafe(stmt);

      successCount++;

      // Log significant operations
      if (stmt.includes('CREATE TABLE')) {
        const match = stmt.match(/CREATE TABLE[^(]*?(\w+)/i);
        console.log(`✅ Created table: ${match ? match[1] : 'unknown'}`);
      } else if (stmt.includes('CREATE UNIQUE INDEX')) {
        const match = stmt.match(/CREATE[^I]*INDEX[^(]*?(\w+)/i);
        console.log(`✅ Created unique index: ${match ? match[1] : 'unknown'}`);
      } else if (stmt.includes('CREATE INDEX')) {
        const match = stmt.match(/CREATE[^I]*INDEX[^(]*?(\w+)/i);
        console.log(`✅ Created index: ${match ? match[1] : 'unknown'}`);
      } else if (stmt.includes('CREATE OR REPLACE VIEW')) {
        const match = stmt.match(/VIEW\s+(\w+)/i);
        console.log(`✅ Created view: ${match ? match[1] : 'unknown'}`);
      } else if (stmt.includes('CREATE OR REPLACE FUNCTION')) {
        const match = stmt.match(/FUNCTION\s+(\w+)/i);
        console.log(`✅ Created function: ${match ? match[1] : 'unknown'}`);
      } else if (stmt.includes('ALTER TABLE')) {
        const match = stmt.match(/ALTER TABLE\s+(\w+)/i);
        console.log(`✅ Altered table: ${match ? match[1] : 'unknown'}`);
      } else if (stmt.includes('DROP TRIGGER')) {
        const match = stmt.match(/TRIGGER\s+(\w+)/i);
        console.log(`✅ Dropped trigger: ${match ? match[1] : 'unknown'}`);
      } else if (stmt.includes('CREATE TRIGGER')) {
        const match = stmt.match(/TRIGGER\s+(\w+)/i);
        console.log(`✅ Created trigger: ${match ? match[1] : 'unknown'}`);
      } else if (stmt.includes('COMMENT ON')) {
        skipCount++;
      }
    } catch (error) {
      // Check if it's a "already exists" type error (acceptable)
      if (error.message.includes('already exists') ||
          error.message.includes('duplicate key')) {
        skipCount++;
        const match = stmt.match(/CREATE[^(]*?(TABLE|INDEX|VIEW|FUNCTION|TRIGGER)\s+\w*\s*(\w+)/i);
        if (match) {
          console.log(`⏭️  Skipped (exists): ${match[1].toLowerCase()} ${match[2]}`);
        }
      } else {
        console.error(`❌ Error executing statement ${i + 1}:`);
        console.error(`   ${firstLine.substring(0, 80)}...`);
        console.error(`   Error: ${error.message}`);
      }
    }
  }

  console.log('');
  console.log('═'.repeat(50));
  console.log(`✅ Migration complete!`);
  console.log(`   ${successCount} statements executed successfully`);
  if (skipCount > 0) {
    console.log(`   ${skipCount} statements skipped (already exist or comments)`);
  }
  console.log('═'.repeat(50));

  // Verify tables exist
  console.log('\n📊 Verification:');

  try {
    const tables = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name IN ('fleet_vehicle_calibration', 'fleet_audit_log')
      ORDER BY table_name
    `;

    console.log('   Tables created:');
    tables.forEach(t => console.log(`     ✓ ${t.table_name}`));

    if (tables.length < 2) {
      console.log('   ⚠️  Some tables may not have been created');
    }
  } catch (error) {
    console.error('   Could not verify tables:', error.message);
  }

  // Check function exists
  try {
    const funcs = await sql`
      SELECT routine_name
      FROM information_schema.routines
      WHERE routine_schema = 'public'
      AND routine_name = 'fleet_vehicle_needs_calibration'
    `;

    if (funcs.length > 0) {
      console.log('   Functions created:');
      console.log(`     ✓ fleet_vehicle_needs_calibration`);
    }
  } catch (error) {
    // Ignore
  }

  // Check view exists
  try {
    const views = await sql`
      SELECT table_name
      FROM information_schema.views
      WHERE table_schema = 'public'
      AND table_name = 'fleet_calibration_status'
    `;

    if (views.length > 0) {
      console.log('   Views created:');
      console.log(`     ✓ fleet_calibration_status`);
    }
  } catch (error) {
    // Ignore
  }
}

runMigration().catch(console.error);
