/**
 * Run Vehicle Assignments Fleet Link Migration (044)
 * Adds fleet_vehicle_id FK to vehicle_assignments table
 */
const { neon } = require('@neondatabase/serverless');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require';

const sql = neon(DATABASE_URL);

async function runMigration() {
  console.log('Running Vehicle Assignments Fleet Link Migration (044)...\n');

  try {
    // Add fleet_vehicle_id column
    await sql`
      ALTER TABLE vehicle_assignments
      ADD COLUMN IF NOT EXISTS fleet_vehicle_id UUID REFERENCES fleet_vehicles(id) ON DELETE SET NULL
    `;
    console.log('✓ Added fleet_vehicle_id column');

    // Create index for efficient lookups
    await sql`
      CREATE INDEX IF NOT EXISTS idx_vehicle_assignments_fleet_vehicle
      ON vehicle_assignments(fleet_vehicle_id)
    `;
    console.log('✓ Created idx_vehicle_assignments_fleet_vehicle index');

    // Create index for active fleet vehicle assignments
    await sql`
      CREATE INDEX IF NOT EXISTS idx_vehicle_assignments_active_fleet
      ON vehicle_assignments(fleet_vehicle_id, is_active)
      WHERE is_active = true
    `;
    console.log('✓ Created idx_vehicle_assignments_active_fleet index');

    // Verify column was added
    console.log('\n📊 Verifying migration...\n');

    const columns = await sql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'vehicle_assignments'
        AND column_name = 'fleet_vehicle_id'
    `;

    if (columns.length > 0) {
      console.log('✓ fleet_vehicle_id column exists:');
      console.log(`   - Type: ${columns[0].data_type}`);
      console.log(`   - Nullable: ${columns[0].is_nullable}`);
    } else {
      console.log('✗ fleet_vehicle_id column not found!');
    }

    console.log('\n✅ Migration complete!');

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    process.exit(1);
  }
}

runMigration();
