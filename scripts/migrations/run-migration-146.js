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
  const migrationPath = path.join(__dirname, '146_boq_change_log.sql');
  const rawSql = fs.readFileSync(migrationPath, 'utf8');

  console.log('Running migration 146: BOQ Change Log...');

  // Strip comment-only lines, then split by semicolons
  const cleaned = rawSql
    .split('\n')
    .filter(line => !line.trim().startsWith('--'))
    .join('\n');

  const statements = cleaned
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0);

  for (const statement of statements) {
    console.log(`  Executing: ${statement.substring(0, 70)}...`);
    await sql.query(statement);
  }

  console.log('Migration 146 completed successfully!');
}

runMigration().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
