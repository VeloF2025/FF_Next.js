/**
 * Migration Runner: 082 Stock Items Odoo
 *
 * Run with:
 *   DATABASE_URL='...' node scripts/migrations/run-migration-082.js
 */

const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const DATABASE_URL = process.env.DATABASE_URL;

  if (!DATABASE_URL) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const sql = neon(DATABASE_URL);

  console.log('='.repeat(60));
  console.log('Migration 082: Stock Items Odoo (stock_levels table)');
  console.log('='.repeat(60));
  console.log('');

  try {
    const sqlPath = path.join(__dirname, '082_stock_items_odoo.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');

    // Split into statements (handle DO $$ blocks and functions)
    const statements = [];
    let currentStatement = '';
    let dollarQuoteDepth = 0;

    for (const line of sqlContent.split('\n')) {
      const trimmedLine = line.trim();
      const dollarMatches = trimmedLine.match(/\$\$|\$[a-zA-Z_]*\$/g) || [];
      for (const match of dollarMatches) {
        dollarQuoteDepth = dollarQuoteDepth === 0 ? 1 : 0;
      }
      currentStatement += line + '\n';
      if (trimmedLine.endsWith(';') && dollarQuoteDepth === 0) {
        const stmt = currentStatement.trim();
        const hasSQL = stmt.split('\n').some(l => {
          const t = l.trim();
          return t && !t.startsWith('--');
        });
        if (stmt && hasSQL) {
          statements.push(stmt);
        }
        currentStatement = '';
      }
    }

    if (currentStatement.trim()) {
      statements.push(currentStatement.trim());
    }

    console.log(`Found ${statements.length} SQL statements to execute`);
    console.log('');

    let successCount = 0;
    let skipCount = 0;

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];

      if (stmt.split('\n').every(l => l.trim().startsWith('--') || l.trim() === '')) {
        skipCount++;
        continue;
      }

      const firstLine = stmt.split('\n').find(l => !l.trim().startsWith('--') && l.trim());
      const preview = firstLine ? firstLine.substring(0, 60) : 'SQL statement';

      try {
        await sql.query(stmt);
        console.log(`[${i + 1}/${statements.length}] OK: ${preview}...`);
        successCount++;
      } catch (error) {
        if (error.message.includes('already exists') ||
            error.message.includes('duplicate key') ||
            error.message.includes('ON CONFLICT DO NOTHING')) {
          console.log(`[${i + 1}/${statements.length}] SKIP (exists): ${preview}...`);
          skipCount++;
        } else {
          console.error(`[${i + 1}/${statements.length}] ERROR: ${preview}...`);
          console.error(`   ${error.message}`);
        }
      }
    }

    console.log('');
    console.log('='.repeat(60));
    console.log(`Migration complete: ${successCount} executed, ${skipCount} skipped`);
    console.log('='.repeat(60));

    // Verify tables
    console.log('\nVerifying tables...');
    const tables = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('stock_levels')
      ORDER BY table_name
    `;
    console.log('Tables:');
    for (const row of tables) {
      console.log(`  ✓ ${row.table_name}`);
    }

  } catch (error) {
    console.error('');
    console.error('❌ Migration failed!');
    console.error('Error:', error.message);
    if (error.detail) console.error('Detail:', error.detail);
    process.exit(1);
  }
}

runMigration();
