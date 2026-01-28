/**
 * Migration 137: Departments Table
 * Creates dynamic department management
 *
 * Usage: node scripts/migrations/run-migration-137.js
 */

const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const sql = neon(databaseUrl);

  console.log('Running Migration 137: Departments Table');
  console.log('='.repeat(50));

  try {
    // Read and execute SQL file
    const sqlPath = path.join(__dirname, '137_departments_table.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');

    // Split by semicolons but keep DO blocks together
    const statements = [];
    let currentStatement = '';
    let inDoBlock = false;

    for (const line of sqlContent.split('\n')) {
      const trimmed = line.trim();

      // Track DO blocks
      if (trimmed.startsWith('DO $$')) {
        inDoBlock = true;
      }
      if (trimmed === 'END $$;') {
        inDoBlock = false;
        currentStatement += line + '\n';
        statements.push(currentStatement.trim());
        currentStatement = '';
        continue;
      }

      currentStatement += line + '\n';

      // Only split on semicolons outside DO blocks
      if (!inDoBlock && trimmed.endsWith(';') && !trimmed.startsWith('--')) {
        statements.push(currentStatement.trim());
        currentStatement = '';
      }
    }

    // Execute each statement
    for (const statement of statements) {
      if (!statement || statement.startsWith('--')) continue;

      const preview = statement.substring(0, 60).replace(/\n/g, ' ');
      console.log(`Executing: ${preview}...`);

      try {
        await sql(statement);
        console.log('  OK');
      } catch (error) {
        // Ignore "already exists" errors
        if (error.message?.includes('already exists') || error.message?.includes('duplicate key')) {
          console.log('  SKIPPED (already exists)');
        } else {
          throw error;
        }
      }
    }

    // Verify migration
    console.log('\nVerifying migration...');

    const deptCount = await sql`SELECT COUNT(*) as count FROM departments`;
    console.log(`  Departments: ${deptCount[0].count}`);

    const staffWithDept = await sql`
      SELECT COUNT(*) as count FROM staff WHERE department_id IS NOT NULL
    `;
    console.log(`  Staff with department_id: ${staffWithDept[0].count}`);

    console.log('\nMigration 137 completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
  }
}

runMigration();
