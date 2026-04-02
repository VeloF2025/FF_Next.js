const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env.local') });

const sql = neon(process.env.DATABASE_URL);

const MISSING_KEYS = [
  'tracker',
  'devops.qfield-mapping',
  'fleet.import',
  'fleet.mileage',
  'noc.data-sync',
  'noc.handover',
  'noc.risks',
];

async function run() {
  const migrationSQL = fs.readFileSync(
    path.join(__dirname, 'migrations', 'sql', '271_rbac_missing_pages.sql'),
    'utf-8'
  );

  // Split by semicolon, filter empty/comment-only statements
  const statements = migrationSQL
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.split('\n').every(l => l.trim().startsWith('--') || l.trim() === ''));

  console.log(`Running migration 271: ${statements.length} statements`);

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
  const placeholders = MISSING_KEYS.map((_, i) => `$${i + 1}`).join(', ');
  const newPerms = await sql(`SELECT key, type, parent_key, label FROM access_permissions WHERE key IN (${placeholders})`, MISSING_KEYS);
  const rolePerms = await sql(`SELECT COUNT(*) as cnt FROM role_permissions WHERE permission_key IN (${placeholders})`, MISSING_KEYS);

  console.log('\n--- Verification ---');
  console.log(`Permission entries: ${newPerms.length}/${MISSING_KEYS.length}`);
  newPerms.forEach(p => console.log(`  ${p.key} (${p.type}) → parent: ${p.parent_key || 'root'} — ${p.label}`));
  console.log(`Role permission entries: ${rolePerms[0].cnt} (expected ${MISSING_KEYS.length * 8}: 7 keys × 8 roles)`);
  console.log('\nMigration 271 applied successfully');
}

run().catch(e => { console.error('Failed:', e.message); process.exit(1); });
