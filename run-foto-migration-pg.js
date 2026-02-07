const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const connectionString = process.env.DATABASE_URL || 'process.env.DATABASE_URL';

async function runMigration() {
  const client = new Client({ connectionString });

  try {
    await client.connect();
    console.log('✓ Connected to database');

    const migrationPath = path.join(__dirname, 'scripts/migrations/create-foto-ai-reviews-table.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('Running migration: create-foto-ai-reviews-table.sql');

    // Execute the migration SQL
    await client.query(migrationSQL);

    console.log('✓ Migration completed successfully');

    // Verify table was created
    const result = await client.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name = 'foto_ai_reviews'
    `);

    if (result.rows.length > 0) {
      console.log('✓ Table foto_ai_reviews created successfully');
    } else {
      console.error('✗ Table was not created');
    }

  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
  } finally {
    await client.end();
    console.log('✓ Database connection closed');
  }
}

runMigration();
