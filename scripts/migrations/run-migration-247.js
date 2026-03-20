/**
 * Run Migration 247: RBAC - Add all missing modules, pages, tabs
 *
 * Brings access_permissions table in sync with current app features:
 * - NOC module (8 pages, 4 tabs)
 * - Accounting module (4 pages)
 * - Field Operations module (4 pages)
 * - SOW module (2 pages)
 * - Missing system pages (health, infrastructure, data-sync, vlm-learning, deployment)
 * - Missing communications pages (help-center, mission-control, dev-queue)
 * - Missing procurement pages (field-stock, stock-portal, reports, workflow, open-orders, audit)
 * - Missing fleet pages (check-in, history, templates)
 * - Storeman role permissions
 * - Updated technician/contractor permissions for new modules
 *
 * Usage: node scripts/migrations/run-migration-247.js
 * Requires DATABASE_URL environment variable.
 */

const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const sqlFile = path.join(__dirname, 'sql', '247_rbac_update_all_modules.sql');
  if (!fs.existsSync(sqlFile)) {
    console.error(`ERROR: Migration file not found: ${sqlFile}`);
    process.exit(1);
  }

  console.log('\n========================================');
  console.log('Migration 247: RBAC - Update All Modules');
  console.log('========================================\n');

  const sql = neon(dbUrl);
  const migrationSql = fs.readFileSync(sqlFile, 'utf8');

  // Pre-migration counts
  console.log('Pre-migration state:');
  try {
    const before = await sql`
      SELECT
        (SELECT count(*) FROM access_permissions WHERE type = 'module') as modules,
        (SELECT count(*) FROM access_permissions WHERE type = 'page') as pages,
        (SELECT count(*) FROM access_permissions WHERE type = 'tab') as tabs,
        (SELECT count(DISTINCT role) FROM role_permissions) as roles,
        (SELECT count(*) FROM role_permissions) as role_perms
    `;
    console.log(`  Modules: ${before[0].modules}`);
    console.log(`  Pages:   ${before[0].pages}`);
    console.log(`  Tabs:    ${before[0].tabs}`);
    console.log(`  Roles:   ${before[0].roles}`);
    console.log(`  Role-permission mappings: ${before[0].role_perms}`);
  } catch (err) {
    console.log(`  Could not query pre-state: ${err.message}`);
  }

  // Split by semicolons, respecting $$ blocks
  const statements = [];
  let currentStatement = '';
  let inDollarQuote = false;

  for (const line of migrationSql.split('\n')) {
    const dollarMatches = (line.match(/\$\$/g) || []).length;
    if (dollarMatches % 2 === 1) {
      inDollarQuote = !inDollarQuote;
    }

    currentStatement += line + '\n';

    if (line.trim().endsWith(';') && !inDollarQuote) {
      // Strip leading comment lines to get actual SQL
      const lines = currentStatement.trim().split('\n');
      const sqlLines = lines.filter(l => !l.trim().startsWith('--'));
      const stmt = sqlLines.join('\n').trim();
      if (stmt && stmt !== 'BEGIN' && stmt !== 'COMMIT') {
        statements.push(stmt);
      }
      currentStatement = '';
    }
  }

  console.log(`\nExecuting ${statements.length} statements...\n`);

  let successCount = 0;
  let errorCount = 0;

  for (const stmt of statements) {
    if (!stmt || stmt.startsWith('--')) continue;

    try {
      // neon() tagged template requires sql.query() for raw SQL strings
      await sql.query(stmt);
      successCount++;
    } catch (err) {
      errorCount++;
      console.log(`  ERROR in statement: ${stmt.substring(0, 80)}...`);
      console.log(`  ${err.message.substring(0, 200)}`);
    }
  }

  console.log(`\nExecution: ${successCount} succeeded, ${errorCount} errors`);

  // Post-migration counts
  console.log('\nPost-migration state:');
  try {
    const after = await sql`
      SELECT
        (SELECT count(*) FROM access_permissions WHERE type = 'module') as modules,
        (SELECT count(*) FROM access_permissions WHERE type = 'page') as pages,
        (SELECT count(*) FROM access_permissions WHERE type = 'tab') as tabs,
        (SELECT count(DISTINCT role) FROM role_permissions) as roles,
        (SELECT count(*) FROM role_permissions) as role_perms
    `;
    console.log(`  Modules: ${after[0].modules}`);
    console.log(`  Pages:   ${after[0].pages}`);
    console.log(`  Tabs:    ${after[0].tabs}`);
    console.log(`  Roles:   ${after[0].roles}`);
    console.log(`  Role-permission mappings: ${after[0].role_perms}`);
  } catch (err) {
    console.log(`  Could not query post-state: ${err.message}`);
  }

  // List new modules
  console.log('\nAll modules:');
  try {
    const modules = await sql`
      SELECT key, label FROM access_permissions
      WHERE type = 'module' ORDER BY sort_order
    `;
    for (const m of modules) {
      console.log(`  ${m.key.padEnd(20)} ${m.label}`);
    }
  } catch (err) {
    console.log(`  Could not list modules: ${err.message}`);
  }

  // List roles
  console.log('\nRole permission counts:');
  try {
    const roles = await sql`
      SELECT role, count(*) as perms
      FROM role_permissions
      GROUP BY role ORDER BY role
    `;
    for (const r of roles) {
      console.log(`  ${r.role.padEnd(20)} ${r.perms} permissions`);
    }
  } catch (err) {
    console.log(`  Could not list roles: ${err.message}`);
  }

  console.log('\n========================================');
  console.log('Migration 247 Complete');
  console.log('========================================\n');
}

runMigration().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
