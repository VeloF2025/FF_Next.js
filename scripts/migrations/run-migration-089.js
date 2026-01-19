/**
 * Migration Runner for 089: Rename Ticketing Module to Maintenance
 *
 * BREAKING CHANGE: This migration renames all ticketing tables to maintenance
 *
 * Run with:
 *   node scripts/migrations/run-migration-089.js
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
    console.log('  DATABASE_URL="postgresql://..." node scripts/migrations/run-migration-089.js');
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });

  console.log('='.repeat(60));
  console.log('Migration 089: Rename Ticketing Module to Maintenance');
  console.log('='.repeat(60));
  console.log('');
  console.log('WARNING: This is a BREAKING CHANGE migration!');
  console.log('');
  console.log('Changes:');
  console.log('  - Renames 12 tables from ticketing to maintenance');
  console.log('  - Updates enum values (maintenance -> fault_repair, etc.)');
  console.log('  - Renames all indexes and constraints');
  console.log('');

  // Read the SQL file
  const sqlFilePath = path.join(__dirname, '089_rename_ticketing_to_maintenance.sql');
  const sqlContent = fs.readFileSync(sqlFilePath, 'utf8');

  let client;
  try {
    client = await pool.connect();

    // Check if tables exist before running
    console.log('Checking existing tables...');

    const ticketsCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'tickets'
      ) as exists
    `);

    const maintenanceCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'maintenance_tickets'
      ) as exists
    `);

    if (maintenanceCheck.rows[0].exists) {
      console.log('');
      console.log('SKIP: maintenance_tickets table already exists.');
      console.log('Migration appears to have already been run.');
      client.release();
      await pool.end();
      process.exit(0);
    }

    if (!ticketsCheck.rows[0].exists) {
      console.log('');
      console.log('SKIP: tickets table does not exist.');
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
        (SELECT COUNT(*) FROM tickets) as tickets,
        (SELECT COUNT(*) FROM ticket_attachments) as attachments,
        (SELECT COUNT(*) FROM ticket_notes) as notes,
        (SELECT COUNT(*) FROM verification_steps) as verification_steps
    `);

    console.log(`  tickets: ${counts.rows[0].tickets}`);
    console.log(`  ticket_attachments: ${counts.rows[0].attachments}`);
    console.log(`  ticket_notes: ${counts.rows[0].notes}`);
    console.log(`  verification_steps: ${counts.rows[0].verification_steps}`);

    console.log('');
    console.log('Running migration...');
    console.log('');

    // Start transaction
    await client.query('BEGIN');

    // Execute the migration - split and execute statements sequentially
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
        // Skip pure comment blocks and transaction control statements
        const lines = s.split('\n').map(l => l.trim()).filter(l => l.length > 0);
        const nonCommentLines = lines.filter(l => !l.startsWith('--'));
        if (nonCommentLines.length === 0) return false;
        // Skip BEGIN/COMMIT
        if (nonCommentLines[0] === 'BEGIN' || nonCommentLines[0] === 'COMMIT') return false;
        return true;
      });

    for (const statement of statements) {
      // Extract the actual SQL (skip comment lines at the start)
      const lines = statement.split('\n');
      const sqlLines = lines.filter(l => !l.trim().startsWith('--') || l.includes('=')); // Keep separator comments with =
      const actualSql = lines.join('\n'); // Execute the full statement including comments

      if (statement.includes('ALTER TABLE') || statement.includes('UPDATE') || statement.includes('COMMENT ON') || statement.includes('DO $$')) {
        // Find first non-comment line for logging
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
        (SELECT COUNT(*) FROM maintenance_tickets) as tickets,
        (SELECT COUNT(*) FROM maintenance_attachments) as attachments,
        (SELECT COUNT(*) FROM maintenance_notes) as notes,
        (SELECT COUNT(*) FROM maintenance_verification_steps) as verification_steps
    `);

    console.log('');
    console.log('New table row counts:');
    console.log(`  maintenance_tickets: ${newCounts.rows[0].tickets}`);
    console.log(`  maintenance_attachments: ${newCounts.rows[0].attachments}`);
    console.log(`  maintenance_notes: ${newCounts.rows[0].notes}`);
    console.log(`  maintenance_verification_steps: ${newCounts.rows[0].verification_steps}`);

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
