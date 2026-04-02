#!/usr/bin/env node

/**
 * Migration 270: Create teams table for NOC team management & notifications
 */

const { neon } = require('@neondatabase/serverless');
const fs = require('fs').promises;
const path = require('path');

async function runMigration() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL not set');
    process.exit(1);
  }

  const sql = neon(databaseUrl);

  try {
    console.log('Running migration 270: Create teams table...\n');

    const migrationPath = path.join(__dirname, 'migrations', 'sql', '270_create_teams_table.sql');
    const migrationSQL = await fs.readFile(migrationPath, 'utf-8');

    const statements = migrationSQL
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (statement.trim()) {
        try {
          console.log(`  [${i + 1}/${statements.length}] Executing...`);
          await sql.query(statement, []);
          console.log(`  OK`);
        } catch (error) {
          if (error.message.includes('already exists')) {
            console.log(`  SKIP (already exists)`);
          } else {
            throw error;
          }
        }
      }
    }

    // Verify
    const result = await sql`SELECT COUNT(*) as cnt FROM information_schema.tables WHERE table_name = 'teams' AND table_schema = 'public'`;
    console.log(`\nVerification: teams table exists = ${result[0].cnt > 0}`);

    const cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'team_members' AND column_name = 'user_id'`;
    console.log(`Verification: team_members.user_id column exists = ${cols.length > 0}`);

    console.log('\nMigration 270 complete.');
  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
  }
}

runMigration();
