const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const sql = neon(process.env.DATABASE_URL);

async function run() {
  const migrationSQL = fs.readFileSync(
    path.join(__dirname, 'migrations', 'sql', '272_rbac_cleanup_site_diary.sql'),
    'utf-8'
  );

  // Split by semicolon, filter empty/comment-only statements
  const statements = migrationSQL
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.split('\n').every(l => l.trim().startsWith('--') || l.trim() === ''));

  console.log(`Running migration 272: ${statements.length} statements`);

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
  console.log('\n--- Verification ---');

  // Check orphans fixed
  const orphans = await sql.query(
    `SELECT ap.key, ap.parent_key FROM access_permissions ap LEFT JOIN access_permissions parent ON ap.parent_key = parent.key WHERE ap.parent_key IS NOT NULL AND parent.key IS NULL`
  );
  console.log(`Orphan permissions: ${orphans.length} (expected: 0)`);
  orphans.forEach(o => console.log(`  ORPHAN: ${o.key} → ${o.parent_key}`));

  // Check site-diary seeded
  const siteDiary = await sql.query(
    `SELECT key, label FROM access_permissions WHERE key = 'projects.site-diary'`
  );
  console.log(`Site-diary permission: ${siteDiary.length === 1 ? 'OK' : 'MISSING'}`);

  // Check contractor tightened
  const contractorSensitive = await sql.query(
    `SELECT permission_key, actions FROM role_permissions WHERE role = 'contractor' AND permission_key IN ('people.staff.list', 'people.staff.tabs.overview', 'people.staff.tabs.projects', 'system.vlm-learning') AND actions->>'view' = 'true'`
  );
  console.log(`Contractor sensitive perms remaining: ${contractorSensitive.length} (expected: 0)`);

  // Check override expiry
  const expirySet = await sql.query(
    `SELECT COUNT(*) as cnt FROM user_permission_overrides WHERE expires_at IS NOT NULL`
  );
  const noExpiry = await sql.query(
    `SELECT COUNT(*) as cnt FROM user_permission_overrides WHERE expires_at IS NULL`
  );
  console.log(`Overrides with expiry: ${expirySet[0].cnt}`);
  console.log(`Overrides without expiry: ${noExpiry[0].cnt}`);

  // Check procurement.pipelines parent exists
  const pipelines = await sql.query(
    `SELECT key, parent_key FROM access_permissions WHERE key = 'procurement.pipelines'`
  );
  console.log(`procurement.pipelines parent: ${pipelines.length === 1 ? 'OK' : 'MISSING'}`);

  console.log('\nMigration 272 applied successfully');
}

run().catch(e => { console.error('Failed:', e.message); process.exit(1); });
