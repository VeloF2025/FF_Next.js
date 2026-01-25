#!/usr/bin/env node
/**
 * Run migration 126: Pipeline Service Authorities
 *
 * Adds:
 * - pipeline_service_authorities table
 * - Compulsory flag on approval types
 * - Lease agreement and cession tracking on projects
 * - Service authority link on approvals
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

async function runMigration() {
  await client.connect();

  try {
    console.log('Running migration 126: Pipeline Service Authorities...');

    const migrationPath = path.join(__dirname, '126_pipeline_service_authorities.sql');
    const sql = fs.readFileSync(migrationPath, 'utf8');

    await client.query(sql);

    // Verify migration
    const result = await client.query(`
      SELECT
        (SELECT COUNT(*) FROM information_schema.tables WHERE table_name = 'pipeline_service_authorities') as table_exists,
        (SELECT COUNT(*) FROM pipeline_approval_types WHERE is_compulsory = true) as compulsory_count,
        (SELECT COUNT(*) FROM information_schema.columns WHERE table_name = 'pipeline_projects' AND column_name = 'lease_agreement_status') as lease_column_exists
    `);

    const { table_exists, compulsory_count, lease_column_exists } = result.rows[0];

    console.log('\nMigration 126 Results:');
    console.log('- Service authorities table created:', table_exists > 0 ? 'YES' : 'NO');
    console.log('- Compulsory approval types:', compulsory_count);
    console.log('- Lease agreement column added:', lease_column_exists > 0 ? 'YES' : 'NO');

    console.log('\n✅ Migration 126 completed successfully!');
  } catch (error) {
    console.error('Migration 126 failed:', error.message);
    throw error;
  } finally {
    await client.end();
  }
}

runMigration().catch(err => {
  console.error(err);
  process.exit(1);
});
