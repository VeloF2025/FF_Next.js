const { neon } = require('@neondatabase/serverless');
require('dotenv').config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL);

async function run() {
  try {
    await sql`ALTER TABLE dr_photo_unified_reviews ADD COLUMN IF NOT EXISTS auto_qa_processed BOOLEAN DEFAULT FALSE`;
    await sql`ALTER TABLE dr_photo_unified_reviews ADD COLUMN IF NOT EXISTS auto_qa_processed_at TIMESTAMPTZ`;
    await sql`ALTER TABLE dr_photo_unified_reviews ADD COLUMN IF NOT EXISTS auto_qa_results JSONB`;
    await sql`ALTER TABLE dr_photo_unified_reviews ADD COLUMN IF NOT EXISTS auto_qa_eligible_at TIMESTAMPTZ`;
    console.log('Columns added');

    const backfill = await sql`UPDATE dr_photo_unified_reviews SET auto_qa_eligible_at = wa_received_at + INTERVAL '30 minutes' WHERE wa_received_at IS NOT NULL AND auto_qa_eligible_at IS NULL`;
    console.log('Backfilled auto_qa_eligible_at');

    await sql`CREATE INDEX IF NOT EXISTS idx_unified_auto_qa_eligible ON dr_photo_unified_reviews (auto_qa_eligible_at) WHERE auto_qa_processed = false AND photo_count > 0`;
    console.log('Index created');

    console.log('Migration 242 complete');
  } catch (err) {
    console.error('Migration error:', err.message);
    process.exit(1);
  }
}

run();
