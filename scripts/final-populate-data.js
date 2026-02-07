/**
 * Final Data Population Script - Corrected for Existing Schema
 * Populates notifications, activities, and communication logs with realistic data
 */

const { neon } = require('@neondatabase/serverless');

// Database connection
const connectionString = process.env.DATABASE_URL || 'process.env.DATABASE_URL';
const sql = neon(connectionString);

// Utility functions
const getRandomItem = (array) => array[Math.floor(Math.random() * array.length)];

// Generate random date within last N days during business hours
const getBusinessHoursDate = (daysBack = 7) => {
  const now = new Date();
  const pastDate = new Date(now.getTime() - (daysBack * 24 * 60 * 60 * 1000));
  
  const randomTime = pastDate.getTime() + Math.random() * (now.getTime() - pastDate.getTime());
  const date = new Date(randomTime);
  
  if (Math.random() > 0.3) { // 70% business hours
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
  console.log('🚀 Starting final data population...');
  
  try {
    // Check existing data
    console.log('📊 Checking existing data...');
    const userCount = await sql`SELECT COUNT(*) as count FROM users`;
    const clientCount = await sql`SELECT COUNT(*) as count FROM clients`;
    const projectCount = await sql`SELECT COUNT(*) as count FROM projects`;
    
    console.log(`Found ${userCount[0].count} users, ${clientCount[0].count} clients, ${projectCount[0].count} projects`);
    
    // Create sample data if none exists
    if (parseInt(userCount[0].count) === 0) {
      console.log('👥 Creating sample users...');
      await createSampleUsers();
    }
    
    if (parseInt(clientCount[0].count) === 0) {
      console.log('🏢 Creating sample clients...');
      await createSampleClients();
    }
    
    if (parseInt(projectCount[0].count) === 0) {
      console.log('📁 Creating sample projects...');
      await createSampleProjects();
    }
    
    // Get data for population
    const users = await sql`SELECT id, email, first_name, last_name, role, department FROM users ORDER BY created_at LIMIT 20`;
    const projects = await sql`SELECT id, project_name, client_id, project_manager FROM projects ORDER BY created_at LIMIT 15`;
    
    console.log(`Working with ${users.length} users and ${projects.length} projects`);
    
    // Clear existing communication data to avoid duplicates
    console.log('🧹 Clearing existing communication data...');
    await sql`DELETE FROM notifications`;
    await sql`DELETE FROM activities`;
    await sql`DELETE FROM communication_logs`;
    await sql`DELETE FROM in_app_messages`;
    await sql`DELETE FROM notification_templates`;
    
    // Populate data
    console.log('📝 Creating notification templates...');
    await insertNotificationTemplates();
    
    console.log('🔔 Generating notifications...');
    await generateNotifications(users, projects, 550);
    
    console.log('📈 Generating activities...');
    await generateActivities(users, projects, 200);
    
    console.log('📞 Generating communication logs...');
    await generateCommunicationLogs(users, projects, 300);
    
    console.log('💬 Generating in-app messages...');
    await generateInAppMessages(users, projects, 150);
    
    // Show final summary
    const summary = await sql`
      SELECT 
        (SELECT COUNT(*) FROM notifications) as notifications,
        (SELECT COUNT(*) FROM activities) as activities,
        (SELECT COUNT(*) FROM communication_logs) as comm_logs,
        (SELECT COUNT(*) FROM in_app_messages) as messages,
        (SELECT COUNT(*) FROM notification_templates) as templates
    `;
    
    console.log('\n🎉 Data population completed successfully!');
    console.log('\n📊 Final Summary:');
    console.log(`- Notification Templates: ${summary[0].templates}`);
    console.log(`- Notifications: ${summary[0].notifications}`);
    console.log(`- Activities: ${summary[0].activities}`);
    console.log(`- Communication Logs: ${summary[0].comm_logs}`);
    console.log(`- In-app Messages: ${summary[0].messages}`);
    
    // Show distribution
    console.log('\n📈 Notification Distribution:');
    const notifStats = await sql`
      SELECT 
        type,
        COUNT(*) as count,
        ROUND(AVG(CASE WHEN is_read THEN 1 ELSE 0 END) * 100, 1) as read_percentage
      FROM notifications 
      GROUP BY type 
      ORDER BY count DESC
    `;
    
    notifStats.forEach(stat => {
      console.log(`- ${stat.type}: ${stat.count} (${stat.read_percentage}% read)`);
    });
    
    console.log('\n📊 Activity Distribution:');
    const activityStats = await sql`
      SELECT 
        activity_type,
        COUNT(*) as count,
        COUNT(CASE WHEN is_important THEN 1 END) as important_count
      FROM activities 
      GROUP BY activity_type 
      ORDER BY count DESC
    `;
    
    activityStats.forEach(stat => {
      console.log(`- ${stat.activity_type}: ${stat.count} (${stat.important_count} important)`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

async function createSampleUsers() {
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
  
  console.log(`✅ ${sampleUsers.length} users created`);
}

async function createSampleClients() {
  const sampleClients = [
    { client_code: 'CCF001', client_name: 'City Connect Fibre', contact_person: 'Tom Wilson', email: 'tom@cityconnect.co.za', phone: '+27114567890' },
    { client_code: 'MNS002', client_name: 'MetroNet Solutions', contact_person: 'Jane Roberts', email: 'jane@metronet.co.za', phone: '+27215551234' },
    { client_code: 'FLS003', client_name: 'FibreLink SA', contact_person: 'Peter van der Merwe', email: 'peter@fibrelink.co.za', phone: '+27312223456' },
    { client_code: 'DHW004', client_name: 'Digital Highway', contact_person: 'Susan Davis', email: 'susan@digitalhighway.co.za', phone: '+27414445678' },
    { client_code: 'CSN005', client_name: 'ConnectSA Networks', contact_person: 'Mark Thompson', email: 'mark@connectsa.co.za', phone: '+27116667890' },
    { client_code: 'FNT006', client_name: 'Fibre Network Technologies', contact_person: 'Linda van Zyl', email: 'linda@fnt.co.za', phone: '+27218889999' },
    { client_code: 'ULC007', client_name: 'Ultra Link Communications', contact_person: 'James Mthembu', email: 'james@ultralink.co.za', phone: '+27317774444' }
  ];
  
  for (const client of sampleClients) {
    await sql`
      INSERT INTO clients (client_code, client_name, contact_person, email, phone, country, status, created_at)
      VALUES (${client.client_code}, ${client.client_name}, ${client.contact_person}, ${client.email}, ${client.phone}, 'South Africa', 'active', NOW())
      ON CONFLICT (client_code) DO NOTHING
    `;
  }
  
  console.log(`✅ ${sampleClients.length} clients created`);
}

async function createSampleProjects() {
  const clients = await sql`SELECT id, client_name FROM clients`;
  
  const sampleProjects = [
    { project_code: 'JHB001', project_name: 'Johannesburg CBD Fiber Network', type: 'network_deployment', location: 'Johannesburg CBD' },
    { project_code: 'CPT002', project_name: 'Cape Town Residential Rollout', type: 'residential', location: 'Cape Town' },
    { project_code: 'DBN003', project_name: 'Durban Industrial Park Connectivity', type: 'industrial', location: 'Durban' },
    { project_code: 'PTA004', project_name: 'Pretoria University Campus Network', type: 'campus', location: 'Pretoria' },
    { project_code: 'PE005', project_name: 'Port Elizabeth Coastal Fiber', type: 'network_deployment', location: 'Port Elizabeth' },
    { project_code: 'BFN006', project_name: 'Bloemfontein Metro Upgrade', type: 'upgrade', location: 'Bloemfontein' },
    { project_code: 'KIM007', project_name: 'Kimberley Mining District', type: 'industrial', location: 'Kimberley' },
    { project_code: 'NEL008', project_name: 'Nelspruit Business District', type: 'commercial', location: 'Nelspruit' },
    { project_code: 'POL009', project_name: 'Polokwane Smart City Initiative', type: 'smart_city', location: 'Polokwane' },
    { project_code: 'GEO010', project_name: 'George Garden Route Network', type: 'network_deployment', location: 'George' },
    { project_code: 'ELZ011', project_name: 'East London Coastal Expansion', type: 'expansion', location: 'East London' },
    { project_code: 'RUS012', project_name: 'Rustenburg Mining Connectivity', type: 'industrial', location: 'Rustenburg' }
  ];
  
  const users = await sql`SELECT id, first_name, last_name FROM users WHERE role IN ('project_manager', 'admin') LIMIT 10`;
  
  for (let i = 0; i < sampleProjects.length; i++) {
    const project = sampleProjects[i];
    const client = clients[i % clients.length];
    const manager = users[i % users.length];
    
    await sql`
      INSERT INTO projects (
        project_code, project_name, client_id, project_type, status, priority, 
        progress, project_manager, location, created_at
      ) VALUES (
        ${project.project_code}, ${project.project_name}, ${client.id}, ${project.type}, 
        ${getRandomItem(['planning', 'in_progress', 'on_hold', 'completed', 'review'])}, 
        ${getRandomItem(['low', 'medium', 'high'])}, 
        ${Math.floor(Math.random() * 101)}, 
        ${manager.first_name + ' ' + manager.last_name},
        ${project.location}, NOW()
      )
      ON CONFLICT (project_code) DO NOTHING
    `;
  }
  
  console.log(`✅ ${sampleProjects.length} projects created`);
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
    },
    {
      template_id: 'quality_check',
      name: 'Quality Check Notification',
      category: 'quality',
      type: 'info',
      title_template: 'Quality Check: {{check_type}}',
      message_template: 'Quality check for {{item_name}} has been {{status}}. Please review the details.'
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
  
  console.log(`✅ ${templates.length} notification templates created`);
}

async function generateNotifications(users, projects, count) {
  const types = ['info', 'warning', 'error', 'success', 'reminder'];
  const categories = ['task', 'project', 'system', 'deadline', 'achievement', 'safety', 'quality'];
  const priorities = ['low', 'medium', 'high', 'urgent'];
  
  const titlePrefixes = [
    'Task Update', 'Project Alert', 'System Notice', 'Deadline Reminder', 
    'Quality Check', 'Safety Alert', 'Team Update', 'Equipment Status',
    'Client Update', 'Progress Report', 'Maintenance Notice', 'Achievement'
  ];
  
  const messages = [
    'Your assigned task needs attention. Please review and update the progress.',
    'Project milestone has been reached. Great work from the team!',
    'System maintenance is scheduled for this weekend. Plan accordingly.',
    'Deadline approaching for fiber installation. Please prioritize this task.',
    'Quality inspection passed with excellent results. Well done!',
    'Safety protocol reminder: Always wear protective equipment on site.',
    'Team meeting scheduled for tomorrow at 2 PM in the main conference room.',
    'New equipment has arrived and is ready for deployment.',
    'Weather conditions may affect outdoor work today. Stay safe.',
    'Client feedback received - overall satisfaction rating: excellent.',
    'Progress report has been submitted and is awaiting review.',
    'Maintenance window completed successfully. All systems operational.',
    'Certificate expires in 30 days. Please renew to avoid service interruption.',
    'Budget milestone reached. Please review current expenditure.',
    'New safety guidelines have been published. Training required.',
    'Performance review scheduled for next week. Please prepare documentation.',
    'Site access permissions updated. Check your credentials.',
    'Fiber testing completed with positive results across all segments.',
    'Customer installation scheduled for tomorrow morning.',
    'Emergency contact information needs to be updated in your profile.'
  ];
  
  for (let i = 0; i < count; i++) {
    const user = getRandomItem(users);
    const project = projects.length > 0 ? getRandomItem(projects) : null;
    const isRead = Math.random() < 0.7; // 70% read as requested
    const createdAt = getBusinessHoursDate(14);
    const readAt = isRead ? new Date(new Date(createdAt).getTime() + Math.random() * 86400000 * 2).toISOString() : null;
    
    const title = `${getRandomItem(titlePrefixes)}: ${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const message = getRandomItem(messages);
    const type = getRandomItem(types);
    const category = getRandomItem(categories);
    const priority = getRandomItem(priorities);
    
    await sql`
      INSERT INTO notifications (
        title, message, type, category, priority, user_id, is_read, 
        read_at, project_id, created_at
      ) VALUES (
        ${title}, ${message}, ${type}, ${category}, ${priority}, 
        ${user.id}, ${isRead}, ${readAt}, ${project?.id || null}, ${createdAt}
      )
    `;
  }
  
  console.log(`✅ ${count} notifications created`);
}

async function generateActivities(users, projects, count) {
  const activityTypes = ['user_action', 'system_event', 'milestone', 'achievement'];
  const actions = ['created', 'updated', 'deleted', 'completed', 'assigned', 'approved', 'rejected', 'started', 'finished'];
  const targetTypes = ['project', 'task', 'document', 'user', 'equipment', 'quality_check', 'safety_inspection', 'client_meeting'];
  
  const descriptions = [
    'User completed the assigned task successfully within the deadline.',
    'System automatically processed the request and updated all related records.',
    'Project milestone achieved ahead of schedule with excellent quality standards.',
    'Quality check completed with positive results and no issues identified.',
    'New team member added to project and given appropriate access permissions.',
    'Document uploaded and processed through the approval workflow.',
    'Status updated by project manager based on field team feedback.',
    'Safety inspection passed all requirements and compliance standards.',
    'Equipment deployed and configured according to technical specifications.',
    'Client approval received for next phase of project implementation.',
    'Performance metrics updated based on latest field data collection.',
    'Training session completed with all participants meeting requirements.',
    'Budget allocation approved and funds released for project continuation.',
    'Site survey completed with detailed findings and recommendations.',
    'Technical review passed with minor suggestions for improvement.'
  ];
  
  for (let i = 0; i < count; i++) {
    const user = getRandomItem(users);
    const project = projects.length > 0 ? getRandomItem(projects) : null;
    const occurredAt = getBusinessHoursDate(7); // Last 7 days as requested
    const action = getRandomItem(actions);
    const targetType = getRandomItem(targetTypes);
    const isImportant = Math.random() < 0.2; // 20% important
    
    const title = `${action.charAt(0).toUpperCase() + action.slice(1)} ${targetType.replace('_', ' ')} - ${Math.random().toString(36).substring(2, 8).toUpperCase()}`;
    const description = getRandomItem(descriptions);
    
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
        true, ${isImportant}, 
        ${'192.168.1.' + (Math.floor(Math.random() * 254) + 1)},
        ${occurredAt}, ${occurredAt}
      )
    `;
  }
  
  console.log(`✅ ${count} activities created`);
}

async function generateCommunicationLogs(users, projects, count) {
  const types = ['email', 'sms', 'in_app', 'push'];
  const statuses = ['sent', 'delivered', 'failed', 'pending'];
  const priorities = ['normal', 'high', 'urgent'];
  
  const emailSubjects = [
    'Project Update Required - Immediate Action Needed',
    'Task Assignment Notification - New Responsibilities',
    'Weekly Progress Report - Review Required',
    'Quality Check Results - Excellent Performance',
    'Team Meeting Reminder - Tomorrow 2 PM',
    'System Maintenance Notice - Weekend Schedule',
    'Safety Protocol Update - New Requirements',
    'Equipment Delivery Schedule - Friday Morning',
    'Client Meeting Follow-up - Action Items',
    'Monthly Performance Review - Preparation Required'
  ];
  
  const messages = [
    'Please review the latest project updates and provide your feedback by end of day.',
    'You have been assigned a new task. Check the project dashboard for detailed specifications.',
    'Weekly progress report is now available for review. Please submit your comments.',
    'Quality check has been completed successfully. All standards have been met.',
    'Reminder: Team meeting scheduled for tomorrow at 2 PM in conference room A.',
    'System maintenance will be performed this weekend from 6 PM to 6 AM.',
    'Updated safety protocols are now in effect. Please review the new requirements.',
    'Equipment delivery is scheduled for Friday morning. Please ensure site access.',
    'Following up on our client meeting discussion points. Action required.',
    'Your monthly performance review is ready. Please schedule a meeting to discuss.'
  ];
  
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
    
    const subject = type === 'email' ? getRandomItem(emailSubjects) : null;
    const message = getRandomItem(messages);
    const priority = getRandomItem(priorities);
    
    const sentAt = status !== 'pending' ? createdAt : null;
    const deliveredAt = status === 'delivered' ? 
      new Date(new Date(createdAt).getTime() + Math.random() * 300000).toISOString() : // 0-5 minutes later
      null;
    
    await sql`
      INSERT INTO communication_logs (
        type, direction, status, from_type, from_id, from_name, from_address,
        to_type, to_id, to_name, to_address, subject, message, project_id,
        priority, provider, is_automated, sent_at, delivered_at, created_at
      ) VALUES (
        ${type}, 'outbound', ${status}, 'user', ${fromUser.id},
        ${fromUser.first_name + ' ' + fromUser.last_name}, ${fromAddress},
        'user', ${toUser.id}, ${toUser.first_name + ' ' + toUser.last_name}, ${toAddress},
        ${subject}, ${message}, ${project?.id || null}, ${priority}, 
        ${type === 'email' ? 'SendGrid' : type === 'sms' ? 'Twilio' : null},
        ${Math.random() < 0.4}, ${sentAt}, ${deliveredAt}, ${createdAt}
      )
    `;
  }
  
  console.log(`✅ ${count} communication logs created`);
}

async function generateInAppMessages(users, projects, count) {
  const subjects = [
    'Project Discussion - Status Update',
    'Task Clarification Needed - Urgent',
    'Quality Review Feedback - Positive Results',
    'Schedule Update - Timeline Changes',
    'Resource Requirements - Additional Support',
    'Technical Question - Expert Input Needed',
    'Team Coordination - Site Visit Planning',
    'Client Update - Satisfaction Survey',
    'Safety Concern - Immediate Attention',
    'Equipment Status - Deployment Ready'
  ];
  
  const contents = [
    'Hi, I wanted to discuss the latest developments in the project. The client is very pleased with our progress so far. Can we schedule a call to review the next milestones?',
    'I need some clarification on the task requirements. The technical specifications seem to have some conflicting information. Could you provide more details or clarify the approach?',
    'The quality review has been completed and I\'m happy to report excellent results. Overall performance exceeded expectations with only minor adjustments needed for optimization.',
    'There has been a change in the project schedule due to client requirements. Please review the updated timeline and let me know if this impacts your current workload.',
    'We need additional resources for the next phase of implementation. The scope has expanded slightly and we want to maintain our quality standards. Let me know your thoughts.',
    'I have a technical question about the fiber installation process in this specific environment. Your expertise with similar installations would be really helpful here.',
    'Let\'s coordinate our efforts for tomorrow\'s site visit. I suggest we meet at 8 AM at the main entrance. What time works best for your team schedule?',
    'The client has requested a progress update and overall they\'re very satisfied with our work. They\'ve specifically mentioned the professionalism of our field team.',
    'I noticed a potential safety concern at the installation site that needs immediate attention. We should address this before proceeding with the next phase of work.',
    'Equipment status has been updated and everything is ready for deployment. All testing has been completed successfully and we can proceed with the installation.'
  ];
  
  for (let i = 0; i < count; i++) {
    const fromUser = getRandomItem(users);
    const toUser = getRandomItem(users.filter(u => u.id !== fromUser.id));
    const project = projects.length > 0 ? getRandomItem(projects) : null;
    const isRead = Math.random() < 0.6; // 60% read
    const sentAt = getBusinessHoursDate(7);
    const readAt = isRead ? 
      new Date(new Date(sentAt).getTime() + Math.random() * 86400000 * 2).toISOString() : 
      null;
    
    const subject = getRandomItem(subjects);
    const content = getRandomItem(contents);
    const priority = getRandomItem(['normal', 'high']);
    
    await sql`
      INSERT INTO in_app_messages (
        subject, content, message_type, priority, from_user_id, to_user_id,
        is_read, read_at, project_id, sent_at, created_at
      ) VALUES (
        ${subject}, ${content}, 'direct', ${priority}, ${fromUser.id}, ${toUser.id}, 
        ${isRead}, ${readAt}, ${project?.id || null}, ${sentAt}, ${sentAt}
      )
    `;
  }
  
  console.log(`✅ ${count} in-app messages created`);
}

// Run the script
main().catch(console.error);