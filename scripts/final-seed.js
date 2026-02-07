#!/usr/bin/env node

const { neon } = require('@neondatabase/serverless');
const crypto = require('crypto');

// Database connection
const sql = neon('process.env.DATABASE_URL');

// Simple password hash for demo
function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
}

async function seedDatabase() {
    console.log('🌱 Starting database seeding with correct schema...\n');
    
    try {
        // First, let's check the actual structure of clients table
        const clientColumns = await sql`
            SELECT column_name, data_type, is_nullable
            FROM information_schema.columns 
            WHERE table_name = 'clients' 
            ORDER BY ordinal_position
        `;
        
        console.log('📋 Clients table structure:');
        const clientColNames = clientColumns.map(col => {
            console.log(`  - ${col.column_name} (${col.data_type}) ${col.is_nullable === 'NO' ? 'NOT NULL' : ''}`);
            return col.column_name;
        });

        // Check existing data
        const existingClients = await sql`SELECT COUNT(*) as count FROM clients`;
        
        if (existingClients[0].count > 0) {
            console.log(`\n✅ Database already contains ${existingClients[0].count} clients.`);
            
            // Show sample data
            const sampleClients = await sql`SELECT * FROM clients LIMIT 2`;
            console.log('\nSample clients:');
            sampleClients.forEach(c => {
                const displayName = c.client_name || c.company_name || c.name || c.id;
                console.log(`  - ${displayName}`);
            });
        } else {
            // Get user for created_by field
            const users = await sql`SELECT id FROM users LIMIT 1`;
            const userId = users[0]?.id;
            
            console.log('\n🏢 Inserting clients with correct schema...');
            
            // Build insert based on actual columns
            if (clientColNames.includes('client_name')) {
                // Use client_name instead of name
                const clients = await sql`
                    INSERT INTO clients (client_name, email, phone, address, city, country, status, created_by)
                    VALUES
                        ('Telkom SA', 'contact@telkom.co.za', '+27 11 311 1000', 
                         '61 Oak Avenue', 'Centurion', 'South Africa', 'active', ${userId}),
                        ('Vodacom Group', 'info@vodacom.co.za', '+27 11 653 5000', 
                         'Vodacom Corporate Park', 'Midrand', 'South Africa', 'active', ${userId}),
                        ('MTN South Africa', 'business@mtn.co.za', '+27 11 912 3000',
                         '216 14th Avenue', 'Johannesburg', 'South Africa', 'active', ${userId})
                    RETURNING id, client_name
                `;
                console.log(`✅ Created ${clients.length} clients`);
                
                // Now add projects for these clients
                await addProjects(clients, userId);
                
            } else if (clientColNames.includes('company_name')) {
                // Use company_name
                const clients = await sql`
                    INSERT INTO clients (company_name, email, phone, address, city, country, status, created_by)
                    VALUES
                        ('Telkom SA', 'contact@telkom.co.za', '+27 11 311 1000', 
                         '61 Oak Avenue', 'Centurion', 'South Africa', 'active', ${userId}),
                        ('Vodacom Group', 'info@vodacom.co.za', '+27 11 653 5000', 
                         'Vodacom Corporate Park', 'Midrand', 'South Africa', 'active', ${userId}),
                        ('MTN South Africa', 'business@mtn.co.za', '+27 11 912 3000',
                         '216 14th Avenue', 'Johannesburg', 'South Africa', 'active', ${userId})
                    RETURNING id, company_name as client_name
                `;
                console.log(`✅ Created ${clients.length} clients`);
                
                // Now add projects for these clients
                await addProjects(clients, userId);
            }
        }
        
        // Check and add other data
        await checkAndAddStaff();
        await checkAndAddSuppliers();
        await checkAndAddContractors();
        
        // Final summary
        await showFinalSummary();
        
    } catch (error) {
        console.error('❌ Error:', error.message);
        process.exit(1);
    }
}

async function addProjects(clients, userId) {
    const existingProjects = await sql`SELECT COUNT(*) as count FROM projects`;
    
    if (existingProjects[0].count === 0) {
        console.log('\n📁 Creating projects...');
        
        const projects = await sql`
            INSERT INTO projects (name, description, client_id, status, priority, 
                                start_date, end_date, budget, created_by)
            VALUES
                ('Centurion Fiber Rollout', 
                 'Fiber optic network deployment in residential areas', 
                 ${clients[0].id}, 'active', 'high', 
                 '2025-02-01', '2025-08-31', 2500000, ${userId}),
                ('Midrand Business Park', 
                 'High-speed fiber connectivity for business park',
                 ${clients[1].id}, 'planning', 'medium', 
                 '2025-03-01', '2025-09-30', 1800000, ${userId}),
                ('Johannesburg CBD Upgrade', 
                 'Network infrastructure upgrade',
                 ${clients[2].id}, 'planning', 'high',
                 '2025-04-01', '2025-12-31', 3200000, ${userId})
            RETURNING id, name
        `;
        console.log(`✅ Created ${projects.length} projects`);
        
        // Add some poles for the first project
        await sql`
            INSERT INTO poles (project_id, pole_number, pole_type, material, height_meters, 
                             latitude, longitude, status)
            VALUES
                (${projects[0].id}, 'P001', 'distribution', 'concrete', 9.00, 
                 -25.7479, 28.2293, 'planned'),
                (${projects[0].id}, 'P002', 'distribution', 'concrete', 9.00, 
                 -25.7481, 28.2295, 'planned'),
                (${projects[0].id}, 'P003', 'distribution', 'wooden', 7.50, 
                 -25.7485, 28.2299, 'installed')
        `;
        console.log(`✅ Created sample poles`);
        
        // Add some tasks
        await sql`
            INSERT INTO tasks (project_id, title, description, priority, status, created_by)
            VALUES
                (${projects[0].id}, 'Site Survey', 'Survey the area', 'high', 'in_progress', ${userId}),
                (${projects[0].id}, 'Route Planning', 'Plan cable routes', 'high', 'pending', ${userId}),
                (${projects[1].id}, 'Initial Assessment', 'Assess requirements', 'medium', 'pending', ${userId})
        `;
        console.log(`✅ Created sample tasks`);
    }
}

async function checkAndAddStaff() {
    const existingStaff = await sql`SELECT COUNT(*) as count FROM staff`;
    
    if (existingStaff[0].count === 0) {
        console.log('\n👥 Creating staff members...');
        
        const staff = await sql`
            INSERT INTO staff (employee_id, first_name, last_name, email, phone, 
                             department, position, role, availability_status, 
                             hourly_rate, is_active)
            VALUES
                ('EMP001', 'David', 'Williams', 'david@fibreflow.com', '+27821112222', 
                 'Engineering', 'Senior Engineer', 'engineer', 'available', 85, true),
                ('EMP002', 'Lisa', 'Davis', 'lisa@fibreflow.com', '+27825556666', 
                 'Field Ops', 'Technician', 'technician', 'available', 55, true),
                ('EMP003', 'Mike', 'Brown', 'mike@fibreflow.com', '+27823334444', 
                 'Field Ops', 'Supervisor', 'supervisor', 'available', 75, true)
            RETURNING id
        `;
        console.log(`✅ Created ${staff.length} staff members`);
    }
}

async function checkAndAddSuppliers() {
    const existingSuppliers = await sql`SELECT COUNT(*) as count FROM suppliers`;
    
    if (existingSuppliers[0].count === 0) {
        console.log('\n📦 Creating suppliers...');
        
        const suppliers = await sql`
            INSERT INTO suppliers (name, email, phone, address, city, country, 
                                 rating, credit_limit, payment_terms, status)
            VALUES
                ('CableTech Suppliers', 'sales@cabletech.co.za', '+27115556666', 
                 '789 Supply Street', 'Johannesburg', 'South Africa', 
                 4.6, 500000, 'Net 30', 'active'),
                ('Network Equipment Co', 'info@netequip.co.za', '+27117778888', 
                 '321 Tech Park', 'Centurion', 'South Africa', 
                 4.4, 750000, 'Net 45', 'active')
            RETURNING id
        `;
        console.log(`✅ Created ${suppliers.length} suppliers`);
    }
}

async function checkAndAddContractors() {
    const existingContractors = await sql`SELECT COUNT(*) as count FROM contractors`;
    
    if (existingContractors[0].count === 0) {
        console.log('\n🔨 Creating contractors...');
        
        const contractors = await sql`
            INSERT INTO contractors (company_name, email, phone, address, city, country, 
                                   rating, status, onboarding_status, onboarding_progress)
            VALUES
                ('FiberTech Solutions', 'info@fibertech.co.za', '+27112223333', 
                 '123 Industrial Road', 'Johannesburg', 'South Africa', 
                 4.5, 'active', 'complete', 100),
                ('Network Builders Pro', 'contact@netbuilders.co.za', '+27114445555', 
                 '456 Construction Ave', 'Pretoria', 'South Africa', 
                 4.2, 'active', 'complete', 100)
            RETURNING id
        `;
        console.log(`✅ Created ${contractors.length} contractors`);
    }
}

async function showFinalSummary() {
    console.log('\n' + '='.repeat(60));
    console.log('📊 DATABASE SUMMARY');
    console.log('='.repeat(60));
    
    const counts = await sql`
        SELECT 
            (SELECT COUNT(*) FROM users) as users,
            (SELECT COUNT(*) FROM clients) as clients,
            (SELECT COUNT(*) FROM projects) as projects,
            (SELECT COUNT(*) FROM staff) as staff,
            (SELECT COUNT(*) FROM contractors) as contractors,
            (SELECT COUNT(*) FROM suppliers) as suppliers,
            (SELECT COUNT(*) FROM poles) as poles,
            (SELECT COUNT(*) FROM tasks) as tasks
    `;
    
    const c = counts[0];
    console.log(`✅ Users: ${c.users}`);
    console.log(`✅ Clients: ${c.clients}`);
    console.log(`✅ Projects: ${c.projects}`);
    console.log(`✅ Staff: ${c.staff}`);
    console.log(`✅ Contractors: ${c.contractors}`);
    console.log(`✅ Suppliers: ${c.suppliers}`);
    console.log(`✅ Poles: ${c.poles}`);
    console.log(`✅ Tasks: ${c.tasks}`);
    
    // Show login credentials if we have users
    if (c.users > 0) {
        const users = await sql`SELECT email, role FROM users LIMIT 3`;
        console.log('\n📧 Available Users:');
        users.forEach(u => console.log(`  - ${u.email} (${u.role})`));
    }
    
    console.log('='.repeat(60));
    console.log('✨ Database is ready for use!');
}

// Run the seeding
seedDatabase().catch(console.error);