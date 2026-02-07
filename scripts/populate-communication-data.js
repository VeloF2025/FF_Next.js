/**
 * Populate Communication Data Script
 * Generates and inserts notifications, activities, and communication logs
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

// Generate random date within last N days during business hours (8 AM - 6 PM, Mon-Fri)
const getBusinessHoursDate = (daysBack = 7) => {
  const now = new Date();
  const pastDate = new Date(now.getTime() - (daysBack * 24 * 60 * 60 * 1000));
  
  // Random date between past and now
  const randomTime = pastDate.getTime() + Math.random() * (now.getTime() - pastDate.getTime());
  const date = new Date(randomTime);
  
  // Adjust to business hours if needed
  if (Math.random() > 0.3) { // 70% business hours
    const hour = 8 + Math.floor(Math.random() * 10); // 8 AM to 6 PM
    const minute = Math.floor(Math.random() * 60);
    date.setHours(hour, minute, 0, 0);
    
    // Ensure it's a weekday
    if (date.getDay() === 0) date.setDate(date.getDate() + 1); // Sunday -> Monday
    if (date.getDay() === 6) date.setDate(date.getDate() + 2); // Saturday -> Monday
  }
  
  return date.toISOString();
};

// South African mobile number format
const generateSAMobileNumber = () => {
  const prefixes = ['082', '083', '084', '072', '073', '074', '076', '078', '079'];
  const prefix = getRandomItem(prefixes);
  const number = Math.floor(1000000 + Math.random() * 9000000); // 7 digits
  return `+27${prefix.substring(1)}${number}`;
};

// Sample data
const notificationTypes = ['info', 'warning', 'error', 'success', 'reminder'];
const categories = ['task', 'project', 'system', 'deadline', 'achievement', 'safety', 'quality'];
const priorities = ['low', 'medium', 'high', 'urgent'];
const activityTypes = ['user_action', 'system_event', 'milestone', 'achievement'];
const actions = ['created', 'updated', 'deleted', 'completed', 'assigned', 'approved', 'rejected', 'started', 'finished'];

const notificationTemplates = [
  {
    template_id: 'task_assignment',
    name: 'Task Assignment Notification',
    category: 'task',
    type: 'info',
    title_template: 'New Task Assigned: {{task_name}}',
    message_template: 'You have been assigned a new task: {{task_name}} for project {{project_name}}. Due date: {{due_date}}',
    action_type: 'navigate',
    action_url_template: '/projects/{{project_id}}/tasks/{{task_id}}'
  },
  {
    template_id: 'project_milestone',
    name: 'Project Milestone Achieved',
    category: 'project',
    type: 'success',
    title_template: 'Milestone Completed: {{milestone_name}}',
    message_template: 'Congratulations! The milestone "{{milestone_name}}" has been completed for project {{project_name}}',
    action_type: 'navigate',
    action_url_template: '/projects/{{project_id}}/milestones'
  },
  {
    template_id: 'deadline_reminder',
    name: 'Deadline Reminder',
    category: 'deadline',
    type: 'warning',
    title_template: 'Deadline Approaching: {{item_name}}',
    message_template: 'Reminder: {{item_name}} is due in {{time_remaining}}. Please ensure completion on time.',
    action_type: 'navigate',
    action_url_template: '{{item_url}}'
  },
  {
    template_id: 'system_maintenance',
    name: 'System Maintenance Notice',
    category: 'system',
    type: 'warning',
    title_template: 'Scheduled Maintenance: {{maintenance_title}}',
    message_template: 'System maintenance is scheduled for {{maintenance_date}}. Expected downtime: {{duration}}',
    action_type: 'none'
  },
  {
    template_id: 'safety_alert',
    name: 'Safety Alert',
    category: 'safety',
    type: 'error',
    priority: 'urgent',
    title_template: 'Safety Alert: {{alert_title}}',
    message_template: 'URGENT: {{safety_message}}. Please take immediate action and report to your supervisor.',
    action_type: 'modal'
  }
];

const sampleActivities = [
  {
    title: 'Project Created',
    action: 'created',
    activity_type: 'user_action',
    target_type: 'project',
    impact_level: 'medium'
  },
  {
    title: 'Task Completed',
    action: 'completed',
    activity_type: 'user_action',
    target_type: 'task',
    impact_level: 'low'
  },
  {
    title: 'Milestone Achieved',
    action: 'completed',
    activity_type: 'milestone',
    target_type: 'milestone',
    impact_level: 'high',
    is_important: true
  },
  {
    title: 'Staff Member Added',
    action: 'created',
    activity_type: 'user_action',
    target_type: 'staff',
    impact_level: 'medium'
  },
  {
    title: 'Document Uploaded',
    action: 'created',
    activity_type: 'user_action',
    target_type: 'document',
    impact_level: 'low'
  },
  {
    title: 'Quality Check Passed',
    action: 'approved',
    activity_type: 'system_event',
    target_type: 'quality_check',
    impact_level: 'medium',
    is_important: true
  }
];

// Main execution function
async function populateData() {
  console.log('🚀 Starting to populate communication data...');
  
  try {
    // First, create the communication tables
    console.log('📋 Creating communication tables...');
    await createTables();
    
    // Get existing data for references
    console.log('📊 Fetching existing data...');
    const users = await sql`SELECT id, email, first_name, last_name, role, department FROM users ORDER BY created_at LIMIT 50`;
    const projects = await sql`SELECT id, project_name, client_id, project_manager FROM projects ORDER BY created_at LIMIT 20`;
    const staff = await sql`SELECT id, first_name, last_name, email, department, position FROM staff ORDER BY created_at LIMIT 30`;
    
    console.log(`Found ${users.length} users, ${projects.length} projects, ${staff.length} staff members`);
    
    if (users.length === 0) {
      console.log('⚠️ No users found. Creating sample users first...');
      await createSampleUsers();
      const newUsers = await sql`SELECT id, email, first_name, last_name, role, department FROM users ORDER BY created_at LIMIT 10`;
      users.push(...newUsers);
    }
    
    // Insert notification templates
    console.log('📝 Creating notification templates...');
    await insertNotificationTemplates();
    
    // Generate and insert notifications (500+)
    console.log('🔔 Generating notifications...');
    await generateNotifications(users, projects, 550);
    
    // Generate and insert activities (last 7 days)
    console.log('📈 Generating activity data...');
    await generateActivities(users, projects, staff, 200);
    
    // Generate and insert communication logs
    console.log('📞 Generating communication logs...');
    await generateCommunicationLogs(users, projects, 300);
    
    // Generate in-app messages
    console.log('💬 Generating in-app messages...');
    await generateInAppMessages(users, projects, 150);
    
    console.log('✅ Data population completed successfully!');
    
    // Print summary
    const notificationCount = await sql`SELECT COUNT(*) as count FROM notifications`;
    const activityCount = await sql`SELECT COUNT(*) as count FROM activities`;
    const commLogCount = await sql`SELECT COUNT(*) as count FROM communication_logs`;
    const messageCount = await sql`SELECT COUNT(*) as count FROM in_app_messages`;
    
    console.log('\n📊 Summary:');
    console.log(`- Notifications: ${notificationCount[0].count}`);
    console.log(`- Activities: ${activityCount[0].count}`);
    console.log(`- Communication Logs: ${commLogCount[0].count}`);
    console.log(`- In-app Messages: ${messageCount[0].count}`);
    
  } catch (error) {
    console.error('❌ Error populating data:', error);
    process.exit(1);
  }
}

// Create communication tables
async function createTables() {
  // Create notifications table
  await sql`
    CREATE TABLE IF NOT EXISTS notifications (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      title VARCHAR(255) NOT NULL,
      message TEXT NOT NULL,
      type VARCHAR(50) NOT NULL,
      category VARCHAR(50),
      priority VARCHAR(20) DEFAULT 'medium',
      user_id UUID,
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
      project_id UUID,
      scheduled_for TIMESTAMP,
      expires_at TIMESTAMP,
      metadata JSONB DEFAULT '{}',
      template_id VARCHAR(50),
      created_by UUID,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
  
  // Create notification_templates table
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
      default_target_roles JSONB DEFAULT '[]',
      default_target_departments JSONB DEFAULT '[]',
      variables JSONB DEFAULT '[]',
      required_variables JSONB DEFAULT '[]',
      metadata JSONB DEFAULT '{}',
      created_by UUID,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
  
  // Create activities table
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
      project_id UUID,
      team_id UUID,
      workspace_id UUID,
      changes_before JSONB,
      changes_after JSONB,
      changed_fields JSONB DEFAULT '[]',
      impact_level VARCHAR(20) DEFAULT 'low',
      is_public BOOLEAN DEFAULT true,
      is_important BOOLEAN DEFAULT false,
      ip_address VARCHAR(45),
      user_agent TEXT,
      session_id VARCHAR(255),
      request_id VARCHAR(255),
      metadata JSONB DEFAULT '{}',
      tags JSONB DEFAULT '[]',
      occurred_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW()
    )
  `;
  
  // Create communication_logs table
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
      message_format VARCHAR(20) DEFAULT 'text',
      project_id UUID,
      related_table VARCHAR(50),
      related_id UUID,
      thread_id UUID,
      parent_message_id UUID,
      sent_at TIMESTAMP,
      delivered_at TIMESTAMP,
      read_at TIMESTAMP,
      failed_at TIMESTAMP,
      error_message TEXT,
      attempt_count INTEGER DEFAULT 0,
      provider VARCHAR(50),
      external_id VARCHAR(255),
      provider_id VARCHAR(255),
      attachments JSONB DEFAULT '[]',
      media_urls JSONB DEFAULT '[]',
      priority VARCHAR(20) DEFAULT 'normal',
      is_urgent BOOLEAN DEFAULT false,
      requires_ack BOOLEAN DEFAULT false,
      acknowledged_at TIMESTAMP,
      acknowledged_by UUID,
      template_id VARCHAR(50),
      is_automated BOOLEAN DEFAULT false,
      trigger_event VARCHAR(100),
      metadata JSONB DEFAULT '{}',
      tags JSONB DEFAULT '[]',
      created_by UUID,
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
  
  // Create in_app_messages table
  await sql`
    CREATE TABLE IF NOT EXISTS in_app_messages (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      subject VARCHAR(500),
      content TEXT NOT NULL,
      message_type VARCHAR(50) DEFAULT 'direct',
      priority VARCHAR(20) DEFAULT 'normal',
      from_user_id UUID,
      to_user_id UUID,
      thread_id UUID,
      parent_message_id UUID,
      is_read BOOLEAN DEFAULT false,
      read_at TIMESTAMP,
      is_archived BOOLEAN DEFAULT false,
      archived_at TIMESTAMP,
      project_id UUID,
      related_table VARCHAR(50),
      related_id UUID,
      attachments JSONB DEFAULT '[]',
      metadata JSONB DEFAULT '{}',
      sent_at TIMESTAMP DEFAULT NOW(),
      created_at TIMESTAMP DEFAULT NOW(),
      updated_at TIMESTAMP DEFAULT NOW()
    )
  `;
  
  console.log('✅ Communication tables created successfully');
}

// Create sample users if none exist
async function createSampleUsers() {
  const sampleUsers = [
    { email: 'admin@fibreflow.com', first_name: 'Admin', last_name: 'User', role: 'admin', department: 'Management' },
    { email: 'pm1@fibreflow.com', first_name: 'John', last_name: 'Smith', role: 'project_manager', department: 'Projects' },
    { email: 'pm2@fibreflow.com', first_name: 'Sarah', last_name: 'Johnson', role: 'project_manager', department: 'Projects' },
    { email: 'tech1@fibreflow.com', first_name: 'Mike', last_name: 'Davis', role: 'technician', department: 'Field Operations' },
    { email: 'tech2@fibreflow.com', first_name: 'Lisa', last_name: 'Wilson', role: 'technician', department: 'Field Operations' },
    { email: 'supervisor@fibreflow.com', first_name: 'David', last_name: 'Brown', role: 'supervisor', department: 'Operations' },
    { email: 'engineer@fibreflow.com', first_name: 'Emma', last_name: 'Taylor', role: 'engineer', department: 'Engineering' },
    { email: 'qa@fibreflow.com', first_name: 'Alex', last_name: 'Martinez', role: 'quality_assurance', department: 'Quality' },
    { email: 'safety@fibreflow.com', first_name: 'Robert', last_name: 'Anderson', role: 'safety_officer', department: 'Safety' },
    { email: 'analyst@fibreflow.com', first_name: 'Jessica', last_name: 'Garcia', role: 'analyst', department: 'Analytics' }
  ];
  
  for (const user of sampleUsers) {
    await sql`
      INSERT INTO users (email, first_name, last_name, role, department, is_active, created_at)
      VALUES (${user.email}, ${user.first_name}, ${user.last_name}, ${user.role}, ${user.department}, true, NOW())
      ON CONFLICT (email) DO NOTHING
    `;
  }
  
  console.log('✅ Sample users created');
}

// Insert notification templates
async function insertNotificationTemplates() {
  for (const template of notificationTemplates) {
    await sql`
      INSERT INTO notification_templates (
        template_id, name, category, type, priority, title_template, 
        message_template, action_type, action_url_template, is_active,
        created_at
      ) VALUES (
        ${template.template_id}, ${template.name}, ${template.category}, 
        ${template.type}, ${template.priority || 'medium'}, ${template.title_template},
        ${template.message_template}, ${template.action_type}, ${template.action_url_template || null},
        true, NOW()
      )
      ON CONFLICT (template_id) DO NOTHING
    `;
  }
  
  console.log(`✅ ${notificationTemplates.length} notification templates inserted`);
}

// Generate notifications
async function generateNotifications(users, projects, count) {
  const notifications = [];
  
  for (let i = 0; i < count; i++) {
    const user = getRandomItem(users);
    const project = projects.length > 0 ? getRandomItem(projects) : null;
    const isRead = Math.random() < 0.7; // 70% read
    const createdAt = getBusinessHoursDate(14); // Last 14 days
    const template = getRandomItem(notificationTemplates);
    
    const notification = {
      title: `${getRandomItem(['Task Update', 'Project Alert', 'System Notice', 'Deadline Reminder', 'Quality Check', 'Safety Alert', 'Team Update'])}: ${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
      message: getRandomItem([
        'Your assigned task needs attention. Please review and update the progress.',
        'Project milestone has been reached. Great work from the team!',
        'System maintenance is scheduled for this weekend. Plan accordingly.',
        'Deadline approaching for fiber installation. Please prioritize.',
        'Quality inspection passed with excellent results.',
        'Safety protocol reminder: Always wear protective equipment.',
        'Team meeting scheduled for tomorrow at 2 PM.'
      ]),
      type: getRandomItem(notificationTypes),
      category: getRandomItem(categories),
      priority: getRandomItem(priorities),
      user_id: user.id,
      is_read: isRead,
      read_at: isRead ? new Date(new Date(createdAt).getTime() + Math.random() * 86400000).toISOString() : null,
      project_id: project?.id || null,
      template_id: template.template_id,
      created_at: createdAt
    };
    
    notifications.push(notification);
  }
  
  // Batch insert notifications
  const batchSize = 50;
  for (let i = 0; i < notifications.length; i += batchSize) {
    const batch = notifications.slice(i, i + batchSize);
    
    for (const notif of batch) {
      await sql`
        INSERT INTO notifications (
          title, message, type, category, priority, user_id, is_read, 
          read_at, project_id, template_id, created_at
        ) VALUES (
          ${notif.title}, ${notif.message}, ${notif.type}, ${notif.category},
          ${notif.priority}, ${notif.user_id}, ${notif.is_read}, ${notif.read_at},
          ${notif.project_id}, ${notif.template_id}, ${notif.created_at}
        )
      `;
    }
  }
  
  console.log(`✅ ${notifications.length} notifications inserted`);
}

// Generate activities
async function generateActivities(users, projects, staff, count) {
  const activities = [];
  
  for (let i = 0; i < count; i++) {
    const user = getRandomItem(users);
    const project = projects.length > 0 ? getRandomItem(projects) : null;
    const activityTemplate = getRandomItem(sampleActivities);
    const occurredAt = getBusinessHoursDate(7); // Last 7 days
    
    const activity = {
      title: `${activityTemplate.title} - ${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
      description: getRandomItem([
        'User completed the assigned task successfully',
        'System automatically processed the request',
        'Project milestone achieved ahead of schedule',
        'Quality check completed with positive results',
        'New team member added to project',
        'Document uploaded and processed',
        'Status updated by project manager'
      ]),
      activity_type: activityTemplate.activity_type,
      action: activityTemplate.action,
      actor_type: 'user',
      actor_id: user.id,
      actor_name: `${user.first_name} ${user.last_name}`,
      target_type: activityTemplate.target_type,
      target_id: project?.id || null,
      target_name: project?.project_name || `Sample ${activityTemplate.target_type}`,
      project_id: project?.id || null,
      impact_level: activityTemplate.impact_level,
      is_public: true,
      is_important: activityTemplate.is_important || false,
      ip_address: `192.168.1.${Math.floor(Math.random() * 254) + 1}`,
      occurred_at: occurredAt,
      created_at: occurredAt
    };
    
    activities.push(activity);
  }
  
  // Batch insert activities
  for (const activity of activities) {
    await sql`
      INSERT INTO activities (
        title, description, activity_type, action, actor_type, actor_id,
        actor_name, target_type, target_id, target_name, project_id,
        impact_level, is_public, is_important, ip_address, occurred_at, created_at
      ) VALUES (
        ${activity.title}, ${activity.description}, ${activity.activity_type},
        ${activity.action}, ${activity.actor_type}, ${activity.actor_id},
        ${activity.actor_name}, ${activity.target_type}, ${activity.target_id},
        ${activity.target_name}, ${activity.project_id}, ${activity.impact_level},
        ${activity.is_public}, ${activity.is_important}, ${activity.ip_address},
        ${activity.occurred_at}, ${activity.created_at}
      )
    `;
  }
  
  console.log(`✅ ${activities.length} activities inserted`);
}

// Generate communication logs
async function generateCommunicationLogs(users, projects, count) {
  const commLogs = [];
  const communicationTypes = ['email', 'sms', 'in_app', 'push'];
  const statuses = ['sent', 'delivered', 'failed', 'pending'];
  
  for (let i = 0; i < count; i++) {
    const fromUser = getRandomItem(users);
    const toUser = getRandomItem(users.filter(u => u.id !== fromUser.id));
    const project = projects.length > 0 ? getRandomItem(projects) : null;
    const type = getRandomItem(communicationTypes);
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
    
    const commLog = {
      type: type,
      direction: 'outbound',
      status: status,
      from_type: 'user',
      from_id: fromUser.id,
      from_name: `${fromUser.first_name} ${fromUser.last_name}`,
      from_address: fromAddress,
      to_type: 'user',
      to_id: toUser.id,
      to_name: `${toUser.first_name} ${toUser.last_name}`,
      to_address: toAddress,
      subject: type === 'email' ? getRandomItem([
        'Project Update Required',
        'Task Assignment Notification',
        'Weekly Progress Report',
        'Quality Check Results',
        'Team Meeting Reminder',
        'System Maintenance Notice'
      ]) : null,
      message: getRandomItem([
        'Please review the latest project updates and provide your feedback.',
        'You have been assigned a new task. Check the project dashboard for details.',
        'Weekly progress report is now available for review.',
        'Quality check has been completed successfully.',
        'Reminder: Team meeting scheduled for tomorrow.',
        'System maintenance will be performed this weekend.'
      ]),
      project_id: project?.id || null,
      priority: getRandomItem(['normal', 'high', 'urgent']),
      provider: type === 'email' ? 'SendGrid' : type === 'sms' ? 'Twilio' : null,
      is_automated: Math.random() < 0.4, // 40% automated
      sent_at: status !== 'pending' ? createdAt : null,
      delivered_at: status === 'delivered' ? new Date(new Date(createdAt).getTime() + 60000).toISOString() : null,
      created_at: createdAt
    };
    
    commLogs.push(commLog);
  }
  
  // Batch insert communication logs
  for (const log of commLogs) {
    await sql`
      INSERT INTO communication_logs (
        type, direction, status, from_type, from_id, from_name, from_address,
        to_type, to_id, to_name, to_address, subject, message, project_id,
        priority, provider, is_automated, sent_at, delivered_at, created_at
      ) VALUES (
        ${log.type}, ${log.direction}, ${log.status}, ${log.from_type}, ${log.from_id},
        ${log.from_name}, ${log.from_address}, ${log.to_type}, ${log.to_id},
        ${log.to_name}, ${log.to_address}, ${log.subject}, ${log.message},
        ${log.project_id}, ${log.priority}, ${log.provider}, ${log.is_automated},
        ${log.sent_at}, ${log.delivered_at}, ${log.created_at}
      )
    `;
  }
  
  console.log(`✅ ${commLogs.length} communication logs inserted`);
}

// Generate in-app messages
async function generateInAppMessages(users, projects, count) {
  const messages = [];
  
  for (let i = 0; i < count; i++) {
    const fromUser = getRandomItem(users);
    const toUser = getRandomItem(users.filter(u => u.id !== fromUser.id));
    const project = projects.length > 0 ? getRandomItem(projects) : null;
    const isRead = Math.random() < 0.6; // 60% read
    const sentAt = getBusinessHoursDate(7);
    
    const message = {
      subject: getRandomItem([
        'Project Discussion',
        'Task Clarification Needed',
        'Quality Review Feedback',
        'Schedule Update',
        'Resource Requirements',
        'Technical Question'
      ]),
      content: getRandomItem([
        'Hi, I wanted to discuss the latest developments in the project. Can we schedule a call?',
        'I need some clarification on the task requirements. Could you provide more details?',
        'The quality review has been completed. Overall results look good with minor adjustments needed.',
        'There has been a change in the project schedule. Please review the updated timeline.',
        'We need additional resources for the next phase. Let me know your thoughts.',
        'I have a technical question about the fiber installation process. Your expertise would be helpful.'
      ]),
      message_type: 'direct',
      priority: getRandomItem(['normal', 'high']),
      from_user_id: fromUser.id,
      to_user_id: toUser.id,
      is_read: isRead,
      read_at: isRead ? new Date(new Date(sentAt).getTime() + Math.random() * 86400000).toISOString() : null,
      project_id: project?.id || null,
      sent_at: sentAt,
      created_at: sentAt
    };
    
    messages.push(message);
  }
  
  // Batch insert messages
  for (const msg of messages) {
    await sql`
      INSERT INTO in_app_messages (
        subject, content, message_type, priority, from_user_id, to_user_id,
        is_read, read_at, project_id, sent_at, created_at
      ) VALUES (
        ${msg.subject}, ${msg.content}, ${msg.message_type}, ${msg.priority},
        ${msg.from_user_id}, ${msg.to_user_id}, ${msg.is_read}, ${msg.read_at},
        ${msg.project_id}, ${msg.sent_at}, ${msg.created_at}
      )
    `;
  }
  
  console.log(`✅ ${messages.length} in-app messages inserted`);
}

// Run the script
if (require.main === module) {
  populateData().catch(console.error);
}

module.exports = { populateData };