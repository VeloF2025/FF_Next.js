/**
 * Run Bank Details Migration
 * Adds bank columns to staff table for OCR-extracted bank details
 */

require('dotenv').config({ path: '.env.local' });

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const connectionString = process.env.DATABASE_URL ||
    'process.env.DATABASE_URL';

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('Connecting to database...');
    console.log('Branch: production (ep-dry-night-a9qyh4sj)');
    await client.connect();
    console.log('Connected\n');

    const sqlFile = path.join(__dirname, '037_bank_details_columns.sql');
    const sql = fs.readFileSync(sqlFile, 'utf8');

    console.log('Running migration: 037_bank_details_columns.sql');
    console.log('Adding columns: bank_name, bank_account_number, bank_branch_code, bank_account_type, bank_account_holder, bank_details_verified_at\n');

    await client.query(sql);

    console.log('Migration completed successfully\n');

    // Verify columns were added
    console.log('Verifying new columns:\n');

    const result = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'staff'
        AND column_name IN ('bank_name', 'bank_account_number', 'bank_branch_code', 'bank_account_type', 'bank_account_holder', 'bank_details_verified_at')
      ORDER BY ordinal_position;
    `);

    if (result.rows.length >= 5) {
      console.log('All bank columns present:');
      console.table(result.rows);
    } else {
      console.log(`Found ${result.rows.length} columns:`);
      console.table(result.rows);
    }

  } catch (error) {
    console.error('Migration failed:', error.message);
    throw error;
  } finally {
    await client.end();
    console.log('\nDatabase connection closed');
  }
}

runMigration().catch(console.error);
