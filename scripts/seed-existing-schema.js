#!/usr/bin/env node

const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');

// Database connection
const sql = neon('process.env.DATABASE_URL');

// Simple password hash for demo (in production, use bcrypt)
function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

async function seedDatabase() {
    console.log('🌱 Starting database seeding...\n');
    
    try {
        // Check if we already have data
        const existingUsers = await sql`SELECT COUNT(*) as count FROM users`;
        
        if (existingUsers[0].count > 0) {
            console.log(`⚠️  Database already contains ${existingUsers[0].count} users. Skipping seed.`);
            const sampleUsers = await sql`SELECT email, first_name, last_name, role FROM users LIMIT 3`;
            console.log('\nExisting users:');
            sampleUsers.forEach(u => console.log(`  - ${u.email} (${u.first_name} ${u.last_name}) - ${u.role}`));
            return;
        }

        // Insert users
        console.log('👤 Creating users...');
        const users = await sql`
            INSERT INTO users (email, password, first_name, last_name, role, permissions, is_active, department)
            VALUES 
                ('admin@fibreflow.com', ${hashPassword('admin123')}, 'Admin', 'User', 'admin', 
                 '["all"]'::jsonb, true, 'Management'),
                ('manager@fibreflow.com', ${hashPassword('manager123')}, 'Project', 'Manager', 'manager',
                 '["projects.manage", "tasks.manage", "staff.view"]'::jsonb, true, 'Operations'),
                ('tech@fibreflow.com', ${hashPassword('tech123')}, 'Field', 'Technician', 'technician',
                 '["tasks.view", "tasks.update"]'::jsonb, true, 'Field Operations')
            RETURNING id, email, role
        `;
        console.log(`✅ Created ${users.length} users`);

        const adminId = users.find(u => u.role === 'admin').id;
        const managerId = users.find(u => u.role === 'manager').id;

        // Insert clients
        console.log('\n🏢 Creating clients...');
        const clients = await sql`
            INSERT INTO clients (name, email, phone, address, city, country, status, created_by)
            VALUES
                ('Telkom SA', 'contact@telkom.co.za', '+27 11 311 1000', 
                 '61 Oak Avenue, Centurion', 'Centurion', 'South Africa', 'active', ${adminId}),
                ('Vodacom Group', 'info@vodacom.co.za', '+27 11 653 5000', 
                 'Vodacom Corporate Park', 'Midrand', 'South Africa', 'active', ${adminId}),
                ('MTN South Africa', 'business@mtn.co.za', '+27 11 912 3000',
                 '216 14th Avenue, Fairland', 'Johannesburg', 'South Africa', 'active', ${adminId})
            RETURNING id, name
        `;
        console.log(`✅ Created ${clients.length} clients`);

        // Insert projects
        console.log('\n📁 Creating projects...');
        const projects = await sql`
            INSERT INTO projects (name, code, description, client_id, project_manager_id, 
                                start_date, end_date, budget, status, priority, type, created_by)
            VALUES
                ('Centurion Fiber Rollout Phase 1', 'CFR-001', 
                 'Fiber optic network deployment in Centurion residential areas', 
                 ${clients[0].id}, ${managerId}, 
                 '2025-02-01', '2025-08-31', 2500000.00, 
                 'active', 'high', 'fiber_deployment', ${adminId}),
                ('Midrand Business Park Connectivity', 'MBC-001',
                 'High-speed fiber connectivity for Midrand Business Park',
                 ${clients[1].id}, ${managerId}, 
                 '2025-03-01', '2025-09-30', 1800000.00, 
                 'planning', 'medium', 'fiber_deployment', ${adminId}),
                ('Johannesburg CBD Upgrade', 'JHB-001',
                 'Network infrastructure upgrade in Johannesburg CBD',
                 ${clients[2].id}, ${managerId},
                 '2025-04-01', '2025-12-31', 3200000.00,
                 'planning', 'high', 'network_upgrade', ${adminId})
            RETURNING id, name, code
        `;
        console.log(`✅ Created ${projects.length} projects`);

        // Insert staff
        console.log('\n👥 Creating staff members...');
        const staff = await sql`
            INSERT INTO staff (employee_id, first_name, last_name, email, phone, 
                             department, position, role, hire_date, availability_status, 
                             hourly_rate, is_active)
            VALUES
                ('EMP001', 'David', 'Williams', 'david.w@fibreflow.com', '+27 82 111 2222', 
                 'Engineering', 'Senior Engineer', 'engineer', '2023-01-15', 'available', 85.00, true),
                ('EMP002', 'Mike', 'Brown', 'mike.b@fibreflow.com', '+27 82 333 4444', 
                 'Field Operations', 'Field Supervisor', 'supervisor', '2023-03-20', 'available', 75.00, true),
                ('EMP003', 'Lisa', 'Davis', 'lisa.d@fibreflow.com', '+27 82 555 6666', 
                 'Field Operations', 'Field Technician', 'technician', '2023-06-01', 'available', 55.00, true),
                ('EMP004', 'James', 'Wilson', 'james.w@fibreflow.com', '+27 82 777 8888', 
                 'Field Operations', 'Field Technician', 'technician', '2023-07-15', 'available', 55.00, true),
                ('EMP005', 'Emma', 'Taylor', 'emma.t@fibreflow.com', '+27 82 999 0000', 
                 'Quality Assurance', 'QA Inspector', 'inspector', '2023-04-10', 'available', 65.00, true),
                ('EMP006', 'Robert', 'Johnson', 'robert.j@fibreflow.com', '+27 82 222 3333',
                 'Engineering', 'Network Designer', 'designer', '2023-02-01', 'available', 80.00, true)
            RETURNING id, first_name, last_name, position
        `;
        console.log(`✅ Created ${staff.length} staff members`);

        // Insert contractors
        console.log('\n🔨 Creating contractors...');
        const contractors = await sql`
            INSERT INTO contractors (company_name, registration_number, email, phone, 
                                   address, city, country, rating, status, 
                                   onboarding_status, onboarding_progress)
            VALUES
                ('FiberTech Solutions', 'REG2023001', 'info@fibertech.co.za', '+27 11 222 3333', 
                 '123 Industrial Road', 'Johannesburg', 'South Africa', 4.5, 'active', 'complete', 100),
                ('Network Builders Pro', 'REG2023002', 'contact@netbuilders.co.za', '+27 11 444 5555', 
                 '456 Construction Ave', 'Pretoria', 'South Africa', 4.2, 'active', 'complete', 100),
                ('TechConnect Services', 'REG2023003', 'info@techconnect.co.za', '+27 11 666 7777',
                 '789 Tech Boulevard', 'Centurion', 'South Africa', 4.7, 'active', 'complete', 100)
            RETURNING id, company_name
        `;
        console.log(`✅ Created ${contractors.length} contractors`);

        // Insert suppliers
        console.log('\n📦 Creating suppliers...');
        const suppliers = await sql`
            INSERT INTO suppliers (name, code, email, phone, address, city, country, 
                                 rating, credit_limit, payment_terms, lead_time_days, 
                                 status, compliance_status)
            VALUES
                ('CableTech Suppliers', 'SUP001', 'sales@cabletech.co.za', '+27 11 555 6666', 
                 '789 Supply Street', 'Johannesburg', 'South Africa', 
                 4.6, 500000.00, 'Net 30', 7, 'active', 'approved'),
                ('Network Equipment Co', 'SUP002', 'info@netequip.co.za', '+27 11 777 8888', 
                 '321 Tech Park', 'Centurion', 'South Africa', 
                 4.4, 750000.00, 'Net 45', 14, 'active', 'approved'),
                ('Safety Gear Direct', 'SUP003', 'orders@safetygear.co.za', '+27 11 999 0000', 
                 '654 Safety Road', 'Midrand', 'South Africa', 
                 4.8, 200000.00, 'Net 15', 3, 'active', 'approved'),
                ('Fiber Optics International', 'SUP004', 'sales@fiberoptics.co.za', '+27 11 888 9999',
                 '987 Optical Drive', 'Sandton', 'South Africa',
                 4.9, 1000000.00, 'Net 60', 21, 'active', 'approved')
            RETURNING id, name, code
        `;
        console.log(`✅ Created ${suppliers.length} suppliers`);

        // Insert poles for first project
        console.log('\n📍 Creating sample poles...');
        const poles = await sql`
            INSERT INTO poles (project_id, pole_number, pole_type, material, height_meters, 
                             latitude, longitude, address, status)
            VALUES
                (${projects[0].id}, 'P001', 'distribution', 'concrete', 9.00, 
                 -25.7479, 28.2293, 'Corner of Jean Ave and Cantonments Rd, Centurion', 'planned'),
                (${projects[0].id}, 'P002', 'distribution', 'concrete', 9.00, 
                 -25.7481, 28.2295, 'Jean Ave, Centurion', 'planned'),
                (${projects[0].id}, 'P003', 'distribution', 'concrete', 9.00, 
                 -25.7483, 28.2297, 'Jean Ave (North), Centurion', 'planned'),
                (${projects[0].id}, 'P004', 'distribution', 'wooden', 7.50, 
                 -25.7485, 28.2299, 'Cantonments Rd, Centurion', 'installed'),
                (${projects[0].id}, 'P005', 'distribution', 'wooden', 7.50, 
                 -25.7487, 28.2301, 'Cantonments Rd (East), Centurion', 'installed'),
                (${projects[0].id}, 'P006', 'transmission', 'steel', 12.00,
                 -25.7490, 28.2305, 'Main Distribution Point', 'installed')
            RETURNING id, pole_number
        `;
        console.log(`✅ Created ${poles.length} poles`);

        // Insert tasks
        console.log('\n📋 Creating sample tasks...');
        const tasks = await sql`
            INSERT INTO tasks (project_id, title, description, task_type, priority, 
                             status, assigned_to, start_date, due_date, 
                             estimated_hours, created_by)
            VALUES
                (${projects[0].id}, 'Site Survey - Zone A', 
                 'Survey residential area Zone A and document infrastructure', 
                 'field_work', 'high', 'completed', ${managerId}, 
                 '2025-02-01', '2025-02-07', 40, ${adminId}),
                (${projects[0].id}, 'Site Survey - Zone B', 
                 'Survey residential area Zone B and document infrastructure', 
                 'field_work', 'high', 'in_progress', ${managerId}, 
                 '2025-02-08', '2025-02-14', 40, ${adminId}),
                (${projects[0].id}, 'Create Route Maps', 
                 'Design optimal cable routing paths for all zones', 
                 'design', 'high', 'pending', ${managerId}, 
                 '2025-02-15', '2025-02-21', 24, ${adminId}),
                (${projects[0].id}, 'Obtain Municipal Permits', 
                 'Secure necessary permits from local authorities', 
                 'administrative', 'critical', 'pending', ${managerId}, 
                 '2025-02-22', '2025-03-07', 16, ${adminId}),
                (${projects[0].id}, 'Material Procurement', 
                 'Order required cables, poles, and equipment', 
                 'procurement', 'high', 'pending', ${managerId}, 
                 '2025-02-15', '2025-02-28', 20, ${adminId}),
                (${projects[1].id}, 'Initial Assessment', 
                 'Assess current infrastructure at business park', 
                 'assessment', 'medium', 'pending', ${managerId}, 
                 '2025-03-01', '2025-03-07', 32, ${adminId})
            RETURNING id, title, status
        `;
        console.log(`✅ Created ${tasks.length} tasks`);

        // Display final summary
        console.log('\n' + '='.repeat(60));
        console.log('🎉 DATABASE SEEDING COMPLETE!');
        console.log('='.repeat(60));
        console.log(`✅ Users: ${users.length} (admin, manager, technician)`);
        console.log(`✅ Clients: ${clients.length} (Telkom, Vodacom, MTN)`);
        console.log(`✅ Projects: ${projects.length}`);
        console.log(`✅ Staff: ${staff.length}`);
        console.log(`✅ Contractors: ${contractors.length}`);
        console.log(`✅ Suppliers: ${suppliers.length}`);
        console.log(`✅ Poles: ${poles.length}`);
        console.log(`✅ Tasks: ${tasks.length}`);
        console.log('='.repeat(60));
        console.log('\n📧 Test Login Credentials:');
        console.log('  Admin: admin@fibreflow.com / admin123');
        console.log('  Manager: manager@fibreflow.com / manager123');
        console.log('  Technician: tech@fibreflow.com / tech123');
        console.log('='.repeat(60));

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error('Details:', error);
        process.exit(1);
    }
}

// Run the seeding
seedDatabase().catch(console.error);