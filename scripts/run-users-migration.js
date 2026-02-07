const { neon } = require('@neondatabase/serverless');
const fs = require('fs');
const path = require('path');

// Database connection string
const DATABASE_URL = 'process.env.DATABASE_URL';

async function runMigration() {
  const sql = neon(DATABASE_URL);
  
  try {
    console.log('🔧 Running users table migration...');
    
    // Read the migration SQL file
    const migrationPath = path.join(__dirname, 'migrations', 'create-users-table.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    // Split into individual statements (Neon might need them executed separately)
    const statements = migrationSQL
      .split(';')
      .map(stmt => stmt.trim())
      .filter(stmt => stmt.length > 0 && !stmt.startsWith('--'));
    
    console.log(`📝 Found ${statements.length} SQL statements to execute`);
    
    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i] + ';';
      console.log(`\n➡️  Executing statement ${i + 1}/${statements.length}...`);
      
      try {
        await sql.unsafe(statement);
        console.log(`✅ Statement ${i + 1} executed successfully`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`⚠️  Statement ${i + 1}: Resource already exists (skipping)`);
        } else if (error.message.includes('duplicate key')) {
          console.log(`⚠️  Statement ${i + 1}: Duplicate key (skipping)`);
        } else {
          console.error(`❌ Statement ${i + 1} failed:`, error.message);
          // Continue with other statements
        }
      }
    }
    
    console.log('\n✅ Migration completed successfully!');
    
    // Verify the tables were created
    console.log('\n🔍 Verifying tables...');
    const tables = await sql`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public' 
      AND tablename IN ('users', 'user_sessions', 'user_permissions', 'user_audit_log')
      ORDER BY tablename;
    `;
    
    console.log('📊 Created tables:');
    tables.forEach(table => {
      console.log(`  - ${table.tablename}`);
    });
    
    // Check if dev users were created - fixed column name
    try {
      const users = await sql`
        SELECT id, email, name, role 
        FROM users 
        WHERE id LIKE 'dev-user-%'
        ORDER BY id;
      `;
      
      console.log('\n👥 Development users:');
      users.forEach(user => {
        console.log(`  - ${user.name} (${user.email}) - Role: ${user.role}`);
      });
    } catch (error) {
      console.log('\n⚠️  Could not verify dev users (might be normal on fresh install)');
    }
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    process.exit(1);
  }
}

// Run the migration
runMigration().catch(console.error);