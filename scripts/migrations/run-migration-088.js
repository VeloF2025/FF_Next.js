/**
 * Migration Runner: 088_barcode_extraction_tracking.sql
 *
 * Adds columns to track serial extraction method (barcode vs VLM)
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL ||
      'process.env.DATABASE_URL'
  });

  try {
    console.log('Starting migration 088: Barcode Extraction Tracking...\n');

    // Read and execute the SQL file
    const sqlPath = path.join(__dirname, '088_barcode_extraction_tracking.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    await pool.query(sql);

    console.log('\nMigration 088 completed successfully!\n');

    // Verify columns were added
    const result = await pool.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'foto_ai_reviews'
        AND column_name LIKE 'serial_extraction_method%'
      ORDER BY column_name
    `);

    console.log('Extraction method columns in foto_ai_reviews:');
    result.rows.forEach(row => {
      console.log(`  - ${row.column_name}: ${row.data_type} (default: ${row.column_default})`);
    });

  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
