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

const { neon } = require('@neondatabase/serverless');
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

  const sql = neon(databaseUrl);

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

  try {
    // Check if tables exist before running
    console.log('Checking existing tables...');

    const ticketsCheck = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'tickets'
      ) as exists
    `;

    const maintenanceCheck = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'maintenance_tickets'
      ) as exists
    `;

    if (maintenanceCheck[0].exists) {
      console.log('');
      console.log('SKIP: maintenance_tickets table already exists.');
      console.log('Migration appears to have already been run.');
      process.exit(0);
    }

    if (!ticketsCheck[0].exists) {
      console.log('');
      console.log('SKIP: tickets table does not exist.');
      console.log('Nothing to migrate.');
      process.exit(0);
    }

    // Get row counts before migration
    console.log('');
    console.log('Current table row counts:');

    const counts = await sql`
      SELECT
        (SELECT COUNT(*) FROM tickets) as tickets,
        (SELECT COUNT(*) FROM ticket_attachments) as attachments,
        (SELECT COUNT(*) FROM ticket_notes) as notes,
        (SELECT COUNT(*) FROM verification_steps) as verification_steps
    `;

    console.log(`  tickets: ${counts[0].tickets}`);
    console.log(`  ticket_attachments: ${counts[0].attachments}`);
    console.log(`  ticket_notes: ${counts[0].notes}`);
    console.log(`  verification_steps: ${counts[0].verification_steps}`);

    console.log('');
    console.log('Running migration...');
    console.log('');

    // Execute the migration
    await sql.transaction(async (tx) => {
      // Split by semicolons and execute each statement
      // Note: This is a simplified approach; complex migrations may need better parsing
      const statements = sqlContent
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--') && !s.startsWith('BEGIN') && !s.startsWith('COMMIT'));

      for (const statement of statements) {
        if (statement.includes('ALTER TABLE') || statement.includes('UPDATE') || statement.includes('COMMENT')) {
          const shortStatement = statement.substring(0, 80).replace(/\n/g, ' ');
          console.log(`  Executing: ${shortStatement}...`);
          await tx.unsafe(statement);
        }
      }
    });

    // Verify migration
    console.log('');
    console.log('Verifying migration...');

    const newCounts = await sql`
      SELECT
        (SELECT COUNT(*) FROM maintenance_tickets) as tickets,
        (SELECT COUNT(*) FROM maintenance_attachments) as attachments,
        (SELECT COUNT(*) FROM maintenance_notes) as notes,
        (SELECT COUNT(*) FROM maintenance_verification_steps) as verification_steps
    `;

    console.log('');
    console.log('New table row counts:');
    console.log(`  maintenance_tickets: ${newCounts[0].tickets}`);
    console.log(`  maintenance_attachments: ${newCounts[0].attachments}`);
    console.log(`  maintenance_notes: ${newCounts[0].notes}`);
    console.log(`  maintenance_verification_steps: ${newCounts[0].verification_steps}`);

    console.log('');
    console.log('='.repeat(60));
    console.log('Migration completed successfully!');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('');
    console.error('ERROR: Migration failed!');
    console.error(error.message);
    console.error('');
    console.error('The transaction has been rolled back.');
    process.exit(1);
  }
}

runMigration();
