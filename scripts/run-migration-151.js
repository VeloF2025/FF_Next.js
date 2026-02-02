#!/usr/bin/env node

/**
 * Migration 151: Client PO Documents
 * Adds document support for Client POs and project documents (BSS, MSS)
 */

const { neon } = require('@neondatabase/serverless');
const fs = require('fs').promises;
const path = require('path');

async function runMigration() {
  const sql = neon(process.env.DATABASE_URL);

  try {
    console.log('🚀 Starting Migration 151: Client PO Documents...\n');

    // Read the migration SQL file
    const migrationPath = path.join(__dirname, 'migrations', '151_client_po_documents.sql');
    const migrationSQL = await fs.readFile(migrationPath, 'utf-8');

    console.log('📄 Read migration file successfully');
    console.log('🔧 Executing migration...\n');

    // Split the SQL into individual statements and execute them
    const statements = migrationSQL
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      if (statement.trim()) {
        try {
          console.log(`  Executing statement ${i + 1}/${statements.length}...`);
          await sql.unsafe(statement);
          console.log(`    ✓ Success`);
        } catch (error) {
          // Some statements might fail if tables/columns already exist, that's OK
          if (error.message.includes('already exists') ||
              error.message.includes('does not exist')) {
            console.log(`    ⚠️  Skipped (expected): ${error.message.split('\n')[0]}`);
          } else {
            throw error;
          }
        }
      }
    }

    console.log('\n✅ Migration 151 completed successfully!');
    console.log('\n📋 Changes:');
    console.log('  - Added source_document_url to client_purchase_orders');
    console.log('  - Added source_document_name to client_purchase_orders');
    console.log('  - Added vlm_extraction_data to client_purchase_orders');
    console.log('  - Added vlm_confidence_score to client_purchase_orders');
    console.log('  - Created project_documents table (BSS, MSS, etc.)');

  } catch (error) {
    console.error('\n❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  runMigration().catch(console.error);
}

module.exports = { runMigration };
