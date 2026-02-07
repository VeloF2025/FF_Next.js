/**
 * Run Migration 122: Serial Change History Table
 *
 * Usage: node scripts/migrations/run-migration-122.js
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL ||
  'process.env.DATABASE_URL';

async function runMigration() {
  const pool = new Pool({ connectionString: DATABASE_URL });

  try {
    console.log('Running Migration 122: Serial Change History Table...\n');

    // Read SQL file
    const sqlPath = path.join(__dirname, '122_serial_change_history.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    // Execute migration
    await pool.query(sql);

    console.log('✅ Migration 122 completed successfully!\n');

    // Verify table was created
    const tableCheck = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'serial_change_history'
      ORDER BY ordinal_position
    `);

    console.log('Table columns:');
    tableCheck.rows.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type}`);
    });

    // Check indexes
    const indexCheck = await pool.query(`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'serial_change_history'
    `);

    console.log('\nIndexes created:');
    indexCheck.rows.forEach(idx => {
      console.log(`  - ${idx.indexname}`);
    });

    // Check views
    const viewCheck = await pool.query(`
      SELECT viewname
      FROM pg_views
      WHERE viewname LIKE 'v_%serial%'
    `);

    console.log('\nViews created:');
    viewCheck.rows.forEach(v => {
      console.log(`  - ${v.viewname}`);
    });

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  } finally {
    await pool.end();
  }
}

runMigration().catch(err => {
  console.error(err);
  process.exit(1);
});
