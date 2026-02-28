const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const sql = neon(process.env.DATABASE_URL);

async function run() {
  const migrationSQL = fs.readFileSync(
    path.join(__dirname, 'migrations', '221_rbac_sync_latest_modules.sql'),
    'utf-8'
  );

  // Split by semicolon, filter empty/comment-only statements
  const statements = migrationSQL
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.split('\n').every(l => l.trim().startsWith('--') || l.trim() === ''));

  console.log(`Running migration 221: ${statements.length} statements`);

  for (let i = 0; i < statements.length; i++) {
    try {
      await sql.query(statements[i]);
      console.log(`  [${i + 1}/${statements.length}] OK`);
    } catch (err) {
      console.error(`  [${i + 1}/${statements.length}] FAILED: ${err.message}`);
      throw err;
    }
  }

  // Verification
  const permCount = await sql.query(`SELECT COUNT(*) as cnt FROM access_permissions`);
  const acctCount = await sql.query(`SELECT COUNT(*) as cnt FROM access_permissions WHERE key LIKE 'accounting.%'`);
  const saCount = await sql.query(`SELECT COUNT(*) as cnt FROM role_permissions WHERE role = 'super_admin'`);

  console.log('\n--- Verification ---');
  console.log(`Total access_permissions: ${permCount[0].cnt}`);
  console.log(`Accounting sub-pages:     ${acctCount[0].cnt}`);
  console.log(`super_admin role_perms:   ${saCount[0].cnt}`);
  console.log('\nMigration 221 applied successfully');
}

run().catch(e => { console.error('Failed:', e.message); process.exit(1); });
