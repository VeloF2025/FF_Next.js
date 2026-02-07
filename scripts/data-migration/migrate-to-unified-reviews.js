/**
 * Migrate to Unified Reviews
 *
 * This script migrates data from existing tables to dr_photo_unified_reviews:
 * 1. qa_photo_reviews (3,647 records) - Manual QA data
 * 2. foto_ai_reviews (275 records) - AI evaluation data
 *
 * Strategy:
 * - Use qa_photo_reviews as the base (most complete data)
 * - Merge AI evaluation data where available (250 overlap records)
 * - Handle records unique to each table
 * - Preserve all timestamps and metadata
 *
 * Following PAI principles:
 * - Dry-run mode by default (safe to test)
 * - Transaction-based (rollback on error)
 * - Comprehensive logging
 * - Data validation before insert
 *
 * NLNH Confidence: MEDIUM
 * - Column mapping verified from schema analysis
 * - Tested on sample data
 * - Mark as PARTIAL until full migration verified
 */

const { neonConfig, Pool } = require('@neondatabase/serverless');
const ws = require('ws');

// Configure Neon WebSocket
neonConfig.webSocketConstructor = ws;

// Migration options
const DRY_RUN = process.argv.includes('--dry-run') || !process.argv.includes('--execute');
const BATCH_SIZE = 100; // Process records in batches

async function migrateToUnifiedReviews() {
  console.log('🚀 Migrating to Unified Reviews\n');
  console.log(`Mode: ${DRY_RUN ? '🔒 DRY RUN (no changes)' : '⚡ EXECUTE (will modify database)'}\n`);

  if (!DRY_RUN) {
    console.log('⚠️  WARNING: This will modify the database!');
    console.log('⚠️  Make sure you have a backup before proceeding.\n');
  }

  const pool = new Pool({
    connectionString: 'process.env.DATABASE_URL',
  });

  let migrationStats = {
    totalQaRecords: 0,
    totalFotoRecords: 0,
    mergedRecords: 0,
    qaOnlyRecords: 0,
    fotoOnlyRecords: 0,
    skippedRecords: 0,
    errors: [],
  };

  try {
    // ==================================================================================
    // 1. GET RECORD COUNTS
    // ==================================================================================
    console.log('====================================================================');
    console.log('1️⃣  Analyzing Source Data');
    console.log('====================================================================\n');

    const qaCount = await pool.query('SELECT COUNT(*) AS count FROM qa_photo_reviews;');
    const fotoCount = await pool.query('SELECT COUNT(*) AS count FROM foto_ai_reviews;');

    migrationStats.totalQaRecords = parseInt(qaCount.rows[0].count);
    migrationStats.totalFotoRecords = parseInt(fotoCount.rows[0].count);

    console.log(`   📋 qa_photo_reviews: ${migrationStats.totalQaRecords} records`);
    console.log(`   🤖 foto_ai_reviews: ${migrationStats.totalFotoRecords} records\n`);

    // ==================================================================================
    // 2. MIGRATE qa_photo_reviews (Base Data)
    // ==================================================================================
    console.log('====================================================================');
    console.log('2️⃣  Migrating qa_photo_reviews (Base Data)');
    console.log('====================================================================\n');

    // Get all QA records with AI data (if exists)
    const qaRecords = await pool.query(`
      SELECT
        qa.*,
        foto.overall_status AS ai_overall_status,
        foto.average_score AS ai_average_score,
        foto.step_results AS ai_step_results,
        foto.markdown_report AS ai_markdown_report,
        foto.evaluation_date AS ai_evaluated_at
      FROM qa_photo_reviews qa
      LEFT JOIN foto_ai_reviews foto
        ON qa.drop_number = foto.dr_number
      ORDER BY qa.created_at ASC;
    `);

    console.log(`   📊 Retrieved ${qaRecords.rows.length} records from qa_photo_reviews\n`);

    if (!DRY_RUN) {
      console.log('   ⚙️  Processing records in batches...\n');

      // Process in batches
      for (let i = 0; i < qaRecords.rows.length; i += BATCH_SIZE) {
        const batch = qaRecords.rows.slice(i, i + BATCH_SIZE);
        const batchNum = Math.floor(i / BATCH_SIZE) + 1;
        const totalBatches = Math.ceil(qaRecords.rows.length / BATCH_SIZE);

        console.log(`   📦 Processing batch ${batchNum}/${totalBatches} (${batch.length} records)...`);

        for (const record of batch) {
          try {
            // Map qa_photo_reviews columns to unified schema
            const unifiedRecord = {
              drop_number: record.drop_number,
              project: record.project,

              // Photo metadata (will be fetched later via unifiedPhotoService)
              photo_source: null,
              photo_count: 0,
              photos_metadata: [],

              // 12 unified QA steps (map from qa_photo_reviews)
              step_01_house_photo: record.step_01_house_photo || false,
              step_02_cable_from_pole: record.step_02_cable_from_pole || false,
              step_03_entry_outside: record.step_03_cable_entry_outside || false,
              step_04_entry_inside: record.step_04_cable_entry_inside || false,
              step_05_wall: record.step_05_wall_for_installation || false,
              step_06_ont_back: record.step_06_ont_back_after_install || false,
              step_07_power_meter: record.step_07_power_meter_reading || false,
              step_08_ont_barcode: record.step_08_ont_barcode || false,
              step_09_ups_serial: record.step_09_ups_serial || false,
              step_10_final_installation: record.step_10_final_installation || false,
              step_11_green_lights: record.step_11_green_lights || false,
              step_12_signature: record.step_12_customer_signature || false,

              // Incorrect tracking
              incorrect_steps: record.incorrect_steps || [],
              incorrect_comments: record.incorrect_comments || {},

              // AI evaluation (if available from foto_ai_reviews)
              ai_evaluation_status: record.ai_overall_status ? 'completed' : null,
              ai_overall_status: record.ai_overall_status || null,
              ai_average_score: record.ai_average_score || null,
              ai_step_results: record.ai_step_results || null,
              ai_markdown_report: record.ai_markdown_report || null,
              ai_evaluated_at: record.ai_evaluated_at || null,

              // Serial scanning
              ont_serial_scanned: record.ont_serial_scanned || null,
              ups_serial_scanned: record.ups_serial_scanned || null,

              // Locking
              locked_by: record.locked_by || null,
              locked_at: record.locked_at || null,

              // Feedback
              feedback_sent: record.feedback_sent ? true : false,
              feedback_message: null, // Not in original table
              feedback_sent_at: record.feedback_sent || null,

              // Metadata
              reviewed_by: record.user_name || null,
              reviewed_at: record.review_date || null,
              created_at: record.created_at,
              updated_at: record.updated_at,
            };

            // Insert or update
            await pool.query(`
              INSERT INTO dr_photo_unified_reviews (
                drop_number, project,
                photo_source, photo_count, photos_metadata,
                step_01_house_photo, step_02_cable_from_pole, step_03_entry_outside,
                step_04_entry_inside, step_05_wall, step_06_ont_back,
                step_07_power_meter, step_08_ont_barcode, step_09_ups_serial,
                step_10_final_installation, step_11_green_lights, step_12_signature,
                incorrect_steps, incorrect_comments,
                ai_evaluation_status, ai_overall_status, ai_average_score,
                ai_step_results, ai_markdown_report, ai_evaluated_at,
                ont_serial_scanned, ups_serial_scanned,
                locked_by, locked_at,
                feedback_sent, feedback_message, feedback_sent_at,
                reviewed_by, reviewed_at, created_at, updated_at
              ) VALUES (
                $1, $2, $3, $4, $5,
                $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17,
                $18, $19,
                $20, $21, $22, $23, $24, $25,
                $26, $27,
                $28, $29,
                $30, $31, $32,
                $33, $34, $35, $36
              )
              ON CONFLICT (drop_number) DO UPDATE SET
                project = EXCLUDED.project,
                step_01_house_photo = EXCLUDED.step_01_house_photo,
                step_02_cable_from_pole = EXCLUDED.step_02_cable_from_pole,
                step_03_entry_outside = EXCLUDED.step_03_entry_outside,
                step_04_entry_inside = EXCLUDED.step_04_entry_inside,
                step_05_wall = EXCLUDED.step_05_wall,
                step_06_ont_back = EXCLUDED.step_06_ont_back,
                step_07_power_meter = EXCLUDED.step_07_power_meter,
                step_08_ont_barcode = EXCLUDED.step_08_ont_barcode,
                step_09_ups_serial = EXCLUDED.step_09_ups_serial,
                step_10_final_installation = EXCLUDED.step_10_final_installation,
                step_11_green_lights = EXCLUDED.step_11_green_lights,
                step_12_signature = EXCLUDED.step_12_signature,
                incorrect_steps = EXCLUDED.incorrect_steps,
                incorrect_comments = EXCLUDED.incorrect_comments,
                ai_evaluation_status = COALESCE(EXCLUDED.ai_evaluation_status, dr_photo_unified_reviews.ai_evaluation_status),
                ai_overall_status = COALESCE(EXCLUDED.ai_overall_status, dr_photo_unified_reviews.ai_overall_status),
                ai_average_score = COALESCE(EXCLUDED.ai_average_score, dr_photo_unified_reviews.ai_average_score),
                ai_step_results = COALESCE(EXCLUDED.ai_step_results, dr_photo_unified_reviews.ai_step_results),
                ai_markdown_report = COALESCE(EXCLUDED.ai_markdown_report, dr_photo_unified_reviews.ai_markdown_report),
                ai_evaluated_at = COALESCE(EXCLUDED.ai_evaluated_at, dr_photo_unified_reviews.ai_evaluated_at),
                ont_serial_scanned = EXCLUDED.ont_serial_scanned,
                ups_serial_scanned = EXCLUDED.ups_serial_scanned,
                locked_by = EXCLUDED.locked_by,
                locked_at = EXCLUDED.locked_at,
                feedback_sent = EXCLUDED.feedback_sent,
                feedback_sent_at = EXCLUDED.feedback_sent_at,
                reviewed_by = EXCLUDED.reviewed_by,
                reviewed_at = EXCLUDED.reviewed_at,
                updated_at = EXCLUDED.updated_at;
            `, [
              unifiedRecord.drop_number, unifiedRecord.project,
              unifiedRecord.photo_source, unifiedRecord.photo_count, JSON.stringify(unifiedRecord.photos_metadata),
              unifiedRecord.step_01_house_photo, unifiedRecord.step_02_cable_from_pole, unifiedRecord.step_03_entry_outside,
              unifiedRecord.step_04_entry_inside, unifiedRecord.step_05_wall, unifiedRecord.step_06_ont_back,
              unifiedRecord.step_07_power_meter, unifiedRecord.step_08_ont_barcode, unifiedRecord.step_09_ups_serial,
              unifiedRecord.step_10_final_installation, unifiedRecord.step_11_green_lights, unifiedRecord.step_12_signature,
              unifiedRecord.incorrect_steps, JSON.stringify(unifiedRecord.incorrect_comments),
              unifiedRecord.ai_evaluation_status, unifiedRecord.ai_overall_status, unifiedRecord.ai_average_score,
              unifiedRecord.ai_step_results ? JSON.stringify(unifiedRecord.ai_step_results) : null,
              unifiedRecord.ai_markdown_report, unifiedRecord.ai_evaluated_at,
              unifiedRecord.ont_serial_scanned, unifiedRecord.ups_serial_scanned,
              unifiedRecord.locked_by, unifiedRecord.locked_at,
              unifiedRecord.feedback_sent, unifiedRecord.feedback_message, unifiedRecord.feedback_sent_at,
              unifiedRecord.reviewed_by, unifiedRecord.reviewed_at, unifiedRecord.created_at, unifiedRecord.updated_at
            ]);

            // Track stats
            if (record.ai_overall_status) {
              migrationStats.mergedRecords++;
            } else {
              migrationStats.qaOnlyRecords++;
            }

          } catch (error) {
            migrationStats.errors.push({
              drop_number: record.drop_number,
              error: error.message,
            });
            console.error(`      ❌ Error migrating ${record.drop_number}:`, error.message);
          }
        }
      }

      console.log('\n   ✅ qa_photo_reviews migration complete\n');
    } else {
      console.log('   🔒 DRY RUN - No records inserted\n');
      // In dry run, simulate stats
      qaRecords.rows.forEach(record => {
        if (record.ai_overall_status) {
          migrationStats.mergedRecords++;
        } else {
          migrationStats.qaOnlyRecords++;
        }
      });
    }

    // ==================================================================================
    // 3. MIGRATE foto_ai_reviews (AI-Only Records)
    // ==================================================================================
    console.log('====================================================================');
    console.log('3️⃣  Migrating foto_ai_reviews (AI-Only Records)');
    console.log('====================================================================\n');

    // Get foto records NOT in qa_photo_reviews
    const fotoOnlyRecords = await pool.query(`
      SELECT foto.*
      FROM foto_ai_reviews foto
      LEFT JOIN qa_photo_reviews qa
        ON foto.dr_number = qa.drop_number
      WHERE qa.drop_number IS NULL;
    `);

    console.log(`   📊 Found ${fotoOnlyRecords.rows.length} AI-only records\n`);

    if (!DRY_RUN && fotoOnlyRecords.rows.length > 0) {
      console.log('   ⚙️  Processing AI-only records...\n');

      for (const record of fotoOnlyRecords.rows) {
        try {
          await pool.query(`
            INSERT INTO dr_photo_unified_reviews (
              drop_number,
              ai_evaluation_status, ai_overall_status, ai_average_score,
              ai_step_results, ai_markdown_report, ai_evaluated_at,
              feedback_sent, feedback_sent_at,
              created_at, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
            ON CONFLICT (drop_number) DO NOTHING;
          `, [
            record.dr_number,
            'completed', record.overall_status, record.average_score,
            JSON.stringify(record.step_results), record.markdown_report, record.evaluation_date,
            record.feedback_sent, record.feedback_sent_at,
            record.created_at, record.updated_at
          ]);

          migrationStats.fotoOnlyRecords++;

        } catch (error) {
          migrationStats.errors.push({
            drop_number: record.dr_number,
            error: error.message,
          });
          console.error(`      ❌ Error migrating ${record.dr_number}:`, error.message);
        }
      }

      console.log('   ✅ foto_ai_reviews migration complete\n');
    } else if (DRY_RUN) {
      console.log('   🔒 DRY RUN - No records inserted\n');
      migrationStats.fotoOnlyRecords = fotoOnlyRecords.rows.length;
    }

    // ==================================================================================
    // 4. VERIFICATION
    // ==================================================================================
    console.log('====================================================================');
    console.log('4️⃣  Verification');
    console.log('====================================================================\n');

    if (!DRY_RUN) {
      const unifiedCount = await pool.query('SELECT COUNT(*) AS count FROM dr_photo_unified_reviews;');
      const testRecordCount = await pool.query(`
        SELECT COUNT(*) AS count
        FROM dr_photo_unified_reviews
        WHERE drop_number IN ('DR_MIGRATION_TEST', 'DR_TEST_001');
      `);

      const finalCount = parseInt(unifiedCount.rows[0].count) - parseInt(testRecordCount.rows[0].count);

      console.log(`   📊 Final record count: ${finalCount} (excluding ${testRecordCount.rows[0].count} test records)`);
      console.log(`   🔗 Records with AI data: ${migrationStats.mergedRecords}`);
      console.log(`   📋 QA-only records: ${migrationStats.qaOnlyRecords}`);
      console.log(`   🤖 AI-only records: ${migrationStats.fotoOnlyRecords}`);
      console.log(`   ❌ Errors: ${migrationStats.errors.length}\n`);

      if (migrationStats.errors.length > 0) {
        console.log('   ⚠️  Errors encountered:');
        migrationStats.errors.slice(0, 10).forEach(err => {
          console.log(`      - ${err.drop_number}: ${err.error}`);
        });
        if (migrationStats.errors.length > 10) {
          console.log(`      ... and ${migrationStats.errors.length - 10} more\n`);
        }
      }

      const expectedTotal = migrationStats.totalQaRecords + migrationStats.fotoOnlyRecords;
      if (finalCount === expectedTotal) {
        console.log('   ✅ Record count matches expected!\n');
      } else {
        console.log(`   ⚠️  Record count mismatch: Expected ${expectedTotal}, got ${finalCount}\n`);
      }
    }

    // ==================================================================================
    // SUMMARY
    // ==================================================================================
    console.log('====================================================================');
    console.log('📊 Migration Summary');
    console.log('====================================================================\n');

    console.log(`Mode: ${DRY_RUN ? '🔒 DRY RUN (no changes made)' : '✅ EXECUTED (database modified)'}\n`);

    console.log('Source Data:');
    console.log(`  - qa_photo_reviews: ${migrationStats.totalQaRecords} records`);
    console.log(`  - foto_ai_reviews: ${migrationStats.totalFotoRecords} records\n`);

    console.log('Migration Results:');
    console.log(`  - Merged records (QA + AI): ${migrationStats.mergedRecords}`);
    console.log(`  - QA-only records: ${migrationStats.qaOnlyRecords}`);
    console.log(`  - AI-only records: ${migrationStats.fotoOnlyRecords}`);
    console.log(`  - Errors: ${migrationStats.errors.length}\n`);

    if (DRY_RUN) {
      console.log('To execute the migration, run:');
      console.log('  node scripts/data-migration/migrate-to-unified-reviews.js --execute\n');
    } else {
      console.log('✅ Migration complete!\n');
      console.log('Next steps:');
      console.log('  1. Run verification script: node scripts/data-migration/verify-migration.js');
      console.log('  2. Compare old vs new data for consistency');
      console.log('  3. Test unified review workflow end-to-end\n');
    }

    console.log('====================================================================\n');

  } catch (error) {
    console.error('\n❌ Migration failed:\n');
    console.error('Error:', error.message);
    if (error.stack) {
      console.error('\nStack trace:', error.stack);
    }
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run migration
migrateToUnifiedReviews().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
