import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { sql } from 'drizzle-orm';

const DATABASE_URL = 'process.env.DATABASE_URL';

async function populateFieldOperations() {
  console.log('🚀 Starting Field Operations Data Population...\n');
  
  const neonClient = neon(DATABASE_URL);
  const db = drizzle(neonClient);

  try {
    // 1. Create tables
    console.log('📦 Creating Field Operations Tables...');
    
    // Create field_tasks table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS field_tasks (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        task_number VARCHAR(100) UNIQUE NOT NULL,
        project_id UUID,
        task_type VARCHAR(50) NOT NULL,
        priority VARCHAR(20) DEFAULT 'medium',
        status VARCHAR(50) DEFAULT 'pending',
        title TEXT NOT NULL,
        description TEXT,
        location_name TEXT,
        address TEXT,
        gps_latitude NUMERIC(10, 8),
        gps_longitude NUMERIC(11, 8),
        scheduled_date DATE,
        scheduled_time TIME,
        estimated_duration INTEGER,
        actual_start_time TIMESTAMP,
        actual_end_time TIMESTAMP,
        assigned_team_id UUID,
        assigned_technician_id UUID,
        equipment_required JSON,
        materials_required JSON,
        safety_requirements JSON,
        completion_percentage INTEGER DEFAULT 0,
        completion_notes TEXT,
        photo_urls JSON,
        attachment_urls JSON,
        customer_name VARCHAR(255),
        customer_phone VARCHAR(50),
        customer_email VARCHAR(255),
        requires_customer_signature BOOLEAN DEFAULT FALSE,
        customer_signature_url TEXT,
        weather_conditions VARCHAR(100),
        created_by VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✓ Created field_tasks table');

    // Create field_teams table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS field_teams (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        team_code VARCHAR(50) UNIQUE NOT NULL,
        team_name VARCHAR(255) NOT NULL,
        team_type VARCHAR(50),
        status VARCHAR(20) DEFAULT 'active',
        base_location TEXT,
        current_location_lat NUMERIC(10, 8),
        current_location_lon NUMERIC(11, 8),
        last_location_update TIMESTAMP,
        capacity INTEGER DEFAULT 4,
        current_workload INTEGER DEFAULT 0,
        supervisor_id UUID,
        vehicle_id UUID,
        specializations JSON,
        certifications JSON,
        rating NUMERIC(3, 2),
        tasks_completed INTEGER DEFAULT 0,
        average_completion_time INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✓ Created field_teams table');

    // Create field_technicians table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS field_technicians (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        employee_id VARCHAR(50) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        phone VARCHAR(50) NOT NULL,
        team_id UUID,
        role VARCHAR(50),
        status VARCHAR(20) DEFAULT 'available',
        skills JSON,
        certifications JSON,
        years_experience INTEGER,
        current_task_id UUID,
        current_location_lat NUMERIC(10, 8),
        current_location_lon NUMERIC(11, 8),
        last_location_update TIMESTAMP,
        device_id VARCHAR(255),
        device_status VARCHAR(20),
        last_sync_time TIMESTAMP,
        performance_rating NUMERIC(3, 2),
        tasks_completed_today INTEGER DEFAULT 0,
        tasks_completed_week INTEGER DEFAULT 0,
        tasks_completed_total INTEGER DEFAULT 0,
        average_task_time INTEGER,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✓ Created field_technicians table');

    // Create daily_schedules table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS daily_schedules (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        schedule_date DATE NOT NULL,
        team_id UUID,
        technician_id UUID,
        shift_start TIME DEFAULT '07:00',
        shift_end TIME DEFAULT '17:00',
        break_start TIME DEFAULT '12:00',
        break_duration INTEGER DEFAULT 60,
        tasks JSON,
        total_tasks INTEGER DEFAULT 0,
        completed_tasks INTEGER DEFAULT 0,
        route_optimization JSON,
        estimated_travel_time INTEGER,
        actual_travel_time INTEGER,
        vehicle_id UUID,
        equipment_checklist JSON,
        notes TEXT,
        status VARCHAR(20) DEFAULT 'scheduled',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✓ Created daily_schedules table');

    // Create quality_checks table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS quality_checks (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        task_id UUID,
        check_type VARCHAR(50),
        inspector_id UUID,
        inspection_date TIMESTAMP DEFAULT NOW(),
        status VARCHAR(20),
        score NUMERIC(5, 2),
        checklist JSON,
        issues_found JSON,
        corrective_actions JSON,
        photo_evidence JSON,
        measurements JSON,
        compliance_standards JSON,
        customer_feedback TEXT,
        customer_satisfaction INTEGER,
        requires_followup BOOLEAN DEFAULT FALSE,
        followup_date DATE,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✓ Created quality_checks table');

    // Create equipment_checkouts table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS equipment_checkouts (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        equipment_id VARCHAR(100) NOT NULL,
        equipment_name VARCHAR(255) NOT NULL,
        equipment_type VARCHAR(50),
        serial_number VARCHAR(100),
        checked_out_to UUID,
        team_id UUID,
        checkout_date TIMESTAMP DEFAULT NOW(),
        expected_return_date TIMESTAMP,
        actual_return_date TIMESTAMP,
        condition_out VARCHAR(50),
        condition_in VARCHAR(50),
        notes_out TEXT,
        notes_in TEXT,
        status VARCHAR(20) DEFAULT 'checked_out',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✓ Created equipment_checkouts table');

    // Create vehicle_assignments table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS vehicle_assignments (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        vehicle_id VARCHAR(100) NOT NULL,
        vehicle_registration VARCHAR(50) UNIQUE NOT NULL,
        vehicle_type VARCHAR(50),
        make_model VARCHAR(100),
        team_id UUID,
        driver_id UUID,
        assignment_date DATE NOT NULL,
        fuel_level_start INTEGER,
        fuel_level_end INTEGER,
        odometer_start INTEGER,
        odometer_end INTEGER,
        condition_notes TEXT,
        maintenance_due_date DATE,
        insurance_valid_until DATE,
        gps_tracker_id VARCHAR(100),
        status VARCHAR(20) DEFAULT 'assigned',
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    console.log('✓ Created vehicle_assignments table');

    // Create mobile_sync_queue table
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS mobile_sync_queue (
        id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        device_id VARCHAR(255) NOT NULL,
        technician_id UUID,
        sync_type VARCHAR(50),
        entity_type VARCHAR(50),
        entity_id VARCHAR(255),
        data JSON,
        priority INTEGER DEFAULT 5,
        status VARCHAR(20) DEFAULT 'pending',
        retry_count INTEGER DEFAULT 0,
        max_retries INTEGER DEFAULT 3,
        error_message TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        queued_at TIMESTAMP,
        started_at TIMESTAMP,
        completed_at TIMESTAMP,
        file_size INTEGER,
        network_type VARCHAR(20)
      )
    `);
    console.log('✓ Created mobile_sync_queue table');

    // 2. Populate field teams
    console.log('\n👥 Populating Field Teams...');
    const teams = [
      { code: 'FT001', name: 'Alpha Installation Team', type: 'installation', location: 'Johannesburg Central', lat: -26.2041, lon: 28.0473, rating: 4.5 },
      { code: 'FT002', name: 'Bravo Maintenance Team', type: 'maintenance', location: 'Sandton', lat: -26.1076, lon: 28.0567, rating: 4.3 },
      { code: 'FT003', name: 'Charlie Fiber Team', type: 'fiber_splicing', location: 'Randburg', lat: -26.0964, lon: 27.9772, rating: 4.8 },
      { code: 'FT004', name: 'Delta Inspection Team', type: 'inspection', location: 'Midrand', lat: -25.9984, lon: 28.1280, rating: 4.6 },
      { code: 'FT005', name: 'Echo Installation Team', type: 'installation', location: 'Roodepoort', lat: -26.1625, lon: 27.8626, rating: 4.4 },
      { code: 'FT006', name: 'Foxtrot Emergency Team', type: 'maintenance', location: 'Kempton Park', lat: -26.0833, lon: 28.2333, rating: 4.7 },
      { code: 'FT007', name: 'Golf Survey Team', type: 'installation', location: 'Soweto', lat: -26.2681, lon: 27.8591, rating: 4.2 },
      { code: 'FT008', name: 'Hotel Splice Team', type: 'fiber_splicing', location: 'Alexandra', lat: -26.1065, lon: 28.0915, rating: 4.5 }
    ];

    for (const team of teams) {
      await db.execute(sql`
        INSERT INTO field_teams (team_code, team_name, team_type, status, base_location, current_location_lat, current_location_lon, capacity, specializations, certifications, rating)
        VALUES (${team.code}, ${team.name}, ${team.type}, 'active', ${team.location}, 
                ${team.lat + Math.random() * 0.5}, ${team.lon + Math.random() * 0.5}, 
                ${3 + Math.floor(Math.random() * 3)},
                '["fiber_installation", "pole_mounting", "troubleshooting"]'::json,
                '["safety_certified", "fiber_certified"]'::json,
                ${team.rating})
        ON CONFLICT (team_code) DO NOTHING
      `);
    }
    console.log(`✓ Created ${teams.length} field teams`);

    // 3. Populate field technicians
    console.log('\n👷 Generating Field Technicians...');
    const techNames = ['John Smith', 'Peter Jones', 'David Brown', 'Michael Davis', 'James Wilson', 
                      'Robert Taylor', 'William Anderson', 'Joseph Thomas', 'Charles Jackson', 
                      'Thomas White', 'Christopher Harris', 'Daniel Martin'];
    
    const teamIds = await db.execute(sql`SELECT id FROM field_teams`);
    let techCount = 0;
    
    for (const teamRow of teamIds.rows) {
      const teamId = teamRow.id as string;
      const numTechs = 2 + Math.floor(Math.random() * 3); // 2-4 techs per team
      
      for (let i = 0; i < numTechs; i++) {
        const name = techNames[Math.floor(Math.random() * techNames.length)];
        const role = i === 0 ? 'lead_technician' : Math.random() < 0.2 ? 'apprentice' : 'technician';
        const empId = `EMP${String(1000 + techCount).padStart(5, '0')}`;
        
        await db.execute(sql`
          INSERT INTO field_technicians (
            employee_id, name, email, phone, team_id, role, status,
            skills, certifications, years_experience, current_location_lat, current_location_lon,
            device_status, performance_rating
          ) VALUES (
            ${empId}, ${name}, ${name.toLowerCase().replace(' ', '.') + '@company.co.za'},
            ${'+27' + (700000000 + Math.floor(Math.random() * 99999999))},
            ${teamId}::uuid, ${role}, ${Math.random() < 0.8 ? 'available' : 'busy'},
            '["fiber_splicing", "testing", "safety"]'::json,
            '["safety_level1", "first_aid"]'::json,
            ${role === 'lead_technician' ? 5 + Math.floor(Math.random() * 10) : 
              role === 'apprentice' ? Math.floor(Math.random() * 2) : 2 + Math.floor(Math.random() * 5)},
            ${-26.2041 + Math.random() * 0.5}, ${28.0473 + Math.random() * 0.5},
            ${Math.random() < 0.9 ? 'online' : 'offline'},
            ${3.5 + Math.random() * 1.5}
          )
          ON CONFLICT (employee_id) DO NOTHING
        `);
        techCount++;
      }
    }
    console.log(`✓ Created ${techCount} field technicians`);

    // 4. Generate field tasks
    console.log('\n📋 Generating Field Tasks...');
    const taskTypes = ['installation', 'maintenance', 'inspection', 'repair', 'survey'];
    const priorities = ['low', 'medium', 'high', 'critical'];
    const statuses = ['pending', 'scheduled', 'in_progress', 'completed'];
    const locations = ['Sandton', 'Rosebank', 'Parktown', 'Melrose', 'Hyde Park', 'Bryanston', 
                      'Fourways', 'Midrand', 'Randburg', 'Northcliff'];
    
    // Get a project ID
    const projects = await db.execute(sql`SELECT id FROM projects LIMIT 1`);
    const projectId = projects.rows[0]?.id || null;
    
    for (let i = 0; i < 250; i++) {
      const taskDate = new Date();
      taskDate.setDate(taskDate.getDate() + Math.floor(Math.random() * 14));
      const taskType = taskTypes[Math.floor(Math.random() * taskTypes.length)];
      const priority = priorities[Math.floor(Math.random() * priorities.length)];
      const status = statuses[Math.floor(Math.random() * statuses.length)];
      const location = locations[Math.floor(Math.random() * locations.length)];
      const taskNumber = `TASK-${String(1001 + i).padStart(6, '0')}`;
      
      const teamRow = teamIds.rows[Math.floor(Math.random() * teamIds.rows.length)];
      const teamId = teamRow?.id as string;
      
      await db.execute(sql`
        INSERT INTO field_tasks (
          task_number, project_id, task_type, priority, status, title, description,
          location_name, address, gps_latitude, gps_longitude,
          scheduled_date, scheduled_time, estimated_duration,
          assigned_team_id, 
          equipment_required, materials_required, safety_requirements,
          completion_percentage, customer_name, customer_phone, customer_email,
          requires_customer_signature, weather_conditions
        ) VALUES (
          ${taskNumber}, ${projectId}::uuid, ${taskType}, ${priority}, ${status},
          ${`${taskType.charAt(0).toUpperCase() + taskType.slice(1)} at ${location}`},
          ${`Perform ${taskType} work at customer location. Ensure all safety protocols are followed.`},
          ${location}, ${Math.floor(Math.random() * 999) + ' Main Road'},
          ${-26.2041 + Math.random() * 0.5}, ${28.0473 + Math.random() * 0.5},
          ${taskDate.toISOString().split('T')[0]}::date,
          ${`${7 + Math.floor(Math.random() * 9)}:${String(Math.floor(Math.random() * 4) * 15).padStart(2, '0')}`}::time,
          ${30 + Math.floor(Math.random() * 150)},
          ${teamId}::uuid,
          '["ladder", "fiber_splicer", "otdr"]'::json,
          '["fiber_cable", "connectors", "mounting_brackets"]'::json,
          '["hard_hat", "safety_vest", "gloves"]'::json,
          ${status === 'completed' ? 100 : status === 'in_progress' ? 20 + Math.floor(Math.random() * 70) : 0},
          ${'Customer ' + String.fromCharCode(65 + Math.floor(Math.random() * 26))},
          ${'+27' + (700000000 + Math.floor(Math.random() * 99999999))},
          ${`customer${i}@email.co.za`},
          ${Math.random() < 0.3},
          ${['Clear', 'Partly Cloudy', 'Cloudy'][Math.floor(Math.random() * 3)]}
        )
        ON CONFLICT (task_number) DO NOTHING
      `);
    }
    console.log('✓ Created 250 field tasks');

    // 5. Generate daily schedules
    console.log('\n📅 Creating Daily Schedules...');
    let scheduleCount = 0;
    for (let day = 0; day < 14; day++) {
      const scheduleDate = new Date();
      scheduleDate.setDate(scheduleDate.getDate() + day);
      const dateStr = scheduleDate.toISOString().split('T')[0];
      
      for (const teamRow of teamIds.rows.slice(0, 5)) { // First 5 teams only
        const teamId = teamRow.id as string;
        
        await db.execute(sql`
          INSERT INTO daily_schedules (
            schedule_date, team_id, shift_start, shift_end,
            break_start, break_duration, total_tasks,
            completed_tasks, estimated_travel_time, 
            equipment_checklist, status
          ) VALUES (
            ${dateStr}::date, ${teamId}::uuid, '07:00'::time, '17:00'::time,
            '12:00'::time, 60, ${3 + Math.floor(Math.random() * 4)},
            ${day < 0 ? Math.floor(Math.random() * 3) : 0},
            ${30 + Math.floor(Math.random() * 90)},
            '{"ladder": true, "safety_gear": true, "tools": true}'::json,
            ${day < 0 ? 'completed' : day === 0 ? 'in_progress' : 'scheduled'}
          )
        `);
        scheduleCount++;
      }
    }
    console.log(`✓ Created ${scheduleCount} daily schedules`);

    // 6. Generate quality checks
    console.log('\n✅ Generating Quality Check Data...');
    const completedTasks = await db.execute(sql`
      SELECT id FROM field_tasks WHERE status = 'completed' LIMIT 100
    `);
    
    let qualityCount = 0;
    for (const task of completedTasks.rows) {
      const passRate = Math.random();
      const status = passRate < 0.85 ? 'pass' : passRate < 0.95 ? 'conditional_pass' : 'fail';
      const score = status === 'pass' ? 85 + Math.random() * 15 : 50 + Math.random() * 35;
      
      // Get a random technician as inspector
      const inspectors = await db.execute(sql`
        SELECT id FROM field_technicians WHERE role IN ('lead_technician', 'supervisor') LIMIT 1
      `);
      const inspectorId = inspectors.rows[0]?.id;
      
      if (inspectorId) {
        await db.execute(sql`
          INSERT INTO quality_checks (
            task_id, check_type, inspector_id, 
            status, score, checklist, issues_found, corrective_actions,
            photo_evidence, measurements, compliance_standards,
            customer_satisfaction, requires_followup, notes
          ) VALUES (
            ${task.id}::uuid, ${['installation', 'fiber_splice', 'connection', 'safety'][Math.floor(Math.random() * 4)]},
            ${inspectorId}::uuid, ${status}, ${score},
            '{"cable_routing": true, "connector_quality": true, "signal_strength": true}'::json,
            ${status !== 'pass' ? '["Minor issue found"]' : '[]'}::json,
            ${status !== 'pass' ? '["Corrective action needed"]' : '[]'}::json,
            '["photo1.jpg", "photo2.jpg"]'::json,
            '{"signal_power": -20, "return_loss": 35}'::json,
            '["ISO9001", "TIA568"]'::json,
            ${status === 'pass' ? 4 + Math.floor(Math.random() * 2) : 2 + Math.floor(Math.random() * 3)},
            ${status !== 'pass'},
            ${status === 'pass' ? 'All checks passed.' : 'Issues identified, follow-up required.'}
          )
        `);
        qualityCount++;
      }
    }
    console.log(`✓ Created ${qualityCount} quality checks`);

    // 7. Generate equipment checkouts
    console.log('\n🔧 Generating Equipment Checkouts...');
    const equipmentTypes = ['Fusion Splicer', 'OTDR', 'Power Meter', 'Tool Kit', 'Ladder'];
    const technicians = await db.execute(sql`SELECT id, team_id FROM field_technicians LIMIT 30`);
    
    let checkoutCount = 0;
    for (const tech of technicians.rows) {
      for (let i = 0; i < 2; i++) {
        await db.execute(sql`
          INSERT INTO equipment_checkouts (
            equipment_id, equipment_name, equipment_type, serial_number,
            checked_out_to, team_id, checkout_date,
            condition_out, notes_out, status
          ) VALUES (
            ${'EQ-' + String(1000 + checkoutCount).padStart(4, '0')},
            ${equipmentTypes[Math.floor(Math.random() * equipmentTypes.length)]},
            ${['tool', 'safety_gear', 'testing_equipment'][Math.floor(Math.random() * 3)]},
            ${'SN-' + Math.random().toString(36).substring(7)},
            ${tech.id}::uuid, ${tech.team_id}::uuid, NOW(),
            ${['excellent', 'good', 'fair'][Math.floor(Math.random() * 3)]},
            ${'Equipment checked and verified'}, ${'checked_out'}
          )
        `);
        checkoutCount++;
      }
    }
    console.log(`✓ Created ${checkoutCount} equipment checkouts`);

    // 8. Generate vehicle assignments
    console.log('\n🚗 Generating Vehicle Assignments...');
    const vehicles = ['Toyota Hilux', 'Ford Ranger', 'Isuzu D-Max', 'Nissan NP200'];
    let vehicleCount = 0;
    
    for (const teamRow of teamIds.rows) {
      const teamId = teamRow.id as string;
      const registration = `GP ${String(100 + vehicleCount).padStart(3, '0')} ${String.fromCharCode(65 + vehicleCount % 26)}BC`;
      
      await db.execute(sql`
        INSERT INTO vehicle_assignments (
          vehicle_id, vehicle_registration, vehicle_type, make_model,
          team_id, assignment_date, fuel_level_start, odometer_start,
          maintenance_due_date, insurance_valid_until, status
        ) VALUES (
          ${'VEH-' + String(1000 + vehicleCount).padStart(4, '0')},
          ${registration}, ${['bakkie', 'van'][Math.floor(Math.random() * 2)]},
          ${vehicles[Math.floor(Math.random() * vehicles.length)]},
          ${teamId}::uuid, CURRENT_DATE, ${60 + Math.floor(Math.random() * 40)},
          ${120000 + Math.floor(Math.random() * 80000)},
          CURRENT_DATE + INTERVAL '30 days',
          CURRENT_DATE + INTERVAL '180 days',
          ${'assigned'}
        )
        ON CONFLICT (vehicle_registration) DO NOTHING
      `);
      vehicleCount++;
    }
    console.log(`✓ Created ${vehicleCount} vehicle assignments`);

    // 9. Generate mobile sync queue
    console.log('\n📱 Generating Mobile Sync Queue...');
    const syncTypes = ['upload', 'download', 'bidirectional'];
    const entityTypes = ['task', 'photo', 'checklist', 'signature'];
    
    let syncCount = 0;
    for (const tech of technicians.rows.slice(0, 20)) {
      for (let i = 0; i < 3; i++) {
        await db.execute(sql`
          INSERT INTO mobile_sync_queue (
            device_id, technician_id, sync_type, entity_type, entity_id,
            data, priority, status, file_size, network_type
          ) VALUES (
            ${'DEVICE-' + tech.id}, ${tech.id}::uuid,
            ${syncTypes[Math.floor(Math.random() * syncTypes.length)]},
            ${entityTypes[Math.floor(Math.random() * entityTypes.length)]},
            ${Math.random().toString(36).substring(7)},
            '{"timestamp": "2024-01-15", "data": "sync_data"}'::json,
            ${1 + Math.floor(Math.random() * 10)},
            ${['pending', 'syncing', 'completed'][Math.floor(Math.random() * 3)]},
            ${1024 + Math.floor(Math.random() * 102400)},
            ${['wifi', '4g', '3g'][Math.floor(Math.random() * 3)]}
          )
        `);
        syncCount++;
      }
    }
    console.log(`✓ Created ${syncCount} sync queue items`);

    // Final summary
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('✨ FIELD OPERATIONS DATA POPULATION COMPLETE!');
    console.log('═══════════════════════════════════════════════════════');
    
    const summary = await Promise.all([
      db.execute(sql`SELECT COUNT(*) as count FROM field_teams`),
      db.execute(sql`SELECT COUNT(*) as count FROM field_technicians`),
      db.execute(sql`SELECT COUNT(*) as count FROM field_tasks`),
      db.execute(sql`SELECT COUNT(*) as count FROM daily_schedules`),
      db.execute(sql`SELECT COUNT(*) as count FROM quality_checks`),
      db.execute(sql`SELECT COUNT(*) as count FROM equipment_checkouts`),
      db.execute(sql`SELECT COUNT(*) as count FROM vehicle_assignments`),
      db.execute(sql`SELECT COUNT(*) as count FROM mobile_sync_queue`)
    ]);
    
    console.log(`📍 Field Teams:          ${summary[0].rows[0]?.count || 0}`);
    console.log(`👷 Field Technicians:    ${summary[1].rows[0]?.count || 0}`);
    console.log(`📋 Field Tasks:          ${summary[2].rows[0]?.count || 0}`);
    console.log(`📅 Daily Schedules:      ${summary[3].rows[0]?.count || 0}`);
    console.log(`✅ Quality Checks:       ${summary[4].rows[0]?.count || 0}`);
    console.log(`🔧 Equipment Checkouts:  ${summary[5].rows[0]?.count || 0}`);
    console.log(`🚗 Vehicle Assignments:  ${summary[6].rows[0]?.count || 0}`);
    console.log(`📱 Mobile Sync Queue:    ${summary[7].rows[0]?.count || 0}`);
    console.log('═══════════════════════════════════════════════════════');
    console.log('');
    console.log('📍 Location: Johannesburg area (±0.5° variation)');
    console.log('⏰ Work Hours: 07:00-17:00 SAST');
    console.log('✅ Quality Pass Rate: 85%');
    console.log('📅 Schedule: 14 days of work generated');
    console.log('');
    
  } catch (error) {
    console.error('❌ Error during population:', error);
    throw error;
  }
}

// Execute
populateFieldOperations()
  .then(() => {
    console.log('🎉 Success! Field operations data has been populated.');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Failed:', error);
    process.exit(1);
  });