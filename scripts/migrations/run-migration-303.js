/**
 * Run Migration 303: Pass/Fail + Comment Correction Learning Tables
 *
 * Creates qa_passfail_corrections and qa_comment_corrections tables to
 * extend HITL learning beyond step categorization.
 *
 * Usage: node scripts/migrations/run-migration-303.js
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

  const sqlFile = path.join(__dirname, 'sql', '303_qa_passfail_comment_corrections.sql');
  if (!fs.existsSync(sqlFile)) {
    console.error(`ERROR: Migration file not found: ${sqlFile}`);
    process.exit(1);
  }

  console.log('\n========================================');
  console.log('Migration 303: Pass/Fail + Comment Learning');
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
      const lines = currentStatement.trim().split('\n');
      const sqlLines = lines.filter(l => !l.trim().startsWith('--'));
      const stmt = sqlLines.join('\n').trim();
      if (stmt && stmt !== 'BEGIN' && stmt !== 'COMMIT') {
        statements.push(stmt);
      }
      currentStatement = '';
    }
  }

  console.log(`Executing ${statements.length} statements...\n`);

  let successCount = 0;
  let errorCount = 0;

  for (const stmt of statements) {
    if (!stmt || stmt.startsWith('--')) continue;

    try {
      await sql.query(stmt);
      successCount++;
    } catch (err) {
      errorCount++;
      console.log(`  ERROR: ${stmt.substring(0, 80)}...`);
      console.log(`  ${err.message.substring(0, 200)}`);
    }
  }

  console.log(`\nExecution: ${successCount} succeeded, ${errorCount} errors`);

  // Verify
  try {
    const tables = await sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('qa_passfail_corrections', 'qa_comment_corrections')
      ORDER BY table_name
    `;
    console.log('\nCreated tables:');
    for (const t of tables) {
      console.log(`  ${t.table_name}`);
    }
  } catch (err) {
    console.log(`  Could not verify tables: ${err.message}`);
  }

  console.log('\n========================================');
  console.log('Migration 303 Complete');
  console.log('========================================\n');
}

runMigration().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
