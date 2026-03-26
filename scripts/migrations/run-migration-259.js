/**
 * Run Migration 259: Add DevOps nav items to RBAC
 *
 * Adds missing permission keys for DevOps sidebar items:
 * - devops.schema (Schema Explorer)
 * - devops.field-mapping (Field Mapping)
 *
 * These items are displayed in the SYSTEM sidebar section and require
 * RBAC permission entries in the database for visibility.
 *
 * Usage: node scripts/migrations/run-migration-259.js
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

  const sqlFile = path.join(__dirname, 'sql', '259_devops_nav_rbac.sql');
  if (!fs.existsSync(sqlFile)) {
    console.error(`ERROR: Migration file not found: ${sqlFile}`);
    process.exit(1);
  }

  console.log('\n========================================');
  console.log('Migration 259: DevOps Nav RBAC Fix');
  console.log('========================================\n');

  const sql = neon(dbUrl);
  const migrationSql = fs.readFileSync(sqlFile, 'utf8');

  // Pre-migration check
  console.log('Pre-migration state:');
  try {
    const before = await sql`
      SELECT
        count(*) as total_permissions,
        (SELECT count(*) FROM access_permissions WHERE key LIKE 'devops.%') as devops_perms
      FROM access_permissions
    `;
    console.log(`  Total permissions: ${before[0].total_permissions}`);
    console.log(`  DevOps permissions: ${before[0].devops_perms}`);
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
      await sql.query(stmt);
      successCount++;
    } catch (err) {
      errorCount++;
      console.log(`  ERROR in statement: ${stmt.substring(0, 80)}...`);
      console.log(`  ${err.message.substring(0, 200)}`);
    }
  }

  console.log(`\nExecution: ${successCount} succeeded, ${errorCount} errors`);

  // Post-migration check
  console.log('\nPost-migration state:');
  try {
    const after = await sql`
      SELECT
        count(*) as total_permissions,
        (SELECT count(*) FROM access_permissions WHERE key LIKE 'devops.%') as devops_perms
      FROM access_permissions
    `;
    console.log(`  Total permissions: ${after[0].total_permissions}`);
    console.log(`  DevOps permissions: ${after[0].devops_perms}`);
  } catch (err) {
    console.log(`  Could not query post-state: ${err.message}`);
  }

  // List DevOps permissions
  console.log('\nDevOps permissions:');
  try {
    const devopsPerms = await sql`
      SELECT key, label, type FROM access_permissions
      WHERE key LIKE 'devops.%' ORDER BY sort_order
    `;
    for (const p of devopsPerms) {
      console.log(`  ${p.key.padEnd(25)} ${p.label.padEnd(30)} (${p.type})`);
    }
  } catch (err) {
    console.log(`  Could not list permissions: ${err.message}`);
  }

  // Verify role assignments
  console.log('\nDevOps role permissions:');
  try {
    const rolePerms = await sql`
      SELECT rp.role, rp.permission_key, rp.actions
      FROM role_permissions rp
      WHERE rp.permission_key LIKE 'devops.%'
      ORDER BY rp.role, rp.permission_key
    `;
    if (rolePerms.length === 0) {
      console.log('  (none - system admins only)');
    } else {
      for (const rp of rolePerms) {
        const actions = JSON.stringify(rp.actions);
        console.log(`  ${rp.role.padEnd(15)} ${rp.permission_key.padEnd(25)} ${actions}`);
      }
    }
  } catch (err) {
    console.log(`  Could not list role permissions: ${err.message}`);
  }

  console.log('\n========================================');
  console.log('Migration 259 Complete');
  console.log('DevOps nav items (Schema Explorer,');
  console.log('Field Mapping) now visible to System Admins');
  console.log('========================================\n');
}

runMigration().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
