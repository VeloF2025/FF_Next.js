/**
 * Migration 140: Assets Procurement Integration
 * Run: node scripts/migrations/run-migration-140.js
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require';

async function runMigration() {
  const pool = new Pool({ connectionString: DATABASE_URL });

  try {
    console.log('Starting migration 140: Assets Procurement Integration...');

    const sqlPath = path.join(__dirname, '140_assets_procurement_integration.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    await pool.query(sql);

    console.log('Migration 140 completed successfully!');

    // Verify columns were added
    const { rows } = await pool.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'assets'
      AND column_name IN ('po_id', 'grn_id', 'verified_at', 'verification_status', 'vlm_extraction_data')
      ORDER BY column_name
    `);

    console.log('\nNew columns added to assets table:');
    rows.forEach(r => console.log(`  - ${r.column_name}: ${r.data_type}`));

    // Check new tables
    const { rows: tables } = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_name IN ('asset_category_stock_mapping', 'asset_registration_batches')
    `);

    console.log('\nNew tables created:');
    tables.forEach(t => console.log(`  - ${t.table_name}`));

  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
