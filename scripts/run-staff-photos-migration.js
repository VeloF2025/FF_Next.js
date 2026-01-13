/**
 * Run Staff Photos Migration (036)
 * Adds photo fields to staff table for ID photo extraction and comparison
 */

const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

async function runMigration() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const sql = neon(databaseUrl);

  console.log('Running migration 036_staff_photos.sql...');

  try {
    // Read migration file
    const migrationPath = path.join(__dirname, 'migrations/036_staff_photos.sql');
    const migrationSql = fs.readFileSync(migrationPath, 'utf-8');

    // Split by semicolons and run each statement
    const statements = migrationSql
      .split(';')
      .map(s => s.trim())
      .filter(s => s.length > 0 && !s.startsWith('--'));

    for (const statement of statements) {
      if (statement.length > 0) {
        console.log('Executing:', statement.substring(0, 60) + '...');
        await sql.unsafe(statement);
      }
    }

    console.log('Migration completed successfully!');

    // Verify columns exist
    const columns = await sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'staff'
      AND column_name IN ('id_photo_url', 'profile_photo_url', 'photo_match_score', 'photo_verified_at')
    `;

    console.log('Added columns:', columns.map(c => `${c.column_name} (${c.data_type})`).join(', '));

  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
  }
}

runMigration();
