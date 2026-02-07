/**
 * Run Field Stock Control Migrations
 * Executes migrations 027-030 for the field stock module
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
  '027_field_stock_core.sql',
  '028_field_stock_transactions.sql',
  '029_field_stock_returns.sql',
  '030_drops_stock_columns.sql',
  '031_field_stock_fixes.sql',
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
  console.log('🚀 Starting Field Stock Control migrations...\n');
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
          if (stmt.match(/^(CREATE|ALTER|INSERT|DROP|COMMENT)/i)) {
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
    console.log('\n📊 Verifying tables...\n');

    const tablesResult = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND (table_name LIKE 'stock_%' OR table_name LIKE 'contractor_stock%')
      ORDER BY table_name
    `);

    console.log('Stock-related tables:');
    for (const row of tablesResult.rows) {
      console.log(`   ✓ ${row.table_name}`);
    }

    // Check for new columns on drops
    const dropsResult = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'drops'
        AND column_name IN ('ont_serial', 'mini_ups_serial', 'router_serial', 'materials_issued', 'materials_verified')
      ORDER BY column_name
    `);

    console.log('\nDrops table new columns:');
    if (dropsResult.rows.length === 0) {
      console.log('   (none found)');
    } else {
      for (const row of dropsResult.rows) {
        console.log(`   ✓ ${row.column_name}`);
      }
    }

    // Count records in new tables
    console.log('\nSeed data verification:');

    try {
      const locationsCount = await client.query('SELECT COUNT(*) as count FROM stock_locations');
      console.log(`   stock_locations: ${locationsCount.rows[0].count} records`);
    } catch (e) {
      console.log(`   stock_locations: table not found`);
    }

    try {
      const itemsCount = await client.query('SELECT COUNT(*) as count FROM stock_items');
      console.log(`   stock_items: ${itemsCount.rows[0].count} records`);
    } catch (e) {
      console.log(`   stock_items: table not found`);
    }

    try {
      const serialsCount = await client.query('SELECT COUNT(*) as count FROM stock_serials');
      console.log(`   stock_serials: ${serialsCount.rows[0].count} records`);
    } catch (e) {
      console.log(`   stock_serials: table not found`);
    }

    try {
      const pickingsCount = await client.query('SELECT COUNT(*) as count FROM stock_pickings');
      console.log(`   stock_pickings: ${pickingsCount.rows[0].count} records`);
    } catch (e) {
      console.log(`   stock_pickings: table not found`);
    }

  } finally {
    client.release();
    await pool.end();
  }

  if (errorCount === 0) {
    console.log('\n🎉 Field Stock Control schema is ready!');
  } else {
    console.log('\n⚠️  Some errors occurred. Review above and fix issues.');
  }
}

runMigrations().catch(console.error);
