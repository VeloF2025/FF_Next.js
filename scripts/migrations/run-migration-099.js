/**
 * Migration Runner: 099_sharepoint_dr_sync.sql
 * Run with: node scripts/migrations/run-migration-099.js
 */

const { neonConfig, Pool } = require('@neondatabase/serverless');
const ws = require('ws');
const fs = require('fs');
const path = require('path');

neonConfig.webSocketConstructor = ws;

const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require';

async function runMigration() {
  const pool = new Pool({ connectionString: DATABASE_URL });

  try {
    console.log('Running migration 099_sharepoint_dr_sync.sql...');

    const sqlPath = path.join(__dirname, '099_sharepoint_dr_sync.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    // Run the entire migration as one script
    await pool.query(sql);

    console.log('✅ Migration 099 completed successfully!');

    // Verify the table was created
    const { rows: columns } = await pool.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'sharepoint_dr_sync'
      ORDER BY ordinal_position
    `);
    console.log('\nTable sharepoint_dr_sync columns:');
    console.table(columns);

    // Check indexes
    const { rows: indexes } = await pool.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'sharepoint_dr_sync'
    `);
    console.log('\nIndexes created:');
    indexes.forEach(idx => console.log(`  - ${idx.indexname}`));

  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
