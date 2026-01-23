/**
 * Migration Runner: 097 Access Control
 *
 * Run with:
 *   DATABASE_URL='...' node scripts/migrations/run-migration-097.js
 *
 * Or use npm script:
 *   npm run db:migrate -- 097
 */

const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const DATABASE_URL = process.env.DATABASE_URL;

  if (!DATABASE_URL) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const sql = neon(DATABASE_URL);

  console.log('='.repeat(60));
  console.log('Migration 097: Access Control System');
  console.log('='.repeat(60));

  try {
    // Read the SQL file
    const sqlPath = path.join(__dirname, '097_access_control.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');

    // Split into statements (simple split on semicolon + newline)
    // This handles most cases but not complex functions
    const statements = [];
    let currentStatement = '';
    let inFunction = false;

    for (const line of sqlContent.split('\n')) {
      const trimmedLine = line.trim();

      // Track if we're inside a function definition
      if (trimmedLine.includes('$$ LANGUAGE')) {
        inFunction = false;
      } else if (trimmedLine.includes('AS $$')) {
        inFunction = true;
      }

      currentStatement += line + '\n';

      // End of statement if line ends with ; and we're not in a function
      if (trimmedLine.endsWith(';') && !inFunction) {
        const stmt = currentStatement.trim();
        if (stmt && !stmt.startsWith('--')) {
          statements.push(stmt);
        }
        currentStatement = '';
      }
    }

    // Add any remaining statement
    if (currentStatement.trim()) {
      statements.push(currentStatement.trim());
    }

    console.log(`Found ${statements.length} SQL statements to execute`);
    console.log('');

    // Execute each statement
    let successCount = 0;
    let skipCount = 0;

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];

      // Skip comment-only statements
      if (stmt.split('\n').every(l => l.trim().startsWith('--') || l.trim() === '')) {
        skipCount++;
        continue;
      }

      // Extract first line for logging
      const firstLine = stmt.split('\n').find(l => !l.trim().startsWith('--') && l.trim());
      const preview = firstLine ? firstLine.substring(0, 60) : 'SQL statement';

      try {
        await sql.unsafe(stmt);
        console.log(`[${i + 1}/${statements.length}] OK: ${preview}...`);
        successCount++;
      } catch (error) {
        // Some errors are OK (like "already exists")
        if (error.message.includes('already exists') ||
            error.message.includes('duplicate key') ||
            error.message.includes('ON CONFLICT DO NOTHING')) {
          console.log(`[${i + 1}/${statements.length}] SKIP (exists): ${preview}...`);
          skipCount++;
        } else {
          console.error(`[${i + 1}/${statements.length}] ERROR: ${preview}...`);
          console.error(`   ${error.message}`);
          // Continue with other statements
        }
      }
    }

    console.log('');
    console.log('='.repeat(60));
    console.log(`Migration complete: ${successCount} executed, ${skipCount} skipped`);
    console.log('='.repeat(60));

    // Verify tables were created
    console.log('\nVerifying tables...');

    const tables = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('access_permissions', 'role_permissions', 'user_permission_overrides')
    `;

    console.log(`Tables found: ${tables.map(t => t.table_name).join(', ')}`);

    // Count records
    const counts = await sql`
      SELECT
        (SELECT COUNT(*) FROM access_permissions) as permissions,
        (SELECT COUNT(*) FROM role_permissions) as role_perms
    `;

    console.log(`Permissions seeded: ${counts[0].permissions}`);
    console.log(`Role-permission mappings: ${counts[0].role_perms}`);

    // Show sample permissions
    const sampleModules = await sql`
      SELECT key, label FROM access_permissions WHERE type = 'module' ORDER BY sort_order LIMIT 5
    `;
    console.log('\nSample modules:', sampleModules.map(m => m.label).join(', '));

  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
  }
}

runMigration();
