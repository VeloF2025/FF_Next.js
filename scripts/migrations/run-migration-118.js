/**
 * Migration Runner: 118 Odoo Invoice Sync
 *
 * Run with:
 *   DATABASE_URL='...' node scripts/migrations/run-migration-118.js
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
  console.log('Migration 118: Odoo Document/Attachment Sync');
  console.log('='.repeat(60));
  console.log('');

  try {
    // Read the SQL file
    const sqlPath = path.join(__dirname, '118_odoo_invoices.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');

    // Split into statements (handle DO $$ blocks and functions with $$ delimiters)
    const statements = [];
    let currentStatement = '';
    let dollarQuoteDepth = 0; // Track $$ block nesting

    for (const line of sqlContent.split('\n')) {
      const trimmedLine = line.trim();

      // Count $$ occurrences to track block depth
      // Opening: DO $$, AS $$, $body$, etc.
      // Closing: $$ LANGUAGE, $$;, etc.
      const dollarMatches = trimmedLine.match(/\$\$|\$[a-zA-Z_]*\$/g) || [];
      for (const match of dollarMatches) {
        // Simple toggle - each $$ toggles in/out of block
        dollarQuoteDepth = dollarQuoteDepth === 0 ? 1 : 0;
      }

      currentStatement += line + '\n';

      // End of statement if line ends with ; and we're not in a $$ block
      if (trimmedLine.endsWith(';') && dollarQuoteDepth === 0) {
        const stmt = currentStatement.trim();
        // Check if statement has any non-comment SQL content
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

    // Add any remaining statement
    if (currentStatement.trim()) {
      statements.push(currentStatement.trim());
    }

    console.log(`Found ${statements.length} SQL statements to execute`);
    console.log('');

    // Execute each statement
    let successCount = 0;
    let skipCount = 0;

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];

      // Skip comment-only statements
      if (stmt.split('\n').every(l => l.trim().startsWith('--') || l.trim() === '')) {
        skipCount++;
        continue;
      }

      // Extract first line for logging
      const firstLine = stmt.split('\n').find(l => !l.trim().startsWith('--') && l.trim());
      const preview = firstLine ? firstLine.substring(0, 60) : 'SQL statement';

      try {
        await sql.query(stmt);
        console.log(`[${i + 1}/${statements.length}] OK: ${preview}...`);
        successCount++;
      } catch (error) {
        // Some errors are OK (like "already exists")
        if (error.message.includes('already exists') ||
            error.message.includes('duplicate key') ||
            error.message.includes('ON CONFLICT DO NOTHING')) {
          console.log(`[${i + 1}/${statements.length}] SKIP (exists): ${preview}...`);
          skipCount++;
        } else {
          console.error(`[${i + 1}/${statements.length}] ERROR: ${preview}...`);
          console.error(`   ${error.message}`);
          // Continue with other statements
        }
      }
    }

    console.log('');
    console.log('='.repeat(60));
    console.log(`Migration complete: ${successCount} executed, ${skipCount} skipped`);
    console.log('='.repeat(60));

    // Verify tables were created
    console.log('\nVerifying tables...');

    const tables = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('odoo_documents', 'odoo_document_type_rules')
      ORDER BY table_name
    `;

    console.log('Created tables:');
    for (const row of tables) {
      console.log(`  ✓ ${row.table_name}`);
    }

    // Check document type rules
    try {
      const rulesCount = await sql`SELECT COUNT(*) as count FROM odoo_document_type_rules`;
      console.log(`  ✓ ${rulesCount[0].count} document type rules inserted`);
    } catch (e) {
      console.log('  (document type rules table check skipped)');
    }

    // Check functions
    const functions = await sql`
      SELECT routine_name
      FROM information_schema.routines
      WHERE routine_schema = 'public'
        AND routine_name IN ('get_odoo_document_type', 'get_odoo_document_sync_stats')
    `;
    console.log('\nCreated functions:');
    for (const row of functions) {
      console.log(`  ✓ ${row.routine_name}()`);
    }

  } catch (error) {
    console.error('');
    console.error('❌ Migration failed!');
    console.error('Error:', error.message);
    if (error.code) console.error('Code:', error.code);
    if (error.detail) console.error('Detail:', error.detail);
    process.exit(1);
  }
}

runMigration();
