// Migration runner for 142_quote_extractions.sql
const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const sql = neon(databaseUrl);

  console.log('Running migration 142: Quote Extractions...');

  const migrationPath = path.join(__dirname, '142_quote_extractions.sql');
  const migrationSql = fs.readFileSync(migrationPath, 'utf8');

  // Split by semicolons but handle $$ blocks
  const statements = [];
  let currentStatement = '';
  let inDollarBlock = false;

  for (const line of migrationSql.split('\n')) {
    const trimmed = line.trim();

    // Track $$ blocks
    if (trimmed.includes('$$')) {
      const count = (trimmed.match(/\$\$/g) || []).length;
      if (count % 2 === 1) {
        inDollarBlock = !inDollarBlock;
      }
    }

    currentStatement += line + '\n';

    if (!inDollarBlock && trimmed.endsWith(';')) {
      const stmt = currentStatement.trim();
      if (stmt && !stmt.startsWith('--')) {
        statements.push(stmt);
      }
      currentStatement = '';
    }
  }

  // Execute each statement
  for (const statement of statements) {
    if (statement.trim()) {
      try {
        await sql(statement);
        console.log('✓ Executed statement');
      } catch (error) {
        // Check if it's a "already exists" error
        if (
          error.message.includes('already exists') ||
          error.message.includes('duplicate')
        ) {
          console.log('  (skipped - already exists)');
        } else {
          console.error('Error executing statement:', error.message);
          console.error('Statement:', statement.substring(0, 100) + '...');
        }
      }
    }
  }

  console.log('\n✅ Migration 142 complete!');
}

runMigration().catch(console.error);
