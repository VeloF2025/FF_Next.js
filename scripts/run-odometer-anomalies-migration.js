/**
 * Run Fleet Odometer Anomalies Migration (043)
 * Adds anomaly detection table for tracking odometer discrepancies
 */
const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL || 'process.env.DATABASE_URL';

const sql = neon(DATABASE_URL);

async function runMigration() {
  console.log('Running Fleet Odometer Anomalies Migration (043)...\n');

  try {
    // Read the migration file
    const migrationPath = path.join(__dirname, 'migrations', '043_fleet_odometer_anomalies.sql');
    const migrationSql = fs.readFileSync(migrationPath, 'utf-8');

    // Split into statements (simple split on semicolon followed by newline)
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
        }
      }
    }

    console.log(`\n✅ Migration completed!`);
    console.log(`   Executed: ${successCount}`);
    console.log(`   Skipped: ${skipCount}`);

    // Verify table was created
    console.log('\n📊 Verifying anomaly table...\n');

    const result = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'fleet_odometer_anomalies'
      ) as exists
    `;
    const exists = result[0]?.exists;
    console.log(`   ${exists ? '✓' : '✗'} fleet_odometer_anomalies`);

    if (exists) {
      // Show column info
      const columns = await sql`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'fleet_odometer_anomalies'
        ORDER BY ordinal_position
      `;
      console.log('\n   Columns:');
      for (const col of columns) {
        console.log(`   - ${col.column_name}: ${col.data_type}`);
      }
    }

    console.log('\n✅ Migration verification complete!');

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    process.exit(1);
  }
}

runMigration();
