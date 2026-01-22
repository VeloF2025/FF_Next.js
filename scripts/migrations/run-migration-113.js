/**
 * Run migration 113: Health & Safety Module
 *
 * Creates tables for H&S checklists, audits, contractor compliance,
 * and ticket integration.
 *
 * Usage:
 *   node scripts/migrations/run-migration-113.js
 *
 * Or with custom database:
 *   DATABASE_URL='...' node scripts/migrations/run-migration-113.js
 */

const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('❌ DATABASE_URL environment variable is required');
    console.log('\nUsage:');
    console.log("  DATABASE_URL='postgresql://...' node scripts/migrations/run-migration-113.js");
    process.exit(1);
  }

  const sql = neon(databaseUrl);

  console.log('🚀 Running migration 113: Health & Safety Module');
  console.log('================================================\n');

  try {
    // Read and execute the SQL migration
    const migrationPath = path.join(__dirname, '113_health_safety_module.sql');
    const migrationSql = fs.readFileSync(migrationPath, 'utf8');

    // Split by semicolons but be careful with function definitions
    // Execute as a single transaction
    console.log('📝 Creating H&S tables...');

    await sql.transaction(async (tx) => {
      // Execute the entire migration as one block
      await tx.unsafe(migrationSql);
    });

    console.log('✅ Migration completed successfully!\n');

    // Verify tables created
    console.log('📊 Verifying tables created:');
    const tables = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name LIKE 'hs_%'
      ORDER BY table_name
    `;

    tables.forEach((t) => {
      console.log(`   ✓ ${t.table_name}`);
    });

    // Count seed data
    console.log('\n📋 Seed data verification:');

    const templateCount = await sql`SELECT COUNT(*) as count FROM hs_checklist_templates`;
    console.log(`   ✓ ${templateCount[0].count} checklist templates`);

    const itemCount = await sql`SELECT COUNT(*) as count FROM hs_checklist_items`;
    console.log(`   ✓ ${itemCount[0].count} checklist items`);

    console.log('\n🎉 H&S module ready!');
    console.log('\nNext steps:');
    console.log('  1. Add H&S ticket types to maintenance module');
    console.log('  2. Create H&S types in src/modules/health-safety/types/');
    console.log('  3. Create H&S services in src/modules/health-safety/services/');

  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    if (error.detail) console.error('   Detail:', error.detail);
    if (error.hint) console.error('   Hint:', error.hint);
    process.exit(1);
  }
}

runMigration();
