/**
 * Migration 119: Password Reset Tokens
 *
 * Run with:
 * DATABASE_URL='...' node scripts/migrations/run-migration-119.js
 */

const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('❌ DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const sql = neon(databaseUrl);

  console.log('🚀 Running Migration 119: Password Reset Tokens...\n');

  try {
    // Read and execute the SQL file
    const sqlFile = path.join(__dirname, '119_password_reset_tokens.sql');
    const sqlContent = fs.readFileSync(sqlFile, 'utf8');

    // Split by semicolon and execute each statement
    const statements = sqlContent
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (const statement of statements) {
      if (statement.trim()) {
        console.log(`Executing: ${statement.substring(0, 60)}...`);
        await sql.unsafe(statement);
        console.log('✅ Done\n');
      }
    }

    // Verify columns exist
    const columns = await sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'users'
      AND column_name IN ('reset_token', 'reset_token_expires', 'password_changed_at')
    `;

    console.log('\n📋 Verification - New columns:');
    columns.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type}`);
    });

    console.log('\n✅ Migration 119 completed successfully!');
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    process.exit(1);
  }
}

runMigration();
