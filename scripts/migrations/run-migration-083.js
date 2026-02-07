/**
 * Run Migration 083: Activity Log and QA Validation
 *
 * Usage: node scripts/migrations/run-migration-083.js
 */

const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL ||
  'process.env.DATABASE_URL';

async function runMigration() {
  console.log('Starting Migration 083: Activity Log and QA Validation');
  console.log('='.repeat(60));

  const sql = neon(DATABASE_URL);

  try {
    // 1. Create activity log table
    console.log('\n1. Creating dr_activity_log table...');
    await sql`
      CREATE TABLE IF NOT EXISTS dr_activity_log (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        drop_number VARCHAR(50) NOT NULL,
        event_type VARCHAR(50) NOT NULL,
        event_data JSONB DEFAULT '{}'::jsonb,
        actor VARCHAR(100),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `;
    console.log('   ✅ Table dr_activity_log created');

    // 2. Create activity log indexes
    console.log('\n2. Creating activity log indexes...');
    await sql`CREATE INDEX IF NOT EXISTS idx_activity_log_drop ON dr_activity_log(drop_number)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_activity_log_type ON dr_activity_log(event_type)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_activity_log_created ON dr_activity_log(created_at DESC)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_activity_log_drop_created ON dr_activity_log(drop_number, created_at DESC)`;
    console.log('   ✅ Activity log indexes created');

    // 3. Add timestamp columns
    console.log('\n3. Adding timestamp columns...');
    await sql`ALTER TABLE dr_photo_unified_reviews ADD COLUMN IF NOT EXISTS whatsapp_submitted_at TIMESTAMP WITH TIME ZONE`;
    await sql`ALTER TABLE dr_photo_unified_reviews ADD COLUMN IF NOT EXISTS acknowledged_at TIMESTAMP WITH TIME ZONE`;
    await sql`ALTER TABLE dr_photo_unified_reviews ADD COLUMN IF NOT EXISTS photos_fetched_at TIMESTAMP WITH TIME ZONE`;
    console.log('   ✅ Timestamp columns added');

    // 4. Add VLM QA validation columns
    console.log('\n4. Adding VLM QA validation columns...');
    await sql`ALTER TABLE dr_photo_unified_reviews ADD COLUMN IF NOT EXISTS vlm_qa_status VARCHAR(50) DEFAULT 'pending'`;
    await sql`ALTER TABLE dr_photo_unified_reviews ADD COLUMN IF NOT EXISTS vlm_qa_results JSONB DEFAULT '[]'::jsonb`;
    await sql`ALTER TABLE dr_photo_unified_reviews ADD COLUMN IF NOT EXISTS vlm_qa_validated_at TIMESTAMP WITH TIME ZONE`;
    await sql`ALTER TABLE dr_photo_unified_reviews ADD COLUMN IF NOT EXISTS vlm_qa_summary JSONB`;
    console.log('   ✅ VLM QA validation columns added');

    // 5. Add human review columns
    console.log('\n5. Adding human review columns...');
    await sql`ALTER TABLE dr_photo_unified_reviews ADD COLUMN IF NOT EXISTS human_qa_overrides JSONB DEFAULT '[]'::jsonb`;
    await sql`ALTER TABLE dr_photo_unified_reviews ADD COLUMN IF NOT EXISTS human_review_status VARCHAR(50) DEFAULT 'pending'`;
    await sql`ALTER TABLE dr_photo_unified_reviews ADD COLUMN IF NOT EXISTS human_review_completed_at TIMESTAMP WITH TIME ZONE`;
    await sql`ALTER TABLE dr_photo_unified_reviews ADD COLUMN IF NOT EXISTS human_reviewer_id TEXT`;
    console.log('   ✅ Human review columns added');

    // 6. Create QA indexes
    console.log('\n6. Creating QA filtering indexes...');
    await sql`CREATE INDEX IF NOT EXISTS idx_dr_unified_vlm_qa_status ON dr_photo_unified_reviews(vlm_qa_status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_dr_unified_human_review_status ON dr_photo_unified_reviews(human_review_status)`;
    console.log('   ✅ QA indexes created');

    // 7. Backfill whatsapp_submitted_at
    console.log('\n7. Backfilling whatsapp_submitted_at from created_at...');
    const backfillResult = await sql`
      UPDATE dr_photo_unified_reviews
      SET whatsapp_submitted_at = created_at
      WHERE whatsapp_submitted_at IS NULL
      RETURNING drop_number
    `;
    console.log(`   ✅ Backfilled ${backfillResult.length} records`);

    // 8. Verify
    console.log('\n8. Verifying migration...');

    const activityTableExists = await sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'dr_activity_log'
      ) as exists
    `;
    console.log(`   - dr_activity_log table: ${activityTableExists[0].exists ? '✅' : '❌'}`);

    const columnCount = await sql`
      SELECT COUNT(*) as count
      FROM information_schema.columns
      WHERE table_name = 'dr_photo_unified_reviews'
        AND column_name IN (
          'whatsapp_submitted_at',
          'acknowledged_at',
          'photos_fetched_at',
          'vlm_qa_status',
          'vlm_qa_results',
          'vlm_qa_validated_at',
          'vlm_qa_summary',
          'human_qa_overrides',
          'human_review_status',
          'human_review_completed_at',
          'human_reviewer_id'
        )
    `;
    console.log(`   - New columns: ${columnCount[0].count}/11 ✅`);

    console.log('\n' + '='.repeat(60));
    console.log('Migration 083 COMPLETE');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    throw error;
  }
}

runMigration()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
