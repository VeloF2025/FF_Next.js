/**
 * Direct script to create supplier tables in Neon database
 */

const { Client } = require('pg');

const DATABASE_URL = 'process.env.DATABASE_URL';

async function createTables() {
  console.log('🚀 Creating supplier tables in Neon database...\n');
  
  const client = new Client({
    connectionString: DATABASE_URL,
  });
  
  try {
    await client.connect();
    console.log('✅ Connected to Neon database\n');
    
    // Drop existing tables first (cascade to handle dependencies)
    console.log('🗑️  Dropping existing supplier tables...');
    try {
      await client.query('DROP TABLE IF EXISTS supplier_performance_history CASCADE');
      await client.query('DROP TABLE IF EXISTS supplier_contracts CASCADE');
      await client.query('DROP TABLE IF EXISTS supplier_contacts CASCADE');
      await client.query('DROP TABLE IF EXISTS supplier_products CASCADE');
      await client.query('DROP TABLE IF EXISTS supplier_compliance CASCADE');
      await client.query('DROP TABLE IF EXISTS supplier_ratings CASCADE');
      await client.query('DROP TABLE IF EXISTS suppliers CASCADE');
      console.log('✅ Existing tables dropped\n');
    } catch (err) {
      console.log('ℹ️  No existing tables to drop\n');
    }
    
    // Create main suppliers table
    console.log('📋 Creating suppliers table...');
    await client.query(`
      CREATE TABLE suppliers (
        id SERIAL PRIMARY KEY,
        code VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        company_name VARCHAR(255),
        trading_name VARCHAR(255),
        registration_number VARCHAR(100),
        tax_number VARCHAR(100),
        
        -- Status and type
        status VARCHAR(50) DEFAULT 'pending',
        business_type VARCHAR(50) DEFAULT 'other',
        is_active BOOLEAN DEFAULT true,
        is_preferred BOOLEAN DEFAULT false,
        is_verified BOOLEAN DEFAULT false,
        
        -- Contact information
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(50),
        fax VARCHAR(50),
        website VARCHAR(255),
        
        -- Primary contact
        contact_name VARCHAR(255),
        contact_title VARCHAR(100),
        contact_email VARCHAR(255),
        contact_phone VARCHAR(50),
        contact_mobile VARCHAR(50),
        contact_department VARCHAR(100),
        
        -- Address information
        physical_street1 VARCHAR(255),
        physical_street2 VARCHAR(255),
        physical_city VARCHAR(100),
        physical_state VARCHAR(100),
        physical_postal_code VARCHAR(20),
        physical_country VARCHAR(100) DEFAULT 'South Africa',
        physical_lat DECIMAL(10, 8),
        physical_lng DECIMAL(11, 8),
        
        -- Banking information
        bank_name VARCHAR(100),
        bank_account_name VARCHAR(255),
        bank_account_number VARCHAR(50),
        bank_branch_code VARCHAR(20),
        
        -- Business information
        employee_size VARCHAR(20),
        annual_revenue VARCHAR(20),
        established_date DATE,
        industry VARCHAR(100),
        province VARCHAR(100),
        
        -- Payment and order terms
        preferred_payment_terms VARCHAR(50),
        currency VARCHAR(3) DEFAULT 'ZAR',
        credit_limit DECIMAL(15, 2),
        lead_time_days INTEGER,
        minimum_order_value DECIMAL(15, 2),
        
        -- Rating
        rating_overall DECIMAL(3, 2) DEFAULT 0,
        rating_quality DECIMAL(3, 2) DEFAULT 0,
        rating_delivery DECIMAL(3, 2) DEFAULT 0,
        rating_pricing DECIMAL(3, 2) DEFAULT 0,
        rating_communication DECIMAL(3, 2) DEFAULT 0,
        rating_flexibility DECIMAL(3, 2) DEFAULT 0,
        total_reviews INTEGER DEFAULT 0,
        last_review_date TIMESTAMP,
        last_reviewed_by VARCHAR(255),
        
        -- Compliance status
        tax_compliant BOOLEAN DEFAULT false,
        bee_compliant BOOLEAN DEFAULT false,
        bee_level INTEGER,
        insurance_valid BOOLEAN DEFAULT false,
        documents_verified BOOLEAN DEFAULT false,
        last_audit_date DATE,
        next_audit_date DATE,
        
        -- Blacklist information
        blacklisted BOOLEAN DEFAULT false,
        blacklist_reason TEXT,
        blacklisted_at TIMESTAMP,
        blacklisted_by VARCHAR(255),
        
        -- Inactive information
        inactive_reason TEXT,
        inactivated_at TIMESTAMP,
        
        -- Additional fields
        notes TEXT,
        tags TEXT[],
        categories TEXT[],
        
        -- Metadata
        created_by VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_by VARCHAR(255),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Suppliers table created');
    
    // Create supplier ratings table
    console.log('📋 Creating supplier_ratings table...');
    await client.query(`
      CREATE TABLE supplier_ratings (
        id SERIAL PRIMARY KEY,
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
        
        -- Rating scores (0-5 scale)
        overall_rating DECIMAL(3, 2) NOT NULL,
        quality_rating DECIMAL(3, 2),
        delivery_rating DECIMAL(3, 2),
        pricing_rating DECIMAL(3, 2),
        communication_rating DECIMAL(3, 2),
        flexibility_rating DECIMAL(3, 2),
        
        -- Review details
        review_title VARCHAR(255),
        review_text TEXT,
        order_reference VARCHAR(100),
        
        -- Metadata
        created_by VARCHAR(255) NOT NULL,
        created_by_name VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Supplier ratings table created');
    
    // Create supplier compliance table
    console.log('📋 Creating supplier_compliance table...');
    await client.query(`
      CREATE TABLE supplier_compliance (
        id SERIAL PRIMARY KEY,
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
        
        -- Document information
        doc_type VARCHAR(50) NOT NULL,
        doc_name VARCHAR(255) NOT NULL,
        doc_number VARCHAR(100),
        doc_url TEXT,
        
        -- Status and validity
        status VARCHAR(50) DEFAULT 'pending',
        verification_status VARCHAR(50) DEFAULT 'pending',
        issue_date DATE,
        expiry_date DATE,
        
        -- Issuing information
        issuing_body VARCHAR(255),
        
        -- Verification
        verified_by VARCHAR(255),
        verified_at TIMESTAMP,
        verification_notes TEXT,
        rejection_reason TEXT,
        
        -- Metadata
        uploaded_by VARCHAR(255) NOT NULL,
        uploaded_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✅ Supplier compliance table created');
    
    // Create supplier products table
    console.log('📋 Creating supplier_products table...');
    await client.query(`
      CREATE TABLE supplier_products (
        id SERIAL PRIMARY KEY,
        supplier_id INTEGER NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
        
        -- Product information
        product_code VARCHAR(100),
        product_name VARCHAR(255) NOT NULL,
        product_description TEXT,
        category VARCHAR(100),
        subcategory VARCHAR(100),
        
        -- Pricing
        unit_price DECIMAL(15, 2),
        currency VARCHAR(3) DEFAULT 'ZAR',
        unit_of_measure VARCHAR(50),
        min_order_quantity DECIMAL(10, 2),
        
        -- Availability
        in_stock BOOLEAN DEFAULT true,
        stock_quantity DECIMAL(10, 2),
        lead_time_days INTEGER,
        
        -- Status
        is_active BOOLEAN DEFAULT true,
        discontinued BOOLEAN DEFAULT false,
        
        -- Metadata
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW(),
        
        -- Unique constraint
        UNIQUE(supplier_id, product_code)
      )
    `);
    console.log('✅ Supplier products table created');
    
    // Create indexes
    console.log('📋 Creating indexes...');
    await client.query('CREATE INDEX idx_suppliers_status ON suppliers(status)');
    await client.query('CREATE INDEX idx_suppliers_is_active ON suppliers(is_active)');
    await client.query('CREATE INDEX idx_suppliers_is_preferred ON suppliers(is_preferred)');
    await client.query('CREATE INDEX idx_supplier_ratings_supplier_id ON supplier_ratings(supplier_id)');
    await client.query('CREATE INDEX idx_supplier_compliance_supplier_id ON supplier_compliance(supplier_id)');
    await client.query('CREATE INDEX idx_supplier_products_supplier_id ON supplier_products(supplier_id)');
    console.log('✅ Indexes created');
    
    // Create update trigger function
    console.log('📋 Creating trigger function...');
    await client.query(`
      CREATE OR REPLACE FUNCTION update_updated_at_column()
      RETURNS TRIGGER AS $$
      BEGIN
        NEW.updated_at = NOW();
        RETURN NEW;
      END;
      $$ language 'plpgsql'
    `);
    console.log('✅ Trigger function created');
    
    // Create triggers
    console.log('📋 Creating triggers...');
    await client.query(`
      CREATE TRIGGER update_suppliers_updated_at 
      BEFORE UPDATE ON suppliers
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()
    `);
    await client.query(`
      CREATE TRIGGER update_supplier_ratings_updated_at 
      BEFORE UPDATE ON supplier_ratings
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()
    `);
    await client.query(`
      CREATE TRIGGER update_supplier_compliance_updated_at 
      BEFORE UPDATE ON supplier_compliance
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()
    `);
    await client.query(`
      CREATE TRIGGER update_supplier_products_updated_at 
      BEFORE UPDATE ON supplier_products
      FOR EACH ROW EXECUTE FUNCTION update_updated_at_column()
    `);
    console.log('✅ Triggers created');
    
    // Add sample data
    console.log('\n📝 Adding sample supplier data...');
    
    // Insert sample suppliers
    await client.query(`
      INSERT INTO suppliers (
        code, name, company_name, email, phone, 
        status, business_type, is_active, 
        contact_name, contact_email, contact_phone,
        physical_street1, physical_city, physical_state, 
        physical_postal_code, physical_country,
        notes, created_by, updated_by, categories, tags
      ) VALUES 
      (
        'SUP-001', 'TechCorp Solutions', 'TechCorp Solutions Ltd', 
        'info@techcorp.com', '+27 11 123 4567',
        'active', 'distributor', true,
        'John Smith', 'john@techcorp.com', '+27 82 123 4567',
        '123 Tech Street', 'Johannesburg', 'Gauteng',
        '2001', 'South Africa',
        'Leading technology distributor', 'system', 'system',
        ARRAY['Technology', 'Hardware'], ARRAY['verified', 'premium']
      ),
      (
        'SUP-002', 'FiberPro Supplies', 'FiberPro Supplies (Pty) Ltd',
        'sales@fiberpro.co.za', '+27 21 555 8900',
        'active', 'manufacturer', true,
        'Sarah Johnson', 'sarah@fiberpro.co.za', '+27 83 555 8901',
        '456 Industrial Road', 'Cape Town', 'Western Cape',
        '7500', 'South Africa',
        'Fiber optic cable manufacturer', 'system', 'system',
        ARRAY['Fiber', 'Cables'], ARRAY['local', 'certified']
      ),
      (
        'SUP-003', 'Network Equipment Co', 'Network Equipment Co',
        'orders@netequip.co.za', '+27 31 777 2200',
        'pending', 'wholesaler', true,
        'Mike Davis', 'mike@netequip.co.za', '+27 84 777 2201',
        '789 Commerce Park', 'Durban', 'KwaZulu-Natal',
        '4000', 'South Africa',
        'Network equipment wholesaler - pending approval', 'system', 'system',
        ARRAY['Networking', 'Equipment'], ARRAY['new']
      )
    `);
    console.log('✅ Sample suppliers added');
    
    // Add sample ratings
    const supplierResult = await client.query(`SELECT id FROM suppliers WHERE code = 'SUP-001'`);
    if (supplierResult.rows.length > 0) {
      const supplierId = supplierResult.rows[0].id;
      
      await client.query(`
        INSERT INTO supplier_ratings (
          supplier_id, overall_rating, quality_rating, 
          delivery_rating, pricing_rating, communication_rating,
          review_title, review_text, created_by, created_by_name
        ) VALUES (
          $1, 4.5, 4.7, 4.3, 4.2, 4.8,
          'Excellent Service', 'Great supplier, always delivers on time',
          'system', 'System Admin'
        )
      `, [supplierId]);
      console.log('✅ Sample ratings added');
      
      // Add sample compliance documents
      await client.query(`
        INSERT INTO supplier_compliance (
          supplier_id, doc_type, doc_name, 
          status, verification_status, uploaded_by,
          expiry_date
        ) VALUES (
          $1, 'tax_clearance', 'Tax Clearance Certificate 2024',
          'approved', 'verified', 'system',
          '2025-12-31'
        ), (
          $1, 'bee_certificate', 'BEE Level 1 Certificate',
          'approved', 'verified', 'system',
          '2025-06-30'
        )
      `, [supplierId]);
      console.log('✅ Sample compliance documents added');
      
      // Add sample products
      await client.query(`
        INSERT INTO supplier_products (
          supplier_id, product_code, product_name, 
          product_description, category, unit_price,
          min_order_quantity, in_stock
        ) VALUES 
        ($1, 'FIBER-001', 'Single Mode Fiber Cable 1km',
         '9/125 micron single mode fiber optic cable', 'Fiber Cables',
         2500.00, 1, true),
        ($1, 'CONN-001', 'SC/PC Connector Pack (100)',
         'Single mode SC/PC connectors, pack of 100', 'Connectors',
         850.00, 1, true)
      `, [supplierId]);
      console.log('✅ Sample products added');
    }
    
    // Verify creation
    console.log('\n🔍 Verifying tables...');
    
    const tablesResult = await client.query(`
      SELECT tablename 
      FROM pg_tables 
      WHERE schemaname = 'public' 
      AND tablename LIKE 'supplier%'
      ORDER BY tablename
    `);
    
    console.log('\n📋 Created tables:');
    tablesResult.rows.forEach(table => {
      console.log(`   ✅ ${table.tablename}`);
    });
    
    // Count records
    const countResult = await client.query(`
      SELECT 
        (SELECT COUNT(*) FROM suppliers) as suppliers,
        (SELECT COUNT(*) FROM supplier_ratings) as ratings,
        (SELECT COUNT(*) FROM supplier_compliance) as compliance,
        (SELECT COUNT(*) FROM supplier_products) as products
    `);
    
    const counts = countResult.rows[0];
    console.log('\n📊 Record counts:');
    console.log(`   Suppliers: ${counts.suppliers}`);
    console.log(`   Ratings: ${counts.ratings}`);
    console.log(`   Compliance: ${counts.compliance}`);
    console.log(`   Products: ${counts.products}`);
    
    console.log('\n✅ All supplier tables created successfully!');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
    console.log('\n👋 Database connection closed');
  }
}

// Run the script
createTables().catch(console.error);