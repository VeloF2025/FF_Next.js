/**
 * Run Migration 100: Fix OES activation timestamp and separate Installed vs Activated
 *
 * Usage: DATABASE_URL='...' node scripts/migrations/run-migration-100.js
 */

const { neon } = require('@neondatabase/serverless');

async function runMigration() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const sql = neon(databaseUrl);

  console.log('Running Migration 100: OES timestamp fix...\n');

  try {
    // Step 1: Add activation_datetime column
    console.log('Step 1: Adding activation_datetime column...');
    await sql`
      ALTER TABLE oes_activations
      ADD COLUMN IF NOT EXISTS activation_datetime TIMESTAMP WITH TIME ZONE
    `;
    console.log('  Done');

    // Step 2: Copy existing dates
    console.log('Step 2: Copying existing dates to activation_datetime...');
    const copyResult = await sql`
      UPDATE oes_activations
      SET activation_datetime = activation_date::TIMESTAMP WITH TIME ZONE
      WHERE activation_datetime IS NULL AND activation_date IS NOT NULL
      RETURNING drop_number
    `;
    console.log(`  Updated ${copyResult.length} records`);

    // Step 3: Add is_oes_only flag
    console.log('Step 3: Adding is_oes_only column...');
    await sql`
      ALTER TABLE dr_photo_unified_reviews
      ADD COLUMN IF NOT EXISTS is_oes_only BOOLEAN DEFAULT FALSE
    `;
    console.log('  Done');

    // Step 4: Mark OES-only records
    console.log('Step 4: Marking OES-only records...');
    const markResult = await sql`
      UPDATE dr_photo_unified_reviews
      SET is_oes_only = TRUE
      WHERE photo_source = 'OES Import'
        AND (wa_received_at IS NULL OR wa_message_id IS NULL)
      RETURNING drop_number
    `;
    console.log(`  Marked ${markResult.length} records as OES-only`);

    // Step 5: Clear submitted_date for OES-only
    console.log('Step 5: Clearing submitted_date for OES-only records...');
    const clearResult = await sql`
      UPDATE dr_photo_unified_reviews
      SET submitted_date = NULL
      WHERE is_oes_only = TRUE AND submitted_date IS NOT NULL
      RETURNING drop_number
    `;
    console.log(`  Cleared submitted_date for ${clearResult.length} records`);

    // Step 6: Create index
    console.log('Step 6: Creating index...');
    await sql`
      CREATE INDEX IF NOT EXISTS idx_unified_is_oes_only
      ON dr_photo_unified_reviews(is_oes_only)
      WHERE is_oes_only = TRUE
    `;
    console.log('  Done');

    // Step 7: Verify
    console.log('\nVerification:');
    const verify = await sql`
      SELECT
        COUNT(*) FILTER (WHERE is_oes_only = TRUE) as oes_only_count,
        COUNT(*) FILTER (WHERE is_oes_only = TRUE AND submitted_date IS NULL) as oes_only_null_submitted,
        COUNT(*) FILTER (WHERE is_oes_only = FALSE OR is_oes_only IS NULL) as wa_submitted_count
      FROM dr_photo_unified_reviews
    `;
    console.log(`  OES-only records: ${verify[0].oes_only_count}`);
    console.log(`  OES-only with NULL submitted_date: ${verify[0].oes_only_null_submitted}`);
    console.log(`  WhatsApp submitted records: ${verify[0].wa_submitted_count}`);

    console.log('\nMigration 100 completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  }
}

runMigration();
