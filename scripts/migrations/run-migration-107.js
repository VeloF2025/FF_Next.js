/**
 * Run migration 107 - Field Stock Setup
 */

const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require';

async function runMigration() {
  const sql = neon(DATABASE_URL);

  console.log('Running migration 107: Field Stock Setup...\n');

  // Read the full SQL file
  const migrationPath = path.join(__dirname, '107_field_stock_setup.sql');
  const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

  // Execute as a single transaction using sql.query()
  try {
    await sql.query(migrationSQL);
    console.log('✓ Migration SQL executed successfully');
  } catch (error) {
    console.error('Migration error:', error.message);
    // Try to continue with verification anyway
  }

  // Verify results
  console.log('\n--- Verification ---');

  const techLocations = await sql`
    SELECT code, assigned_to_name
    FROM stock_locations
    WHERE location_type = 'technician'
    ORDER BY assigned_to_name
  `;
  console.log(`\nTechnician locations: ${techLocations.length}`);
  techLocations.forEach(loc => {
    console.log(`  - ${loc.code}: ${loc.assigned_to_name}`);
  });

  // Check views
  const views = await sql`
    SELECT table_name FROM information_schema.views
    WHERE table_schema = 'public'
    AND (table_name LIKE 'v_technician%' OR table_name LIKE 'v_field%')
  `;
  console.log(`\nViews: ${views.map(v => v.table_name).join(', ') || 'None'}`);

  // Check functions
  const funcs = await sql`
    SELECT routine_name FROM information_schema.routines
    WHERE routine_schema = 'public'
    AND routine_name IN ('get_technician_stock', 'issue_stock_to_technician')
  `;
  console.log(`Functions: ${funcs.map(f => f.routine_name).join(', ') || 'None'}`);

  console.log('\n✅ Migration 107 complete.');
}

runMigration().catch(console.error);
