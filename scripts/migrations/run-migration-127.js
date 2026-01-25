/**
 * Run Migration 127: OLT Investigation Workflow
 *
 * Adds columns for investigation workflow, escalation, and resolution tracking
 *
 * Usage: DATABASE_URL='...' node scripts/migrations/run-migration-127.js
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  const client = await pool.connect();

  try {
    console.log('Starting migration 127: OLT Investigation Workflow...');

    // Read and execute SQL
    const sqlPath = path.join(__dirname, '127_olt_investigation_workflow.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    // Split by semicolons and execute each statement
    const statements = sql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (const statement of statements) {
      if (statement.length > 0) {
        console.log('Executing:', statement.substring(0, 80) + '...');
        await client.query(statement);
      }
    }

    // Verify columns were added
    const verifyResult = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'olt_mismatch_records'
        AND column_name IN ('resolution_type', 'resolution_notes', 'escalated_to', 'escalated_at', 'escalated_by', 'resolved_at', 'resolved_by')
      ORDER BY column_name
    `);

    console.log('\n✅ Migration 127 completed successfully!');
    console.log('New columns added:');
    verifyResult.rows.forEach(row => {
      console.log(`  - ${row.column_name}: ${row.data_type}`);
    });

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

runMigration().catch(err => {
  console.error(err);
  process.exit(1);
});
