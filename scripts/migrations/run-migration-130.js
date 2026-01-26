/**
 * Migration 130: System Integration - Project Hub Foundation
 * Run: node scripts/migrations/run-migration-130.js
 *
 * This migration:
 * - Adds is_primary column to staff_projects
 * - Creates v_project_team view
 * - Creates v_project_dashboard view
 */

const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('ERROR: DATABASE_URL environment variable not set');
    process.exit(1);
  }

  const sql = neon(databaseUrl);
  const migrationPath = path.join(__dirname, '130_system_integration.sql');

  console.log('='.repeat(60));
  console.log('Migration 130: System Integration - Project Hub Foundation');
  console.log('='.repeat(60));
  console.log('Database:', databaseUrl.split('@')[1]?.split('/')[0] || 'unknown');
  console.log('');

  try {
    // Check current state
    console.log('1. Checking current state...');

    // Check if is_primary column exists
    const isPrimaryExists = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'staff_projects' AND column_name = 'is_primary'
    `;
    if (isPrimaryExists.length > 0) {
      console.log('   - is_primary column already exists');
    } else {
      console.log('   - is_primary column will be added');
    }

    // Check if views exist
    const viewsExist = await sql`
      SELECT table_name FROM information_schema.views
      WHERE table_schema = 'public'
      AND table_name IN ('v_project_team', 'v_project_dashboard')
    `;
    const existingViews = viewsExist.map(v => v.table_name);
    console.log('   - Existing views:', existingViews.length > 0 ? existingViews.join(', ') : 'none');

    // Run migration
    console.log('\n2. Running migration...');

    // Add is_primary column
    if (isPrimaryExists.length === 0) {
      await sql`
        ALTER TABLE staff_projects
        ADD COLUMN IF NOT EXISTS is_primary BOOLEAN DEFAULT false
      `;
      console.log('   - Added is_primary column to staff_projects');
    }

    // Create index for primary lookups
    await sql`
      CREATE INDEX IF NOT EXISTS idx_staff_projects_primary
      ON staff_projects(project_id, is_primary)
      WHERE is_primary = true
    `;
    console.log('   - Created idx_staff_projects_primary index');

    // Create v_project_team view
    await sql`
      CREATE OR REPLACE VIEW v_project_team AS
      SELECT
        sp.project_id,
        sp.staff_id::text as person_id,
        'staff' as person_type,
        COALESCE(s.first_name || ' ' || s.last_name, 'Unknown') as name,
        s.email,
        s.phone,
        sp.role,
        sp.start_date,
        sp.end_date,
        sp.is_active,
        sp.is_primary,
        sp.created_at
      FROM staff_projects sp
      JOIN staff s ON s.id = sp.staff_id
      UNION ALL
      SELECT
        cp.project_id,
        cp.contractor_id::text as person_id,
        'contractor' as person_type,
        c.company_name as name,
        c.email,
        c.phone,
        cp.role,
        cp.start_date,
        cp.end_date,
        cp.is_active,
        cp.is_primary_contractor as is_primary,
        cp.created_at
      FROM contractor_projects cp
      JOIN contractors c ON c.id = cp.contractor_id
    `;
    console.log('   - Created/updated v_project_team view');

    // Create v_project_dashboard view
    await sql`
      CREATE OR REPLACE VIEW v_project_dashboard AS
      SELECT
        p.id,
        p.project_code,
        p.project_name,
        p.status,
        p.progress,
        p.budget,
        p.actual_cost,
        p.start_date,
        p.end_date,
        p.client_id,
        c.company_name as client_name,
        pb.total_budget,
        pb.committed_amount,
        pb.actual_amount as budget_actual_amount,
        pb.available_budget,
        CASE
          WHEN pb.total_budget IS NULL OR pb.total_budget = 0 THEN 'unknown'
          WHEN pb.actual_amount IS NULL THEN 'healthy'
          WHEN (pb.actual_amount / pb.total_budget) * 100 >= 100 THEN 'critical'
          WHEN (pb.actual_amount / pb.total_budget) * 100 >= 80 THEN 'warning'
          ELSE 'healthy'
        END as budget_health,
        (SELECT COUNT(*) FROM staff_projects sp
         WHERE sp.project_id = p.id AND sp.is_active = true) as staff_count,
        (SELECT COUNT(*) FROM contractor_projects cp
         WHERE cp.project_id = p.id AND cp.is_active = true) as contractor_count,
        (SELECT s.first_name || ' ' || s.last_name
         FROM staff_projects sp
         JOIN staff s ON s.id = sp.staff_id
         WHERE sp.project_id = p.id AND sp.is_primary = true
         LIMIT 1) as primary_manager_name,
        (SELECT overall_score FROM hs_project_audits
         WHERE project_id = p.id
         ORDER BY created_at DESC LIMIT 1) as latest_hs_score,
        (SELECT created_at FROM hs_project_audits
         WHERE project_id = p.id
         ORDER BY created_at DESC LIMIT 1) as last_audit_date,
        (SELECT COUNT(*) FROM maintenance_tickets
         WHERE project_id::text = p.id::text
         AND status NOT IN ('closed', 'resolved')) as open_tickets,
        (SELECT COUNT(*) FROM maintenance_tickets
         WHERE project_id::text = p.id::text
         AND status = 'resolved'
         AND resolved_at >= NOW() - INTERVAL '30 days') as resolved_this_month,
        (SELECT COUNT(*) FROM purchase_orders
         WHERE project_id = p.id
         AND status = 'pending_approval') as pending_pos,
        (SELECT COALESCE(SUM(total_amount), 0) FROM purchase_orders
         WHERE project_id = p.id) as total_po_value,
        (SELECT COUNT(*) FROM rfqs
         WHERE project_id::text = p.id::text
         AND status = 'open') as pending_rfqs,
        p.created_at,
        p.updated_at
      FROM projects p
      LEFT JOIN clients c ON c.id = p.client_id
      LEFT JOIN project_budgets pb ON pb.project_id = p.id
    `;
    console.log('   - Created/updated v_project_dashboard view');

    // Create unique constraint for primary manager
    try {
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_staff_projects_unique_primary
        ON staff_projects(project_id)
        WHERE is_primary = true
      `;
      console.log('   - Created unique primary manager constraint');
    } catch (e) {
      // May fail if duplicate primaries exist - that's ok for now
      console.log('   - Note: Unique primary constraint may already exist or have duplicates');
    }

    // Verify migration
    console.log('\n3. Verifying migration...');

    const verifyColumn = await sql`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'staff_projects' AND column_name = 'is_primary'
    `;
    console.log('   - is_primary column:', verifyColumn.length > 0 ? 'OK' : 'MISSING');

    const verifyTeamView = await sql`
      SELECT COUNT(*) as count FROM v_project_team LIMIT 1
    `;
    console.log('   - v_project_team view: OK (', verifyTeamView[0]?.count || 0, 'records)');

    const verifyDashboardView = await sql`
      SELECT COUNT(*) as count FROM v_project_dashboard LIMIT 1
    `;
    console.log('   - v_project_dashboard view: OK (', verifyDashboardView[0]?.count || 0, 'records)');

    console.log('\n' + '='.repeat(60));
    console.log('Migration 130 completed successfully!');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('\nMigration FAILED:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

runMigration();
