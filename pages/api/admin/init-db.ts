import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, withRole } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL || 'process.env.DATABASE_URL');

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

   try {
     // Create clients table
    await sql`
      CREATE TABLE IF NOT EXISTS clients (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        company_name VARCHAR(255) NOT NULL,
        contact_person VARCHAR(255),
        email VARCHAR(255),
        phone VARCHAR(20),
        alternate_phone VARCHAR(20),
        address TEXT,
        city VARCHAR(100),
        state VARCHAR(100),
        country VARCHAR(100) DEFAULT 'USA',
        postal_code VARCHAR(20),
        website VARCHAR(255),
        industry VARCHAR(100),
        client_type VARCHAR(50) DEFAULT 'standard',
        status VARCHAR(20) DEFAULT 'active',
        contract_value DECIMAL(15,2),
        payment_terms VARCHAR(100),
        tax_id VARCHAR(50),
        notes TEXT,
        metadata JSONB DEFAULT '{}',
        created_by UUID,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`;

    // Create projects table
    await sql`
      CREATE TABLE IF NOT EXISTS projects (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_code VARCHAR(50) NOT NULL UNIQUE,
        project_name VARCHAR(255) NOT NULL,
        client_id UUID REFERENCES clients(id) ON DELETE CASCADE,
        description TEXT,
        project_type VARCHAR(50),
        status VARCHAR(20) DEFAULT 'planning',
        priority VARCHAR(20) DEFAULT 'medium',
        start_date DATE,
        end_date DATE,
        actual_start_date DATE,
        actual_end_date DATE,
        budget DECIMAL(15,2),
        actual_cost DECIMAL(15,2),
        project_manager UUID,
        team_lead UUID,
        location TEXT,
        latitude DECIMAL(10,8),
        longitude DECIMAL(11,8),
        progress_percentage INTEGER DEFAULT 0,
        milestones JSONB DEFAULT '[]',
        deliverables JSONB DEFAULT '[]',
        risks JSONB DEFAULT '[]',
        documents JSONB DEFAULT '[]',
        tags JSONB DEFAULT '[]',
        metadata JSONB DEFAULT '{}',
        created_by UUID,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`;

    // Create SOW Poles table
    await sql`
      CREATE TABLE IF NOT EXISTS sow_poles (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
        pole_number VARCHAR(255) NOT NULL,
        location VARCHAR(500),
        pole_type VARCHAR(100),
        height DECIMAL(10,2),
        latitude DECIMAL(10,8),
        longitude DECIMAL(11,8),
        status VARCHAR(50) DEFAULT 'pending',
        installation_date DATE,
        installed_by VARCHAR(255),
        inspection_status VARCHAR(50),
        inspection_date DATE,
        notes TEXT,
        photos JSONB DEFAULT '[]',
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`;

    // Create SOW Drops table
    await sql`
      CREATE TABLE IF NOT EXISTS sow_drops (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
        drop_number VARCHAR(255) NOT NULL,
        address VARCHAR(500),
        drop_type VARCHAR(100),
        cable_length DECIMAL(10,2),
        cable_type VARCHAR(100),
        customer_name VARCHAR(255),
        customer_phone VARCHAR(20),
        latitude DECIMAL(10,8),
        longitude DECIMAL(11,8),
        status VARCHAR(50) DEFAULT 'pending',
        installation_date DATE,
        installed_by VARCHAR(255),
        tested BOOLEAN DEFAULT FALSE,
        test_date DATE,
        test_results JSONB DEFAULT '{}',
        notes TEXT,
        photos JSONB DEFAULT '[]',
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`;

    // Create SOW Fibre table
    await sql`
      CREATE TABLE IF NOT EXISTS sow_fibre (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
        cable_id VARCHAR(255) NOT NULL,
        cable_type VARCHAR(100),
        cable_size VARCHAR(50),
        fiber_count INTEGER,
        start_location VARCHAR(255),
        end_location VARCHAR(255),
        start_latitude DECIMAL(10,8),
        start_longitude DECIMAL(11,8),
        end_latitude DECIMAL(10,8),
        end_longitude DECIMAL(11,8),
        length DECIMAL(10,2),
        installation_method VARCHAR(100),
        status VARCHAR(50) DEFAULT 'pending',
        installation_date DATE,
        installed_by VARCHAR(255),
        splicing_complete BOOLEAN DEFAULT FALSE,
        splicing_date DATE,
        testing_complete BOOLEAN DEFAULT FALSE,
        test_date DATE,
        test_results JSONB DEFAULT '{}',
        notes TEXT,
        route_map JSONB DEFAULT '[]',
        metadata JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`;

    // Create indexes
    await sql`CREATE INDEX IF NOT EXISTS idx_clients_company_name ON clients(company_name)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_projects_code ON projects(project_code)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_projects_status ON projects(status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_sow_poles_project ON sow_poles(project_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_sow_poles_status ON sow_poles(status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_sow_drops_project ON sow_drops(project_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_sow_drops_status ON sow_drops(status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_sow_fibre_project ON sow_fibre(project_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_sow_fibre_status ON sow_fibre(status)`;

    // Get counts
    const [projectCount] = await sql`SELECT COUNT(*) FROM projects`;
    const [polesCount] = await sql`SELECT COUNT(*) FROM sow_poles`;
    const [dropsCount] = await sql`SELECT COUNT(*) FROM sow_drops`;
    const [fibreCount] = await sql`SELECT COUNT(*) FROM sow_fibre`;

    return res.status(200).json({
      success: true,
      message: 'Database initialized successfully',
      statistics: {
        projects: projectCount.count,
        sow_poles: polesCount.count,
        sow_drops: dropsCount.count,
        sow_fibre: fibreCount.count
      }
    });

  } catch (error: any) {
    log.error('Error initializing database', { error });
    return res.status(500).json({
      error: 'Failed to initialize database',
      details: error.message
    });
  }
}

export default withAuth(withRole('admin')(handler));