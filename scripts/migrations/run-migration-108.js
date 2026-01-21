/**
 * Migration Runner: 108_pipeline_management
 * Run: DATABASE_URL="..." node scripts/migrations/run-migration-108.js
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('❌ DATABASE_URL environment variable is required');
    console.log('\nUsage:');
    console.log('  DATABASE_URL="postgresql://..." node scripts/migrations/run-migration-108.js');
    process.exit(1);
  }

  const client = new Client({ connectionString: databaseUrl });

  console.log('🚀 Running Migration 108: Pipeline Management Module\n');

  try {
    await client.connect();
    console.log('✅ Connected to database\n');

    // Read the migration file
    const migrationPath = path.join(__dirname, '108_pipeline_management.sql');
    const migrationSql = fs.readFileSync(migrationPath, 'utf8');

    // Execute the entire migration as a transaction
    await client.query('BEGIN');

    try {
      // Execute the full migration
      await client.query(migrationSql);

      await client.query('COMMIT');
      console.log('✅ Migration executed successfully\n');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }

    // Verify tables
    const tablesResult = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name LIKE 'pipeline_%'
      ORDER BY table_name
    `);

    const smartsheetResult = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name LIKE 'smartsheet_%'
      ORDER BY table_name
    `);

    console.log('📋 Pipeline Tables Created:');
    tablesResult.rows.forEach(t => console.log(`   • ${t.table_name}`));

    console.log('\n📋 Smartsheet Tables Created:');
    smartsheetResult.rows.forEach(t => console.log(`   • ${t.table_name}`));

    // Check approval types seeded
    const approvalTypesResult = await client.query(`
      SELECT code, name, category FROM pipeline_approval_types ORDER BY display_order
    `);
    console.log(`\n🏷️  Approval Types Seeded (${approvalTypesResult.rows.length}):`);
    approvalTypesResult.rows.forEach(t => console.log(`   • [${t.category}] ${t.code}: ${t.name}`));

    // Check views
    const viewsResult = await client.query(`
      SELECT table_name
      FROM information_schema.views
      WHERE table_schema = 'public'
        AND table_name LIKE 'pipeline_%'
    `);
    console.log(`\n👁️  Views Created:`);
    viewsResult.rows.forEach(v => console.log(`   • ${v.table_name}`));

    // Check triggers
    const triggersResult = await client.query(`
      SELECT trigger_name, event_object_table
      FROM information_schema.triggers
      WHERE trigger_schema = 'public'
        AND trigger_name LIKE 'trg_%pipeline%'
    `);
    console.log(`\n⚡ Triggers Created:`);
    triggersResult.rows.forEach(t => console.log(`   • ${t.trigger_name} on ${t.event_object_table}`));

    console.log('\n' + '='.repeat(60));
    console.log('✅ Migration 108 completed successfully!\n');

  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    if (error.position) {
      console.error('   Position:', error.position);
    }
    if (error.detail) {
      console.error('   Detail:', error.detail);
    }
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration();
