/**
 * Check Database Schema and Populate Communication Data
 * This script will first check what tables exist and create missing ones
 */

const { neon } = require('@neondatabase/serverless');

// Database connection
const connectionString = process.env.DATABASE_URL || 'process.env.DATABASE_URL';
const sql = neon(connectionString);

// Utility functions
const getRandomItem = (array) => array[Math.floor(Math.random() * array.length)];
const getRandomItems = (array, count) => {
  const shuffled = [...array].sort(() => 0.5 - Math.random());
  return shuffled.slice(0, count);
};

// Generate random date within last N days during business hours
const getBusinessHoursDate = (daysBack = 7) => {
  const now = new Date();
  const pastDate = new Date(now.getTime() - (daysBack * 24 * 60 * 60 * 1000));
  
  const randomTime = pastDate.getTime() + Math.random() * (now.getTime() - pastDate.getTime());
  const date = new Date(randomTime);
  
  if (Math.random() > 0.3) {
    const hour = 8 + Math.floor(Math.random() * 10);
    const minute = Math.floor(Math.random() * 60);
    date.setHours(hour, minute, 0, 0);
    
    if (date.getDay() === 0) date.setDate(date.getDate() + 1);
    if (date.getDay() === 6) date.setDate(date.getDate() + 2);
  }
  
  return date.toISOString();
};

// Generate SA mobile number
const generateSAMobileNumber = () => {
  const prefixes = ['082', '083', '084', '072', '073', '074', '076', '078', '079'];
  const prefix = getRandomItem(prefixes);
  const number = Math.floor(1000000 + Math.random() * 9000000);
  return `+27${prefix.substring(1)}${number}`;
};

async function main() {
  console.log('🔍 Checking database schema...');
  
  try {
    // Check what tables exist
    const tables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `;
    
    console.log('📋 Existing tables:', tables.map(t => t.table_name).join(', '));
    
    // Create all necessary tables
    console.log('🏗️ Creating all required tables...');
    await createAllTables();
    
    // Create sample data
    console.log('👥 Creating sample users and projects...');
    await createSampleData();
    
    // Get the created data
    const users = await sql`SELECT id, email, first_name, last_name, role, department FROM users ORDER BY created_at LIMIT 20`;
    const projects = await sql`SELECT id, project_name, client_id FROM projects ORDER BY created_at LIMIT 10`;
    
    console.log(`✅ Found ${users.length} users and ${projects.length} projects`);
    
    // Populate communication data
    console.log('🔔 Creating notification templates...');
    await insertNotificationTemplates();
    
    console.log('📊 Generating notifications...');
    await generateNotifications(users, projects, 500);
    
    console.log('📈 Generating activities...');
    await generateActivities(users, projects, 150);
    
    console.log('📞 Generating communication logs...');
    await generateCommunicationLogs(users, projects, 200);
    
    console.log('💬 Generating in-app messages...');
    await generateInAppMessages(users, projects, 100);
    
    // Show final counts
    const counts = await sql`
      SELECT 
        (SELECT COUNT(*) FROM notifications) as notifications,
        (SELECT COUNT(*) FROM activities) as activities,
        (SELECT COUNT(*) FROM communication_logs) as comm_logs,
        (SELECT COUNT(*) FROM in_app_messages) as messages,
        (SELECT COUNT(*) FROM users) as users,
        (SELECT COUNT(*) FROM projects) as projects
    `;
    
    console.log('\n🎉 Data population completed successfully!');
    console.log('\n📊 Final Summary:');
    console.log(`- Users: ${counts[0].users}`);
    console.log(`- Projects: ${counts[0].projects}`);
    console.log(`- Notifications: ${counts[0].notifications}`);
    console.log(`- Activities: ${counts[0].activities}`);
    console.log(`- Communication Logs: ${counts[0].comm_logs}`);
    console.log(`- In-app Messages: ${counts[0].messages}`);
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

async function createAllTables() {
  // Create users table first
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) NOT NULL UNIQUE,
      password VARCHAR(255),
      first_name VARCHAR(100),
      last_name VARCHAR(100),
      role VARCHAR(50) DEFAULT 'user',
      permissions JSONB DEFAULT '[]',
      is_active BOOLEAN DEFAULT true,
      last_login TIMESTAMP,
      profile_picture TEXT,
      phone_number VARCHAR(20),
      department VARCHAR(100),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
  
  // Create clients table
  await sql`
    CREATE TABLE IF NOT EXISTS clients (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      company_name VARCHAR(255) NOT NULL,
      contact_person VARCHAR(255),
      email VARCHAR(255),
      phone VARCHAR(20),
      address TEXT,
      city VARCHAR(100),
      state VARCHAR(100),
      country VARCHAR(100) DEFAULT 'South Africa',
      postal_code VARCHAR(20),
      status VARCHAR(20) DEFAULT 'active',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
  
  // Create projects table
  await sql`
    CREATE TABLE IF NOT EXISTS projects (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      project_code VARCHAR(50) NOT NULL UNIQUE,
      project_name VARCHAR(255) NOT NULL,
      client_id UUID REFERENCES clients(id),
      description TEXT,
      project_type VARCHAR(50),
      status VARCHAR(20) DEFAULT 'planning',
      priority VARCHAR(20) DEFAULT 'medium',
      start_date DATE,
      end_date DATE,
      budget DECIMAL(15,2),
      progress_percentage INTEGER DEFAULT 0,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
  
  // Create staff table
  await sql`
    CREATE TABLE IF NOT EXISTS staff (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      employee_id VARCHAR(50) NOT NULL UNIQUE,
      user_id UUID REFERENCES users(id),
      first_name VARCHAR(100) NOT NULL,
      last_name VARCHAR(100) NOT NULL,
      email VARCHAR(255) NOT NULL UNIQUE,
      phone VARCHAR(20),
      position VARCHAR(100),
      department VARCHAR(100),
      status VARCHAR(20) DEFAULT 'active',
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
  
  // Create communication tables
  await sql`
    CREATE TABLE IF NOT EXISTS notifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      type VARCHAR(50) NOT NULL,
      category VARCHAR(50),
      priority VARCHAR(20) DEFAULT 'medium',
      user_id UUID REFERENCES users(id),
      is_global BOOLEAN DEFAULT false,
      target_roles JSONB DEFAULT '[]',
      target_departments JSONB DEFAULT '[]',
      is_read BOOLEAN DEFAULT false,
      read_at TIMESTAMP,
      is_archived BOOLEAN DEFAULT false,
      archived_at TIMESTAMP,
      action_type VARCHAR(50),
      action_url TEXT,
      action_data JSONB DEFAULT '{}',
      related_table VARCHAR(50),
      related_id UUID,
      project_id UUID REFERENCES projects(id),
      scheduled_for TIMESTAMP,
      expires_at TIMESTAMP,
      metadata JSONB DEFAULT '{}',
      template_id VARCHAR(50),
      created_by UUID REFERENCES users(id),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
  
  await sql`
    CREATE TABLE IF NOT EXISTS notification_templates (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      template_id VARCHAR(50) NOT NULL UNIQUE,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      category VARCHAR(50) NOT NULL,
      type VARCHAR(50) NOT NULL,
      priority VARCHAR(20) DEFAULT 'medium',
      title_template TEXT NOT NULL,
      message_template TEXT NOT NULL,
      action_type VARCHAR(50),
      action_url_template TEXT,
      is_active BOOLEAN DEFAULT true,
      can_user_disable BOOLEAN DEFAULT true,
      auto_archive_hours INTEGER,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;
  
  await sql`
    CREATE TABLE IF NOT EXISTS activities (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title VARCHAR(255) NOT NULL,
      description TEXT,
      activity_type VARCHAR(50) NOT NULL,
      action VARCHAR(100) NOT NULL,
      actor_type VARCHAR(20) NOT NULL,
      actor_id UUID,
      actor_name VARCHAR(255),
      target_type VARCHAR(50),
      target_id UUID,
      target_name VARCHAR(255),
      project_id UUID REFERENCES projects(id),
      impact_level VARCHAR(20) DEFAULT 'low',
      is_public BOOLEAN DEFAULT true,
      is_important BOOLEAN DEFAULT false,
      ip_address VARCHAR(45),
      metadata JSONB DEFAULT '{}',
      occurred_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;
  
  await sql`
    CREATE TABLE IF NOT EXISTS communication_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      type VARCHAR(20) NOT NULL,
      direction VARCHAR(20) NOT NULL,
      status VARCHAR(20) DEFAULT 'pending',
      from_type VARCHAR(20),
      from_id UUID,
      from_name VARCHAR(255),
      from_address VARCHAR(255),
      to_type VARCHAR(20),
      to_id UUID,
      to_name VARCHAR(255),
      to_address VARCHAR(255),
      subject VARCHAR(500),
      message TEXT NOT NULL,
      project_id UUID REFERENCES projects(id),
      priority VARCHAR(20) DEFAULT 'normal',
      provider VARCHAR(50),
      is_automated BOOLEAN DEFAULT false,
      sent_at TIMESTAMP,
      delivered_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;
  
  await sql`
    CREATE TABLE IF NOT EXISTS in_app_messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      subject VARCHAR(500),
      content TEXT NOT NULL,
      message_type VARCHAR(50) DEFAULT 'direct',
      priority VARCHAR(20) DEFAULT 'normal',
      from_user_id UUID REFERENCES users(id),
      to_user_id UUID REFERENCES users(id),
      thread_id UUID,
      is_read BOOLEAN DEFAULT false,
      read_at TIMESTAMP,
      project_id UUID REFERENCES projects(id),
      sent_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;
  
  console.log('✅ All tables created successfully');
}

async function createSampleData() {
  // Create sample users
  const sampleUsers = [
    { email: 'admin@fibreflow.com', first_name: 'Admin', last_name: 'User', role: 'admin', department: 'Management' },
    { email: 'john.smith@fibreflow.com', first_name: 'John', last_name: 'Smith', role: 'project_manager', department: 'Projects' },
    { email: 'sarah.johnson@fibreflow.com', first_name: 'Sarah', last_name: 'Johnson', role: 'project_manager', department: 'Projects' },
    { email: 'mike.davis@fibreflow.com', first_name: 'Mike', last_name: 'Davis', role: 'technician', department: 'Field Operations' },
    { email: 'lisa.wilson@fibreflow.com', first_name: 'Lisa', last_name: 'Wilson', role: 'technician', department: 'Field Operations' },
    { email: 'david.brown@fibreflow.com', first_name: 'David', last_name: 'Brown', role: 'supervisor', department: 'Operations' },
    { email: 'emma.taylor@fibreflow.com', first_name: 'Emma', last_name: 'Taylor', role: 'engineer', department: 'Engineering' },
    { email: 'alex.martinez@fibreflow.com', first_name: 'Alex', last_name: 'Martinez', role: 'quality_assurance', department: 'Quality' },
    { email: 'robert.anderson@fibreflow.com', first_name: 'Robert', last_name: 'Anderson', role: 'safety_officer', department: 'Safety' },
    { email: 'jessica.garcia@fibreflow.com', first_name: 'Jessica', last_name: 'Garcia', role: 'analyst', department: 'Analytics' },
    { email: 'michael.jones@fibreflow.com', first_name: 'Michael', last_name: 'Jones', role: 'technician', department: 'Field Operations' },
    { email: 'amanda.white@fibreflow.com', first_name: 'Amanda', last_name: 'White', role: 'coordinator', department: 'Operations' },
    { email: 'chris.lee@fibreflow.com', first_name: 'Chris', last_name: 'Lee', role: 'engineer', department: 'Engineering' },
    { email: 'jennifer.clark@fibreflow.com', first_name: 'Jennifer', last_name: 'Clark', role: 'analyst', department: 'Analytics' },
    { email: 'ryan.miller@fibreflow.com', first_name: 'Ryan', last_name: 'Miller', role: 'supervisor', department: 'Field Operations' }
  ];
  
  for (const user of sampleUsers) {
    await sql`
      INSERT INTO users (email, first_name, last_name, role, department, is_active, created_at)
      VALUES (${user.email}, ${user.first_name}, ${user.last_name}, ${user.role}, ${user.department}, true, NOW())
      ON CONFLICT (email) DO NOTHING
    `;
  }
  
  // Create sample clients
  const sampleClients = [
    { company_name: 'City Connect Fibre', contact_person: 'Tom Wilson', email: 'tom@cityconnect.co.za', phone: '+27114567890' },
    { company_name: 'MetroNet Solutions', contact_person: 'Jane Roberts', email: 'jane@metronet.co.za', phone: '+27215551234' },
    { company_name: 'FibreLink SA', contact_person: 'Peter van der Merwe', email: 'peter@fibrelink.co.za', phone: '+27312223456' },
    { company_name: 'Digital Highway', contact_person: 'Susan Davis', email: 'susan@digitalhighway.co.za', phone: '+27414445678' },
    { company_name: 'ConnectSA Networks', contact_person: 'Mark Thompson', email: 'mark@connectsa.co.za', phone: '+27116667890' }
  ];
  
  for (const client of sampleClients) {
    await sql`
      INSERT INTO clients (company_name, contact_person, email, phone, country, created_at)
      VALUES (${client.company_name}, ${client.contact_person}, ${client.email}, ${client.phone}, 'South Africa', NOW())
      ON CONFLICT DO NOTHING
    `;
  }
  
  // Get client IDs for projects
  const clients = await sql`SELECT id, company_name FROM clients LIMIT 5`;
  
  // Create sample projects
  const sampleProjects = [
    { project_code: 'JHB001', project_name: 'Johannesburg CBD Fiber Network', type: 'network_deployment' },
    { project_code: 'CPT002', project_name: 'Cape Town Residential Rollout', type: 'residential' },
    { project_code: 'DBN003', project_name: 'Durban Industrial Park Connectivity', type: 'industrial' },
    { project_code: 'PTA004', project_name: 'Pretoria University Campus Network', type: 'campus' },
    { project_code: 'PE005', project_name: 'Port Elizabeth Coastal Fiber', type: 'network_deployment' },
    { project_code: 'BFN006', project_name: 'Bloemfontein Metro Upgrade', type: 'upgrade' },
    { project_code: 'KIM007', project_name: 'Kimberley Mining District', type: 'industrial' },
    { project_code: 'NEL008', project_name: 'Nelspruit Business District', type: 'commercial' },
    { project_code: 'POL009', project_name: 'Polokwane Smart City Initiative', type: 'smart_city' },
    { project_code: 'GEO010', project_name: 'George Garden Route Network', type: 'network_deployment' }
  ];
  
  for (let i = 0; i < sampleProjects.length; i++) {
    const project = sampleProjects[i];
    const client = clients[i % clients.length];
    
    await sql`
      INSERT INTO projects (project_code, project_name, client_id, project_type, status, priority, progress_percentage, created_at)
      VALUES (${project.project_code}, ${project.project_name}, ${client.id}, ${project.type}, 
              ${getRandomItem(['planning', 'in_progress', 'on_hold', 'completed'])}, 
              ${getRandomItem(['low', 'medium', 'high'])}, 
              ${Math.floor(Math.random() * 101)}, NOW())
      ON CONFLICT (project_code) DO NOTHING
    `;
  }
  
  console.log('✅ Sample data created');
}

async function insertNotificationTemplates() {
  const templates = [
    {
      template_id: 'task_assignment',
      name: 'Task Assignment Notification',
      category: 'task',
      type: 'info',
      title_template: 'New Task Assigned: {{task_name}}',
      message_template: 'You have been assigned a new task: {{task_name}} for project {{project_name}}. Due date: {{due_date}}'
    },
    {
      template_id: 'project_milestone',
      name: 'Project Milestone Achieved',
      category: 'project',
      type: 'success',
      title_template: 'Milestone Completed: {{milestone_name}}',
      message_template: 'Congratulations! The milestone "{{milestone_name}}" has been completed for project {{project_name}}'
    },
    {
      template_id: 'deadline_reminder',
      name: 'Deadline Reminder',
      category: 'deadline',
      type: 'warning',
      title_template: 'Deadline Approaching: {{item_name}}',
      message_template: 'Reminder: {{item_name}} is due in {{time_remaining}}. Please ensure completion on time.'
    },
    {
      template_id: 'safety_alert',
      name: 'Safety Alert',
      category: 'safety',
      type: 'error',
      priority: 'urgent',
      title_template: 'Safety Alert: {{alert_title}}',
      message_template: 'URGENT: {{safety_message}}. Please take immediate action and report to your supervisor.'
    },
    {
      template_id: 'system_maintenance',
      name: 'System Maintenance Notice',
      category: 'system',
      type: 'warning',
      title_template: 'Scheduled Maintenance: {{maintenance_title}}',
      message_template: 'System maintenance is scheduled for {{maintenance_date}}. Expected downtime: {{duration}}'
    }
  ];
  
  for (const template of templates) {
    await sql`
      INSERT INTO notification_templates (
        template_id, name, category, type, priority, title_template, message_template
      ) VALUES (
        ${template.template_id}, ${template.name}, ${template.category}, ${template.type},
        ${template.priority || 'medium'}, ${template.title_template}, ${template.message_template}
      )
      ON CONFLICT (template_id) DO NOTHING
    `;
  }
  
  console.log('✅ Notification templates created');
}

async function generateNotifications(users, projects, count) {
  const types = ['info', 'warning', 'error', 'success', 'reminder'];
  const categories = ['task', 'project', 'system', 'deadline', 'achievement', 'safety', 'quality'];
  const priorities = ['low', 'medium', 'high', 'urgent'];
  
  for (let i = 0; i < count; i++) {
    const user = getRandomItem(users);
    const project = projects.length > 0 ? getRandomItem(projects) : null;
    const isRead = Math.random() < 0.7; // 70% read
    const createdAt = getBusinessHoursDate(14);
    
    const title = `${getRandomItem(['Task Update', 'Project Alert', 'System Notice', 'Deadline Reminder', 'Quality Check', 'Safety Alert', 'Team Update'])}: ${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const message = getRandomItem([
      'Your assigned task needs attention. Please review and update the progress.',
      'Project milestone has been reached. Great work from the team!',
      'System maintenance is scheduled for this weekend. Plan accordingly.',
      'Deadline approaching for fiber installation. Please prioritize.',
      'Quality inspection passed with excellent results.',
      'Safety protocol reminder: Always wear protective equipment on site.',
      'Team meeting scheduled for tomorrow at 2 PM in the main conference room.',
      'New equipment has arrived and is ready for deployment.',
      'Weather conditions may affect outdoor work today. Stay safe.',
      'Client feedback received - overall satisfaction rating: excellent.'
    ]);
    
    await sql`
      INSERT INTO notifications (
        title, message, type, category, priority, user_id, is_read, 
        read_at, project_id, created_at
      ) VALUES (
        ${title}, ${message}, ${getRandomItem(types)}, ${getRandomItem(categories)},
        ${getRandomItem(priorities)}, ${user.id}, ${isRead}, 
        ${isRead ? new Date(new Date(createdAt).getTime() + Math.random() * 86400000).toISOString() : null},
        ${project?.id || null}, ${createdAt}
      )
    `;
  }
  
  console.log(`✅ ${count} notifications created`);
}

async function generateActivities(users, projects, count) {
  const activityTypes = ['user_action', 'system_event', 'milestone', 'achievement'];
  const actions = ['created', 'updated', 'deleted', 'completed', 'assigned', 'approved', 'rejected', 'started', 'finished'];
  const targetTypes = ['project', 'task', 'document', 'user', 'equipment', 'quality_check', 'safety_inspection'];
  
  for (let i = 0; i < count; i++) {
    const user = getRandomItem(users);
    const project = projects.length > 0 ? getRandomItem(projects) : null;
    const occurredAt = getBusinessHoursDate(7);
    const action = getRandomItem(actions);
    const targetType = getRandomItem(targetTypes);
    
    const title = `${action.charAt(0).toUpperCase() + action.slice(1)} ${targetType.replace('_', ' ')} - ${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const description = getRandomItem([
      'User completed the assigned task successfully',
      'System automatically processed the request',
      'Project milestone achieved ahead of schedule',
      'Quality check completed with positive results',
      'New team member added to project',
      'Document uploaded and processed',
      'Status updated by project manager',
      'Safety inspection passed all requirements',
      'Equipment deployed and configured',
      'Client approval received for next phase'
    ]);
    
    await sql`
      INSERT INTO activities (
        title, description, activity_type, action, actor_type, actor_id,
        actor_name, target_type, target_name, project_id, impact_level,
        is_public, is_important, ip_address, occurred_at, created_at
      ) VALUES (
        ${title}, ${description}, ${getRandomItem(activityTypes)}, ${action},
        'user', ${user.id}, ${user.first_name + ' ' + user.last_name},
        ${targetType}, ${project?.project_name || 'Sample ' + targetType},
        ${project?.id || null}, ${getRandomItem(['low', 'medium', 'high'])},
        true, ${Math.random() < 0.2}, 
        ${'192.168.1.' + Math.floor(Math.random() * 254 + 1)},
        ${occurredAt}, ${occurredAt}
      )
    `;
  }
  
  console.log(`✅ ${count} activities created`);
}

async function generateCommunicationLogs(users, projects, count) {
  const types = ['email', 'sms', 'in_app', 'push'];
  const statuses = ['sent', 'delivered', 'failed', 'pending'];
  
  for (let i = 0; i < count; i++) {
    const fromUser = getRandomItem(users);
    const toUser = getRandomItem(users.filter(u => u.id !== fromUser.id));
    const project = projects.length > 0 ? getRandomItem(projects) : null;
    const type = getRandomItem(types);
    const status = getRandomItem(statuses);
    const createdAt = getBusinessHoursDate(7);
    
    let fromAddress, toAddress;
    if (type === 'email') {
      fromAddress = fromUser.email;
      toAddress = toUser.email;
    } else if (type === 'sms') {
      fromAddress = generateSAMobileNumber();
      toAddress = generateSAMobileNumber();
    }
    
    const subject = type === 'email' ? getRandomItem([
      'Project Update Required',
      'Task Assignment Notification',
      'Weekly Progress Report',
      'Quality Check Results',
      'Team Meeting Reminder',
      'System Maintenance Notice',
      'Safety Protocol Update',
      'Equipment Delivery Schedule',
      'Client Meeting Follow-up',
      'Monthly Performance Review'
    ]) : null;
    
    const message = getRandomItem([
      'Please review the latest project updates and provide your feedback.',
      'You have been assigned a new task. Check the project dashboard for details.',
      'Weekly progress report is now available for review.',
      'Quality check has been completed successfully.',
      'Reminder: Team meeting scheduled for tomorrow.',
      'System maintenance will be performed this weekend.',
      'Updated safety protocols are now in effect.',
      'Equipment delivery is scheduled for Friday morning.',
      'Following up on our client meeting discussion points.',
      'Your monthly performance review is ready for review.'
    ]);
    
    await sql`
      INSERT INTO communication_logs (
        type, direction, status, from_type, from_id, from_name, from_address,
        to_type, to_id, to_name, to_address, subject, message, project_id,
        priority, provider, is_automated, sent_at, delivered_at, created_at
      ) VALUES (
        ${type}, 'outbound', ${status}, 'user', ${fromUser.id},
        ${fromUser.first_name + ' ' + fromUser.last_name}, ${fromAddress},
        'user', ${toUser.id}, ${toUser.first_name + ' ' + toUser.last_name}, ${toAddress},
        ${subject}, ${message}, ${project?.id || null},
        ${getRandomItem(['normal', 'high', 'urgent'])}, 
        ${type === 'email' ? 'SendGrid' : type === 'sms' ? 'Twilio' : null},
        ${Math.random() < 0.4}, 
        ${status !== 'pending' ? createdAt : null},
        ${status === 'delivered' ? new Date(new Date(createdAt).getTime() + 60000).toISOString() : null},
        ${createdAt}
      )
    `;
  }
  
  console.log(`✅ ${count} communication logs created`);
}

async function generateInAppMessages(users, projects, count) {
  for (let i = 0; i < count; i++) {
    const fromUser = getRandomItem(users);
    const toUser = getRandomItem(users.filter(u => u.id !== fromUser.id));
    const project = projects.length > 0 ? getRandomItem(projects) : null;
    const isRead = Math.random() < 0.6; // 60% read
    const sentAt = getBusinessHoursDate(7);
    
    const subject = getRandomItem([
      'Project Discussion',
      'Task Clarification Needed',
      'Quality Review Feedback',
      'Schedule Update',
      'Resource Requirements',
      'Technical Question',
      'Team Coordination',
      'Client Update',
      'Safety Concern',
      'Equipment Status'
    ]);
    
    const content = getRandomItem([
      'Hi, I wanted to discuss the latest developments in the project. Can we schedule a call?',
      'I need some clarification on the task requirements. Could you provide more details?',
      'The quality review has been completed. Overall results look good with minor adjustments needed.',
      'There has been a change in the project schedule. Please review the updated timeline.',
      'We need additional resources for the next phase. Let me know your thoughts.',
      'I have a technical question about the fiber installation process. Your expertise would be helpful.',
      'Let\'s coordinate our efforts for tomorrow\'s site visit. What time works best for you?',
      'The client has requested an update on the project progress. Can you prepare the latest report?',
      'I noticed a potential safety concern at the site. We should address this immediately.',
      'The equipment status has been updated. Please check if everything is ready for deployment.'
    ]);
    
    await sql`
      INSERT INTO in_app_messages (
        subject, content, message_type, priority, from_user_id, to_user_id,
        is_read, read_at, project_id, sent_at, created_at
      ) VALUES (
        ${subject}, ${content}, 'direct', ${getRandomItem(['normal', 'high'])},
        ${fromUser.id}, ${toUser.id}, ${isRead}, 
        ${isRead ? new Date(new Date(sentAt).getTime() + Math.random() * 86400000).toISOString() : null},
        ${project?.id || null}, ${sentAt}, ${sentAt}
      )
    `;
  }
  
  console.log(`✅ ${count} in-app messages created`);
}

// Run the script
main().catch(console.error);