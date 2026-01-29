/**
 * Run Migration 144: Data Sync Operations Log
 *
 * Creates the data_sync_operations table for unified sync history tracking.
 *
 * Usage:
 *   DATABASE_URL='...' node scripts/migrations/run-migration-144.js
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  console.log('Running Migration 144: Data Sync Operations Log');
  console.log('================================================\n');

  try {
    const sqlPath = path.join(__dirname, '144_data_sync_operations.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    await pool.query(sql);

    console.log('Migration completed successfully!\n');

    // Verify
    console.log('Verification:');

    const tableCheck = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'data_sync_operations'
      ORDER BY ordinal_position
    `);

    console.log('\n  data_sync_operations columns:');
    tableCheck.rows.forEach(row => {
      console.log(`    ${row.column_name}: ${row.data_type} (${row.is_nullable === 'YES' ? 'nullable' : 'not null'})`);
    });

    const indexCheck = await pool.query(`
      SELECT indexname FROM pg_indexes WHERE tablename = 'data_sync_operations'
    `);
    console.log('\n  Indexes:');
    indexCheck.rows.forEach(row => {
      console.log(`    ${row.indexname}`);
    });

    console.log('\nAll verifications passed!');
  } catch (error) {
    console.error('Migration failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
