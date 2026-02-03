/**
 * Run migration 156: Project Pipeline Links Junction Table
 *
 * Usage: node scripts/migrations/run-migration-156.js
 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function run() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  const sqlPath = path.join(__dirname, '156_project_pipeline_links.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  console.log('Running migration 156: Project Pipeline Links Junction Table...');

  try {
    await pool.query(sql);
    console.log('Migration 156 completed successfully.');

    // Verify migration
    const result = await pool.query(`
      SELECT COUNT(*) as count FROM project_pipeline_links
    `);
    console.log(`Migrated ${result.rows[0].count} existing project-pipeline links.`);
  } catch (error) {
    console.error('Migration 156 failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();
