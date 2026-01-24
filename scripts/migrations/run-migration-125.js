#!/usr/bin/env node
/**
 * Run migration 125: Create olt_mismatch_records table
 */

const { Client } = require('pg');

const client = new Client({
  connectionString: process.env.DATABASE_URL,
});

async function runMigration() {
  await client.connect();

  try {
    console.log('Running migration 125...');

    // Create table
    await client.query(`
      CREATE TABLE IF NOT EXISTS olt_mismatch_records (
        id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
        import_id UUID REFERENCES olt_report_imports(id) ON DELETE CASCADE,
        drop_number VARCHAR(20) NOT NULL,
        olt_serial VARCHAR(50),
        wrong_onemap_serial VARCHAR(50),
        row_index INTEGER,
        fix_status VARCHAR(20) DEFAULT 'pending',
        fix_attempted_at TIMESTAMPTZ,
        fix_result TEXT,
        fix_old_value VARCHAR(50),
        fix_by UUID REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        CONSTRAINT olt_mismatch_records_status_check
          CHECK (fix_status IN ('pending', 'fixed', 'skipped', 'not_found', 'empty_serial'))
      )
    `);
    console.log('✓ Created olt_mismatch_records table');

    // Create indexes
    await client.query(`CREATE INDEX IF NOT EXISTS idx_olt_mismatch_drop ON olt_mismatch_records(drop_number)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_olt_mismatch_status ON olt_mismatch_records(fix_status)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_olt_mismatch_import ON olt_mismatch_records(import_id)`);
    console.log('✓ Created indexes');

    console.log('✅ Migration 125 complete');
  } catch (error) {
    console.error('Migration failed:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration();
