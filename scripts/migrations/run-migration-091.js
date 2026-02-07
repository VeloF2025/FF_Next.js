/**
 * Run Migration 091: Offline Devices Tracking
 *
 * Usage: node scripts/migrations/run-migration-091.js
 */

const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL ||
  'process.env.DATABASE_URL';

async function runMigration() {
  console.log('Starting Migration 091: Offline Devices Tracking');
  console.log('='.repeat(60));

  const sql = neon(DATABASE_URL);

  try {
    // Read the migration file
    const migrationPath = path.join(__dirname, '091_offline_devices_tracking.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    // Split by semicolons and filter out comments-only statements
    const statements = migrationSQL
      .split(';')
      .map(s => s.trim())
      .filter(s => s && !s.startsWith('--') && s.length > 5);

    console.log('Found ' + statements.length + ' SQL statements to execute\n');

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];
      // Skip pure comment blocks
      if (stmt.split('\n').every(line => line.trim().startsWith('--') || line.trim() === '')) {
        continue;
      }

      // Extract first meaningful line for logging
      const firstLine = stmt.split('\n').find(line => !line.trim().startsWith('--') && line.trim() !== '') || '';
      const preview = firstLine.substring(0, 60).replace(/\s+/g, ' ');
      console.log('[' + (i + 1) + '/' + statements.length + '] ' + preview + '...');

      try {
        await sql.unsafe(stmt);
        console.log('    ✓ Success');
      } catch (err) {
        // Some errors are expected (e.g., "already exists")
        if (err.message.includes('already exists') || err.message.includes('duplicate')) {
          console.log('    ⚠ Skipped (already exists)');
        } else {
          console.error('    ✗ Error: ' + err.message);
          throw err;
        }
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('Migration 091 completed successfully!');
    console.log('='.repeat(60));

    // Verify tables
    console.log('\nVerifying tables...');

    const tables = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('offline_import_batches', 'offline_devices', 'offline_alerts')
      ORDER BY table_name
    `;
    console.log('Created tables:', tables.map(t => t.table_name).join(', '));

    // Check drops columns
    const dropsColumns = await sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'drops'
        AND column_name IN ('is_offline', 'offline_since', 'offline_reason', 'offline_days', 'last_offline_check')
    `;
    console.log('New drops columns:', dropsColumns.map(c => c.column_name).join(', '));

  } catch (error) {
    console.error('\nMigration failed:', error.message);
    process.exit(1);
  }
}

runMigration();
