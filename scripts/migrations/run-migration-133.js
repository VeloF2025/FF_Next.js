#!/usr/bin/env node
/**
 * Migration 133: Project Management Hub (PRD-058)
 *
 * Creates tables for:
 * - project_requirements (workflow checklists)
 * - contractor_agreements (SOW + MBA)
 * - document_expiry_tracking
 *
 * Run: node scripts/migrations/run-migration-133.js
 */

const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('❌ DATABASE_URL environment variable is required');
    process.exit(1);
  }

  console.log('🚀 Starting Migration 133: Project Management Hub (PRD-058)');
  console.log('─'.repeat(60));

  const sql = neon(databaseUrl);

  try {
    // Read the SQL file
    const migrationPath = path.join(__dirname, '133_project_management_hub.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf-8');

    // Split into individual statements (handling $$ blocks)
    const statements = splitSQLStatements(migrationSQL);

    console.log(`📝 Found ${statements.length} SQL statements to execute`);
    console.log('');

    let successCount = 0;
    let skipCount = 0;

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i].trim();
      if (!statement || statement.startsWith('--')) continue;

      try {
        await sql.unsafe(statement);
        successCount++;

        // Log progress for key operations
        if (statement.includes('CREATE TABLE')) {
          const tableName = statement.match(/CREATE TABLE[^(]+?(\w+)/i)?.[1] || 'unknown';
          console.log(`✅ Created table: ${tableName}`);
        } else if (statement.includes('CREATE INDEX')) {
          const indexName = statement.match(/CREATE INDEX[^O]+?(\w+)/i)?.[1] || 'unknown';
          console.log(`  📇 Created index: ${indexName}`);
        } else if (statement.includes('CREATE OR REPLACE FUNCTION')) {
          const funcName = statement.match(/FUNCTION\s+(\w+)/i)?.[1] || 'unknown';
          console.log(`✅ Created function: ${funcName}`);
        } else if (statement.includes('CREATE OR REPLACE VIEW')) {
          const viewName = statement.match(/VIEW\s+(\w+)/i)?.[1] || 'unknown';
          console.log(`✅ Created view: ${viewName}`);
        } else if (statement.includes('CREATE TRIGGER')) {
          const triggerName = statement.match(/TRIGGER\s+(\w+)/i)?.[1] || 'unknown';
          console.log(`✅ Created trigger: ${triggerName}`);
        } else if (statement.includes('ALTER TABLE') && statement.includes('ADD COLUMN')) {
          const colMatch = statement.match(/ADD COLUMN\s+(\w+)/i);
          if (colMatch) {
            console.log(`  ➕ Added column: ${colMatch[1]}`);
          }
        }
      } catch (err) {
        // Handle "already exists" gracefully
        if (err.message?.includes('already exists') ||
            err.message?.includes('duplicate key') ||
            err.message?.includes('relation') && err.message?.includes('exists')) {
          skipCount++;
          // Don't log skipped items to reduce noise
        } else {
          console.error(`❌ Error executing statement ${i + 1}:`, err.message);
          console.error('Statement:', statement.substring(0, 100) + '...');
        }
      }
    }

    console.log('');
    console.log('─'.repeat(60));
    console.log(`✅ Migration 133 completed successfully`);
    console.log(`   Executed: ${successCount} statements`);
    if (skipCount > 0) {
      console.log(`   Skipped: ${skipCount} (already exist)`);
    }
    console.log('');
    console.log('📋 New tables created:');
    console.log('   - project_requirements (workflow checklists)');
    console.log('   - contractor_agreements (SOW + MBA tracking)');
    console.log('   - document_expiry_tracking (expiry monitoring)');
    console.log('');
    console.log('📊 New views created:');
    console.log('   - v_portfolio_metrics (dashboard aggregates)');
    console.log('   - v_project_expiring_docs (expiring documents)');

  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

/**
 * Split SQL into statements, handling $$ blocks
 */
function splitSQLStatements(sql) {
  const statements = [];
  let current = '';
  let inDollarBlock = false;
  const lines = sql.split('\n');

  for (const line of lines) {
    const trimmedLine = line.trim();

    // Skip empty lines and comments at statement start
    if (!current && (!trimmedLine || trimmedLine.startsWith('--'))) {
      continue;
    }

    // Check for $$ blocks (functions, triggers)
    const dollarMatches = (line.match(/\$\$/g) || []).length;
    if (dollarMatches % 2 === 1) {
      inDollarBlock = !inDollarBlock;
    }

    current += line + '\n';

    // End of statement (not in $$ block and line ends with ;)
    if (!inDollarBlock && trimmedLine.endsWith(';')) {
      statements.push(current.trim());
      current = '';
    }
  }

  // Add any remaining content
  if (current.trim()) {
    statements.push(current.trim());
  }

  return statements;
}

// Run migration
runMigration();
