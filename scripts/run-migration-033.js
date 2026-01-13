/**
 * Run Migration 033: Add ups_serial column to onemap_properties
 * Usage: node scripts/run-migration-033.js
 */

const { neon } = require('@neondatabase/serverless');
require('dotenv').config();

// Production database URL (fallback if not in env)
const PRODUCTION_DB_URL = 'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require';

async function runMigration() {
  const databaseUrl = process.env.DATABASE_URL || PRODUCTION_DB_URL;
  console.log('Using database endpoint:', databaseUrl.includes('ep-dry-night') ? 'ep-dry-night-a9qyh4sj (production)' : 'unknown');

  const sql = neon(databaseUrl);
  console.log('Connecting to database...');

  try {
    // Check if column already exists
    const checkResult = await sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'onemap_properties'
        AND column_name = 'ups_serial'
    `;

    if (checkResult.length > 0) {
      console.log('Column ups_serial already exists in onemap_properties table');
      return;
    }

    // Add the column
    console.log('Adding ups_serial column to onemap_properties table...');
    await sql`
      ALTER TABLE onemap_properties
      ADD COLUMN ups_serial VARCHAR(255)
    `;
    console.log('Column added successfully');

    // Create index
    console.log('Creating index on ups_serial...');
    await sql`
      CREATE INDEX IF NOT EXISTS idx_onemap_properties_ups_serial
      ON onemap_properties(ups_serial)
    `;
    console.log('Index created successfully');

    // Add comment
    await sql`
      COMMENT ON COLUMN onemap_properties.ups_serial IS 'Mini-UPS/Gizzu serial number from 1Map (br_ser field)'
    `;
    console.log('Comment added successfully');

    console.log('Migration 033 completed successfully!');

  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
  }
}

runMigration();
