/**
 * Run Migration 141: Assets Odoo Sync Support
 */

const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL || 'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require';

async function runMigration() {
  const sql = neon(DATABASE_URL);

  console.log('Running migration 141: Assets Odoo Sync Support...');

  try {
    // Read and execute SQL file
    const sqlPath = path.join(__dirname, '141_assets_odoo_sync.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');

    // Split by semicolons and execute each statement
    const statements = sqlContent
      .split(';')
      .map(s => s.trim())
      .filter(s => s && !s.startsWith('--'));

    for (const statement of statements) {
      if (statement) {
        console.log('Executing:', statement.substring(0, 50) + '...');
        await sql.unsafe(statement);
      }
    }

    console.log('✅ Migration 141 completed successfully');

    // Verify columns exist
    const cols = await sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'assets'
      AND column_name IN ('odoo_product_id', 'odoo_vehicle_id')
    `;
    console.log('Verified columns:', cols.map(c => c.column_name).join(', '));

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  }
}

runMigration();
