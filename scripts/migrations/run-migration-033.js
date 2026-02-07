/**
 * Run Migration 033: DR Photo Unified Reviews
 *
 * This script executes the migration SQL file against the Neon database.
 * Uses the @neondatabase/serverless client for compatibility.
 */

const { neonConfig, Pool } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');
const ws = require('ws');

// Configure Neon WebSocket
neonConfig.webSocketConstructor = ws;

async function runMigration() {
  console.log('🚀 Starting Migration 033: DR Photo Unified Reviews\n');

  // Database connection (from .env.local)
  const pool = new Pool({
    connectionString: 'process.env.DATABASE_URL',
  });

  try {
    // Read migration file
    const migrationPath = path.join(__dirname, '033_dr_photo_unified_reviews.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('📄 Migration file loaded:', migrationPath);
    console.log('📏 Migration size:', migrationSQL.length, 'characters\n');

    // Execute migration
    console.log('⚙️  Executing migration...\n');
    const result = await pool.query(migrationSQL);

    console.log('\n✅ Migration executed successfully!\n');

    // Display any notices/messages from the database
    if (result.rows && result.rows.length > 0) {
      console.log('📊 Results:');
      result.rows.forEach((row, i) => {
        console.log(`  ${i + 1}.`, row);
      });
    }

  } catch (error) {
    console.error('\n❌ Migration failed:\n');
    console.error('Error:', error.message);
    if (error.detail) {
      console.error('Detail:', error.detail);
    }
    if (error.hint) {
      console.error('Hint:', error.hint);
    }
    process.exit(1);
  } finally {
    await pool.end();
  }

  console.log('\n✅ Migration 033 complete!\n');
}

// Run migration
runMigration().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
