#!/usr/bin/env node
/* eslint-env node */
/* eslint-disable no-console, @typescript-eslint/no-var-requires */
// Apply migration 396 (meetings summary lock — Cortex Scribe Goal 3b).
// Idempotent (ADD COLUMN IF NOT EXISTS); safe to re-run. Usage:
//   DATABASE_URL=postgres://... node scripts/migrations/run-migration-396.js
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const VERSION = 396;
const NAME = 'meetings_summary_lock';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }
  const pool = new Pool({ connectionString: url });
  const sql = fs.readFileSync(
    path.join(__dirname, 'sql', `${VERSION}_${NAME}.sql`), 'utf8');
  try {
    await pool.query(sql);
    const r = await pool.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name='meetings' AND column_name IN ('summary_source','summary_locked_at')
       ORDER BY column_name`);
    console.log('Applied 396. meetings now has:', r.rows.map((x) => x.column_name));
  } catch (e) {
    console.error('Migration failed:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
