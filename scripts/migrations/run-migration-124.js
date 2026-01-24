#!/usr/bin/env node
/**
 * Run migration 124: Add olt_wrong_onemap_serial column
 */

const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

async function runMigration() {
  await client.connect();

  try {
    console.log('Running migration 124...');

    // Add column
    await client.query(`
      ALTER TABLE offline_devices
      ADD COLUMN IF NOT EXISTS olt_wrong_onemap_serial VARCHAR(50)
    `);
    console.log('✓ Added olt_wrong_onemap_serial column');

    // Drop and recreate view (can't change column types with CREATE OR REPLACE)
    await client.query(`DROP VIEW IF EXISTS v_olt_onemap_mismatches`);
    console.log('✓ Dropped old view');

    await client.query(`
      CREATE VIEW v_olt_onemap_mismatches AS
      SELECT
        o.id,
        o.drop_number,
        o.zone,
        o.address,
        o.olt_serial,
        COALESCE(o.olt_wrong_onemap_serial, r.ont_serial_scanned) as onemap_serial,
        NULL::TEXT as onemap_prop_id,
        o.serial_number as offline_serial,
        e.serial_number as oes_serial,
        o.onemap_fix_attempted,
        o.onemap_fix_result,
        o.onemap_fix_old_value,
        o.onemap_fix_at,
        COALESCE(o.mismatch_status, 'pending_investigation') as status,
        oi.filename as import_filename,
        oi.imported_at as import_date,
        CASE
          WHEN o.olt_serial IS NULL THEN 'empty_olt'
          WHEN o.olt_wrong_onemap_serial IS NOT NULL AND UPPER(o.olt_serial) != UPPER(o.olt_wrong_onemap_serial) THEN 'mismatch'
          WHEN o.olt_wrong_onemap_serial IS NOT NULL AND UPPER(o.olt_serial) = UPPER(o.olt_wrong_onemap_serial) THEN 'match'
          WHEN r.ont_serial_scanned IS NULL THEN 'no_onemap'
          WHEN UPPER(o.olt_serial) = UPPER(r.ont_serial_scanned) THEN 'match'
          ELSE 'mismatch'
        END as comparison_status
      FROM offline_devices o
      LEFT JOIN dr_photo_unified_reviews r ON o.drop_number = r.drop_number
      LEFT JOIN oes_activations e ON o.drop_number = e.drop_number
      LEFT JOIN olt_report_imports oi ON o.olt_report_id = oi.id
      WHERE o.olt_serial IS NOT NULL
         OR o.olt_report_id IS NOT NULL
         OR o.olt_wrong_onemap_serial IS NOT NULL
    `);
    console.log('✓ Updated v_olt_onemap_mismatches view');

    console.log('✅ Migration 124 complete');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration();
