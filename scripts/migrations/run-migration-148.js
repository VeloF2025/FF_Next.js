/**
 * Run migration 148: Serial verification pre-computed columns
 *
 * Usage: node scripts/migrations/run-migration-148.js
 */
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

async function run() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });

  const sqlPath = path.join(__dirname, '148_serial_verification_precomputed.sql');
  const sql = fs.readFileSync(sqlPath, 'utf8');

  console.log('Running migration 148: Serial verification pre-computed columns...');

  try {
    await pool.query(sql);
    console.log('Migration 148 completed successfully.');
  } catch (error) {
    console.error('Migration 148 failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

run();
