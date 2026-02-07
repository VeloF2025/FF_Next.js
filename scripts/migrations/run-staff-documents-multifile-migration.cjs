/**
 * Run Staff Documents Multi-File Migration
 * Adds file_url_front and file_url_back columns for driver's license
 */

const { neon } = require('@neondatabase/serverless');

// Use production database
const DATABASE_URL = process.env.DATABASE_URL || 'process.env.DATABASE_URL';

async function runMigration() {
  console.log('Starting Staff Documents Multi-File migration...\n');

  const sql = neon(DATABASE_URL);

  try {
    // Add file_url_front column
    console.log('Adding file_url_front column...');
    await sql`ALTER TABLE staff_documents ADD COLUMN IF NOT EXISTS file_url_front TEXT`;
    console.log('  Done\n');

    // Add file_url_back column
    console.log('Adding file_url_back column...');
    await sql`ALTER TABLE staff_documents ADD COLUMN IF NOT EXISTS file_url_back TEXT`;
    console.log('  Done\n');

    // Add file_path column
    console.log('Adding file_path column...');
    await sql`ALTER TABLE staff_documents ADD COLUMN IF NOT EXISTS file_path TEXT`;
    console.log('  Done\n');

    // Add file_name column
    console.log('Adding file_name column...');
    await sql`ALTER TABLE staff_documents ADD COLUMN IF NOT EXISTS file_name VARCHAR(255)`;
    console.log('  Done\n');

    // Add status column
    console.log('Adding status column...');
    await sql`ALTER TABLE staff_documents ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending'`;
    console.log('  Done\n');

    // Add uploaded_at column
    console.log('Adding uploaded_at column...');
    await sql`ALTER TABLE staff_documents ADD COLUMN IF NOT EXISTS uploaded_at TIMESTAMP DEFAULT NOW()`;
    console.log('  Done\n');

    // Verify the columns were added
    const columns = await sql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'staff_documents'
        AND column_name IN ('file_url_front', 'file_url_back', 'file_path', 'file_name', 'status', 'uploaded_at')
      ORDER BY column_name
    `;

    console.log('\nVerification - New columns in staff_documents:');
    console.table(columns);

    console.log('\nMigration completed successfully!');
  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
  }
}

runMigration();
