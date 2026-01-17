import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL!);

async function run() {
  console.log('Running migration 082_stock_items_odoo.sql...\n');

  const migrationPath = './scripts/migrations/082_stock_items_odoo.sql';
  const migrationSql = fs.readFileSync(migrationPath, 'utf-8');

  // Split by semicolons and run each statement
  const statements = migrationSql
    .split(';')
    .map(s => s.trim())
    .filter(s => s.length > 0 && !s.startsWith('--'));

  for (const stmt of statements) {
    if (stmt.length < 10) continue;

    // Get first line for logging
    const firstLine = stmt.split('\n').find(l => l.trim().length > 0 && !l.trim().startsWith('--')) || stmt.substring(0, 50);
    console.log('Executing:', firstLine.substring(0, 60) + '...');

    try {
      await sql.unsafe(stmt);
      console.log('  ✓ Success\n');
    } catch (err: any) {
      if (err.message.includes('already exists')) {
        console.log('  - Already exists, skipping\n');
      } else {
        console.error('  ✗ Error:', err.message, '\n');
      }
    }
  }

  console.log('Migration complete!');

  // Verify
  console.log('\nVerifying new columns on stock_items:');
  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'stock_items' AND column_name LIKE '%odoo%' OR column_name LIKE '%qty_%'
    ORDER BY column_name
  `;
  for (const c of cols) {
    console.log('  -', c.column_name);
  }

  console.log('\nVerifying new tables:');
  const tables = await sql`
    SELECT table_name FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name IN ('supplier_item_codes', 'stock_levels')
  `;
  for (const t of tables) {
    console.log('  -', t.table_name);
  }
}

run().catch(console.error);
