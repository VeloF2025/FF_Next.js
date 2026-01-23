/**
 * Migration Runner: 114_maintenance_wa_tracking.sql
 *
 * Creates tables for Mohadin QA WhatsApp maintenance tracking:
 * - maintenance_wa_messages
 * - maintenance_wa_photos
 * - dr_maintenance_flags
 * - maintenance_wa_sender_context
 *
 * Run with: node scripts/migrations/run-migration-114.js
 */

const { neonConfig, Pool } = require('@neondatabase/serverless');
const ws = require('ws');
const fs = require('fs');
const path = require('path');

neonConfig.webSocketConstructor = ws;

const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require';

async function runMigration() {
  const pool = new Pool({ connectionString: DATABASE_URL });

  try {
    console.log('Running migration 114_maintenance_wa_tracking.sql...');
    console.log('Database:', DATABASE_URL.split('@')[1]?.split('/')[0] || 'configured');
    console.log('');

    const sqlPath = path.join(__dirname, '114_maintenance_wa_tracking.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    // Run the entire migration as one script
    await pool.query(sql);

    console.log('✅ Migration 114 completed successfully!\n');

    // Verify tables were created
    const tables = [
      'maintenance_wa_messages',
      'maintenance_wa_photos',
      'dr_maintenance_flags',
      'maintenance_wa_sender_context'
    ];

    console.log('Verifying tables:');
    for (const table of tables) {
      const { rows } = await pool.query(`
        SELECT COUNT(*) as col_count
        FROM information_schema.columns
        WHERE table_name = $1
      `, [table]);

      if (rows[0].col_count > 0) {
        console.log(`  ✓ ${table} (${rows[0].col_count} columns)`);
      } else {
        console.log(`  ✗ ${table} NOT FOUND`);
      }
    }

    // Check triggers
    console.log('\nVerifying triggers:');
    const { rows: triggers } = await pool.query(`
      SELECT trigger_name, event_manipulation, action_statement
      FROM information_schema.triggers
      WHERE trigger_name LIKE 'trg_%maint%'
    `);

    if (triggers.length > 0) {
      triggers.forEach(t => console.log(`  ✓ ${t.trigger_name}`));
    } else {
      console.log('  (No triggers found - may be using functions)');
    }

    // Check functions
    console.log('\nVerifying functions:');
    const { rows: functions } = await pool.query(`
      SELECT routine_name
      FROM information_schema.routines
      WHERE routine_name LIKE '%maintenance%'
        AND routine_type = 'FUNCTION'
    `);

    if (functions.length > 0) {
      functions.forEach(f => console.log(`  ✓ ${f.routine_name}`));
    } else {
      console.log('  (No matching functions found)');
    }

    console.log('\n✅ Migration 114 verification complete!');

  } catch (error) {
    console.error('Migration failed:', error.message);
    if (error.detail) console.error('Detail:', error.detail);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
