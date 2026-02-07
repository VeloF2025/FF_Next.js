/**
 * Migration Runner: 087_wa_message_threading.sql
 *
 * Adds WhatsApp threading support columns to dr_photo_unified_reviews
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
    console.log('Starting migration 087: WhatsApp Message Threading...\n');

    // Read and execute the SQL file
    const sqlPath = path.join(__dirname, '087_wa_message_threading.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    await pool.query(sql);

    console.log('\nMigration 087 completed successfully!\n');

    // Verify columns were added
    const result = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'dr_photo_unified_reviews'
        AND column_name LIKE 'wa_%'
      ORDER BY column_name
    `);

    console.log('WhatsApp columns in dr_photo_unified_reviews:');
    result.rows.forEach(row => {
      console.log(`  - ${row.column_name}: ${row.data_type}`);
    });

  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
