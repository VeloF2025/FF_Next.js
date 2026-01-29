/**
 * Run Migration 145: OneMap Status Tracking
 *
 * Adds onemap_status column to dr_photo_unified_reviews
 * to track DRs submitted via WhatsApp but not yet in 1Map.
 *
 * Usage:
 *   DATABASE_URL='...' node scripts/migrations/run-migration-145.js
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  console.log('🚀 Running Migration 145: OneMap Status Tracking');
  console.log('================================================\n');

  try {
    const sqlPath = path.join(__dirname, '145_onemap_status_tracking.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    await pool.query(sql);

    console.log('✅ Migration completed successfully!\n');

    // Verify
    console.log('📋 Verification:');
    const colCheck = await pool.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'dr_photo_unified_reviews'
        AND column_name IN ('onemap_status', 'onemap_checked_at')
      ORDER BY column_name
    `);
    colCheck.rows.forEach(row => {
      console.log(`  ✅ ${row.column_name}: ${row.data_type} (default: ${row.column_default || 'NULL'})`);
    });

    // Backfill existing not_found DRs (DR1863221 and DR1863022 from today)
    const backfill = await pool.query(`
      UPDATE dr_photo_unified_reviews
      SET onemap_status = 'not_found', onemap_checked_at = NOW()
      WHERE drop_number IN ('DR1863221', 'DR1863022')
        AND onemap_status IS NULL
    `);
    console.log(`\n  📝 Backfilled ${backfill.rowCount} known not_found DRs`);

    console.log('\n✅ All verifications passed!');
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
