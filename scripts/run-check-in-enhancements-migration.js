/**
 * Run Fleet Check-In Enhancements Migration (042)
 * Adds daily/weekly check support, VLM integration tables, and history tracking
 */
const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL || 'process.env.DATABASE_URL';

const sql = neon(DATABASE_URL);

async function runMigration() {
  console.log('Running Fleet Check-In Enhancements Migration (042)...\n');

  try {
    // Read the migration file
    const migrationPath = path.join(__dirname, 'migrations', '042_fleet_check_enhancements.sql');
    const migrationSql = fs.readFileSync(migrationPath, 'utf-8');

    // Split into statements (simple split on semicolon followed by newline)
    // This handles most cases but not edge cases with semicolons in strings
    const statements = migrationSql
      .split(/;\s*\n/)
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    console.log(`Found ${statements.length} SQL statements to execute\n`);

    let successCount = 0;
    let skipCount = 0;

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      const preview = statement.substring(0, 60).replace(/\n/g, ' ');

      try {
        await sql.unsafe(statement);
        successCount++;
        console.log(`✓ [${i + 1}/${statements.length}] ${preview}...`);
      } catch (error) {
        // Some errors are expected (e.g., IF NOT EXISTS when already exists)
        if (error.message.includes('already exists') ||
            error.message.includes('duplicate key') ||
            error.message.includes('cannot insert duplicate key')) {
          skipCount++;
          console.log(`○ [${i + 1}/${statements.length}] Skipped (already exists): ${preview}...`);
        } else {
          console.error(`✗ [${i + 1}/${statements.length}] Failed: ${preview}...`);
          console.error(`  Error: ${error.message}`);
          // Continue with other statements
        }
      }
    }

    console.log(`\n✅ Migration completed!`);
    console.log(`   Executed: ${successCount}`);
    console.log(`   Skipped: ${skipCount}`);

    // Verify tables were created
    console.log('\n📊 Verifying tables...\n');

    const tables = [
      'fleet_odometer_history',
      'fleet_fuel_history',
      'fleet_photo_vlm_results',
      'fleet_check_schedule',
      'fleet_check_reminders',
      'fleet_vehicle_thresholds'
    ];

    for (const table of tables) {
      const result = await sql`
        SELECT EXISTS (
          SELECT FROM information_schema.tables
          WHERE table_name = ${table}
        ) as exists
      `;
      const exists = result[0]?.exists;
      console.log(`   ${exists ? '✓' : '✗'} ${table}`);
    }

    // Verify templates were created
    console.log('\n📋 Verifying templates...\n');

    const templates = await sql`
      SELECT id, name, check_type, is_default
      FROM fleet_check_templates
      WHERE is_active = true
      ORDER BY check_type, is_default DESC
    `;

    for (const t of templates) {
      console.log(`   ${t.is_default ? '★' : '○'} [${t.check_type}] ${t.name}`);
    }

    // Count items per template
    console.log('\n📝 Template items...\n');

    const itemCounts = await sql`
      SELECT t.name, t.check_type, COUNT(i.id) as item_count
      FROM fleet_check_templates t
      LEFT JOIN fleet_check_items i ON i.template_id = t.id AND i.is_active = true
      WHERE t.is_active = true
      GROUP BY t.id, t.name, t.check_type
      ORDER BY t.check_type, t.name
    `;

    for (const c of itemCounts) {
      console.log(`   [${c.check_type}] ${c.name}: ${c.item_count} items`);
    }

    console.log('\n✅ Migration verification complete!');

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    process.exit(1);
  }
}

runMigration();
