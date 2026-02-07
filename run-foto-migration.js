const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

const sql = neon(process.env.DATABASE_URL || 'process.env.DATABASE_URL');

async function runMigration() {
  try {
    const migrationPath = path.join(__dirname, 'scripts/migrations/create-foto-ai-reviews-table.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

    console.log('Running migration: create-foto-ai-reviews-table.sql');

    // Execute the migration SQL using sql.query for raw SQL
    const client = neon(process.env.DATABASE_URL || 'process.env.DATABASE_URL', {
      fullResults: true
    });

    await client(migrationSQL);

    console.log('✓ Migration completed successfully');

    // Verify table was created
    const result = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      AND table_name = 'foto_ai_reviews'
    `;

    if (result.length > 0) {
      console.log('✓ Table foto_ai_reviews created successfully');
    } else {
      console.error('✗ Table was not created');
    }

    process.exit(0);
  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
  }
}

runMigration();
