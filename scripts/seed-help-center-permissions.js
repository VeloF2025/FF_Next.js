#!/usr/bin/env node
/**
 * Seed Help Center Permissions
 *
 * Adds Help Center module and page permissions to access_permissions
 * and grants view access to all roles in role_permissions.
 *
 * Target: PRODUCTION database
 */

const { Client } = require('pg');

const PRODUCTION_DB = 'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require';

async function seedPermissions() {
  const client = new Client({ connectionString: PRODUCTION_DB });

  try {
    await client.connect();
    console.log('Connected to PRODUCTION database');

    // Begin transaction
    await client.query('BEGIN');

    // Insert module entry
    const moduleResult = await client.query(`
      INSERT INTO access_permissions (key, type, label, description, parent_key, sort_order, is_active)
      VALUES ('help-center', 'module', 'Help Center', 'Help center with documentation and AI chat', NULL, 140, true)
      ON CONFLICT (key) DO NOTHING
      RETURNING key
    `);

    if (moduleResult.rowCount > 0) {
      console.log('✓ Inserted module: help-center');
    } else {
      console.log('○ Module help-center already exists');
    }

    // Insert page permissions
    const pagesResult = await client.query(`
      INSERT INTO access_permissions (key, type, label, description, parent_key, sort_order, is_active)
      VALUES
        ('help-center.manual', 'page', 'User Manual', 'Searchable user documentation', 'help-center', 10, true),
        ('help-center.ai-chat', 'page', 'AI Chat Assistant', 'AI-powered help chat', 'help-center', 20, true)
      ON CONFLICT (key) DO NOTHING
      RETURNING key
    `);

    console.log(`✓ Inserted ${pagesResult.rowCount} page permissions`);

    // Insert role permissions for all roles
    const rolePermissionsResult = await client.query(`
      INSERT INTO role_permissions (role, permission_key, actions)
      VALUES
        ('super_admin', 'help-center', '{"view": true, "create": true, "edit": true, "delete": true}'),
        ('admin', 'help-center', '{"view": true, "create": false, "edit": false, "delete": false}'),
        ('manager', 'help-center', '{"view": true, "create": false, "edit": false, "delete": false}'),
        ('technician', 'help-center', '{"view": true, "create": false, "edit": false, "delete": false}'),
        ('viewer', 'help-center', '{"view": true, "create": false, "edit": false, "delete": false}'),
        ('contractor', 'help-center', '{"view": true, "create": false, "edit": false, "delete": false}'),
        ('super_admin', 'help-center.manual', '{"view": true}'),
        ('admin', 'help-center.manual', '{"view": true}'),
        ('manager', 'help-center.manual', '{"view": true}'),
        ('technician', 'help-center.manual', '{"view": true}'),
        ('viewer', 'help-center.manual', '{"view": true}'),
        ('contractor', 'help-center.manual', '{"view": true}'),
        ('super_admin', 'help-center.ai-chat', '{"view": true}'),
        ('admin', 'help-center.ai-chat', '{"view": true}'),
        ('manager', 'help-center.ai-chat', '{"view": true}'),
        ('technician', 'help-center.ai-chat', '{"view": true}'),
        ('viewer', 'help-center.ai-chat', '{"view": true}'),
        ('contractor', 'help-center.ai-chat', '{"view": true}')
      ON CONFLICT (role, permission_key) DO NOTHING
      RETURNING role, permission_key
    `);

    console.log(`✓ Inserted ${rolePermissionsResult.rowCount} role permission mappings`);

    // Verify the data
    const verifyResult = await client.query(`
      SELECT
        ap.key,
        ap.type,
        ap.label,
        ap.sort_order,
        COUNT(rp.role) as role_count
      FROM access_permissions ap
      LEFT JOIN role_permissions rp ON rp.permission_key = ap.key
      WHERE ap.key LIKE 'help-center%'
      GROUP BY ap.key, ap.type, ap.label, ap.sort_order
      ORDER BY ap.sort_order
    `);

    console.log('\n=== VERIFICATION ===');
    console.log('Help Center Permissions:');
    verifyResult.rows.forEach(row => {
      console.log(`  ${row.type.padEnd(8)} ${row.key.padEnd(25)} "${row.label}" (${row.role_count} roles)`);
    });

    // Commit transaction
    await client.query('COMMIT');
    console.log('\n✓ Transaction committed successfully');

  } catch (error) {
    await client.query('ROLLBACK');
    console.error('✗ Error seeding permissions:', error.message);
    console.error('  Transaction rolled back');
    throw error;
  } finally {
    await client.end();
    console.log('Database connection closed');
  }
}

// Run the seed script
seedPermissions()
  .then(() => {
    console.log('\n✓ Help Center permissions seeded successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n✗ Failed to seed permissions:', error.message);
    process.exit(1);
  });
