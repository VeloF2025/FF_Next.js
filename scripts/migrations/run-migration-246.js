/**
 * Run Migration 246: Stage auto-QA'd DRs for human review
 *
 * Resets feedback_sent on auto-QA'd DRs so human operators
 * can review and send feedback from QA Centre.
 *
 * Usage:
 *   node scripts/migrations/run-migration-246.js
 *
 * Requires DATABASE_URL environment variable.
 */

const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const sqlFile = path.join(__dirname, 'sql', '246_stage_autoqa_drs_for_human_review.sql');
  if (!fs.existsSync(sqlFile)) {
    console.error(`ERROR: Migration file not found: ${sqlFile}`);
    process.exit(1);
  }

  console.log('\n========================================');
  console.log('Migration 246: Stage Auto-QA DRs for Human Review');
  console.log('========================================\n');

  const sql = neon(dbUrl);
  const migrationSql = fs.readFileSync(sqlFile, 'utf8');

  // Count affected DRs before migration
  console.log('Pre-migration state:');
  try {
    const before = await sql`
      SELECT
        count(*) as total,
        count(*) FILTER (WHERE feedback_sent = true) as feedback_sent,
        count(*) FILTER (WHERE feedback_sent IS NULL OR feedback_sent = false) as feedback_not_sent
      FROM dr_photo_unified_reviews
      WHERE qa_decision_by = 'system:auto-qa'
        AND human_reviewer_id IS NULL
    `;
    console.log(`  Total auto-QA DRs (no human review): ${before[0].total}`);
    console.log(`  With feedback_sent=true (blocked):    ${before[0].feedback_sent}`);
    console.log(`  With feedback not sent:               ${before[0].feedback_not_sent}`);
  } catch (err) {
    console.log(`  Could not query pre-state: ${err.message}`);
  }

  // Split by semicolons, respecting $$ blocks
  const statements = [];
  let currentStatement = '';
  let inDollarQuote = false;

  for (const line of migrationSql.split('\n')) {
    const dollarMatches = (line.match(/\$\$/g) || []).length;
    if (dollarMatches % 2 === 1) {
      inDollarQuote = !inDollarQuote;
    }

    currentStatement += line + '\n';

    if (line.trim().endsWith(';') && !inDollarQuote) {
      const stmt = currentStatement.trim();
      if (stmt && !stmt.startsWith('--')) {
        statements.push(stmt);
      }
      currentStatement = '';
    }
  }

  console.log(`\nExecuting ${statements.length} statements...\n`);

  let successCount = 0;
  let errorCount = 0;

  for (const stmt of statements) {
    if (!stmt || stmt.startsWith('--')) continue;

    try {
      await sql.unsafe(stmt);
      successCount++;
    } catch (err) {
      errorCount++;
      console.log(`  ERROR: ${err.message.substring(0, 200)}`);
    }
  }

  console.log(`\nExecution: ${successCount} succeeded, ${errorCount} errors`);

  // Verify post-migration state
  console.log('\nPost-migration state:');
  try {
    const after = await sql`
      SELECT
        count(*) as total,
        count(*) FILTER (WHERE feedback_sent = true) as feedback_sent,
        count(*) FILTER (WHERE human_review_status = 'pending_hitl') as pending_hitl,
        count(*) FILTER (WHERE auto_qa_processed = true) as auto_qa_kept
      FROM dr_photo_unified_reviews
      WHERE qa_decision_by = 'system:auto-qa'
        AND human_reviewer_id IS NULL
    `;
    console.log(`  Total auto-QA DRs (no human review): ${after[0].total}`);
    console.log(`  feedback_sent=true (should be 0):     ${after[0].feedback_sent}`);
    console.log(`  human_review_status=pending_hitl:     ${after[0].pending_hitl}`);
    console.log(`  auto_qa_processed=true (cron skip):   ${after[0].auto_qa_kept}`);
  } catch (err) {
    console.log(`  Could not query post-state: ${err.message}`);
  }

  // List affected drop numbers
  console.log('\nAffected DRs:');
  try {
    const drs = await sql`
      SELECT drop_number, project, qa_decision, human_review_status, feedback_sent
      FROM dr_photo_unified_reviews
      WHERE qa_decision_by = 'system:auto-qa'
        AND human_reviewer_id IS NULL
      ORDER BY updated_at DESC
      LIMIT 50
    `;
    for (const dr of drs) {
      console.log(`  ${dr.drop_number} | ${dr.project || 'no-project'} | decision=${dr.qa_decision} | hitl=${dr.human_review_status} | feedback=${dr.feedback_sent}`);
    }
    if (drs.length === 50) console.log('  ... (showing first 50)');
  } catch (err) {
    console.log(`  Could not list DRs: ${err.message}`);
  }

  console.log('\n========================================');
  console.log('Migration 246 Complete');
  console.log('========================================\n');
}

runMigration().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
