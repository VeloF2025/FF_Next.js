#!/usr/bin/env node

const { neon } = require('@neondatabase/serverless');

// Database connection
const DATABASE_URL = 'process.env.DATABASE_URL';
const sql = neon(DATABASE_URL);

async function createTables() {
  console.log('🔨 Creating contractor tables...\n');
  
  try {
    // Create contractors table
    console.log('Creating contractors table...');
    await sql`
      CREATE TABLE IF NOT EXISTS contractors (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_name TEXT NOT NULL,
        registration_number VARCHAR(50) NOT NULL UNIQUE,
        contact_person TEXT NOT NULL,
        email VARCHAR(255) NOT NULL,
        phone VARCHAR(20),
        alternative_phone VARCHAR(20),
        address TEXT,
        city VARCHAR(100),
        province VARCHAR(100),
        postal_code VARCHAR(10),
        website TEXT,
        vat_number VARCHAR(50),
        bee_level INTEGER,
        bee_expiry_date TIMESTAMP,
        number_of_employees INTEGER,
        established_date TIMESTAMP,
        bank_name VARCHAR(100),
        bank_account_number VARCHAR(50),
        bank_branch_code VARCHAR(10),
        insurance_provider VARCHAR(100),
        insurance_policy_number VARCHAR(100),
        insurance_expiry_date TIMESTAMP,
        safety_rating NUMERIC(5,2),
        quality_score NUMERIC(5,2),
        on_time_delivery NUMERIC(5,2),
        rag_performance VARCHAR(10),
        rag_quality VARCHAR(10),
        rag_safety VARCHAR(10),
        rag_overall VARCHAR(10),
        status VARCHAR(20),
        notes TEXT,
        capabilities JSONB,
        certifications JSONB,
        preferred_payment_terms VARCHAR(50),
        credit_limit NUMERIC(15,2),
        created_by VARCHAR(255),
        updated_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    console.log('✅ contractors table created');
    
    // Create indexes for contractors
    await sql`CREATE INDEX IF NOT EXISTS idx_contractor_email ON contractors(email)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_contractor_status ON contractors(status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_contractor_rag ON contractors(rag_overall)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_contractor_reg_number ON contractors(registration_number)`;
    
    // Create contractor_teams table
    console.log('Creating contractor_teams table...');
    await sql`
      CREATE TABLE IF NOT EXISTS contractor_teams (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contractor_id UUID NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
        team_name TEXT NOT NULL,
        team_type VARCHAR(50),
        specialization VARCHAR(100),
        max_capacity INTEGER NOT NULL,
        current_capacity INTEGER DEFAULT 0,
        leader_id UUID,
        vehicle_count INTEGER,
        equipment_list JSONB,
        certifications JSONB,
        status VARCHAR(20),
        performance_score NUMERIC(5,2),
        base_location TEXT,
        operating_radius INTEGER,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    console.log('✅ contractor_teams table created');
    
    // Create indexes for contractor_teams
    await sql`CREATE INDEX IF NOT EXISTS idx_contractor_team ON contractor_teams(contractor_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_team_type ON contractor_teams(team_type)`;
    
    // Create team_members table
    console.log('Creating team_members table...');
    await sql`
      CREATE TABLE IF NOT EXISTS team_members (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        team_id UUID NOT NULL REFERENCES contractor_teams(id) ON DELETE CASCADE,
        contractor_id UUID NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        id_number VARCHAR(20) UNIQUE,
        email VARCHAR(255),
        phone VARCHAR(20),
        role VARCHAR(50),
        skills JSONB,
        certifications JSONB,
        years_experience INTEGER,
        emergency_contact VARCHAR(20),
        emergency_contact_name TEXT,
        blood_type VARCHAR(5),
        medical_conditions TEXT,
        status VARCHAR(20),
        performance_rating NUMERIC(5,2),
        safety_score NUMERIC(5,2),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    console.log('✅ team_members table created');
    
    // Create indexes for team_members
    await sql`CREATE INDEX IF NOT EXISTS idx_team_member ON team_members(team_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_contractor_member ON team_members(contractor_id)`;
    
    // Create project_assignments table
    console.log('Creating project_assignments table...');
    await sql`
      CREATE TABLE IF NOT EXISTS project_assignments (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id VARCHAR(255) NOT NULL,
        contractor_id UUID NOT NULL REFERENCES contractors(id),
        team_id UUID REFERENCES contractor_teams(id),
        assignment_type VARCHAR(50),
        scope TEXT NOT NULL,
        responsibilities JSONB,
        start_date TIMESTAMP NOT NULL,
        end_date TIMESTAMP,
        actual_start_date TIMESTAMP,
        actual_end_date TIMESTAMP,
        status VARCHAR(20) NOT NULL,
        performance_rating NUMERIC(5,2),
        quality_score NUMERIC(5,2),
        safety_score NUMERIC(5,2),
        progress_percentage INTEGER,
        issues_reported INTEGER,
        issues_resolved INTEGER,
        completion_notes TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    console.log('✅ project_assignments table created');
    
    // Create indexes for project_assignments
    await sql`CREATE INDEX IF NOT EXISTS idx_project_contractor ON project_assignments(project_id, contractor_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_contractor_assignment ON project_assignments(contractor_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_assignment_status ON project_assignments(status)`;
    
    // Create contractor_documents table
    console.log('Creating contractor_documents table...');
    await sql`
      CREATE TABLE IF NOT EXISTS contractor_documents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contractor_id UUID NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
        document_type VARCHAR(50) NOT NULL,
        document_name TEXT NOT NULL,
        document_number VARCHAR(100),
        file_name TEXT NOT NULL,
        file_url TEXT NOT NULL,
        file_size INTEGER,
        mime_type VARCHAR(100),
        issue_date TIMESTAMP,
        expiry_date TIMESTAMP,
        is_verified BOOLEAN DEFAULT false,
        verified_by VARCHAR(255),
        verified_date TIMESTAMP,
        status VARCHAR(20),
        notes TEXT,
        rejection_reason TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    console.log('✅ contractor_documents table created');
    
    // Create indexes for contractor_documents
    await sql`CREATE INDEX IF NOT EXISTS idx_contractor_doc ON contractor_documents(contractor_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_doc_type ON contractor_documents(document_type)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_doc_expiry ON contractor_documents(expiry_date)`;
    
    // Create contractor_rag_scores table
    console.log('Creating contractor_rag_scores table...');
    await sql`
      CREATE TABLE IF NOT EXISTS contractor_rag_scores (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        contractor_id UUID NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
        assessment_date TIMESTAMP NOT NULL,
        performance_score NUMERIC(5,2),
        quality_score NUMERIC(5,2),
        safety_score NUMERIC(5,2),
        compliance_score NUMERIC(5,2),
        financial_score NUMERIC(5,2),
        overall_score NUMERIC(5,2),
        rag_status VARCHAR(10),
        assessment_notes TEXT,
        assessed_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `;
    console.log('✅ contractor_rag_scores table created');
    
    // Create indexes for contractor_rag_scores
    await sql`CREATE INDEX IF NOT EXISTS idx_rag_contractor ON contractor_rag_scores(contractor_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_rag_date ON contractor_rag_scores(assessment_date)`;
    
    console.log('\n✅ All contractor tables created successfully!');
    
    // Verify tables
    const tables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN (
        'contractors', 'contractor_teams', 'team_members', 
        'project_assignments', 'contractor_documents', 'contractor_rag_scores'
      )
      ORDER BY table_name
    `;
    
    console.log('\n📋 Created tables:');
    tables.forEach(t => console.log(`  - ${t.table_name}`));
    
  } catch (error) {
    console.error('❌ Error creating tables:', error);
    process.exit(1);
  }
}

// Run the script
createTables().catch(console.error);