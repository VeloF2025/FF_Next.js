/**
 * Migration 120: Custom Roles System
 * Run: DATABASE_URL='...' node scripts/migrations/run-migration-120.js
 */

const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    console.error('❌ DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const sql = neon(DATABASE_URL);

  console.log('='.repeat(60));
  console.log('Migration 120: Custom Roles System');
  console.log('='.repeat(60));

  try {
    // Read the SQL file
    const sqlPath = path.join(__dirname, '120_custom_roles.sql');
    const sqlContent = fs.readFileSync(sqlPath, 'utf8');

    // Remove pure comment lines at the start of blocks
    const cleanContent = sqlContent
      .split('\n')
      .map(line => {
        const trimmed = line.trim();
        // Keep comment lines that are part of a statement but mark standalone comments
        if (trimmed.startsWith('--') && !trimmed.includes('--')) {
          return ''; // Empty standalone comment lines
        }
        return line;
      })
      .join('\n');

    // Split into statements (handle function definitions with $$)
    const statements = [];
    let currentStatement = '';
    let inFunction = false;
    let dollarQuoteDepth = 0;

    for (const line of sqlContent.split('\n')) {
      const trimmedLine = line.trim();

      // Skip pure comment lines (don't accumulate them)
      if (trimmedLine.startsWith('--')) {
        continue;
      }

      // Track dollar-quoted blocks ($$)
      const dollarQuoteMatches = line.match(/\$\$/g);
      if (dollarQuoteMatches) {
        dollarQuoteDepth += dollarQuoteMatches.length;
      }

      currentStatement += line + '\n';

      // End of statement if line ends with ; and we're not in a dollar-quoted block
      if (trimmedLine.endsWith(';') && dollarQuoteDepth % 2 === 0) {
        const stmt = currentStatement.trim();
        if (stmt) {
          statements.push(stmt);
        }
        currentStatement = '';
        dollarQuoteDepth = 0;
      }
    }

    // Add any remaining statement
    if (currentStatement.trim()) {
      statements.push(currentStatement.trim());
    }

    console.log(`Found ${statements.length} SQL statements to execute\n`);

    // Execute each statement
    let successCount = 0;
    let skipCount = 0;

    for (let i = 0; i < statements.length; i++) {
      const stmt = statements[i];

      // Extract first meaningful line for logging
      const firstLine = stmt.split('\n').find(l => l.trim() && !l.trim().startsWith('--'));
      const preview = firstLine ? firstLine.trim().substring(0, 55) : 'SQL statement';

      try {
        await sql.unsafe(stmt);
        console.log(`[${i + 1}/${statements.length}] ✅ ${preview}...`);
        successCount++;
      } catch (error) {
        // Some errors are OK (like "already exists")
        if (error.message.includes('already exists') ||
            error.message.includes('duplicate key') ||
            error.message.includes('ON CONFLICT')) {
          console.log(`[${i + 1}/${statements.length}] ⚠️  SKIP (exists): ${preview}...`);
          skipCount++;
        } else {
          console.error(`[${i + 1}/${statements.length}] ❌ ERROR: ${preview}...`);
          console.error(`   ${error.message}`);
          // Continue with other statements
        }
      }
    }

    console.log('');
    console.log('='.repeat(60));
    console.log(`Migration complete: ${successCount} executed, ${skipCount} skipped`);
    console.log('='.repeat(60));

    // Verify results
    const roles = await sql`SELECT name, display_name, is_system FROM custom_roles ORDER BY sort_order`;
    console.log('\n📋 Roles in database:');
    for (const role of roles) {
      const badge = role.is_system ? '🔒' : '🔓';
      console.log(`   ${badge} ${role.name} - ${role.display_name}`);
    }

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  }
}

runMigration();
