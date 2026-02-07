/**
 * Simple Field Operations Data Generator
 * Populates comprehensive field operations data for mobile workers using direct SQL
 */

import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL || 'process.env.DATABASE_URL');

// Simple random data generation functions
const randomHelpers = {
  arrayElement: <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)],
  arrayElements: <T>(arr: T[], count: number): T[] => {
    const shuffled = [...arr].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  },
  number: (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min,
  float: (min: number, max: number, precision: number = 2) => {
    const val = Math.random() * (max - min) + min;
    return Math.round(val * Math.pow(10, precision)) / Math.pow(10, precision);
  },
  uuid: () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0;
    const v = c === 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  }),
  fullName: () => {
    const firstNames = ['John', 'Jane', 'Michael', 'Sarah', 'David', 'Emma', 'Peter', 'Lisa', 'James', 'Mary', 'Sipho', 'Thabo', 'Nomsa'];
    const lastNames = ['Smith', 'Johnson', 'Van Der Merwe', 'Naidoo', 'Botha', 'Williams', 'Brown', 'Patel', 'Mthembu', 'Dlamini'];
    return `${randomHelpers.arrayElement(firstNames)} ${randomHelpers.arrayElement(lastNames)}`;
  },
  email: (name: string) => {
    const domain = ['gmail.com', 'outlook.com', 'company.co.za', 'work.com'];
    const cleanName = name.toLowerCase().replace(' ', '.');
    return `${cleanName}@${randomHelpers.arrayElement(domain)}`;
  },
  phoneNumber: () => `+27${randomHelpers.number(60, 84)}${randomHelpers.number(1000000, 9999999)}`,
  address: () => {
    const streets = ['Main St', 'Church Rd', 'Nelson Mandela Dr', 'Jan Smuts Ave', 'Oxford Rd', 'Witkoppen Rd', 'Beyers Naude Dr'];
    return `${randomHelpers.number(1, 999)} ${randomHelpers.arrayElement(streets)}`;
  }
};

// Johannesburg area coordinates with ±0.5° variation
const JHB_CENTER = { lat: -26.2041, lng: 28.0473 };
const COORD_VARIANCE = 0.5;

// Field task types
const TASK_TYPES = [
  'installation', 'maintenance', 'inspection', 'repair', 
  'survey', 'testing', 'commissioning', 'troubleshooting'
];

const TASK_CATEGORIES = [
  'fiber_optic', 'pole_installation', 'drop_cable', 'home_installation',
  'network_testing', 'equipment_setup', 'quality_check', 'emergency_repair'
];

const PRIORITIES = ['low', 'medium', 'high', 'urgent'];
const STATUSES = ['pending', 'scheduled', 'in_progress', 'completed', 'on_hold', 'cancelled'];

const EQUIPMENT_TYPES = [
  'OTDR', 'Fusion Splicer', 'Power Meter', 'Light Source', 'VFL',
  'Cable Locator', 'Ladder', 'Safety Kit', 'Tool Kit', 'Testing Equipment'
];

const VEHICLE_TYPES = [
  'Service Van', 'Bucket Truck', 'Cable Truck', 'Pickup Truck', 'ATV'
];

// Generate random GPS coordinates around Johannesburg
function generateGPSCoords() {
  return {
    latitude: JHB_CENTER.lat + (Math.random() - 0.5) * COORD_VARIANCE,
    longitude: JHB_CENTER.lng + (Math.random() - 0.5) * COORD_VARIANCE
  };
}

async function populateFieldOpsData() {
  console.log('🚀 Starting Field Operations Data Population...');
  
  try {
    // Check if data already exists
    const existingTasks = await sql`SELECT COUNT(*) as count FROM tasks WHERE task_code LIKE 'TASK-FLD-%'`;
    const existingTaskCount = parseInt(existingTasks[0].count);
    
    if (existingTaskCount > 0) {
      console.log(`⏭️ Field operations data already exists (${existingTaskCount} tasks found)`);
      console.log('✨ Skipping population to avoid duplicates');
      return;
    }
    
    // Check if we have projects and staff
    const projects = await sql`SELECT id, project_name FROM projects LIMIT 5`;
    const staff = await sql`SELECT id, first_name, last_name FROM staff LIMIT 30`;
    
    if (projects.length === 0) {
      console.log('Creating sample project...');
      const coords = generateGPSCoords();
      const projectResult = await sql`
        INSERT INTO projects (project_code, project_name, description, status, location, created_at, updated_at)
        VALUES ('PROJ-FLD-001', 'Field Operations Demo Project', 'Demo project for field operations', 'active', 'Johannesburg', NOW(), NOW())
        RETURNING id, project_name
      `;
      projects.push(projectResult[0]);
    }
    
    if (staff.length < 10) {
      console.log('Creating sample technicians...');
      for (let i = 0; i < 20; i++) {
        const fullName = randomHelpers.fullName();
        const [firstName, lastName] = fullName.split(' ');
        await sql`
          INSERT INTO staff (employee_id, first_name, last_name, email, phone, department, position, status, hire_date, created_at, updated_at)
          VALUES (
            ${'TECH-' + String(i + 1).padStart(4, '0')},
            ${firstName},
            ${lastName},
            ${randomHelpers.email(fullName)},
            ${randomHelpers.phoneNumber()},
            'Field Operations',
            ${randomHelpers.arrayElement(['Field Technician', 'Senior Technician', 'Team Lead'])},
            'active',
            ${new Date(Date.now() - randomHelpers.number(30, 365) * 24 * 60 * 60 * 1000).toISOString().split('T')[0]},
            NOW(),
            NOW()
          )
        `;
      }
      // Refresh staff list
      const newStaff = await sql`SELECT id, first_name, last_name FROM staff LIMIT 30`;
      staff.push(...newStaff);
    }
    
    console.log(`📊 Found/Created ${projects.length} projects and ${staff.length} staff members`);
    
    // Generate 250 field tasks
    console.log('📝 Generating 250 field tasks...');
    const taskIds = [];
    
    for (let i = 0; i < 250; i++) {
      const project = randomHelpers.arrayElement(projects);
      const technician = randomHelpers.arrayElement(staff);
      const coords = generateGPSCoords();
      const dueDate = new Date(Date.now() + randomHelpers.number(1, 14) * 24 * 60 * 60 * 1000);
      
      const taskType = randomHelpers.arrayElement(TASK_TYPES);
      const category = randomHelpers.arrayElement(TASK_CATEGORIES);
      
      const metadata = {
        location: {
          latitude: coords.latitude,
          longitude: coords.longitude,
          address: randomHelpers.address(),
          city: 'Johannesburg',
          province: 'Gauteng'
        },
        equipment: randomHelpers.arrayElements(EQUIPMENT_TYPES, randomHelpers.number(1, 3)),
        vehicle: randomHelpers.arrayElement(VEHICLE_TYPES),
        photos: Array.from({ length: randomHelpers.number(0, 3) }, () => ({
          url: `https://storage.example.com/field-photos/${randomHelpers.uuid()}.jpg`,
          caption: 'Field work photo',
          timestamp: new Date().toISOString()
        })),
        customerInfo: {
          name: randomHelpers.fullName(),
          phone: randomHelpers.phoneNumber(),
          email: randomHelpers.email(randomHelpers.fullName())
        },
        syncStatus: randomHelpers.arrayElement(['synced', 'pending', 'conflict', 'offline']),
        workOrder: `WO-${randomHelpers.number(100000, 999999)}`
      };
      
      const result = await sql`
        INSERT INTO tasks (
          task_code, title, description, project_id, assigned_to, 
          priority, status, category, due_date, 
          estimated_hours, progress, metadata, created_at, updated_at
        ) VALUES (
          ${'TASK-FLD-' + String(i + 1).padStart(5, '0')},
          ${taskType.charAt(0).toUpperCase() + taskType.slice(1) + ' - ' + randomHelpers.address()},
          ${`${taskType} task for ${category} installation`},
          ${project.id},
          ${technician.id},
          ${randomHelpers.arrayElement(PRIORITIES)},
          ${randomHelpers.arrayElement(STATUSES)},
          ${category},
          ${dueDate.toISOString()},
          ${randomHelpers.float(1, 8, 1)},
          ${randomHelpers.number(0, 100)},
          ${JSON.stringify(metadata)},
          NOW(),
          NOW()
        ) RETURNING id
      `;
      
      taskIds.push(result[0].id);
      
      if ((i + 1) % 50 === 0) {
        console.log(`  ✓ Created ${i + 1} tasks`);
      }
    }
    
    console.log('✅ Field tasks created successfully');
    
    // Generate daily schedules for next 14 days
    console.log('📅 Generating daily schedules for next 14 days...');
    let scheduleCount = 0;
    
    for (let day = 0; day < 14; day++) {
      const scheduleDate = new Date();
      scheduleDate.setDate(scheduleDate.getDate() + day);
      const dateStr = scheduleDate.toISOString().split('T')[0];
      
      // Create schedules for first 15 technicians
      for (const technician of staff.slice(0, 15)) {
        const taskCount = randomHelpers.number(3, 8);
        const dayTasks = randomHelpers.arrayElements(taskIds, Math.min(taskCount, taskIds.length));
        
        const scheduleMetadata = {
          tasks: dayTasks.map((taskId, idx) => ({
            taskId,
            sequence: idx + 1,
            estimatedTime: randomHelpers.float(1, 4, 1),
            travelTime: randomHelpers.float(0.25, 1, 2)
          })),
          vehicle: {
            type: randomHelpers.arrayElement(VEHICLE_TYPES),
            plateNumber: `GP ${randomHelpers.number(100, 999)}-ABC`
          },
          equipment: randomHelpers.arrayElements(EQUIPMENT_TYPES, randomHelpers.number(3, 6))
        };
        
        const startTime = new Date(scheduleDate);
        startTime.setHours(7, 0);
        const endTime = new Date(scheduleDate);
        endTime.setHours(16, 0);
        
        await sql`
          INSERT INTO daily_progress (
            project_id, work_date, team_lead, work_type, 
            start_time, end_time, total_hours,
            activities_completed, vehicles_used, equipment_used,
            productivity_score, metadata, created_at, updated_at
          ) VALUES (
            ${projects[0].id},
            ${dateStr},
            ${technician.id},
            'field_operations',
            ${startTime.toISOString()},
            ${endTime.toISOString()},
            8,
            ${JSON.stringify([`Completed ${taskCount} field tasks`])},
            ${JSON.stringify([scheduleMetadata.vehicle])},
            ${JSON.stringify(scheduleMetadata.equipment)},
            ${randomHelpers.float(75, 100, 1)},
            ${JSON.stringify(scheduleMetadata)},
            NOW(),
            NOW()
          )
        `;
        
        scheduleCount++;
      }
    }
    
    console.log(`✅ ${scheduleCount} daily schedules generated`);
    
    // Generate equipment records
    console.log('🔧 Generating equipment records...');
    
    for (let i = 0; i < 50; i++) {
      const equipmentType = randomHelpers.arrayElement(EQUIPMENT_TYPES);
      const serialNumber = `SN-${randomHelpers.uuid().substring(0, 8).toUpperCase()}`;
      
      const metadata = {
        checkout: Math.random() > 0.3 ? {
          technicianId: randomHelpers.arrayElement(staff).id,
          checkoutTime: new Date(Date.now() - randomHelpers.number(0, 7) * 24 * 60 * 60 * 1000).toISOString(),
          purpose: randomHelpers.arrayElement(['field_work', 'testing', 'installation', 'maintenance'])
        } : null
      };
      
      await sql`
        INSERT INTO nokia_equipment (
          equipment_id, serial_number, model_number, equipment_type, category,
          status, current_location, metadata, created_at, updated_at
        ) VALUES (
          ${'EQ-' + String(i + 1).padStart(5, '0')},
          ${serialNumber},
          ${'MDL-' + randomHelpers.uuid().substring(0, 6).toUpperCase()},
          ${equipmentType},
          'field_equipment',
          ${metadata.checkout ? 'deployed' : 'inventory'},
          'Field Operations Center',
          ${JSON.stringify(metadata)},
          NOW(),
          NOW()
        )
      `;
    }
    
    console.log('✅ Equipment records generated');
    
    // Generate action items
    console.log('⚡ Generating action items...');
    
    for (let i = 0; i < 30; i++) {
      const taskId = randomHelpers.arrayElement(taskIds);
      const technician = randomHelpers.arrayElement(staff);
      
      await sql`
        INSERT INTO action_items (
          action_id, project_id, related_table, related_id,
          title, description, category, priority, assigned_to,
          due_date, status, created_at, updated_at
        ) VALUES (
          ${'ACT-FLD-' + String(i + 1).padStart(5, '0')},
          ${projects[0].id},
          'tasks',
          ${taskId},
          ${randomHelpers.arrayElement([
            'Follow up with customer',
            'Replace damaged equipment', 
            'Schedule maintenance',
            'Update documentation',
            'Safety inspection required'
          ])},
          'Field operations action item',
          ${randomHelpers.arrayElement(['safety', 'quality', 'technical', 'customer'])},
          ${randomHelpers.arrayElement(['low', 'medium', 'high', 'urgent'])},
          ${technician.id},
          ${new Date(Date.now() + randomHelpers.number(1, 7) * 24 * 60 * 60 * 1000).toISOString().split('T')[0]},
          ${randomHelpers.arrayElement(['open', 'in_progress', 'completed'])},
          NOW(),
          NOW()
        )
      `;
    }
    
    console.log('✅ Action items generated');
    
    // Add quality check data to some tasks
    console.log('🔍 Adding quality check data...');
    
    const randomTasks = randomHelpers.arrayElements(taskIds, 75);
    for (const taskId of randomTasks) {
      const passed = Math.random() > 0.15; // 85% pass rate
      const qualityCheck = {
        checkType: randomHelpers.arrayElement(['installation', 'safety', 'technical', 'compliance']),
        passed,
        score: passed ? randomHelpers.number(70, 100) : randomHelpers.number(30, 69),
        checklist: {
          items: [
            { name: 'Cable routing', checked: true, notes: 'Properly secured' },
            { name: 'Connector quality', checked: true, notes: 'Clean connections' },
            { name: 'Signal strength', checked: passed, notes: passed ? 'Within specs' : 'Below threshold' },
            { name: 'Safety compliance', checked: true, notes: 'PPE used' }
          ]
        },
        photos: Array.from({ length: randomHelpers.number(1, 3) }, () => ({
          url: `https://storage.example.com/quality-photos/${randomHelpers.uuid()}.jpg`,
          type: 'completed'
        })),
        timestamp: new Date().toISOString(),
        technician: randomHelpers.fullName()
      };
      
      await sql`
        UPDATE tasks 
        SET metadata = jsonb_set(metadata, '{qualityCheck}', ${JSON.stringify(qualityCheck)}::jsonb),
            status = ${passed ? 'completed' : 'on_hold'},
            updated_at = NOW()
        WHERE id = ${taskId}
      `;
    }
    
    console.log('✅ Quality check data added');
    
    // Summary
    console.log('\n📊 Field Operations Data Population Complete!');
    console.log('=====================================');
    console.log(`✓ 250 field tasks created`);
    console.log(`✓ ${scheduleCount} daily schedules created`);
    console.log(`✓ 50 equipment records created`);
    console.log(`✓ 30 action items generated`);
    console.log(`✓ 75 quality checks added`);
    console.log('=====================================');
    console.log('🎉 All field operations data successfully populated!');
    
  } catch (error) {
    console.error('❌ Error populating field operations data:', error);
    process.exit(1);
  }
}

// Run the population script
if (require.main === module) {
  populateFieldOpsData().then(() => {
    console.log('✨ Script completed successfully');
    process.exit(0);
  }).catch((error) => {
    console.error('💥 Script failed:', error);
    process.exit(1);
  });
}

export { populateFieldOpsData };