#!/usr/bin/env node
/**
 * Migration 121: WhatsApp Photos for DR Submissions
 * Creates unified wa_photos table for capturing serial sticker photos
 */

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL ||
  'process.env.DATABASE_URL';

async function runMigration() {
  const pool = new Pool({
    connectionString: DATABASE_URL,
  });

  try {
    console.log('🚀 Running Migration 121: WhatsApp Photos for DR Submissions');
    console.log('='.repeat(60));

    // Read SQL file
    const sqlPath = path.join(__dirname, '121_wa_photos_unified.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    // Run migration
    await pool.query(sql);
    console.log('✅ Migration 121 completed successfully');

    // Verify table was created
    const tableCheck = await pool.query(`
      SELECT table_name FROM information_schema.tables
      WHERE table_name = 'wa_photos'
    `);

    if (tableCheck.rows.length > 0) {
      console.log('✅ wa_photos table created');
    } else {
      console.log('❌ wa_photos table NOT found');
    }

    // Check columns added to dr_photo_unified_reviews
    const columnCheck = await pool.query(`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'dr_photo_unified_reviews'
      AND column_name IN ('wa_photo_count', 'wa_photo_received_at', 'wa_serial_photo_warning_sent')
    `);

    console.log(`✅ Added ${columnCheck.rows.length} new columns to dr_photo_unified_reviews`);

    console.log('='.repeat(60));
    console.log('Migration complete!');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
