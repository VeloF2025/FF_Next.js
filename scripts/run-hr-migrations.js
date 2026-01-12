#!/usr/bin/env node

/**
 * HR System Migration Runner
 * Runs migrations 033, 034, 035 for HR system expansion
 */

const { neon } = require('@neondatabase/serverless');
const fs = require('fs').promises;
const path = require('path');

const MIGRATIONS = [
  '033_disciplinary_incidents.sql',
  '034_vehicle_assignments.sql',
  '035_staff_hr_fields.sql'
];

async function runMigrations() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('❌ DATABASE_URL environment variable not set');
    process.exit(1);
  }

  const sql = neon(databaseUrl);

  console.log('🚀 Starting HR System Migrations...\n');
  console.log(`📍 Database: ${databaseUrl.split('@')[1]?.split('/')[0] || 'configured'}\n`);

  for (const migrationFile of MIGRATIONS) {
    try {
      console.log(`\n📄 Running: ${migrationFile}`);
      console.log('─'.repeat(50));

      const migrationPath = path.join(__dirname, 'migrations', migrationFile);
      const migrationSQL = await fs.readFile(migrationPath, 'utf-8');

      // Split into statements by semicolon followed by newline
      const statements = migrationSQL
        .split(/;\s*\n/)
        .map(stmt => stmt.trim())
        .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));

      let successCount = 0;
      let skipCount = 0;

      for (let i = 0; i < statements.length; i++) {
        let statement = statements[i];
        if (statement.trim()) {
          // Remove trailing semicolon if present
          statement = statement.replace(/;\s*$/, '');

          try {
            // Use tagged template literal with raw SQL
            await sql([statement]);
            successCount++;

            // Extract object name for logging
            const match = statement.match(/(?:CREATE TABLE|ALTER TABLE|CREATE INDEX|ADD COLUMN)\s+(?:IF NOT EXISTS\s+)?([^\s(]+)/i);
            if (match) {
              console.log(`  ✓ ${match[1]}`);
            } else {
              console.log(`  ✓ Statement ${i + 1}`);
            }
          } catch (error) {
            if (error.message.includes('already exists') ||
                error.message.includes('does not exist') ||
                error.message.includes('duplicate key') ||
                error.message.includes('column') && error.message.includes('already exists')) {
              skipCount++;
              console.log(`  ⚠ Skipped (already exists)`);
            } else {
              console.error(`  ❌ Error on statement ${i + 1}: ${error.message.split('\n')[0]}`);
              console.error(`     SQL: ${statement.substring(0, 100)}...`);
              throw error;
            }
          }
        }
      }

      console.log(`  Summary: ${successCount} executed, ${skipCount} skipped`);

    } catch (error) {
      console.error(`\n❌ Migration failed: ${migrationFile}`);
      console.error(`   Error: ${error.message}`);
      process.exit(1);
    }
  }

  console.log('\n' + '═'.repeat(50));
  console.log('✅ All HR migrations completed successfully!');
  console.log('═'.repeat(50));
}

runMigrations().catch(err => {
  console.error('Migration failed:', err);
  process.exit(1);
});
