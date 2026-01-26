#!/usr/bin/env node
/**
 * Migration 132: WhatsApp Monitored Groups
 * Run: node scripts/migrations/run-migration-132.js
 */

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = process.env.DATABASE_URL ||
  'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require';

async function runMigration() {
  const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('🚀 Running migration 132: WhatsApp Monitored Groups...\n');

    const sqlPath = path.join(__dirname, '132_wa_monitored_groups.sql');
    const sql = fs.readFileSync(sqlPath, 'utf8');

    await pool.query(sql);

    console.log('✅ Migration completed successfully!\n');

    // Verify the migration
    const result = await pool.query(`
      SELECT group_name, group_type, project_name, is_active
      FROM wa_monitored_groups
      ORDER BY group_type, group_name
    `);

    console.log('Monitored groups:');
    console.log('─'.repeat(70));
    console.log('Name'.padEnd(25) + 'Type'.padEnd(18) + 'Project'.padEnd(15) + 'Active');
    console.log('─'.repeat(70));

    for (const group of result.rows) {
      const status = group.is_active ? '✅' : '❌';
      console.log(
        `${group.group_name.padEnd(25)}${group.group_type.padEnd(18)}${(group.project_name || '-').padEnd(15)}${status}`
      );
    }

    console.log('─'.repeat(70));
    console.log(`Total: ${result.rows.length} groups`);

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();
