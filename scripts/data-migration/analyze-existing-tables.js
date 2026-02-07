/**
 * Analyze Existing Tables for Migration
 *
 * This script analyzes the structure and data of existing tables:
 * 1. qa_photo_reviews (WA Monitor manual QA)
 * 2. foto_ai_reviews (AI evaluation results)
 *
 * Purpose: Understand data structure before building migration service
 */

const { neonConfig, Pool } = require('@neondatabase/serverless');
const ws = require('ws');

// Configure Neon WebSocket
neonConfig.webSocketConstructor = ws;

async function analyzeTables() {
  console.log('🔍 Analyzing Existing Tables for Migration\n');

  const pool = new Pool({
    connectionString: 'process.env.DATABASE_URL',
  });

  try {
    // ==================================================================================
    // 1. ANALYZE qa_photo_reviews TABLE
    // ==================================================================================
    console.log('====================================================================');
    console.log('1️⃣  Analyzing qa_photo_reviews (WA Monitor)');
    console.log('====================================================================\n');

    // Check if table exists
    const qaTableExists = await pool.query(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_name = 'qa_photo_reviews'
      ) AS exists;
    `);

    if (!qaTableExists.rows[0].exists) {
      console.log('   ⚠️  Table qa_photo_reviews does not exist\n');
    } else {
      // Get column structure
      console.log('   📋 Column Structure:');
      const qaColumns = await pool.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = 'qa_photo_reviews'
        ORDER BY ordinal_position;
      `);

      qaColumns.rows.forEach(col => {
        console.log(`      - ${col.column_name} (${col.data_type})${col.is_nullable === 'NO' ? ' NOT NULL' : ''}`);
      });
      console.log();

      // Get record count
      const qaCount = await pool.query('SELECT COUNT(*) AS count FROM qa_photo_reviews;');
      console.log(`   📊 Record Count: ${qaCount.rows[0].count}`);

      // Get sample records
      if (parseInt(qaCount.rows[0].count) > 0) {
        const qaSample = await pool.query(`
          SELECT *
          FROM qa_photo_reviews
          ORDER BY created_at DESC
          LIMIT 2;
        `);

        console.log('\n   📝 Sample Records:');
        qaSample.rows.forEach((record, i) => {
          console.log(`\n   Record ${i + 1}:`);
          console.log(`      - drop_number: ${record.drop_number}`);
          console.log(`      - project: ${record.project}`);
          console.log(`      - step_01: ${record.step_01}`);
          console.log(`      - step_12: ${record.step_12}`);
          console.log(`      - ont_serial_scanned: ${record.ont_serial_scanned}`);
          console.log(`      - locked_by: ${record.locked_by}`);
          console.log(`      - created_at: ${record.created_at}`);
        });
      }
      console.log();

      // Get projects
      const qaProjects = await pool.query(`
        SELECT DISTINCT project, COUNT(*) as count
        FROM qa_photo_reviews
        GROUP BY project
        ORDER BY count DESC;
      `);

      console.log('   🏗️  Projects:');
      qaProjects.rows.forEach(proj => {
        console.log(`      - ${proj.project}: ${proj.count} records`);
      });
      console.log();
    }

    // ==================================================================================
    // 2. ANALYZE foto_ai_reviews TABLE
    // ==================================================================================
    console.log('====================================================================');
    console.log('2️⃣  Analyzing foto_ai_reviews (AI Evaluation)');
    console.log('====================================================================\n');

    // Check if table exists
    const fotoTableExists = await pool.query(`
      SELECT EXISTS (
        SELECT 1
        FROM information_schema.tables
        WHERE table_name = 'foto_ai_reviews'
      ) AS exists;
    `);

    if (!fotoTableExists.rows[0].exists) {
      console.log('   ⚠️  Table foto_ai_reviews does not exist\n');
    } else {
      // Get column structure
      console.log('   📋 Column Structure:');
      const fotoColumns = await pool.query(`
        SELECT column_name, data_type, is_nullable, column_default
        FROM information_schema.columns
        WHERE table_name = 'foto_ai_reviews'
        ORDER BY ordinal_position;
      `);

      fotoColumns.rows.forEach(col => {
        console.log(`      - ${col.column_name} (${col.data_type})${col.is_nullable === 'NO' ? ' NOT NULL' : ''}`);
      });
      console.log();

      // Get record count
      const fotoCount = await pool.query('SELECT COUNT(*) AS count FROM foto_ai_reviews;');
      console.log(`   📊 Record Count: ${fotoCount.rows[0].count}`);

      // Get sample records
      if (parseInt(fotoCount.rows[0].count) > 0) {
        const fotoSample = await pool.query(`
          SELECT *
          FROM foto_ai_reviews
          ORDER BY created_at DESC
          LIMIT 2;
        `);

        console.log('\n   📝 Sample Records:');
        fotoSample.rows.forEach((record, i) => {
          console.log(`\n   Record ${i + 1}:`);
          console.log(`      - dr_number: ${record.dr_number}`);
          console.log(`      - overall_status: ${record.overall_status}`);
          console.log(`      - average_score: ${record.average_score}`);
          console.log(`      - step_results: ${record.step_results ? 'Present' : 'Null'}`);
          console.log(`      - created_at: ${record.created_at}`);
        });
      }
      console.log();

      // Get status distribution
      const fotoStatuses = await pool.query(`
        SELECT overall_status, COUNT(*) as count
        FROM foto_ai_reviews
        GROUP BY overall_status
        ORDER BY count DESC;
      `);

      console.log('   📈 Status Distribution:');
      fotoStatuses.rows.forEach(status => {
        console.log(`      - ${status.overall_status}: ${status.count} records`);
      });
      console.log();
    }

    // ==================================================================================
    // 3. FIND OVERLAPPING RECORDS
    // ==================================================================================
    console.log('====================================================================');
    console.log('3️⃣  Finding Overlapping Records (for merge strategy)');
    console.log('====================================================================\n');

    if (qaTableExists.rows[0].exists && fotoTableExists.rows[0].exists) {
      const overlap = await pool.query(`
        SELECT COUNT(*) AS count
        FROM qa_photo_reviews qa
        INNER JOIN foto_ai_reviews foto
          ON qa.drop_number = foto.dr_number;
      `);

      console.log(`   🔗 Records in BOTH tables: ${overlap.rows[0].count}`);

      const qaOnly = await pool.query(`
        SELECT COUNT(*) AS count
        FROM qa_photo_reviews qa
        LEFT JOIN foto_ai_reviews foto
          ON qa.drop_number = foto.dr_number
        WHERE foto.dr_number IS NULL;
      `);

      console.log(`   📋 Records ONLY in qa_photo_reviews: ${qaOnly.rows[0].count}`);

      const fotoOnly = await pool.query(`
        SELECT COUNT(*) AS count
        FROM foto_ai_reviews foto
        LEFT JOIN qa_photo_reviews qa
          ON foto.dr_number = qa.drop_number
        WHERE qa.drop_number IS NULL;
      `);

      console.log(`   🤖 Records ONLY in foto_ai_reviews: ${fotoOnly.rows[0].count}`);
      console.log();
    }

    // ==================================================================================
    // SUMMARY
    // ==================================================================================
    console.log('====================================================================');
    console.log('📊 Migration Analysis Summary');
    console.log('====================================================================\n');

    if (qaTableExists.rows[0].exists) {
      const qaCount = await pool.query('SELECT COUNT(*) AS count FROM qa_photo_reviews;');
      console.log(`✅ qa_photo_reviews: ${qaCount.rows[0].count} records`);
    } else {
      console.log('⚠️  qa_photo_reviews: Table not found');
    }

    if (fotoTableExists.rows[0].exists) {
      const fotoCount = await pool.query('SELECT COUNT(*) AS count FROM foto_ai_reviews;');
      console.log(`✅ foto_ai_reviews: ${fotoCount.rows[0].count} records`);
    } else {
      console.log('⚠️  foto_ai_reviews: Table not found');
    }

    console.log('\nReady to build migration service based on this analysis.');
    console.log('====================================================================\n');

  } catch (error) {
    console.error('\n❌ Analysis failed:\n');
    console.error('Error:', error.message);
    if (error.detail) {
      console.error('Detail:', error.detail);
    }
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run analysis
analyzeTables().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
