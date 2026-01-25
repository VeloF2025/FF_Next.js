/**
 * Migration Runner: 127_merge_foto_ai_reviews.sql
 * Run with: node scripts/migrations/run-migration-127.js
 */

const { neonConfig, Pool } = require('@neondatabase/serverless');
const ws = require('ws');
const fs = require('fs');
const path = require('path');

neonConfig.webSocketConstructor = ws;

const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require';

async function runMigration() {
  const pool = new Pool({ connectionString: DATABASE_URL });

  try {
    console.log('');
    console.log('====================================================================');
    console.log('Migration 127: Merge foto_ai_reviews into dr_photo_unified_reviews');
    console.log('====================================================================');
    console.log('');

    // Get pre-migration counts
    console.log('📊 Pre-migration counts:');

    const fotoCount = await pool.query('SELECT COUNT(*) as count FROM foto_ai_reviews');
    console.log(`   foto_ai_reviews: ${fotoCount.rows[0].count} records`);

    const unifiedCount = await pool.query('SELECT COUNT(*) as count FROM dr_photo_unified_reviews');
    console.log(`   dr_photo_unified_reviews: ${unifiedCount.rows[0].count} records`);

    const stuckCount = await pool.query(`
      SELECT COUNT(*) as count FROM dr_photo_unified_reviews
      WHERE vlm_categorization_status = 'processing'
        AND updated_at < NOW() - INTERVAL '1 hour'
    `);
    console.log(`   Stuck processing records: ${stuckCount.rows[0].count}`);
    console.log('');

    // Read and run migration
    console.log('🚀 Running migration...');
    const sqlPath = path.join(__dirname, '127_merge_foto_ai_reviews.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');
    await pool.query(sql);
    console.log('   ✅ Migration SQL executed');
    console.log('');

    // Post-migration verification
    console.log('📊 Post-migration verification:');

    const vlmDataCount = await pool.query(`
      SELECT COUNT(*) as count FROM dr_photo_unified_reviews
      WHERE vlm_power_meter_dbm IS NOT NULL
         OR vlm_ont_serial_step6 IS NOT NULL
         OR vlm_ont_serial_step9 IS NOT NULL
    `);
    console.log(`   Records with VLM data: ${vlmDataCount.rows[0].count}`);

    // Verify view exists
    try {
      await pool.query('SELECT COUNT(*) FROM v_foto_ai_reviews LIMIT 1');
      console.log('   View v_foto_ai_reviews: ✅ working');
    } catch (e) {
      console.log('   View v_foto_ai_reviews: ❌ not found');
    }

    // Check stuck records
    const stuckAfter = await pool.query(`
      SELECT COUNT(*) as count FROM dr_photo_unified_reviews
      WHERE vlm_categorization_status = 'processing'
        AND updated_at < NOW() - INTERVAL '1 hour'
    `);
    console.log(`   Stuck records remaining: ${stuckAfter.rows[0].count}`);

    // Verify new columns exist
    const columnCheck = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'dr_photo_unified_reviews'
      AND column_name IN ('vlm_power_meter_dbm', 'vlm_ont_serial_step6', 'serial_validation_status', 'qa_phase')
    `);
    console.log(`   New columns added: ${columnCheck.rows.length}/4 key columns`);

    console.log('');
    console.log('====================================================================');
    console.log('✅ Migration 127 completed successfully!');
    console.log('====================================================================');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Update process-vlm-queue.ts to use unified table directly');
    console.log('  2. Remove 30-day limit from VLM processing');
    console.log('  3. Update other code files (8 total)');
    console.log('  4. Set up VLM cron on Velocity server');
    console.log('  5. Deploy to dev.fibreflow.app');
    console.log('');

  } catch (error) {
    console.error('');
    console.error('❌ Migration failed:', error.message);
    console.error('');
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
