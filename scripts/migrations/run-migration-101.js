/**
 * Migration 101: BOQ Import Exceptions Table
 * Run: node scripts/migrations/run-migration-101.js
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

  console.log('🚀 Running Migration 101: BOQ Import Exceptions');

  const sql = neon(databaseUrl);

  try {
    // Read the migration SQL
    const migrationPath = path.join(__dirname, '101_boq_import_exceptions.sql');
    const migrationSql = fs.readFileSync(migrationPath, 'utf8');

    // Split by semicolons carefully (avoiding PL/pgSQL blocks)
    const statements = migrationSql
      .split(/;(?=(?:[^']*'[^']*')*[^']*$)/)
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    console.log(`📝 Executing ${statements.length} statements...\n`);

    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];

      if (!statement || statement.startsWith('--')) continue;

      try {
        await sql.unsafe(statement);

        if (statement.includes('CREATE TABLE IF NOT EXISTS boq_import_exceptions')) {
          console.log('✅ Created boq_import_exceptions table');
        } else if (statement.includes('CREATE INDEX')) {
          console.log('✅ Created index');
        } else if (statement.includes('CREATE OR REPLACE FUNCTION')) {
          console.log('✅ Created timestamp update function');
        } else if (statement.includes('CREATE TRIGGER')) {
          console.log('✅ Created trigger');
        } else if (statement.includes('COMMENT ON TABLE')) {
          console.log('✅ Added table comment');
        }
      } catch (err) {
        if (err.message?.includes('already exists') || err.message?.includes('duplicate key')) {
          console.log(`⚠️  Skipped (already exists)`);
        } else {
          console.error(`❌ Error: ${err.message}`);
        }
      }
    }

    // Verify
    console.log('\n🔍 Verifying migration...');

    const check = await sql`
      SELECT EXISTS (
        SELECT FROM information_schema.tables
        WHERE table_name = 'boq_import_exceptions'
      ) as exists
    `;

    console.log(`   boq_import_exceptions table: ${check[0].exists ? '✅' : '❌'}`);

    if (check[0].exists) {
      console.log('\n✅ Migration 101 completed successfully!');
    } else {
      console.log('\n⚠️  Migration may have issues');
    }

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  }
}

runMigration();
