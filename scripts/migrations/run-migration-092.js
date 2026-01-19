/**
 * Run Migration 092: Offline Devices Summary Fields
 *
 * Usage: node scripts/migrations/run-migration-092.js
 */

const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require';

async function runMigration() {
  console.log('Starting Migration 092: Offline Devices Summary Fields');
  console.log('='.repeat(60));

  const sql = neon(DATABASE_URL);

  try {
    // Read the migration file
    const migrationPath = path.join(__dirname, '092_offline_devices_summary_fields.sql');
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
    console.log('Migration 092 completed successfully!');
    console.log('='.repeat(60));

    // Verify columns
    console.log('\nVerifying new columns...');

    const newColumns = await sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'offline_devices'
        AND column_name IN ('zone', 'planned_pon', 'address', 'pole_number', 'point_of_interest',
                           'installation_date', 'days_since_activation', 'revenue_30day_avg', 'source_report')
      ORDER BY column_name
    `;
    console.log('New columns added:', newColumns.map(c => c.column_name).join(', '));

  } catch (error) {
    console.error('\nMigration failed:', error.message);
    process.exit(1);
  }
}

runMigration();
