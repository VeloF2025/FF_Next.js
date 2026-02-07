import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL || 'process.env.DATABASE_URL');

async function createFieldTables() {
  try {
    console.log('Creating field operations tables...');
    
    // Create tasks table if it doesn't exist
    await sql`
      CREATE TABLE IF NOT EXISTS tasks (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        task_code VARCHAR(50) UNIQUE,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        project_id UUID REFERENCES projects(id),
        assigned_to UUID,
        assigned_by UUID,
        priority VARCHAR(20) DEFAULT 'medium',
        status VARCHAR(20) DEFAULT 'pending',
        category VARCHAR(50),
        due_date TIMESTAMP,
        start_date TIMESTAMP,
        completed_date TIMESTAMP,
        estimated_hours DECIMAL(6,2),
        actual_hours DECIMAL(6,2),
        progress INTEGER DEFAULT 0,
        dependencies JSONB DEFAULT '[]',
        subtasks JSONB DEFAULT '[]',
        comments JSONB DEFAULT '[]',
        attachments JSONB DEFAULT '[]',
        tags JSONB DEFAULT '[]',
        metadata JSONB DEFAULT '{}',
        created_by UUID,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `;
    console.log('✓ Tasks table created/verified');
    
    // Create indexes
    await sql`CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_tasks_assigned_to ON tasks(assigned_to)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_tasks_priority ON tasks(priority)`;
    console.log('✓ Tasks indexes created');
    
    // Create daily_progress table if it doesn't exist
    await sql`
      CREATE TABLE IF NOT EXISTS daily_progress (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID REFERENCES projects(id),
        work_date DATE NOT NULL,
        shift_type VARCHAR(20) DEFAULT 'day',
        team_lead UUID,
        team_members JSONB DEFAULT '[]',
        contractor_id UUID,
        work_type VARCHAR(50),
        activities_completed JSONB DEFAULT '[]',
        locations_worked JSONB DEFAULT '[]',
        drops_completed INTEGER DEFAULT 0,
        fiber_stringing_completed DECIMAL(10,2) DEFAULT 0,
        home_installations_completed INTEGER DEFAULT 0,
        poles_installed INTEGER DEFAULT 0,
        start_time TIMESTAMP,
        end_time TIMESTAMP,
        total_hours DECIMAL(6,2),
        overtime_hours DECIMAL(6,2) DEFAULT 0,
        break_time DECIMAL(4,2) DEFAULT 0,
        materials_used JSONB DEFAULT '[]',
        equipment_used JSONB DEFAULT '[]',
        vehicles_used JSONB DEFAULT '[]',
        safety_incidents JSONB DEFAULT '[]',
        quality_issues JSONB DEFAULT '[]',
        safety_check_completed BOOLEAN DEFAULT FALSE,
        ppe_compliance BOOLEAN DEFAULT TRUE,
        weather_conditions VARCHAR(100),
        temperature DECIMAL(4,1),
        work_stoppages JSONB DEFAULT '[]',
        customer_contacts JSONB DEFAULT '[]',
        customer_complaints JSONB DEFAULT '[]',
        customer_feedback JSONB DEFAULT '[]',
        work_photos JSONB DEFAULT '[]',
        progress_notes TEXT,
        challenges_faced TEXT,
        next_day_planning TEXT,
        productivity_score DECIMAL(5,2),
        efficiency_rating INTEGER,
        goal_achievement_percentage INTEGER,
        metadata JSONB DEFAULT '{}',
        created_by UUID,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `;
    console.log('✓ Daily progress table created/verified');
    
    // Create indexes for daily_progress
    await sql`CREATE INDEX IF NOT EXISTS idx_daily_progress_project_date ON daily_progress(project_id, work_date)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_daily_progress_work_date ON daily_progress(work_date)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_daily_progress_team_lead ON daily_progress(team_lead)`;
    console.log('✓ Daily progress indexes created');
    
    // Create nokia_equipment table if it doesn't exist
    await sql`
      CREATE TABLE IF NOT EXISTS nokia_equipment (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        equipment_id VARCHAR(50) NOT NULL UNIQUE,
        serial_number VARCHAR(100) NOT NULL UNIQUE,
        model_number VARCHAR(100) NOT NULL,
        equipment_type VARCHAR(50) NOT NULL,
        category VARCHAR(50),
        software_version VARCHAR(50),
        firmware_version VARCHAR(50),
        hardware_revision VARCHAR(50),
        part_number VARCHAR(100),
        asset_tag VARCHAR(50),
        purchase_order VARCHAR(50),
        vendor VARCHAR(100) DEFAULT 'Nokia',
        purchase_date DATE,
        purchase_cost DECIMAL(12,2),
        warranty_expiry DATE,
        project_id UUID REFERENCES projects(id),
        current_location TEXT,
        installation_address TEXT,
        latitude DECIMAL(10,8),
        longitude DECIMAL(11,8),
        installation_date DATE,
        installed_by UUID,
        installation_type VARCHAR(50),
        status VARCHAR(20) DEFAULT 'inventory',
        operational_status VARCHAR(20),
        last_status_update TIMESTAMP,
        ip_address VARCHAR(45),
        mac_address VARCHAR(17),
        vlan_configuration JSONB DEFAULT '{}',
        network_ports JSONB DEFAULT '[]',
        uptime DECIMAL(10,2),
        last_maintenance_date DATE,
        next_maintenance_date DATE,
        performance_metrics JSONB DEFAULT '{}',
        specifications JSONB DEFAULT '{}',
        port_count INTEGER,
        power_consumption DECIMAL(8,2),
        operating_temperature JSONB DEFAULT '{}',
        connected_equipment JSONB DEFAULT '[]',
        parent_equipment UUID,
        child_equipment JSONB DEFAULT '[]',
        configuration_files JSONB DEFAULT '[]',
        manuals JSONB DEFAULT '[]',
        certificates JSONB DEFAULT '[]',
        compliance_standards JSONB DEFAULT '[]',
        maintenance_history JSONB DEFAULT '[]',
        incident_history JSONB DEFAULT '[]',
        replacement_history JSONB DEFAULT '[]',
        depreciation_schedule JSONB DEFAULT '{}',
        current_value DECIMAL(12,2),
        insurance_value DECIMAL(12,2),
        return_date DATE,
        disposal_date DATE,
        disposal_method VARCHAR(50),
        recycling_info JSONB DEFAULT '{}',
        metadata JSONB DEFAULT '{}',
        created_by UUID,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `;
    console.log('✓ Nokia equipment table created/verified');
    
    // Create indexes for nokia_equipment
    await sql`CREATE INDEX IF NOT EXISTS idx_nokia_equipment_id ON nokia_equipment(equipment_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_nokia_equipment_serial ON nokia_equipment(serial_number)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_nokia_equipment_type ON nokia_equipment(equipment_type)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_nokia_equipment_status ON nokia_equipment(status)`;
    console.log('✓ Nokia equipment indexes created');
    
    // Create action_items table if it doesn't exist
    await sql`
      CREATE TABLE IF NOT EXISTS action_items (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        action_id VARCHAR(50) NOT NULL UNIQUE,
        project_id UUID REFERENCES projects(id),
        related_table VARCHAR(50),
        related_id UUID,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        category VARCHAR(50) DEFAULT 'general',
        priority VARCHAR(20) DEFAULT 'medium',
        action_type VARCHAR(50),
        assigned_to UUID,
        assigned_by UUID,
        department_responsible VARCHAR(100),
        due_date DATE,
        scheduled_date DATE,
        estimated_hours DECIMAL(6,2),
        status VARCHAR(20) DEFAULT 'open',
        start_date DATE,
        completion_date DATE,
        actual_hours DECIMAL(6,2),
        resolution TEXT,
        resolution_date DATE,
        verified_by UUID,
        verification_date DATE,
        attachments JSONB DEFAULT '[]',
        photos JSONB DEFAULT '[]',
        related_actions JSONB DEFAULT '[]',
        safety_related BOOLEAN DEFAULT FALSE,
        compliance_related BOOLEAN DEFAULT FALSE,
        customer_impact VARCHAR(20),
        notifications_sent JSONB DEFAULT '[]',
        reminder_scheduled BOOLEAN DEFAULT FALSE,
        escalation_level INTEGER DEFAULT 0,
        metadata JSONB DEFAULT '{}',
        created_by UUID,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `;
    console.log('✓ Action items table created/verified');
    
    // Create indexes for action_items
    await sql`CREATE INDEX IF NOT EXISTS idx_action_items_id ON action_items(action_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_action_items_project ON action_items(project_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_action_items_assigned_to ON action_items(assigned_to)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_action_items_status ON action_items(status)`;
    console.log('✓ Action items indexes created');
    
    console.log('\n✅ All field operations tables created successfully!');
    
  } catch (error) {
    console.error('Error creating tables:', error);
  }
}

createFieldTables();