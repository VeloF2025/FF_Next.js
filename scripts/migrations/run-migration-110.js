/**
 * Migration Runner: 110 System Health Monitoring
 *
 * Run with:
 *   DATABASE_URL='...' node scripts/migrations/run-migration-110.js
 *
 * Or use npm script:
 *   npm run db:migrate -- 110
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
  console.log('Migration 110: System Health Monitoring');
  console.log('='.repeat(60));

  try {
    // Read the SQL file
    const sqlPath = path.join(__dirname, '110_system_health_monitoring.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');

    // Split into statements (handle functions with $$ delimiters)
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
        AND table_name IN ('system_health_logs', 'system_recovery_actions', 'system_service_config')
    `;

    console.log(`Tables found: ${tables.map(t => t.table_name).join(', ')}`);

    // Count service configs
    const configCount = await sql`SELECT COUNT(*) as count FROM system_service_config`;
    console.log(`Service configurations seeded: ${configCount[0].count}`);

    // Show services by category
    const categories = await sql`
      SELECT category, COUNT(*) as count
      FROM system_service_config
      GROUP BY category
      ORDER BY category
    `;
    console.log('\nServices by category:');
    for (const cat of categories) {
      console.log(`  ${cat.category}: ${cat.count} services`);
    }

  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
  }
}

runMigration();
