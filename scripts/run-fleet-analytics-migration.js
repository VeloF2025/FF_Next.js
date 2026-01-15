/**
 * Migration Runner: 046_fleet_analytics.sql
 *
 * Run with:
 *   DATABASE_URL='postgresql://...' node scripts/run-fleet-analytics-migration.js
 */

const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('Fleet Analytics Migration (046)');
  console.log('='.repeat(60));
  console.log('');

  const sql = neon(databaseUrl);

  try {
    // Read the migration file
    const migrationPath = path.join(__dirname, 'migrations', '046_fleet_analytics.sql');
    const migrationSql = fs.readFileSync(migrationPath, 'utf8');

    // Split into statements (simple split on semicolon + newline)
    const statements = migrationSql
      .split(/;\s*\n/)
      .map(s => s.trim())
      .filter(s => s && !s.startsWith('--'));

    console.log(`Found ${statements.length} SQL statements to execute`);
    console.log('');

    let executed = 0;
    let skipped = 0;

    for (const statement of statements) {
      if (!statement || statement.startsWith('--')) {
        skipped++;
        continue;
      }

      // Get first line for logging
      const firstLine = statement.split('\n')[0].substring(0, 60);

      try {
        await sql.unsafe(statement);
        executed++;
        console.log(`✓ ${firstLine}...`);
      } catch (err) {
        // Check if it's a "already exists" type error
        if (err.message.includes('already exists') ||
            err.message.includes('duplicate key')) {
          console.log(`⊘ ${firstLine}... (already exists)`);
          skipped++;
        } else {
          console.error(`✗ ${firstLine}...`);
          console.error(`  Error: ${err.message}`);
          throw err;
        }
      }
    }

    console.log('');
    console.log('='.repeat(60));
    console.log(`Migration completed: ${executed} executed, ${skipped} skipped`);
    console.log('='.repeat(60));

    // Verify tables exist
    console.log('');
    console.log('Verifying created objects...');

    const tables = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_name IN (
        'fleet_service_intervals',
        'fleet_service_history',
        'fleet_driver_scores',
        'fleet_analytics_snapshots',
        'fleet_fuel_anomalies'
      )
      ORDER BY table_name
    `;

    console.log(`Tables created: ${tables.map(t => t.table_name).join(', ')}`);

    const views = await sql`
      SELECT table_name
      FROM information_schema.views
      WHERE table_name IN (
        'v_fleet_tco_summary',
        'v_fleet_check_compliance',
        'v_fleet_upcoming_services',
        'v_fleet_driver_leaderboard'
      )
      ORDER BY table_name
    `;

    console.log(`Views created: ${views.map(v => v.table_name).join(', ')}`);

  } catch (error) {
    console.error('');
    console.error('Migration failed:', error.message);
    process.exit(1);
  }
}

runMigration();
