/**
 * Field Operations Data Generator
 * Populates comprehensive field operations data for mobile workers
 * 
 * This script generates:
 * - 200+ field tasks with varied types
 * - 14 days of schedules
 * - Quality check data
 * - Mobile sync data
 * - Equipment checkouts
 * - Vehicle assignments
 */

import { neon } from '@neondatabase/serverless';
// Simple random data generation functions to avoid dependency issues
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
  street: () => {
    const streets = ['Main St', 'Church Rd', 'Nelson Mandela Dr', 'Jan Smuts Ave', 'Oxford Rd', 'Witkoppen Rd', 'Beyers Naude Dr'];
    return `${randomHelpers.number(1, 999)} ${randomHelpers.arrayElement(streets)}`;
  },
  fullName: () => {
    const firstNames = ['John', 'Jane', 'Michael', 'Sarah', 'David', 'Emma', 'Peter', 'Lisa', 'James', 'Mary'];
    const lastNames = ['Smith', 'Johnson', 'Van Der Merwe', 'Naidoo', 'Botha', 'Williams', 'Brown', 'Patel'];
    return `${randomHelpers.arrayElement(firstNames)} ${randomHelpers.arrayElement(lastNames)}`;
  },
  email: (name: string) => {
    const domain = ['gmail.com', 'outlook.com', 'company.co.za', 'work.com'];
    const cleanName = name.toLowerCase().replace(' ', '.');
    return `${cleanName}@${randomHelpers.arrayElement(domain)}`;
  },
  phoneNumber: () => `+27${randomHelpers.number(60, 84)}${randomHelpers.number(1000000, 9999999)}`,
  sentence: () => {
    const sentences = [
      'Task completed successfully.',
      'Work in progress, materials delivered.',
      'Customer satisfied with installation.',
      'Minor issue resolved on site.',
      'All safety checks passed.',
      'Equipment tested and operational.'
    ];
    return randomHelpers.arrayElement(sentences);
  },
  paragraph: () => {
    const paragraphs = [
      'Installation completed according to specifications. All tests passed successfully. Customer signed off on the work.',
      'Field work progressed as scheduled. Minor delays due to weather but overall project on track. Team performance excellent.',
      'Quality inspection revealed no major issues. Equipment functioning within normal parameters. Documentation updated.',
      'Maintenance work completed ahead of schedule. All systems operational. No safety incidents reported.'
    ];
    return randomHelpers.arrayElement(paragraphs);
  }
};

const sql = neon(process.env.DATABASE_URL || 'process.env.DATABASE_URL');

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

// Generate realistic work hours (07:00-17:00 SAST)
function generateWorkTime(date: Date, isStart: boolean = true) {
  const workDate = new Date(date);
  if (isStart) {
    workDate.setHours(7 + Math.floor(Math.random() * 2), Math.floor(Math.random() * 60));
  } else {
    workDate.setHours(15 + Math.floor(Math.random() * 2), Math.floor(Math.random() * 60));
  }
  return workDate;
}

// Generate field task data
function generateFieldTask(projectId: string, technicianId: string, index: number) {
  const coords = generateGPSCoords();
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + Math.floor(Math.random() * 14));
  
  const taskType = randomHelpers.arrayElement(TASK_TYPES);
  const category = randomHelpers.arrayElement(TASK_CATEGORIES);
  
  return {
    taskCode: `TASK-FLD-${String(index).padStart(5, '0')}`,
    title: `${taskType.charAt(0).toUpperCase() + taskType.slice(1)} - ${randomHelpers.street()}`,
    description: `${taskType} task for ${category} at ${randomHelpers.street()}`,
    projectId,
    assignedTo: technicianId,
    priority: randomHelpers.arrayElement(PRIORITIES),
    status: randomHelpers.arrayElement(STATUSES),
    category,
    dueDate: generateWorkTime(dueDate),
    startDate: Math.random() > 0.5 ? generateWorkTime(dueDate, true) : null,
    completedDate: Math.random() > 0.3 ? generateWorkTime(dueDate, false) : null,
    estimatedHours: randomHelpers.float(1, 8, 1),
    actualHours: Math.random() > 0.5 ? randomHelpers.float(1, 10, 1) : null,
    progress: randomHelpers.number(0, 100),
    metadata: {
      location: {
        latitude: coords.latitude,
        longitude: coords.longitude,
        address: randomHelpers.street(),
        city: 'Johannesburg',
        province: 'Gauteng',
        postalCode: `${randomHelpers.number(1000, 9999)}`
      },
      equipment: randomHelpers.arrayElements(EQUIPMENT_TYPES, randomHelpers.number(1, 3)),
      vehicle: randomHelpers.arrayElement(VEHICLE_TYPES),
      photos: Array.from({ length: randomHelpers.number(0, 5) }, () => ({
        url: `https://storage.example.com/field-photos/${randomHelpers.uuid()}.jpg`,
        caption: randomHelpers.sentence(),
        timestamp: new Date(Date.now() - randomHelpers.number(0, 7) * 24 * 60 * 60 * 1000).toISOString()
      })),
      notes: randomHelpers.paragraph(),
      customerInfo: {
        name: randomHelpers.fullName(),
        phone: randomHelpers.phoneNumber(),
        email: randomHelpers.email(randomHelpers.fullName())
      },
      workOrder: `WO-${randomHelpers.number(100000, 999999)}`,
      syncStatus: randomHelpers.arrayElement(['synced', 'pending', 'conflict', 'offline']),
      lastSync: new Date(Date.now() - randomHelpers.number(0, 24) * 60 * 60 * 1000).toISOString(),
      offlineEdits: Math.random() > 0.8 ? {
        editsCount: randomHelpers.number(1, 5),
        lastEdit: new Date(Date.now() - randomHelpers.number(0, 12) * 60 * 60 * 1000).toISOString()
      } : null
    },
    attachments: Array.from({ length: randomHelpers.number(0, 3) }, () => ({
      name: `document_${randomHelpers.number(1000, 9999)}.pdf`,
      url: `https://storage.example.com/attachments/${randomHelpers.uuid()}`,
      type: randomHelpers.arrayElement(['pdf', 'doc', 'xlsx', 'jpg', 'png']),
      size: randomHelpers.number(100, 5000000)
    })),
    tags: randomHelpers.arrayElements(
      ['mobile', 'field', 'urgent', 'customer-facing', 'technical', 'safety-critical'],
      randomHelpers.number(1, 4)
    )
  };
}

// Generate quality check data
function generateQualityCheck(taskId: string, technicianId: string) {
  const passed = Math.random() > 0.15; // 85% pass rate
  
  return {
    taskId,
    technicianId,
    checkType: randomHelpers.arrayElement(['installation', 'safety', 'technical', 'compliance']),
    passed,
    score: passed ? randomHelpers.number(70, 100) : randomHelpers.number(30, 69),
    checklist: {
      items: [
        { name: 'Cable routing', checked: true, notes: 'Properly secured' },
        { name: 'Connector quality', checked: true, notes: 'Clean connections' },
        { name: 'Signal strength', checked: passed, notes: passed ? 'Within specs' : 'Below threshold' },
        { name: 'Documentation', checked: true, notes: 'Complete' },
        { name: 'Safety compliance', checked: true, notes: 'PPE used' }
      ]
    },
    issues: !passed ? [
      {
        type: randomHelpers.arrayElement(['technical', 'safety', 'quality']),
        description: randomHelpers.sentence(),
        severity: randomHelpers.arrayElement(['low', 'medium', 'high']),
        resolution: randomHelpers.sentence()
      }
    ] : [],
    photos: Array.from({ length: randomHelpers.number(2, 5) }, () => ({
      url: `https://storage.example.com/quality-photos/${randomHelpers.uuid()}.jpg`,
      caption: randomHelpers.sentence(),
      type: randomHelpers.arrayElement(['before', 'after', 'issue', 'completed'])
    })),
    notes: randomHelpers.paragraph(),
    signedBy: randomHelpers.fullName(),
    signatureUrl: `https://storage.example.com/signatures/${randomHelpers.uuid()}.png`,
    timestamp: new Date(Date.now() - randomHelpers.number(0, 7) * 24 * 60 * 60 * 1000).toISOString()
  };
}

// Generate daily schedule
function generateDailySchedule(date: Date, technicianId: string, tasks: any[]) {
  const dayTasks = tasks.slice(0, randomHelpers.number(3, 8));
  
  return {
    date: date.toISOString().split('T')[0],
    technicianId,
    shiftStart: generateWorkTime(date, true).toISOString(),
    shiftEnd: generateWorkTime(date, false).toISOString(),
    tasks: dayTasks.map((task, idx) => ({
      taskId: task.id,
      sequence: idx + 1,
      estimatedTime: task.estimatedHours,
      travelTime: randomHelpers.float(0.25, 1, 2),
      status: randomHelpers.arrayElement(['pending', 'in_progress', 'completed'])
    })),
    vehicle: {
      type: randomHelpers.arrayElement(VEHICLE_TYPES),
      plateNumber: `GP ${randomHelpers.number(100, 999)}-${'ABC'.split('').map(() => String.fromCharCode(65 + randomHelpers.number(0, 25))).join('')}`,
      mileageStart: randomHelpers.number(10000, 50000),
      mileageEnd: randomHelpers.number(50001, 100000)
    },
    equipment: randomHelpers.arrayElements(EQUIPMENT_TYPES, randomHelpers.number(3, 7)).map(eq => ({
      name: eq,
      serialNumber: `SN-${randomHelpers.uuid().substring(0, 8).toUpperCase()}`,
      checkedOut: generateWorkTime(date, true).toISOString(),
      checkedIn: Math.random() > 0.3 ? generateWorkTime(date, false).toISOString() : null
    })),
    breaks: [
      {
        type: 'lunch',
        start: new Date(date.setHours(12, 0)).toISOString(),
        end: new Date(date.setHours(12, 30)).toISOString()
      }
    ],
    notes: randomHelpers.sentence()
  };
}

// Generate equipment checkout record
function generateEquipmentCheckout(technicianId: string, date: Date) {
  return {
    equipmentId: randomHelpers.uuid(),
    equipmentType: randomHelpers.arrayElement(EQUIPMENT_TYPES),
    serialNumber: `SN-${randomHelpers.uuid().substring(0, 8).toUpperCase()}`,
    technicianId,
    checkoutTime: generateWorkTime(date, true),
    expectedReturn: generateWorkTime(date, false),
    actualReturn: Math.random() > 0.2 ? generateWorkTime(date, false) : null,
    condition: randomHelpers.arrayElement(['excellent', 'good', 'fair', 'needs_repair']),
    notes: randomHelpers.sentence(),
    metadata: {
      purpose: randomHelpers.arrayElement(['field_work', 'testing', 'installation', 'maintenance']),
      project: `Project ${randomHelpers.number(100, 999)}`,
      verified_by: randomHelpers.fullName()
    }
  };
}

// Generate mobile sync data
function generateMobileSync(technicianId: string) {
  return {
    technicianId,
    deviceId: randomHelpers.uuid(),
    deviceType: randomHelpers.arrayElement(['android', 'ios', 'tablet']),
    appVersion: `2.${randomHelpers.number(0, 9)}.${randomHelpers.number(0, 20)}`,
    lastSync: new Date(Date.now() - randomHelpers.number(0, 24) * 60 * 60 * 1000).toISOString(),
    syncStatus: randomHelpers.arrayElement(['success', 'partial', 'failed', 'pending']),
    dataQueued: {
      tasks: randomHelpers.number(0, 10),
      photos: randomHelpers.number(0, 50),
      forms: randomHelpers.number(0, 20),
      signatures: randomHelpers.number(0, 15)
    },
    conflicts: Math.random() > 0.8 ? Array.from({ length: randomHelpers.number(1, 3) }, () => ({
      type: randomHelpers.arrayElement(['task_update', 'status_change', 'data_conflict']),
      localData: { timestamp: new Date(Date.now() - randomHelpers.number(0, 12) * 60 * 60 * 1000).toISOString() },
      serverData: { timestamp: new Date(Date.now() - randomHelpers.number(0, 12) * 60 * 60 * 1000).toISOString() },
      resolution: randomHelpers.arrayElement(['local_wins', 'server_wins', 'manual', 'pending'])
    })) : [],
    networkStatus: randomHelpers.arrayElement(['online', 'offline', 'limited']),
    batteryLevel: randomHelpers.number(10, 100),
    storageUsed: randomHelpers.number(100, 5000), // MB
    location: generateGPSCoords()
  };
}

// Main function to populate data
async function populateFieldOpsData() {
  console.log('🚀 Starting Field Operations Data Population...');
  
  try {
    // Get existing projects and staff
    const existingProjects = await db.select().from(projects).limit(5);
    const existingStaff = await db.select().from(staff).limit(30);
    
    if (existingProjects.length === 0 || existingStaff.length === 0) {
      console.log('⚠️ No projects or staff found. Creating sample data...');
      
      // Create sample project if needed
      if (existingProjects.length === 0) {
        const sampleProject = await db.insert(projects).values({
          projectCode: `PROJ-FLD-${Date.now()}`,
          projectName: 'Field Operations Demo Project',
          description: 'Demo project for field operations',
          status: 'active',
          budget: '1000000',
          location: 'Johannesburg',
          ...generateGPSCoords()
        }).returning();
        existingProjects.push(sampleProject[0]);
      }
      
      // Create sample technicians if needed
      if (existingStaff.length === 0) {
        const technicians = await db.insert(staff).values(
          Array.from({ length: 30 }, (_, i) => ({
            employeeId: `TECH-${String(i + 1).padStart(4, '0')}`,
            firstName: randomHelpers.fullName().split(' ')[0],
            lastName: randomHelpers.fullName().split(' ')[1],
            email: randomHelpers.email(randomHelpers.fullName()),
            phone: randomHelpers.phoneNumber(),
            role: randomHelpers.arrayElement(['Field Technician', 'Senior Technician', 'Team Lead']),
            department: 'Field Operations',
            isActive: true,
            skills: randomHelpers.arrayElements(
              ['Fiber Splicing', 'OTDR Testing', 'Cable Installation', 'Troubleshooting', 'Customer Service'],
              randomHelpers.number(2, 5)
            ),
            certifications: randomHelpers.arrayElements(
              ['Safety Certified', 'Fiber Optic Certified', 'Tower Climbing', 'First Aid'],
              randomHelpers.number(1, 3)
            )
          }))
        ).returning();
        existingStaff.push(...technicians);
      }
    }
    
    console.log(`📊 Found ${existingProjects.length} projects and ${existingStaff.length} staff members`);
    
    // Generate field tasks
    console.log('📝 Generating 200+ field tasks...');
    const fieldTasks = [];
    
    for (let i = 0; i < 250; i++) {
      const project = randomHelpers.arrayElement(existingProjects);
      const technician = randomHelpers.arrayElement(existingStaff);
      
      const task = await db.insert(tasks).values(
        generateFieldTask(project.id, technician.id, i)
      ).returning();
      
      fieldTasks.push(task[0]);
      
      if ((i + 1) % 50 === 0) {
        console.log(`  ✓ Created ${i + 1} tasks`);
      }
    }
    
    console.log('✅ Field tasks created successfully');
    
    // Generate quality checks for tasks
    console.log('🔍 Generating quality check data...');
    const qualityChecks = [];
    
    for (let i = 0; i < 100; i++) {
      const task = randomHelpers.arrayElement(fieldTasks);
      const technician = randomHelpers.arrayElement(existingStaff);
      
      const qualityData = generateQualityCheck(task.id, technician.id);
      
      // Store quality check in task metadata
      await db.update(tasks)
        .set({
          metadata: {
            ...task.metadata,
            qualityCheck: qualityData
          }
        })
        .where({ id: task.id });
      
      qualityChecks.push(qualityData);
    }
    
    console.log('✅ Quality checks generated');
    
    // Generate daily schedules for next 14 days
    console.log('📅 Generating daily schedules for next 14 days...');
    const schedules = [];
    
    for (let day = 0; day < 14; day++) {
      const scheduleDate = new Date();
      scheduleDate.setDate(scheduleDate.getDate() + day);
      
      for (const technician of existingStaff.slice(0, 20)) {
        const dayTasks = randomHelpers.arrayElements(
          fieldTasks.filter(t => t.assignedTo === technician.id),
          randomHelpers.number(3, 8)
        );
        
        if (dayTasks.length > 0) {
          const schedule = generateDailySchedule(scheduleDate, technician.id, dayTasks);
          schedules.push(schedule);
          
          // Create daily progress record
          await db.insert(dailyProgress).values({
            projectId: existingProjects[0].id,
            workDate: scheduleDate.toISOString().split('T')[0],
            teamLead: technician.id,
            teamMembers: [technician.id],
            workType: 'field_operations',
            activitiesCompleted: dayTasks.map(t => t.title),
            startTime: schedule.shiftStart,
            endTime: schedule.shiftEnd,
            totalHours: '8',
            materialsUsed: schedule.equipment,
            vehiclesUsed: [schedule.vehicle],
            progressNotes: `Completed ${dayTasks.length} field tasks`,
            productivityScore: randomHelpers.float(75, 100, 1).toString(),
            metadata: { schedule }
          });
        }
      }
      
      console.log(`  ✓ Day ${day + 1} schedules created`);
    }
    
    console.log('✅ Daily schedules generated');
    
    // Generate equipment checkouts
    console.log('🔧 Generating equipment checkout records...');
    const equipmentCheckouts = [];
    
    for (let i = 0; i < 75; i++) {
      const technician = randomHelpers.arrayElement(existingStaff);
      const checkoutDate = new Date(Date.now() - randomHelpers.number(0, 7) * 24 * 60 * 60 * 1000);
      
      const checkout = generateEquipmentCheckout(technician.id, checkoutDate);
      
      // Create Nokia equipment record
      await db.insert(nokiaEquipment).values({
        equipmentId: `EQ-${String(i + 1).padStart(5, '0')}`,
        serialNumber: checkout.serialNumber,
        modelNumber: `MDL-${randomHelpers.uuid().substring(0, 6).toUpperCase()}`,
        equipmentType: checkout.equipmentType,
        category: 'field_equipment',
        status: 'deployed',
        currentLocation: 'Field Operations Center',
        metadata: { checkout }
      });
      
      equipmentCheckouts.push(checkout);
    }
    
    console.log('✅ Equipment checkouts created');
    
    // Generate mobile sync data
    console.log('📱 Generating mobile sync data...');
    const syncData = [];
    
    for (const technician of existingStaff.slice(0, 25)) {
      const sync = generateMobileSync(technician.id);
      syncData.push(sync);
      
      // Store sync data in staff metadata
      await db.update(staff)
        .set({
          metadata: {
            mobileSync: sync
          }
        })
        .where({ id: technician.id });
    }
    
    console.log('✅ Mobile sync data generated');
    
    // Generate action items for field operations
    console.log('⚡ Generating action items...');
    
    for (let i = 0; i < 50; i++) {
      const task = randomHelpers.arrayElement(fieldTasks);
      const technician = randomHelpers.arrayElement(existingStaff);
      
      await db.insert(actionItems).values({
        actionId: `ACT-FLD-${String(i + 1).padStart(5, '0')}`,
        projectId: task.projectId,
        relatedTable: 'tasks',
        relatedId: task.id,
        title: randomHelpers.arrayElement([
          'Follow up with customer',
          'Replace damaged equipment',
          'Schedule maintenance',
          'Update documentation',
          'Safety inspection required'
        ]),
        description: randomHelpers.paragraph(),
        category: randomHelpers.arrayElement(['safety', 'quality', 'technical', 'customer']),
        priority: randomHelpers.arrayElement(['low', 'medium', 'high', 'urgent']),
        assignedTo: technician.id,
        dueDate: new Date(Date.now() + randomHelpers.number(1, 7) * 24 * 60 * 60 * 1000).toISOString().split('T')[0],
        status: randomHelpers.arrayElement(['open', 'in_progress', 'completed'])
      });
    }
    
    console.log('✅ Action items created');
    
    // Summary
    console.log('\n📊 Field Operations Data Population Complete!');
    console.log('=====================================');
    console.log(`✓ ${fieldTasks.length} field tasks created`);
    console.log(`✓ ${qualityChecks.length} quality checks generated`);
    console.log(`✓ ${schedules.length} daily schedules created`);
    console.log(`✓ ${equipmentCheckouts.length} equipment checkouts recorded`);
    console.log(`✓ ${syncData.length} mobile sync records created`);
    console.log(`✓ 50 action items generated`);
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