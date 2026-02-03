#!/usr/bin/env node

/**
 * Migration 157: Module Tab Permissions
 * Adds granular tab-level permissions for Fleet, Staff, Projects, and Maintenance
 */

const { neon } = require('@neondatabase/serverless');
const fs = require('fs').promises;
const path = require('path');

async function runMigration() {
  const sql = neon(process.env.DATABASE_URL);

  try {
    console.log('🚀 Running Migration 157: Module Tab Permissions...\n');

    // Read the migration SQL file
    const migrationPath = path.join(__dirname, 'migrations', '157_module_tab_permissions.sql');
    const migrationSQL = await fs.readFile(migrationPath, 'utf-8');

    console.log('📄 Read migration file successfully');
    console.log('🔧 Executing migration...\n');

    // Split the SQL into individual statements and execute them
    const statements = migrationSQL
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (statement.trim()) {
        try {
          console.log(`  Executing statement ${i + 1}/${statements.length}...`);
          await sql.unsafe(statement);
        } catch (error) {
          // Some statements might fail if tables already exist, that's OK
          if (error.message.includes('already exists') ||
              error.message.includes('does not exist') ||
              error.message.includes('duplicate key')) {
            console.log(`    ⚠️  Statement ${i + 1} skipped: ${error.message.split('\n')[0].substring(0, 80)}`);
          } else {
            throw error;
          }
        }
      }
    }

    console.log('\n✅ Migration 157 completed!');

    // Verify permissions were created
    console.log('\n📋 Verifying permissions...');

    const fleetPerms = await sql`SELECT key FROM access_permissions WHERE key LIKE 'fleet%' ORDER BY key`;
    console.log(`\n  Fleet permissions: ${fleetPerms.length}`);

    const staffPerms = await sql`SELECT key FROM access_permissions WHERE key LIKE 'people.staff.%' ORDER BY key`;
    console.log(`  Staff tab permissions: ${staffPerms.length}`);

    const projectPerms = await sql`SELECT key FROM access_permissions WHERE key LIKE 'projects.%' ORDER BY key`;
    console.log(`  Project permissions: ${projectPerms.length}`);

    const maintenancePerms = await sql`SELECT key FROM access_permissions WHERE key LIKE 'maintenance.%' ORDER BY key`;
    console.log(`  Maintenance tab permissions: ${maintenancePerms.length}`);

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  runMigration().catch(console.error);
}

module.exports = { runMigration };
