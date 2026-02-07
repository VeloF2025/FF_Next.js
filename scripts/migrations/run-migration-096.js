/**
 * Migration Runner: 096_wa_service_fallback.sql
 * Run with: node scripts/migrations/run-migration-096.js
 */

const { neonConfig, Pool } = require('@neondatabase/serverless');
const ws = require('ws');
const fs = require('fs');
const path = require('path');

neonConfig.webSocketConstructor = ws;

const DATABASE_URL = process.env.DATABASE_URL ||
  'process.env.DATABASE_URL';

async function runMigration() {
  const pool = new Pool({ connectionString: DATABASE_URL });

  try {
    console.log('Running migration 096_wa_service_fallback.sql...');

    const sqlPath = path.join(__dirname, '096_wa_service_fallback.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    // Run the entire migration as one script
    await pool.query(sql);

    console.log('✅ Migration 096 completed successfully!');

    // Verify the results
    const { rows: configs } = await pool.query(
      "SELECT config_key, config_value FROM wa_service_config WHERE config_key LIKE '%_phone' OR config_key LIKE '%_failover' ORDER BY config_key"
    );
    console.log('\nPhone configurations:');
    console.table(configs);

    const { rows: phones } = await pool.query('SELECT service, phone_number, display_name, role, status FROM wa_phone_numbers ORDER BY service, role');
    console.log('\nRegistered phone numbers:');
    console.table(phones);

  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
