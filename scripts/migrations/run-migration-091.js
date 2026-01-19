/**
 * Migration Runner for 090: Rename Remaining Ticket Tables
 *
 * Run with:
 *   node scripts/migrations/run-migration-090.js
 *
 * Environment:
 *   DATABASE_URL - PostgreSQL connection string
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    console.log('');
    console.log('Usage:');
    console.log('  DATABASE_URL="postgresql://..." node scripts/migrations/run-migration-090.js');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });

  console.log('='.repeat(60));
  console.log('Migration 091: Rename Remaining Ticket Tables');
  console.log('='.repeat(60));
  console.log('');
  console.log('Tables to rename:');
  console.log('  - ticket_statuses -> maintenance_statuses');
  console.log('  - ticket_activities -> maintenance_activities');
  console.log('  - ticket_history -> maintenance_history');
  console.log('  - ticket_tags -> maintenance_tags');
  console.log('  - ticket_assignment_history -> maintenance_assignment_history');
  console.log('  - ticket_billing -> maintenance_billing');
  console.log('');

  // Read the SQL file
  const sqlFilePath = path.join(__dirname, '091_rename_remaining_ticket_tables.sql');
  const sqlContent = fs.readFileSync(sqlFilePath, 'utf8');

  let client;
  try {
    client = await pool.connect();

    // Check if migration already ran
    console.log('Checking existing tables...');

    const statusesCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'maintenance_statuses'
      ) as exists
    `);

    const oldStatusesCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'ticket_statuses'
      ) as exists
    `);

    if (statusesCheck.rows[0].exists && !oldStatusesCheck.rows[0].exists) {
      console.log('');
      console.log('SKIP: maintenance_statuses already exists and ticket_statuses does not.');
      console.log('Migration appears to have already been run.');
      client.release();
      await pool.end();
      process.exit(0);
    }

    if (!oldStatusesCheck.rows[0].exists) {
      console.log('');
      console.log('SKIP: ticket_statuses table does not exist.');
      console.log('Nothing to migrate.');
      client.release();
      await pool.end();
      process.exit(0);
    }

    // Get row counts before migration
    console.log('');
    console.log('Current table row counts:');

    const counts = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM ticket_statuses) as statuses,
        (SELECT COUNT(*) FROM ticket_activities) as activities,
        (SELECT COUNT(*) FROM ticket_history) as history,
        (SELECT COUNT(*) FROM ticket_tags) as tags,
        (SELECT COUNT(*) FROM ticket_assignment_history) as assignment_history,
        (SELECT COUNT(*) FROM ticket_billing) as billing
    `);

    console.log(`  ticket_statuses: ${counts.rows[0].statuses}`);
    console.log(`  ticket_activities: ${counts.rows[0].activities}`);
    console.log(`  ticket_history: ${counts.rows[0].history}`);
    console.log(`  ticket_tags: ${counts.rows[0].tags}`);
    console.log(`  ticket_assignment_history: ${counts.rows[0].assignment_history}`);
    console.log(`  ticket_billing: ${counts.rows[0].billing}`);

    console.log('');
    console.log('Running migration...');
    console.log('');

    // Start transaction
    await client.query('BEGIN');

    // Handle DO $$ ... END $$; blocks specially (they contain semicolons)
    const doBlockRegex = /DO\s*\$\$.*?END\s*\$\$/gs;
    const doBlocks = [];
    let processedContent = sqlContent.replace(doBlockRegex, (match) => {
      const placeholder = `__DO_BLOCK_${doBlocks.length}__`;
      doBlocks.push(match);
      return placeholder;
    });

    const statements = processedContent
      .split(';')
      .map(s => s.trim())
      .map(s => {
        // Restore DO blocks
        return s.replace(/__DO_BLOCK_(\d+)__/g, (_, idx) => doBlocks[parseInt(idx)]);
      })
      .filter(s => {
        if (s.length === 0) return false;
        const lines = s.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        const nonCommentLines = lines.filter(l => !l.startsWith('--'));
        if (nonCommentLines.length === 0) return false;
        // Skip BEGIN/COMMIT (we handle transaction ourselves)
        if (nonCommentLines[0] === 'BEGIN' || nonCommentLines[0] === 'COMMIT') return false;
        return true;
      });

    for (const statement of statements) {
      const lines = statement.split('\n');

      if (statement.includes('ALTER TABLE') || statement.includes('COMMENT ON') || statement.includes('DO $$')) {
        const firstSqlLine = lines.find(l => l.trim() && !l.trim().startsWith('--')) || statement;
        const shortStatement = firstSqlLine.substring(0, 80).replace(/\n/g, ' ').trim();
        console.log(`  Executing: ${shortStatement}...`);
        await client.query(statement);
      }
    }

    // Commit transaction
    await client.query('COMMIT');

    // Verify migration
    console.log('');
    console.log('Verifying migration...');

    const newCounts = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM maintenance_statuses) as statuses,
        (SELECT COUNT(*) FROM maintenance_activities) as activities,
        (SELECT COUNT(*) FROM maintenance_history) as history,
        (SELECT COUNT(*) FROM maintenance_tags) as tags,
        (SELECT COUNT(*) FROM maintenance_assignment_history) as assignment_history,
        (SELECT COUNT(*) FROM maintenance_billing) as billing
    `);

    console.log('');
    console.log('New table row counts:');
    console.log(`  maintenance_statuses: ${newCounts.rows[0].statuses}`);
    console.log(`  maintenance_activities: ${newCounts.rows[0].activities}`);
    console.log(`  maintenance_history: ${newCounts.rows[0].history}`);
    console.log(`  maintenance_tags: ${newCounts.rows[0].tags}`);
    console.log(`  maintenance_assignment_history: ${newCounts.rows[0].assignment_history}`);
    console.log(`  maintenance_billing: ${newCounts.rows[0].billing}`);

    console.log('');
    console.log('='.repeat(60));
    console.log('Migration completed successfully!');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('');
    console.error('ERROR: Migration failed!');
    console.error(error.message);
    console.error('');

    if (client) {
      try {
        await client.query('ROLLBACK');
        console.error('The transaction has been rolled back.');
      } catch (rollbackError) {
        console.error('Failed to rollback:', rollbackError.message);
      }
    }

    process.exit(1);
  } finally {
    if (client) {
      client.release();
    }
    await pool.end();
  }
}

runMigration();
