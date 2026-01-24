#!/usr/bin/env node
/**
 * Run migration 123 - OLT Report Import
 *
 * Adds:
 * - olt_report_imports table for tracking imports
 * - OLT serial columns to offline_devices
 * - 1Map fix tracking columns
 * - View for OLT vs 1Map comparison
 *
 * Usage: node scripts/migrations/run-migration-123.js
 */

const { Pool } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require';

async function runMigration() {
  const pool = new Pool({ connectionString: DATABASE_URL });

  try {
    console.log('Running migration 123: OLT Report Import...\n');

    const sqlPath = path.join(__dirname, '123_olt_report_import.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    await pool.query(sql);

    console.log('Migration 123 completed successfully!\n');

    // Verify olt_report_imports table
    const tableCheck = await pool.query(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_name = 'olt_report_imports'
      ) as exists
    `);
    console.log('olt_report_imports table:', tableCheck.rows[0].exists ? 'OK' : 'MISSING');

    // Verify OLT columns
    const colCheck = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'offline_devices'
        AND column_name LIKE 'olt_%'
      ORDER BY column_name
    `);
    console.log('OLT columns:', colCheck.rows.map(r => r.column_name).join(', '));

    // Verify 1Map fix columns
    const fixColCheck = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'offline_devices'
        AND column_name LIKE 'onemap_fix_%'
      ORDER BY column_name
    `);
    console.log('1Map fix columns:', fixColCheck.rows.map(r => r.column_name).join(', '));

    // Check view
    const viewCheck = await pool.query(`
      SELECT viewname FROM pg_views
      WHERE viewname = 'v_olt_onemap_mismatches'
    `);
    console.log('View v_olt_onemap_mismatches:', viewCheck.rows.length > 0 ? 'OK' : 'MISSING');

  } catch (error) {
    console.error('Migration failed:', error.message);
    throw error;
  } finally {
    await pool.end();
  }
}

runMigration().catch(err => {
  console.error(err);
  process.exit(1);
});
