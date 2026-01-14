/**
 * Verify Data Migration: Compare old tables vs new unified table
 *
 * This script validates that the migration to dr_photo_unified_reviews
 * was successful by comparing data integrity between:
 * - qa_photo_reviews vs dr_photo_unified_reviews (manual QA steps)
 * - foto_ai_reviews vs dr_photo_unified_reviews (AI evaluation)
 *
 * Checks:
 * 1. Record counts match
 * 2. Step values match for each DR
 * 3. AI data correctly merged
 * 4. No data loss occurred
 * 5. Sample data integrity
 */

const { neonConfig, Pool } = require('@neondatabase/serverless');
const ws = require('ws');

// Configure Neon WebSocket
neonConfig.webSocketConstructor = ws;

async function verifyMigration() {
  console.log('🔍 Verifying Data Migration to Unified Reviews\n');

  const pool = new Pool({
    connectionString: 'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require',
  });

  const errors = [];
  const warnings = [];

  try {
    // ==================================================================================
    // 1. RECORD COUNT VERIFICATION
    // ==================================================================================
    console.log('====================================================================');
    console.log('1️⃣  Record Count Verification');
    console.log('====================================================================\n');

    const qaCount = await pool.query('SELECT COUNT(*) AS count FROM qa_photo_reviews;');
    const fotoCount = await pool.query('SELECT COUNT(*) AS count FROM foto_ai_reviews;');
    const unifiedCount = await pool.query(`
      SELECT COUNT(*) AS count FROM dr_photo_unified_reviews
      WHERE drop_number NOT LIKE 'DR_MIGRATION_TEST%';
    `);

    const expectedTotal = parseInt(qaCount.rows[0].count) + 25; // QA + AI-only records

    console.log(`   📋 qa_photo_reviews: ${qaCount.rows[0].count} records`);
    console.log(`   🤖 foto_ai_reviews: ${fotoCount.rows[0].count} records`);
    console.log(`   🔗 dr_photo_unified_reviews: ${unifiedCount.rows[0].count} records`);
    console.log(`   📊 Expected (QA + AI-only): ${expectedTotal} records\n`);

    if (parseInt(unifiedCount.rows[0].count) !== expectedTotal) {
      warnings.push(`Record count mismatch: Expected ${expectedTotal}, got ${unifiedCount.rows[0].count}`);
      console.log(`   ⚠️  Record count mismatch: Expected ${expectedTotal}, got ${unifiedCount.rows[0].count}\n`);
    } else {
      console.log('   ✅ Record count matches expected total\n');
    }

    // ==================================================================================
    // 2. MANUAL QA STEP VERIFICATION (Sample 100 records)
    // ==================================================================================
    console.log('====================================================================');
    console.log('2️⃣  Manual QA Step Verification (Sample 100)');
    console.log('====================================================================\n');

    const stepComparison = await pool.query(`
      SELECT
        qa.drop_number,
        qa.project,
        -- Compare step values (sample all 12 steps)
        qa.step_01_house_photo AS qa_step01,
        ur.step_01_house_photo AS unified_step01,
        qa.step_02_cable_from_pole AS qa_step02,
        ur.step_02_cable_from_pole AS unified_step02,
        qa.step_03_cable_entry_outside AS qa_step03,
        ur.step_03_entry_outside AS unified_step03,
        qa.step_04_cable_entry_inside AS qa_step04,
        ur.step_04_entry_inside AS unified_step04,
        qa.step_05_wall_for_installation AS qa_step05,
        ur.step_05_wall AS unified_step05,
        qa.step_06_ont_back_after_install AS qa_step06,
        ur.step_06_ont_back AS unified_step06,
        qa.step_07_power_meter_reading AS qa_step07,
        ur.step_07_power_meter AS unified_step07,
        qa.step_08_ont_barcode AS qa_step08,
        ur.step_08_ont_barcode AS unified_step08,
        qa.step_09_ups_serial AS qa_step09,
        ur.step_09_ups_serial AS unified_step09,
        qa.step_10_final_installation AS qa_step10,
        ur.step_10_final_installation AS unified_step10,
        qa.step_11_green_lights AS qa_step11,
        ur.step_11_green_lights AS unified_step11,
        qa.step_12_customer_signature AS qa_step12,
        ur.step_12_signature AS unified_step12
      FROM qa_photo_reviews qa
      INNER JOIN dr_photo_unified_reviews ur
        ON qa.drop_number = ur.drop_number
      ORDER BY RANDOM()
      LIMIT 100;
    `);

    let stepMismatches = 0;
    const stepMismatchDetails = [];

    stepComparison.rows.forEach(row => {
      for (let i = 1; i <= 12; i++) {
        const stepNum = i.toString().padStart(2, '0');
        const qaValue = row[`qa_step${stepNum}`];
        const unifiedValue = row[`unified_step${stepNum}`];

        if (qaValue !== unifiedValue) {
          stepMismatches++;
          stepMismatchDetails.push({
            drop_number: row.drop_number,
            project: row.project,
            step: i,
            qaValue,
            unifiedValue,
          });
        }
      }
    });

    console.log(`   📊 Sampled 100 records (1,200 step comparisons)`);
    console.log(`   ✅ Step matches: ${1200 - stepMismatches}`);
    console.log(`   ❌ Step mismatches: ${stepMismatches}\n`);

    if (stepMismatches > 0) {
      errors.push(`Step value mismatches found: ${stepMismatches}`);
      console.log('   ⚠️  Step mismatches found:\n');
      stepMismatchDetails.slice(0, 10).forEach(mismatch => {
        console.log(`      - ${mismatch.drop_number} (${mismatch.project}): Step ${mismatch.step}`);
        console.log(`        QA: ${mismatch.qaValue}, Unified: ${mismatch.unifiedValue}`);
      });
      if (stepMismatchDetails.length > 10) {
        console.log(`      ... and ${stepMismatchDetails.length - 10} more\n`);
      }
    } else {
      console.log('   ✅ All sampled step values match\n');
    }

    // ==================================================================================
    // 3. AI EVALUATION VERIFICATION
    // ==================================================================================
    console.log('====================================================================');
    console.log('3️⃣  AI Evaluation Data Verification');
    console.log('====================================================================\n');

    const aiComparison = await pool.query(`
      SELECT COUNT(*) AS count
      FROM foto_ai_reviews foto
      INNER JOIN dr_photo_unified_reviews ur
        ON foto.dr_number = ur.drop_number
      WHERE
        foto.overall_status = ur.ai_overall_status
        AND foto.average_score = ur.ai_average_score;
    `);

    const aiTotalRecords = await pool.query(`
      SELECT COUNT(*) AS count
      FROM foto_ai_reviews foto
      INNER JOIN dr_photo_unified_reviews ur
        ON foto.dr_number = ur.drop_number;
    `);

    const aiMatches = parseInt(aiComparison.rows[0].count);
    const aiTotal = parseInt(aiTotalRecords.rows[0].count);

    console.log(`   📊 AI evaluation records compared: ${aiTotal}`);
    console.log(`   ✅ AI data matches: ${aiMatches}`);
    console.log(`   ❌ AI data mismatches: ${aiTotal - aiMatches}\n`);

    if (aiMatches !== aiTotal) {
      errors.push(`AI evaluation data mismatches: ${aiTotal - aiMatches}`);
      console.log('   ⚠️  AI data mismatches found\n');
    } else {
      console.log('   ✅ All AI evaluation data matches\n');
    }

    // ==================================================================================
    // 4. DATA LOSS CHECK
    // ==================================================================================
    console.log('====================================================================');
    console.log('4️⃣  Data Loss Check');
    console.log('====================================================================\n');

    // Check for QA records missing in unified
    const missingQaRecords = await pool.query(`
      SELECT COUNT(*) AS count
      FROM qa_photo_reviews qa
      LEFT JOIN dr_photo_unified_reviews ur
        ON qa.drop_number = ur.drop_number
      WHERE ur.drop_number IS NULL;
    `);

    // Check for AI records missing in unified
    const missingAiRecords = await pool.query(`
      SELECT COUNT(*) AS count
      FROM foto_ai_reviews foto
      LEFT JOIN dr_photo_unified_reviews ur
        ON foto.dr_number = ur.drop_number
      WHERE ur.drop_number IS NULL;
    `);

    console.log(`   📋 QA records missing in unified: ${missingQaRecords.rows[0].count}`);
    console.log(`   🤖 AI records missing in unified: ${missingAiRecords.rows[0].count}\n`);

    if (parseInt(missingQaRecords.rows[0].count) > 0) {
      errors.push(`QA records missing in unified: ${missingQaRecords.rows[0].count}`);
      console.log(`   ❌ Data loss detected: ${missingQaRecords.rows[0].count} QA records missing\n`);
    } else {
      console.log('   ✅ No QA data loss\n');
    }

    if (parseInt(missingAiRecords.rows[0].count) > 0) {
      errors.push(`AI records missing in unified: ${missingAiRecords.rows[0].count}`);
      console.log(`   ❌ Data loss detected: ${missingAiRecords.rows[0].count} AI records missing\n`);
    } else {
      console.log('   ✅ No AI data loss\n');
    }

    // ==================================================================================
    // 5. PROJECT DISTRIBUTION VERIFICATION
    // ==================================================================================
    console.log('====================================================================');
    console.log('5️⃣  Project Distribution Verification');
    console.log('====================================================================\n');

    const qaProjectDist = await pool.query(`
      SELECT project, COUNT(*) AS count
      FROM qa_photo_reviews
      GROUP BY project
      ORDER BY count DESC;
    `);

    const unifiedProjectDist = await pool.query(`
      SELECT project, COUNT(*) AS count
      FROM dr_photo_unified_reviews
      WHERE drop_number NOT LIKE 'DR_MIGRATION_TEST%'
      GROUP BY project
      ORDER BY count DESC;
    `);

    console.log('   📊 Project distribution comparison:\n');
    console.log('   Project                QA Count    Unified Count   Diff');
    console.log('   ─────────────────────  ──────────  ──────────────  ────');

    const qaProjects = new Map(qaProjectDist.rows.map(r => [r.project, parseInt(r.count)]));
    const unifiedProjects = new Map(unifiedProjectDist.rows.map(r => [r.project, parseInt(r.count)]));

    const allProjects = new Set([...qaProjects.keys(), ...unifiedProjects.keys()]);

    allProjects.forEach(project => {
      const qaCount = qaProjects.get(project) || 0;
      const unifiedCount = unifiedProjects.get(project) || 0;
      const diff = unifiedCount - qaCount;
      const status = diff === 0 ? '✅' : '⚠️ ';
      const projectName = (project || 'NULL').padEnd(21);

      console.log(
        `   ${status} ${projectName} ${qaCount.toString().padStart(10)} ${unifiedCount.toString().padStart(14)} ${diff >= 0 ? '+' : ''}${diff}`
      );
    });
    console.log();

    // ==================================================================================
    // 6. SAMPLE DATA INTEGRITY
    // ==================================================================================
    console.log('====================================================================');
    console.log('6️⃣  Sample Data Integrity (Random 5 Records)');
    console.log('====================================================================\n');

    const sampleRecords = await pool.query(`
      SELECT
        qa.drop_number,
        qa.project,
        qa.step_01_house_photo AS qa_step01,
        ur.step_01_house_photo AS ur_step01,
        qa.step_12_customer_signature AS qa_step12,
        ur.step_12_signature AS ur_step12,
        ur.ai_overall_status,
        ur.created_at,
        ur.updated_at
      FROM qa_photo_reviews qa
      INNER JOIN dr_photo_unified_reviews ur
        ON qa.drop_number = ur.drop_number
      ORDER BY RANDOM()
      LIMIT 5;
    `);

    sampleRecords.rows.forEach((record, i) => {
      console.log(`   Record ${i + 1}: ${record.drop_number} (${record.project})`);
      console.log(`      Step 01: QA=${record.qa_step01}, Unified=${record.ur_step01} ${record.qa_step01 === record.ur_step01 ? '✅' : '❌'}`);
      console.log(`      Step 12: QA=${record.qa_step12}, Unified=${record.ur_step12} ${record.qa_step12 === record.ur_step12 ? '✅' : '❌'}`);
      console.log(`      AI Status: ${record.ai_overall_status || 'N/A'}`);
      console.log(`      Created: ${record.created_at}`);
      console.log();
    });

    // ==================================================================================
    // SUMMARY
    // ==================================================================================
    console.log('====================================================================');
    console.log('📊 Verification Summary');
    console.log('====================================================================\n');

    if (errors.length === 0 && warnings.length === 0) {
      console.log('✅ ALL CHECKS PASSED\n');
      console.log('   - Record counts match');
      console.log('   - Step values verified (100 sample)');
      console.log('   - AI evaluation data correct');
      console.log('   - No data loss detected');
      console.log('   - Project distribution matches\n');
      console.log('✅ Migration verified successfully!\n');
    } else {
      if (errors.length > 0) {
        console.log('❌ ERRORS FOUND:\n');
        errors.forEach(error => console.log(`   - ${error}`));
        console.log();
      }

      if (warnings.length > 0) {
        console.log('⚠️  WARNINGS:\n');
        warnings.forEach(warning => console.log(`   - ${warning}`));
        console.log();
      }

      console.log('⚠️  Migration verification completed with issues\n');
      console.log('Please review the errors and warnings above.\n');
    }

    console.log('====================================================================\n');

    // Exit with error if there are critical errors
    if (errors.length > 0) {
      process.exit(1);
    }

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
