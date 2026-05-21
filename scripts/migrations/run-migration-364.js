#!/usr/bin/env node
/* eslint-env node */
/* eslint-disable no-console, @typescript-eslint/no-var-requires */
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const VERSION = 364;
const NAME = 'serial_event_triggers';

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
      'SELECT version, name, applied_at FROM migrations WHERE version=$1',
      [VERSION]);
    console.log('Applied:', r.rows[0]);
  } catch (e) {
    console.error('Migration failed:', e.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
