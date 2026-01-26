/**
 * PM Field Migration Script
 * Migrates project_manager field from projects table to staff_projects with is_primary=true
 *
 * Run: DATABASE_URL=... node scripts/migrations/run-pm-migration.js
 */

const { neon } = require('@neondatabase/serverless');

async function migratePM() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL environment variable not set');
    process.exit(1);
  }

  const sql = neon(databaseUrl);

  console.log('='.repeat(60));
  console.log('PM Field Migration: projects.project_manager -> staff_projects');
  console.log('='.repeat(60));
  console.log('');

  try {
    // 1. Find projects with project_manager that need migration
    console.log('1. Finding projects to migrate...');

    const projectsToMigrate = await sql`
      SELECT p.id, p.project_name, p.project_manager, p.start_date, p.created_at
      FROM projects p
      WHERE p.project_manager IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM staff_projects sp
        WHERE sp.project_id = p.id AND sp.is_primary = true
      )
    `;

    console.log(`   Found ${projectsToMigrate.length} projects to migrate`);

    if (projectsToMigrate.length === 0) {
      console.log('\nNo migration needed - all projects either have no PM or already have primary in staff_projects');
      return;
    }

    // 2. For each project, check if staff exists and create staff_projects record
    console.log('\n2. Migrating PM field...');

    let migrated = 0;
    let skipped = 0;
    const results = [];

    for (const project of projectsToMigrate) {
      // Check if staff exists
      const staffExists = await sql`
        SELECT id, first_name, last_name FROM staff WHERE id = ${project.project_manager}
      `;

      if (staffExists.length === 0) {
        console.log(`   SKIP: ${project.project_name} - Staff ${project.project_manager} not found`);
        skipped++;
        results.push({ project: project.project_name, status: 'skipped', reason: 'Staff not found' });
        continue;
      }

      const staffName = `${staffExists[0].first_name} ${staffExists[0].last_name}`;

      // Check if staff is already assigned (without is_primary)
      const existingAssignment = await sql`
        SELECT id FROM staff_projects
        WHERE project_id = ${project.id} AND staff_id = ${project.project_manager}
      `;

      if (existingAssignment.length > 0) {
        // Update existing assignment
        await sql`
          UPDATE staff_projects
          SET is_primary = true, role = 'Project Manager'
          WHERE id = ${existingAssignment[0].id}
        `;
        console.log(`   UPDATE: ${project.project_name} - Set ${staffName} as primary (existing record)`);
      } else {
        // Create new assignment
        await sql`
          INSERT INTO staff_projects (id, project_id, staff_id, role, is_primary, is_active, start_date, created_at)
          VALUES (
            gen_random_uuid(),
            ${project.id},
            ${project.project_manager},
            'Project Manager',
            true,
            true,
            ${project.start_date || project.created_at?.toISOString().split('T')[0]},
            NOW()
          )
        `;
        console.log(`   CREATE: ${project.project_name} - Added ${staffName} as primary manager`);
      }

      migrated++;
      results.push({ project: project.project_name, status: 'migrated', staff: staffName });
    }

    // 3. Verify migration
    console.log('\n3. Verifying migration...');

    const primaryCount = await sql`
      SELECT COUNT(*) as count FROM staff_projects WHERE is_primary = true
    `;
    console.log(`   Primary managers in staff_projects: ${primaryCount[0].count}`);

    // Check dashboard view
    const dashboardSample = await sql`
      SELECT project_name, primary_manager_name
      FROM v_project_dashboard
      WHERE primary_manager_name IS NOT NULL
      LIMIT 5
    `;
    console.log('\n   Projects with primary manager (from view):');
    dashboardSample.forEach(p => console.log(`     - ${p.project_name}: ${p.primary_manager_name}`));

    console.log('\n' + '='.repeat(60));
    console.log(`Migration complete: ${migrated} migrated, ${skipped} skipped`);
    console.log('='.repeat(60));

  } catch (error) {
    console.error('\nMigration FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

migratePM();
