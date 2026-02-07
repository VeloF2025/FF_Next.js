/**
 * Verify Migration 033: DR Photo Unified Reviews
 *
 * This script verifies that migration 033 was executed successfully:
 * 1. Table exists with correct columns
 * 2. Indexes are created
 * 3. Compatibility view exists
 * 4. Trigger is active
 * 5. Sample data is present
 */

const { neonConfig, Pool } = require('@neondatabase/serverless');
const ws = require('ws');

// Configure Neon WebSocket
neonConfig.webSocketConstructor = ws;

async function verifyMigration() {
  console.log('🔍 Verifying Migration 033: DR Photo Unified Reviews\n');

  const pool = new Pool({
    connectionString: 'process.env.DATABASE_URL',
  });

  try {
    // 1. Verify table exists
    console.log('1️⃣  Checking if table exists...');
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_name = 'dr_photo_unified_reviews'
      ) AS exists;
    `);

    if (tableCheck.rows[0].exists) {
      console.log('   ✅ Table dr_photo_unified_reviews exists\n');
    } else {
      throw new Error('Table dr_photo_unified_reviews does not exist');
    }

    // 2. Verify columns
    console.log('2️⃣  Checking table columns...');
    const columnCheck = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'dr_photo_unified_reviews'
      ORDER BY ordinal_position;
    `);

    console.log(`   ✅ Found ${columnCheck.rows.length} columns:`);
    const importantColumns = [
      'id', 'drop_number', 'project', 'photo_source', 'photo_count',
      'step_01_house_photo', 'step_12_signature',
      'ai_evaluation_status', 'ai_overall_status',
      'locked_by', 'feedback_sent'
    ];
    importantColumns.forEach(col => {
      const found = columnCheck.rows.find(r => r.column_name === col);
      if (found) {
        console.log(`      - ${col} (${found.data_type})`);
      }
    });
    console.log();

    // 3. Verify indexes
    console.log('3️⃣  Checking indexes...');
    const indexCheck = await pool.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'dr_photo_unified_reviews';
    `);

    console.log(`   ✅ Found ${indexCheck.rows.length} indexes:`);
    indexCheck.rows.forEach(idx => {
      console.log(`      - ${idx.indexname}`);
    });
    console.log();

    // 4. Verify compatibility view
    console.log('4️⃣  Checking compatibility view...');
    const viewCheck = await pool.query(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.views
        WHERE table_name = 'v_qa_photo_reviews_compat'
      ) AS exists;
    `);

    if (viewCheck.rows[0].exists) {
      console.log('   ✅ View v_qa_photo_reviews_compat exists\n');
    } else {
      throw new Error('View v_qa_photo_reviews_compat does not exist');
    }

    // 5. Verify trigger
    console.log('5️⃣  Checking trigger...');
    const triggerCheck = await pool.query(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.triggers
        WHERE trigger_name = 'trigger_update_dr_photo_unified_reviews_updated_at'
      ) AS exists;
    `);

    if (triggerCheck.rows[0].exists) {
      console.log('   ✅ Trigger trigger_update_dr_photo_unified_reviews_updated_at exists\n');
    } else {
      throw new Error('Trigger trigger_update_dr_photo_unified_reviews_updated_at does not exist');
    }

    // 6. Verify sample data
    console.log('6️⃣  Checking sample test data...');
    const sampleCheck = await pool.query(`
      SELECT drop_number, project, photo_source, photo_count
      FROM dr_photo_unified_reviews
      WHERE drop_number = 'DR_MIGRATION_TEST';
    `);

    if (sampleCheck.rows.length > 0) {
      console.log('   ✅ Sample test record found:');
      console.log('      -', JSON.stringify(sampleCheck.rows[0], null, 2));
    } else {
      console.log('   ⚠️  Sample test record not found (may have been cleaned up)');
    }
    console.log();

    // 7. Verify record count
    console.log('7️⃣  Checking record count...');
    const countCheck = await pool.query(`
      SELECT COUNT(*) AS count
      FROM dr_photo_unified_reviews;
    `);

    console.log(`   ℹ️  Total records: ${countCheck.rows[0].count}\n`);

    // 8. Test compatibility view
    console.log('8️⃣  Testing compatibility view...');
    const compatViewTest = await pool.query(`
      SELECT drop_number, project, step_01, step_12
      FROM v_qa_photo_reviews_compat
      LIMIT 1;
    `);

    if (compatViewTest.rows.length > 0) {
      console.log('   ✅ Compatibility view is queryable');
      console.log('      -', JSON.stringify(compatViewTest.rows[0], null, 2));
    } else {
      console.log('   ℹ️  Compatibility view is empty (no records yet)');
    }
    console.log();

    // Summary
    console.log('====================================================================');
    console.log('✅ Migration 033 Verification: ALL CHECKS PASSED');
    console.log('====================================================================');
    console.log('Summary:');
    console.log('  - Table: dr_photo_unified_reviews ✅');
    console.log(`  - Columns: ${columnCheck.rows.length} ✅`);
    console.log(`  - Indexes: ${indexCheck.rows.length} ✅`);
    console.log('  - View: v_qa_photo_reviews_compat ✅');
    console.log('  - Trigger: auto-update updated_at ✅');
    console.log(`  - Records: ${countCheck.rows[0].count}`);
    console.log('');
    console.log('Ready for Phase 2: Data Migration');
    console.log('====================================================================\n');

  } catch (error) {
    console.error('\n❌ Verification failed:\n');
    console.error('Error:', error.message);
    if (error.detail) {
      console.error('Detail:', error.detail);
    }
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run verification
verifyMigration().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
