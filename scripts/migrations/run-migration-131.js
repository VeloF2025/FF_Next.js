/**
 * Migration 131: Add contact fields to dr_photo_unified_reviews
 *
 * Run with: node scripts/migrations/run-migration-131.js
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL ||
  'process.env.DATABASE_URL';

async function runMigration() {
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('Running migration 131: Add contact fields to dr_photo_unified_reviews');

    const sqlPath = path.join(__dirname, '131_unified_contact_fields.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    await pool.query(sql);

    console.log('✅ Migration 131 completed successfully');

    // Verify columns exist
    const result = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'dr_photo_unified_reviews'
      AND column_name IN ('subscriber_name', 'subscriber_phone', 'subscriber_email', 'subscriber_language',
                          'qcontact_name', 'qcontact_phone', 'qcontact_email', 'signup_agent', 'installer_name')
    `);

    console.log('New columns added:', result.rows.map(r => r.column_name).join(', '));

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
