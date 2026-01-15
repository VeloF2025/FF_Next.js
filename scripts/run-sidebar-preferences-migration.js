const { neon } = require('@neondatabase/serverless');

async function runMigration() {
  const databaseUrl = process.env.DATABASE_URL;

  if (!databaseUrl) {
    console.error('DATABASE_URL environment variable is required');
    process.exit(1);
  }

  const sql = neon(databaseUrl);

  console.log('Running migration: 046_user_sidebar_preferences');

  try {
    // Create table
    console.log('Creating table...');
    await sql`
      CREATE TABLE IF NOT EXISTS user_sidebar_preferences (
        user_id TEXT PRIMARY KEY,
        main_section_items TEXT[] DEFAULT ARRAY['meetings', 'action-items'],
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;

    // Add comments
    console.log('Adding comments...');
    await sql`COMMENT ON TABLE user_sidebar_preferences IS 'Stores user preferences for customizable sidebar menu items'`;

    // Create index
    console.log('Creating index...');
    await sql`CREATE INDEX IF NOT EXISTS idx_user_sidebar_preferences_user_id ON user_sidebar_preferences(user_id)`;

    console.log('Migration completed successfully!');

    // Verify table exists
    const result = await sql`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'user_sidebar_preferences'
      ORDER BY ordinal_position
    `;

    console.log('\nTable structure:');
    result.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type}`);
    });

  } catch (error) {
    console.error('Migration failed:', error.message);
    process.exit(1);
  }
}

runMigration();
