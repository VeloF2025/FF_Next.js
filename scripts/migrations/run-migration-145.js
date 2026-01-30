/**
 * Run Migration 145: BOQ Column Templates
 * Usage: DATABASE_URL='...' node scripts/migrations/run-migration-145.js
 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  console.log('Running Migration 145: BOQ Column Templates');

  try {
    const sqlPath = path.join(__dirname, '145_boq_column_templates.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    await pool.query(sql);
    console.log('Migration completed successfully!');

    const templateCheck = await pool.query('SELECT name, supplier_name, array_length(headers, 1) as header_count FROM boq_column_templates');
    templateCheck.rows.forEach(row => {
      console.log('  Template: ' + row.name + ' (' + (row.supplier_name || 'No supplier') + ') - ' + row.header_count + ' headers');
    });

    const colCheck = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'boq_items' AND column_name = 'stock_item_id'");
    console.log('  boq_items.stock_item_id: ' + (colCheck.rows.length > 0 ? 'EXISTS' : 'MISSING'));
  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
