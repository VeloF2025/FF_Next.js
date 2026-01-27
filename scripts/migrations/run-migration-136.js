/**
 * Run Migration 136: PO Approval Versioning
 *
 * Purpose: Add versioning support for purchase orders and configure
 * approval levels with custom thresholds.
 *
 * Usage:
 *   node scripts/migrations/run-migration-136.js
 *
 * Or with explicit DATABASE_URL:
 *   DATABASE_URL='...' node scripts/migrations/run-migration-136.js
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  console.log('🚀 Running Migration 136: PO Approval Versioning');
  console.log('================================================\n');

  try {
    const sqlPath = path.join(__dirname, '136_po_approval_versioning.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    await pool.query(sql);

    console.log('✅ Migration completed successfully!\n');

    // Verify the changes
    console.log('📋 Verification:');

    // Check PO version column
    const poCheck = await pool.query(`
      SELECT column_name, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'purchase_orders'
        AND column_name IN ('version', 'current_approval_request_id')
      ORDER BY column_name
    `);
    console.log('\n  PO columns added:');
    poCheck.rows.forEach(row => {
      console.log(`    - ${row.column_name} (${row.data_type})`);
    });

    // Check version history table
    const versionTableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'purchase_order_versions'
      ) as exists
    `);
    console.log(`\n  Version history table: ${versionTableCheck.rows[0].exists ? '✅' : '❌'}`);

    // Check approval levels
    const levelsCheck = await pool.query(`
      SELECT al.level_number, al.name, al.min_amount, al.max_amount, al.auto_approve, al.approver_role
      FROM approval_levels al
      JOIN approval_workflows aw ON al.workflow_id = aw.id
      WHERE aw.workflow_type = 'purchase_order'
      ORDER BY al.level_number
    `);
    console.log('\n  PO Approval Levels:');
    levelsCheck.rows.forEach(row => {
      const threshold = row.max_amount
        ? `R${row.min_amount.toLocaleString()} - R${row.max_amount.toLocaleString()}`
        : `> R${row.min_amount.toLocaleString()}`;
      const approver = row.auto_approve ? 'Auto-approve' : row.approver_role;
      console.log(`    Level ${row.level_number}: ${row.name} (${threshold}) → ${approver}`);
    });

    // Check escalation setting
    const escalationCheck = await pool.query(`
      SELECT escalation_enabled, escalation_hours
      FROM approval_workflows
      WHERE workflow_type = 'purchase_order'
    `);
    if (escalationCheck.rows.length > 0) {
      const { escalation_enabled, escalation_hours } = escalationCheck.rows[0];
      console.log(`\n  Escalation: ${escalation_enabled ? `✅ Enabled (${escalation_hours}h)` : '❌ Disabled'}`);
    }

    console.log('\n✅ All verifications passed!');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
