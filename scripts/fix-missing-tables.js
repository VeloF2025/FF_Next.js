#!/usr/bin/env node

/**
 * Fix Missing Tables Script
 * Creates the contractor_rag_history and contractor_onboarding_stages tables
 */

const { neon } = require('@neondatabase/serverless');

// Database connection
const DATABASE_URL = 'process.env.DATABASE_URL';
const sql = neon(DATABASE_URL);

async function createMissingTables() {
  console.log('🔧 Creating missing tables...\n');
  
  try {
    // Create contractor_rag_history table
    console.log('Creating contractor_rag_history table...');
    await sql`
      CREATE TABLE IF NOT EXISTS contractor_rag_history (
        id SERIAL PRIMARY KEY,
        contractor_id UUID NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
        score_type VARCHAR(50) NOT NULL CHECK (score_type IN ('overall', 'financial', 'compliance', 'performance', 'safety')),
        old_score VARCHAR(10) CHECK (old_score IN ('red', 'amber', 'green')),
        new_score VARCHAR(10) NOT NULL CHECK (new_score IN ('red', 'amber', 'green')),
        change_reason TEXT,
        assessment_data JSONB,
        changed_by VARCHAR(255),
        changed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      )
    `;
    console.log('✅ contractor_rag_history table created');
    
    // Create contractor_onboarding_stages table
    console.log('\nCreating contractor_onboarding_stages table...');
    await sql`
      CREATE TABLE IF NOT EXISTS contractor_onboarding_stages (
        id SERIAL PRIMARY KEY,
        contractor_id UUID NOT NULL REFERENCES contractors(id) ON DELETE CASCADE,
        stage_name VARCHAR(100) NOT NULL,
        stage_order INTEGER NOT NULL,
        status VARCHAR(50) DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped')),
        completion_percentage INTEGER DEFAULT 0,
        required_documents JSONB DEFAULT '[]',
        completed_documents JSONB DEFAULT '[]',
        started_at TIMESTAMP WITH TIME ZONE,
        completed_at TIMESTAMP WITH TIME ZONE,
        due_date DATE,
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(contractor_id, stage_name)
      )
    `;
    console.log('✅ contractor_onboarding_stages table created');
    
    // Create indexes for the new tables
    console.log('\nCreating indexes...');
    
    await sql`CREATE INDEX IF NOT EXISTS idx_contractor_rag_history_contractor ON contractor_rag_history(contractor_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_contractor_rag_history_type ON contractor_rag_history(score_type)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_contractor_onboarding_contractor ON contractor_onboarding_stages(contractor_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_contractor_onboarding_status ON contractor_onboarding_stages(status)`;
    
    console.log('✅ Indexes created');
    
    // Verify all tables exist
    console.log('\n📋 Verifying all tables...\n');
    
    const tables = [
      'contractors',
      'contractor_teams', 
      'contractor_documents',
      'contractor_rag_history',
      'contractor_onboarding_stages'
    ];
    
    for (const table of tables) {
      const result = await sql`
        SELECT COUNT(*) as count 
        FROM information_schema.tables 
        WHERE table_name = ${table}
      `;
      
      if (result[0].count > 0) {
        console.log(`  ✅ Table '${table}' exists`);
      } else {
        console.log(`  ❌ Table '${table}' not found`);
      }
    }
    
    console.log('\n🎉 All contractor tables are now ready!');
    
  } catch (error) {
    console.error('❌ Error creating tables:', error);
    process.exit(1);
  }
}

// Run the script
createMissingTables().catch(console.error);