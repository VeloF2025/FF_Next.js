/**
 * Run Fleet Vehicle Ownership Enhancement Migration
 * Executes migration 040 for ownership tracking
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

// Use production database
const DATABASE_URL = 'process.env.DATABASE_URL';

const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

const migrations = [
  '040_fleet_ownership.sql',
];

/**
 * Split SQL into individual statements
 * Handles functions/procedures with $$ delimiters
 */
function splitSqlStatements(sql) {
  const statements = [];
  let current = '';
  let inDollarQuote = false;
  let dollarTag = '';

  const lines = sql.split('\n');

  for (const line of lines) {
    // Skip pure comment lines at statement boundaries
    const trimmedLine = line.trim();
    if (trimmedLine.startsWith('--') && !inDollarQuote && current.trim() === '') {
      continue;
    }

    // Check for dollar quote start/end
    const dollarMatch = line.match(/\$([a-zA-Z]*)\$/);
    if (dollarMatch) {
      if (!inDollarQuote) {
        inDollarQuote = true;
        dollarTag = dollarMatch[0];
      } else if (line.includes(dollarTag)) {
        // Count occurrences - if even, we're still in; if odd after adding, we exit
        const count = (line.split(dollarTag).length - 1);
        if (count % 2 === 1 || (line.match(new RegExp(dollarTag.replace(/\$/g, '\\$'), 'g')) || []).length >= 2) {
          inDollarQuote = false;
          dollarTag = '';
        }
      }
    }

    current += line + '\n';

    // If we hit a semicolon at end of line and not in dollar quote, that's a statement boundary
    if (!inDollarQuote && trimmedLine.endsWith(';')) {
      const stmt = current.trim();
      if (stmt && stmt !== ';') {
        statements.push(stmt);
      }
      current = '';
    }
  }

  // Add any remaining content
  const remaining = current.trim();
  if (remaining && remaining !== ';') {
    statements.push(remaining);
  }

  return statements;
}

async function runMigrations() {
  console.log('🚀 Starting Fleet Vehicle Ownership migrations...\n');
  console.log('Database: Production (ep-dry-night-a9qyh4sj)\n');

  const client = await pool.connect();
  let totalStatements = 0;
  let successCount = 0;
  let skipCount = 0;
  let errorCount = 0;

  try {
    for (const migrationFile of migrations) {
      const filePath = path.join(__dirname, 'migrations', migrationFile);
      console.log(`\n📄 ${migrationFile}`);
      console.log('─'.repeat(50));

      const sqlContent = fs.readFileSync(filePath, 'utf8');
      const statements = splitSqlStatements(sqlContent);

      console.log(`   Found ${statements.length} statements`);

      for (let i = 0; i < statements.length; i++) {
        const stmt = statements[i];
        totalStatements++;

        // Get a preview of the statement (first line, truncated)
        const preview = stmt.split('\n').find(l => !l.trim().startsWith('--') && l.trim())?.substring(0, 60) || 'statement';

        try {
          await client.query(stmt);
          successCount++;
          // Only log CREATE/ALTER/INSERT statements, not comments
          if (stmt.match(/^(CREATE|ALTER|INSERT|DROP|COMMENT|DO)/i)) {
            console.log(`   ✓ ${preview}...`);
          }
        } catch (error) {
          if (error.message && (
            error.message.includes('already exists') ||
            error.message.includes('duplicate key') ||
            error.message.includes('does not exist') && error.message.includes('DROP')
          )) {
            skipCount++;
            console.log(`   ⚠ ${preview}... (exists)`);
          } else {
            errorCount++;
            console.log(`   ✗ ${preview}...`);
            console.log(`     Error: ${error.message}`);
          }
        }
      }
    }

    console.log('\n' + '═'.repeat(50));
    console.log(`✨ Migration Summary:`);
    console.log(`   Total statements: ${totalStatements}`);
    console.log(`   Success: ${successCount}`);
    console.log(`   Skipped (exists): ${skipCount}`);
    console.log(`   Errors: ${errorCount}`);
    console.log('═'.repeat(50));

    // Verify tables were created
    console.log('\n📊 Verifying new tables...\n');

    const tablesResult = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'fleet_vehicle_documents',
          'fleet_license_disc',
          'fleet_vehicle_finance',
          'fleet_vehicle_lease',
          'fleet_vehicle_insurance'
        )
      ORDER BY table_name
    `);

    console.log('Fleet ownership tables:');
    for (const row of tablesResult.rows) {
      console.log(`   ✓ ${row.table_name}`);
    }

    // Check for new columns on fleet_vehicles
    const columnsResult = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'fleet_vehicles'
        AND column_name IN ('is_financed', 'natis_number', 'engine_number', 'chassis_number')
      ORDER BY column_name
    `);

    console.log('\nfleet_vehicles new columns:');
    if (columnsResult.rows.length === 0) {
      console.log('   (none found)');
    } else {
      for (const row of columnsResult.rows) {
        console.log(`   ✓ ${row.column_name}`);
      }
    }

    // Check view
    const viewResult = await client.query(`
      SELECT table_name
      FROM information_schema.views
      WHERE table_schema = 'public'
        AND table_name = 'fleet_expiring_items'
    `);

    console.log('\nViews:');
    if (viewResult.rows.length > 0) {
      console.log(`   ✓ fleet_expiring_items`);
    } else {
      console.log(`   (view not found)`);
    }

  } finally {
    client.release();
    await pool.end();
  }

  if (errorCount === 0) {
    console.log('\n🎉 Fleet Vehicle Ownership schema is ready!');
  } else {
    console.log('\n⚠️  Some errors occurred. Review above and fix issues.');
  }
}

runMigrations().catch(console.error);
