/**
 * Run Migration 143: Procurement Settings
 *
 * Creates tables for procurement configuration:
 * - procurement_sequences (number sequences)
 * - procurement_settings (key-value config)
 * - procurement_notifications (event notification preferences)
 *
 * Usage:
 *   DATABASE_URL='...' node scripts/migrations/run-migration-143.js
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  console.log('🚀 Running Migration 143: Procurement Settings');
  console.log('================================================\n');

  try {
    const sqlPath = path.join(__dirname, '143_procurement_settings.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    await pool.query(sql);

    console.log('✅ Migration completed successfully!\n');

    // Verify
    console.log('📋 Verification:');

    const seqCheck = await pool.query('SELECT entity_type, prefix, next_number, padding, reset_period FROM procurement_sequences ORDER BY entity_type');
    console.log('\n  Sequences:');
    seqCheck.rows.forEach(row => {
      console.log(`    ${row.entity_type}: ${row.prefix}${String(row.next_number).padStart(row.padding, '0')} (reset: ${row.reset_period})`);
    });

    const settingsCheck = await pool.query('SELECT setting_key, setting_value, category FROM procurement_settings ORDER BY category, setting_key');
    console.log('\n  Settings:');
    settingsCheck.rows.forEach(row => {
      console.log(`    [${row.category}] ${row.setting_key}: ${JSON.stringify(row.setting_value)}`);
    });

    const notifCheck = await pool.query('SELECT event_type, enabled FROM procurement_notifications ORDER BY event_type');
    console.log('\n  Notifications:');
    notifCheck.rows.forEach(row => {
      console.log(`    ${row.enabled ? '✅' : '❌'} ${row.event_type}`);
    });

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
