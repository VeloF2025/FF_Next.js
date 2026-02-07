/**
 * Script to run supplier tables migration on Neon database
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const DATABASE_URL = 'process.env.DATABASE_URL';

async function runMigration() {
  console.log('🚀 Starting supplier tables migration...\n');
  
  const client = new Client({
    connectionString: DATABASE_URL,
  });
  
  try {
    await client.connect();
    console.log('✅ Connected to Neon database\n');
    
    // Read the migration SQL file
    const migrationPath = path.join(__dirname, 'migrations', 'create-suppliers-tables.sql');
    const migrationSQL = fs.readFileSync(migrationPath, 'utf8');
    
    // Split by semicolons but be careful with functions
    const statements = [];
    let currentStatement = '';
    let inFunction = false;
    
    migrationSQL.split('\n').forEach(line => {
      const trimmedLine = line.trim();
      
      // Check if we're entering or leaving a function definition
      if (trimmedLine.toUpperCase().includes('CREATE OR REPLACE FUNCTION')) {
        inFunction = true;
      }
      if (trimmedLine === '$$ language \'plpgsql\';') {
        inFunction = false;
        currentStatement += line + '\n';
        statements.push(currentStatement.trim());
        currentStatement = '';
        return;
      }
      
      // Add line to current statement
      currentStatement += line + '\n';
      
      // If not in function and line ends with semicolon, complete the statement
      if (!inFunction && trimmedLine.endsWith(';') && !trimmedLine.startsWith('--')) {
        statements.push(currentStatement.trim());
        currentStatement = '';
      }
    });
    
    // Add any remaining statement
    if (currentStatement.trim()) {
      statements.push(currentStatement.trim());
    }
    
    console.log(`📋 Found ${statements.length} SQL statements to execute\n`);
    
    let successCount = 0;
    let errorCount = 0;
    let skippedCount = 0;
    
    // Execute each statement
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      
      // Skip comments and empty statements
      if (!statement || statement.startsWith('--') || statement.trim() === '') {
        skippedCount++;
        continue;
      }
      
      // Extract operation type for logging
      const firstLine = statement.split('\n')[0].substring(0, 60).replace(/\s+/g, ' ');
      
      try {
        await client.query(statement);
        successCount++;
        console.log(`✅ [${i + 1}/${statements.length}] ${firstLine}...`);
      } catch (error) {
        if (error.message.includes('already exists')) {
          console.log(`⏭️  [${i + 1}/${statements.length}] Skipped (already exists): ${firstLine}...`);
          skippedCount++;
        } else {
          errorCount++;
          console.error(`❌ [${i + 1}/${statements.length}] Failed: ${firstLine}...`);
          console.error(`   Error: ${error.message}\n`);
        }
      }
    }
    
    console.log('\n📊 Migration Summary:');
    console.log(`   ✅ Successful: ${successCount}`);
    console.log(`   ⏭️  Skipped: ${skippedCount}`);
    console.log(`   ❌ Failed: ${errorCount}`);
    
    // Verify tables were created
    console.log('\n🔍 Verifying tables...\n');
    
    const tablesResult = await client.query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public' 
      AND tablename LIKE 'supplier%'
      ORDER BY tablename;
    `);
    
    console.log('📋 Created tables:');
    tablesResult.rows.forEach(table => {
      console.log(`   ✅ ${table.tablename}`);
    });
    
    // Check indexes
    const indexesResult = await client.query(`
      SELECT indexname 
      FROM pg_indexes 
      WHERE schemaname = 'public' 
      AND tablename LIKE 'supplier%'
      ORDER BY indexname;
    `);
    
    console.log(`\n📋 Created ${indexesResult.rows.length} indexes`);
    
    // Check triggers
    const triggersResult = await client.query(`
      SELECT trigger_name, event_object_table
      FROM information_schema.triggers
      WHERE trigger_schema = 'public'
      AND event_object_table LIKE 'supplier%'
      ORDER BY trigger_name;
    `);
    
    console.log(`📋 Created ${triggersResult.rows.length} triggers`);
    
    // Add some sample data for testing
    console.log('\n📝 Adding sample supplier data...\n');
    
    try {
      await client.query(`
        INSERT INTO suppliers (
          code, name, company_name, email, phone, 
          status, business_type, is_active, 
          contact_name, contact_email, contact_phone,
          physical_street1, physical_city, physical_state, 
          physical_postal_code, physical_country,
          notes, created_by, updated_by
        ) VALUES 
        (
          'SUP-001', 'TechCorp Solutions', 'TechCorp Solutions Ltd', 
          'info@techcorp.com', '+27 11 123 4567',
          'active', 'distributor', true,
          'John Smith', 'john@techcorp.com', '+27 82 123 4567',
          '123 Tech Street', 'Johannesburg', 'Gauteng',
          '2001', 'South Africa',
          'Leading technology distributor', 'system', 'system'
        ),
        (
          'SUP-002', 'FiberPro Supplies', 'FiberPro Supplies (Pty) Ltd',
          'sales@fiberpro.co.za', '+27 21 555 8900',
          'active', 'manufacturer', true,
          'Sarah Johnson', 'sarah@fiberpro.co.za', '+27 83 555 8901',
          '456 Industrial Road', 'Cape Town', 'Western Cape',
          '7500', 'South Africa',
          'Fiber optic cable manufacturer', 'system', 'system'
        ),
        (
          'SUP-003', 'Network Equipment Co', 'Network Equipment Co',
          'orders@netequip.co.za', '+27 31 777 2200',
          'pending', 'wholesaler', true,
          'Mike Davis', 'mike@netequip.co.za', '+27 84 777 2201',
          '789 Commerce Park', 'Durban', 'KwaZulu-Natal',
          '4000', 'South Africa',
          'Network equipment wholesaler - pending approval', 'system', 'system'
        )
        ON CONFLICT (code) DO NOTHING;
      `);
      console.log('✅ Sample suppliers added');
      
      // Add sample ratings
      await client.query(`
        INSERT INTO supplier_ratings (
          supplier_id, overall_rating, quality_rating, 
          delivery_rating, pricing_rating, communication_rating,
          review_title, review_text, created_by, created_by_name
        ) 
        SELECT 
          id, 4.5, 4.7, 4.3, 4.2, 4.8,
          'Excellent Service', 'Great supplier, always delivers on time',
          'system', 'System Admin'
        FROM suppliers 
        WHERE code = 'SUP-001'
        LIMIT 1;
      `);
      console.log('✅ Sample ratings added');
      
      // Add sample compliance documents
      await client.query(`
        INSERT INTO supplier_compliance (
          supplier_id, doc_type, doc_name, 
          status, verification_status, uploaded_by
        )
        SELECT 
          id, 'tax_clearance', 'Tax Clearance Certificate 2024',
          'approved', 'verified', 'system'
        FROM suppliers 
        WHERE code = 'SUP-001'
        LIMIT 1;
      `);
      console.log('✅ Sample compliance documents added');
      
    } catch (error) {
      if (error.message.includes('duplicate key')) {
        console.log('ℹ️  Sample data already exists');
      } else {
        console.log('⚠️  Could not add sample data:', error.message);
      }
    }
    
    console.log('\n✅ Migration completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await client.end();
    console.log('\n👋 Database connection closed');
  }
}

// Run the migration
runMigration().catch(console.error);