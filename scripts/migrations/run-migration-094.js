/**
 * Run Migration 094: WA Communications Admin
 *
 * Creates tables for WhatsApp Communications Admin Panel:
 * - wa_group_config (project-to-group mappings)
 * - wa_message_templates (message templates)
 * - wa_message_logs (message audit logs)
 * - wa_service_config (runtime configuration)
 * - wa_admin_audit_log (admin action audit)
 */

const { neonConfig, Pool } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');
const ws = require('ws');

// Configure Neon WebSocket
neonConfig.webSocketConstructor = ws;

async function runMigration() {
  console.log('🚀 Starting Migration 094: WA Communications Admin\n');

  // Database connection
  const pool = new Pool({
    connectionString: 'process.env.DATABASE_URL',
  });

  try {
    // Read migration file
    const migrationPath = path.join(__dirname, '094_wa_communications_admin.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('📄 Migration file loaded:', migrationPath);
    console.log('📏 Migration size:', migrationSQL.length, 'characters\n');

    // Execute migration
    console.log('⚙️  Executing migration...\n');
    await pool.query(migrationSQL);

    console.log('✅ Migration executed successfully!\n');

    // Verify tables exist
    console.log('📊 Verifying tables...');
    const tablesResult = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name LIKE 'wa_%'
      ORDER BY table_name
    `);

    console.log('\nCreated tables:');
    tablesResult.rows.forEach(t => console.log(`  - ${t.table_name}`));

    // Count seed data
    const groupCount = await pool.query('SELECT COUNT(*) as count FROM wa_group_config');
    const templateCount = await pool.query('SELECT COUNT(*) as count FROM wa_message_templates');
    const configCount = await pool.query('SELECT COUNT(*) as count FROM wa_service_config');

    console.log('\nSeed data:');
    console.log(`  - wa_group_config: ${groupCount.rows[0].count} rows`);
    console.log(`  - wa_message_templates: ${templateCount.rows[0].count} rows`);
    console.log(`  - wa_service_config: ${configCount.rows[0].count} rows`);

  } catch (error) {
    console.error('\n❌ Migration failed:\n');
    console.error('Error:', error.message);
    if (error.detail) {
      console.error('Detail:', error.detail);
    }
    if (error.hint) {
      console.error('Hint:', error.hint);
    }
    process.exit(1);
  } finally {
    await pool.end();
  }

  console.log('\n✅ Migration 094 complete!\n');
}

// Run migration
runMigration().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
