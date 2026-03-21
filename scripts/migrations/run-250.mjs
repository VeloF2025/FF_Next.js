// Migration 250 runner — adds remaining 8 Conduit projects
import { neon } from '@neondatabase/serverless';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const sql_path = join(__dirname, 'sql/250_conduit_all_projects.sql');
const sqlText = readFileSync(sql_path, 'utf-8');

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  process.stderr.write('ERROR: DATABASE_URL not set\n');
  process.exit(1);
}

const sql = neon(DATABASE_URL);

async function run() {
  process.stdout.write('Running migration 250...\n');
  await sql.unsafe(sqlText);
  process.stdout.write('Migration 250 complete — 8 projects inserted (duplicates skipped).\n');
}

run().catch(err => {
  process.stderr.write(`Migration failed: ${err.message}\n`);
  process.exit(1);
});
