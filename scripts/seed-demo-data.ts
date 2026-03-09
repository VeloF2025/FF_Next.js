/**
 * Database Seeder for Demo Data
 * Seeds procurement and field operations tables with sample data
 */

import { neon } from '@neondatabase/serverless';
import { drizzle } from 'drizzle-orm/neon-http';
// PARTIAL: Schema modules not yet created — using raw table references via drizzle
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const users: any = 'users';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const staff: any = 'staff';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const projects: any = 'projects';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tasks: any = 'tasks';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const clients: any = 'clients';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const boqs: any = 'boqs';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const boqItems: any = 'boq_items';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rfqs: any = 'rfqs';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rfqItems: any = 'rfq_items';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stockPositions: any = 'stock_positions';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const stockMovements: any = 'stock_movements';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const quotes: any = 'quotes';

// Use connection string from environment or default
const connectionString = process.env.DATABASE_URL || 
  'process.env.DATABASE_URL';

const neonClient = neon(connectionString);
const db = drizzle(neonClient as any);

async function seedDemoData() {
  console.log('🌱 Starting database seeding...');
  
  try {
    // 1. Create demo users
    console.log('Creating demo users...');
    const demoUsers = await db.insert(users).values([
      {
        email: 'john.technician@fibreflow.com',
        firstName: 'John',
        lastName: 'Smith',
        role: 'technician',
        department: 'Field Operations',
        isActive: true,
      },
      {
        email: 'jane.manager@fibreflow.com',
        firstName: 'Jane',
        lastName: 'Doe',
        role: 'manager',
        department: 'Operations',
        isActive: true,
      },
      {
        email: 'mike.procurement@fibreflow.com',
        firstName: 'Mike',
        lastName: 'Johnson',
        role: 'procurement',
        department: 'Procurement',
        isActive: true,
      },
    ]).returning();
    console.log(`✅ Created ${demoUsers.length} users`);

    // 2. Create demo clients
    console.log('Creating demo clients...');
    const demoClients = await db.insert(clients).values([
      {
        companyName: 'TechCorp Solutions',
        contactPerson: 'Alice Brown',
        email: 'alice@techcorp.com',
        phone: '+27 11 234 5678',
        city: 'Johannesburg',
        status: 'active',
      },
      {
        companyName: 'Network Systems Ltd',
        contactPerson: 'Bob Wilson',
        email: 'bob@networksystems.com',
        phone: '+27 21 345 6789',
        city: 'Cape Town',
        status: 'active',
      },
    ]).returning();
    console.log(`✅ Created ${demoClients.length} clients`);

    // 3. Create demo projects
    console.log('Creating demo projects...');
    const demoProjects = await db.insert(projects).values([
      {
        projectCode: 'PROJ-2024-001',
        projectName: 'Johannesburg Fiber Network Expansion',
        clientId: demoClients[0].id,
        description: 'Expanding fiber network coverage in Johannesburg CBD',
        status: 'active',
        location: 'Johannesburg CBD',
        latitude: '-26.2041',
        longitude: '28.0473',
        budget: '5000000',
      },
      {
        projectCode: 'PROJ-2024-002',
        projectName: 'Cape Town Coastal Network',
        clientId: demoClients[1].id,
        description: 'Installing fiber infrastructure along Cape Town coast',
        status: 'planning',
        location: 'Cape Town',
        latitude: '-33.9249',
        longitude: '18.4241',
        budget: '3500000',
      },
    ]).returning();
    console.log(`✅ Created ${demoProjects.length} projects`);

    // 4. Create demo staff/technicians
    console.log('Creating demo staff...');
    const demoStaff = await db.insert(staff).values([
      {
        employeeId: 'EMP-001',
        userId: demoUsers[0].id,
        firstName: 'John',
        lastName: 'Smith',
        email: 'john.technician@fibreflow.com',
        phone: '+27 82 123 4567',
        position: 'Field Technician',
        department: 'Field Operations',
        status: 'active',
        skills: ['Fiber Installation', 'Cable Splicing', 'Network Testing'],
        performanceRating: '4.5',
      },
      {
        employeeId: 'EMP-002',
        userId: demoUsers[1].id,
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane.manager@fibreflow.com',
        phone: '+27 82 234 5678',
        position: 'Operations Manager',
        department: 'Operations',
        status: 'active',
        skills: ['Project Management', 'Team Leadership', 'Quality Control'],
        performanceRating: '4.8',
      },
      {
        employeeId: 'EMP-003',
        firstName: 'Sarah',
        lastName: 'Williams',
        email: 'sarah.tech@fibreflow.com',
        phone: '+27 82 345 6789',
        position: 'Field Technician',
        department: 'Field Operations',
        status: 'active',
        skills: ['Fiber Optics', 'Troubleshooting', 'Documentation'],
        performanceRating: '4.3',
      },
    ]).returning();
    console.log(`✅ Created ${demoStaff.length} staff members`);

    // 5. Create demo BOQs
    console.log('Creating demo BOQs...');
    const demoBOQs = await db.insert(boqs).values([
      {
        projectId: demoProjects[0].projectCode,
        version: 'v1.0',
        title: 'JHB Fiber Network BOQ',
        description: 'Bill of quantities for Johannesburg fiber network project',
        status: 'approved',
        uploadedBy: demoUsers[2].email,
        itemCount: 3,
        totalEstimatedValue: '450000',
        currency: 'ZAR',
      },
      {
        projectId: demoProjects[1].projectCode,
        version: 'v1.0',
        title: 'Cape Town Coastal BOQ',
        description: 'Bill of quantities for Cape Town coastal network',
        status: 'draft',
        uploadedBy: demoUsers[2].email,
        itemCount: 2,
        totalEstimatedValue: '320000',
        currency: 'ZAR',
      },
    ]).returning();
    console.log(`✅ Created ${demoBOQs.length} BOQs`);

    // 6. Create demo BOQ items
    console.log('Creating demo BOQ items...');
    const demoBOQItems = await db.insert(boqItems).values([
      {
        boqId: demoBOQs[0].id,
        projectId: demoProjects[0].projectCode,
        lineNumber: 1,
        itemCode: 'FIB-12C-001',
        description: '12-Core Single Mode Fiber Optic Cable',
        category: 'Cables',
        quantity: '5000',
        uom: 'meters',
        unitPrice: '45',
        totalPrice: '225000',
        procurementStatus: 'pending',
      },
      {
        boqId: demoBOQs[0].id,
        projectId: demoProjects[0].projectCode,
        lineNumber: 2,
        itemCode: 'CON-50MM-001',
        description: '50mm PVC Conduit Pipe',
        category: 'Conduits',
        quantity: '3000',
        uom: 'meters',
        unitPrice: '25',
        totalPrice: '75000',
        procurementStatus: 'pending',
      },
      {
        boqId: demoBOQs[0].id,
        projectId: demoProjects[0].projectCode,
        lineNumber: 3,
        itemCode: 'CONN-SC-001',
        description: 'SC/APC Fiber Connectors',
        category: 'Connectors',
        quantity: '500',
        uom: 'pieces',
        unitPrice: '15',
        totalPrice: '7500',
        procurementStatus: 'pending',
      },
      {
        boqId: demoBOQs[1].id,
        projectId: demoProjects[1].projectCode,
        lineNumber: 1,
        itemCode: 'FIB-24C-001',
        description: '24-Core Single Mode Fiber Optic Cable',
        category: 'Cables',
        quantity: '3000',
        uom: 'meters',
        unitPrice: '75',
        totalPrice: '225000',
        procurementStatus: 'pending',
      },
      {
        boqId: demoBOQs[1].id,
        projectId: demoProjects[1].projectCode,
        lineNumber: 2,
        itemCode: 'SPLICE-001',
        description: 'Fiber Splice Enclosures',
        category: 'Equipment',
        quantity: '50',
        uom: 'units',
        unitPrice: '350',
        totalPrice: '17500',
        procurementStatus: 'pending',
      },
    ]).returning();
    console.log(`✅ Created ${demoBOQItems.length} BOQ items`);

    // 7. Create demo RFQs
    console.log('Creating demo RFQs...');
    const demoRFQs = await db.insert(rfqs).values([
      {
        projectId: demoProjects[0].projectCode,
        rfqNumber: 'RFQ-2024-001',
        title: 'Fiber Optic Cable Supply - JHB Project',
        description: 'Request for quotation for fiber optic cable and accessories',
        status: 'issued',
        responseDeadline: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days from now
        createdBy: demoUsers[2].email,
        paymentTerms: 'Net 30 days',
        deliveryTerms: 'FOB Johannesburg',
        currency: 'ZAR',
        itemCount: 2,
        totalBudgetEstimate: '300000',
      },
      {
        projectId: demoProjects[1].projectCode,
        rfqNumber: 'RFQ-2024-002',
        title: 'Installation Services - Cape Town',
        description: 'Request for quotation for fiber installation services',
        status: 'draft',
        responseDeadline: new Date(Date.now() + 21 * 24 * 60 * 60 * 1000), // 21 days from now
        createdBy: demoUsers[2].email,
        paymentTerms: 'Net 45 days',
        deliveryTerms: 'On-site Cape Town',
        currency: 'ZAR',
        itemCount: 1,
        totalBudgetEstimate: '150000',
      },
    ]).returning();
    console.log(`✅ Created ${demoRFQs.length} RFQs`);

    // 8. Create demo RFQ items
    console.log('Creating demo RFQ items...');
    const demoRFQItems = await db.insert(rfqItems).values([
      {
        rfqId: demoRFQs[0].id,
        projectId: demoProjects[0].projectCode,
        lineNumber: 1,
        itemCode: 'FIB-12C-001',
        description: '12-Core Single Mode Fiber Optic Cable',
        category: 'Cables',
        quantity: '5000',
        uom: 'meters',
        budgetPrice: '45',
      },
      {
        rfqId: demoRFQs[0].id,
        projectId: demoProjects[0].projectCode,
        lineNumber: 2,
        itemCode: 'CONN-SC-001',
        description: 'SC/APC Fiber Connectors',
        category: 'Connectors',
        quantity: '500',
        uom: 'pieces',
        budgetPrice: '15',
      },
      {
        rfqId: demoRFQs[1].id,
        projectId: demoProjects[1].projectCode,
        lineNumber: 1,
        description: 'Fiber Installation Service',
        category: 'Services',
        quantity: '3000',
        uom: 'meters',
        budgetPrice: '50',
      },
    ]).returning();
    console.log(`✅ Created ${demoRFQItems.length} RFQ items`);

    // 9. Create demo stock positions
    console.log('Creating demo stock positions...');
    const demoStock = await db.insert(stockPositions).values([
      {
        projectId: demoProjects[0].projectCode,
        itemCode: 'FIB-12C-001',
        itemName: '12-Core Single Mode Fiber Optic Cable',
        description: 'High quality single mode fiber cable',
        category: 'Cables',
        uom: 'meters',
        onHandQuantity: '2500',
        reservedQuantity: '500',
        availableQuantity: '2000',
        inTransitQuantity: '1000',
        averageUnitCost: '43',
        totalValue: '107500',
        warehouseLocation: 'Main Warehouse - JHB',
        binLocation: 'A-12-3',
        reorderLevel: '1000',
        maxStockLevel: '10000',
        stockStatus: 'normal',
      },
      {
        projectId: demoProjects[0].projectCode,
        itemCode: 'CON-50MM-001',
        itemName: '50mm PVC Conduit Pipe',
        description: 'Heavy duty PVC conduit for underground installation',
        category: 'Conduits',
        uom: 'meters',
        onHandQuantity: '1200',
        reservedQuantity: '0',
        availableQuantity: '1200',
        inTransitQuantity: '500',
        averageUnitCost: '24',
        totalValue: '28800',
        warehouseLocation: 'Main Warehouse - JHB',
        binLocation: 'B-05-2',
        reorderLevel: '500',
        maxStockLevel: '5000',
        stockStatus: 'normal',
      },
      {
        projectId: demoProjects[0].projectCode,
        itemCode: 'CONN-SC-001',
        itemName: 'SC/APC Fiber Connectors',
        description: 'Professional grade fiber connectors',
        category: 'Connectors',
        uom: 'pieces',
        onHandQuantity: '50',
        reservedQuantity: '0',
        availableQuantity: '50',
        inTransitQuantity: '200',
        averageUnitCost: '14',
        totalValue: '700',
        warehouseLocation: 'Main Warehouse - JHB',
        binLocation: 'C-02-1',
        reorderLevel: '100',
        maxStockLevel: '1000',
        stockStatus: 'low',
      },
      {
        projectId: demoProjects[1].projectCode,
        itemCode: 'FIB-24C-001',
        itemName: '24-Core Single Mode Fiber Optic Cable',
        description: 'High capacity fiber cable for backbone',
        category: 'Cables',
        uom: 'meters',
        onHandQuantity: '1500',
        reservedQuantity: '300',
        availableQuantity: '1200',
        inTransitQuantity: '0',
        averageUnitCost: '72',
        totalValue: '108000',
        warehouseLocation: 'Cape Town Warehouse',
        binLocation: 'A-08-1',
        reorderLevel: '500',
        maxStockLevel: '5000',
        stockStatus: 'normal',
      },
    ]).returning();
    console.log(`✅ Created ${demoStock.length} stock positions`);

    // 10. Create demo tasks
    console.log('Creating demo tasks...');
    const demoTasks = await db.insert(tasks).values([
      {
        taskCode: 'TASK-001',
        title: 'Install Fiber Cable - Section A',
        description: 'Install 500m of fiber optic cable in Section A of the JHB network',
        projectId: demoProjects[0].id,
        assignedTo: demoUsers[0].id,
        assignedBy: demoUsers[1].id,
        priority: 'high',
        status: 'in_progress',
        category: 'installation',
        dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // 2 days from now
        estimatedHours: '8',
        progress: 35,
      },
      {
        taskCode: 'TASK-002',
        title: 'Test Network Connectivity - Zone B',
        description: 'Perform comprehensive network testing in Zone B',
        projectId: demoProjects[0].id,
        assignedTo: demoUsers[0].id,
        assignedBy: demoUsers[1].id,
        priority: 'medium',
        status: 'pending',
        category: 'testing',
        dueDate: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // 5 days from now
        estimatedHours: '4',
        progress: 0,
      },
      {
        taskCode: 'TASK-003',
        title: 'Site Survey - Cape Town North',
        description: 'Conduct site survey for fiber route planning',
        projectId: demoProjects[1].id,
        assignedTo: demoStaff[2].userId || demoUsers[0].id,
        assignedBy: demoUsers[1].id,
        priority: 'high',
        status: 'pending',
        category: 'survey',
        dueDate: new Date(Date.now() + 1 * 24 * 60 * 60 * 1000), // Tomorrow
        estimatedHours: '6',
        progress: 0,
      },
      {
        taskCode: 'TASK-004',
        title: 'Splice Fiber Connections - Junction Box 12',
        description: 'Complete fiber splicing at junction box 12',
        projectId: demoProjects[0].id,
        assignedTo: demoUsers[0].id,
        assignedBy: demoUsers[1].id,
        priority: 'urgent',
        status: 'pending',
        category: 'maintenance',
        dueDate: new Date(Date.now() + 4 * 60 * 60 * 1000), // 4 hours from now
        estimatedHours: '3',
        progress: 0,
      },
    ]).returning();
    console.log(`✅ Created ${demoTasks.length} tasks`);

    console.log('\n🎉 Database seeding completed successfully!');
    console.log('You can now view the data in your procurement and field operations pages.');
    
  } catch (error) {
    console.error('❌ Error seeding database:', error);
    process.exit(1);
  }
}

// Run the seeder
seedDemoData()
  .then(() => {
    console.log('✅ Seeding script finished');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Seeding script failed:', error);
    process.exit(1);
  });