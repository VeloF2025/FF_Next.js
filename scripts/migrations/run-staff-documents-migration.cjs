/**
 * Run Staff Documents Migration
 * Creates staff_documents, staff_projects, and document_expiry_alerts tables
 */

require('dotenv').config({ path: '.env.local' });

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  // Use dev database (hein-dev branch)
  const connectionString = process.env.DATABASE_URL ||
    'process.env.DATABASE_URL';

  const client = new Client({
    connectionString,
    ssl: { rejectUnauthorized: false }
  });

  try {
    console.log('Connecting to database...');
    console.log('Branch: hein-dev (ep-aged-poetry-a9bbd8e9)');
    await client.connect();
    console.log('✓ Connected\n');

    // Read the SQL file
    const sqlFile = path.join(__dirname, 'create-staff-documents-tables.sql');
    const sql = fs.readFileSync(sqlFile, 'utf8');

    console.log('Running migration...');
    await client.query(sql);

    console.log('✓ Migration completed successfully\n');

    // Verify tables were created
    console.log('Verifying created tables:\n');

    // Check staff_documents
    const docsResult = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'staff_documents'
      ORDER BY ordinal_position;
    `);
    console.log('✓ staff_documents table:');
    console.table(docsResult.rows);

    // Check staff_projects
    const projResult = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'staff_projects'
      ORDER BY ordinal_position;
    `);
    console.log('\n✓ staff_projects table:');
    console.table(projResult.rows);

    // Check document_expiry_alerts
    const alertsResult = await client.query(`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'document_expiry_alerts'
      ORDER BY ordinal_position;
    `);
    console.log('\n✓ document_expiry_alerts table:');
    console.table(alertsResult.rows);

  } catch (error) {
    console.error('✗ Migration failed:', error.message);
    throw error;
  } finally {
    await client.end();
    console.log('\nDatabase connection closed');
  }
}

runMigration().catch(console.error);
