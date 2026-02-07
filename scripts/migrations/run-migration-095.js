/**
 * Migration Runner: 095_qa_wizard_draft_state.sql
 * Run with: node scripts/migrations/run-migration-095.js
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
    console.log('Running migration 095_qa_wizard_draft_state.sql...');

    const sqlPath = path.join(__dirname, '095_qa_wizard_draft_state.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    // Run the entire migration as one script
    await pool.query(sql);


    console.log('Migration 095 completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
