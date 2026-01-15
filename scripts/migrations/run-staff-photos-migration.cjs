/**
 * Run Staff Photos Migration
 * Adds photo fields to staff table for ID photo extraction and comparison
 */

require('dotenv').config({ path: '.env.local' });

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  // Use production database
  const connectionString = process.env.DATABASE_URL ||
    'postgresql://neondb_owner:npg_aRNLhZc1G2CD@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require';

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('Connecting to database...');
    console.log('Branch: production (ep-dry-night-a9qyh4sj)');
    await client.connect();
    console.log('✓ Connected\n');

    // Read the SQL file
    const sqlFile = path.join(__dirname, '036_staff_photos.sql');
    const sql = fs.readFileSync(sqlFile, 'utf8');

    console.log('Running migration: 036_staff_photos.sql');
    console.log('Adding columns: id_photo_url, profile_photo_url, photo_match_score, photo_verified_at\n');

    await client.query(sql);

    console.log('✓ Migration completed successfully\n');

    // Verify columns were added
    console.log('Verifying new columns:\n');

    const result = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'staff'
        AND column_name IN ('id_photo_url', 'profile_photo_url', 'photo_match_score', 'photo_verified_at')
      ORDER BY ordinal_position;
    `);

    if (result.rows.length === 4) {
      console.log('✓ All photo columns added successfully:');
      console.table(result.rows);
    } else {
      console.log(`⚠ Expected 4 columns, found ${result.rows.length}:`);
      console.table(result.rows);
    }

  } catch (error) {
    console.error('✗ Migration failed:', error.message);
    throw error;
  } finally {
    await client.end();
    console.log('\nDatabase connection closed');
  }
}

runMigration().catch(console.error);
