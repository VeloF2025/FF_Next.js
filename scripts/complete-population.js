/**
 * Complete Data Population - Finish remaining data
 */

const { neon } = require('@neondatabase/serverless');

const connectionString = process.env.DATABASE_URL || 'process.env.DATABASE_URL';
const sql = neon(connectionString);

const getRandomItem = (array) => array[Math.floor(Math.random() * array.length)];

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

const generateSAMobileNumber = () => {
  const prefixes = ['082', '083', '084', '072', '073', '074', '076', '078', '079'];
  const prefix = getRandomItem(prefixes);
  const number = Math.floor(1000000 + Math.random() * 9000000);
  return `+27${prefix.substring(1)}${number}`;
};

async function main() {
  try {
    console.log('📊 Checking current status...');
    
    const counts = await sql`
      SELECT 
        (SELECT COUNT(*) FROM notifications) as notifications,
        (SELECT COUNT(*) FROM activities) as activities,
        (SELECT COUNT(*) FROM communication_logs) as comm_logs,
        (SELECT COUNT(*) FROM in_app_messages) as messages
    `;
    
    console.log(`Current counts: ${counts[0].notifications} notifications, ${counts[0].activities} activities, ${counts[0].comm_logs} comm logs, ${counts[0].messages} messages`);
    
    const users = await sql`SELECT id, email, first_name, last_name, role, department FROM users ORDER BY created_at LIMIT 15`;
    const projects = await sql`SELECT id, project_name, client_id FROM projects ORDER BY created_at LIMIT 10`;
    
    // Complete notifications if needed
    const notifNeeded = Math.max(0, 500 - parseInt(counts[0].notifications));
    if (notifNeeded > 0) {
      console.log(`🔔 Adding ${notifNeeded} more notifications...`);
      await completeNotifications(users, projects, notifNeeded);
    }
    
    // Add activities
    if (parseInt(counts[0].activities) < 150) {
      console.log('📈 Adding activities...');
      await addActivities(users, projects, 150);
    }
    
    // Add communication logs
    if (parseInt(counts[0].comm_logs) < 250) {
      console.log('📞 Adding communication logs...');
      await addCommunicationLogs(users, projects, 250);
    }
    
    // Add in-app messages
    if (parseInt(counts[0].messages) < 100) {
      console.log('💬 Adding in-app messages...');
      await addInAppMessages(users, projects, 100);
    }
    
    // Final summary
    const finalCounts = await sql`
      SELECT 
        (SELECT COUNT(*) FROM notifications) as notifications,
        (SELECT COUNT(*) FROM activities) as activities,
        (SELECT COUNT(*) FROM communication_logs) as comm_logs,
        (SELECT COUNT(*) FROM in_app_messages) as messages
    `;
    
    console.log('\n🎉 Data population completed!');
    console.log('\n📊 Final Summary:');
    console.log(`- Notifications: ${finalCounts[0].notifications}`);
    console.log(`- Activities: ${finalCounts[0].activities}`);
    console.log(`- Communication Logs: ${finalCounts[0].comm_logs}`);
    console.log(`- In-app Messages: ${finalCounts[0].messages}`);
    
    // Show read/unread distribution
    const readStats = await sql`
      SELECT 
        COUNT(CASE WHEN is_read THEN 1 END) as read_count,
        COUNT(CASE WHEN NOT is_read THEN 1 END) as unread_count,
        ROUND(AVG(CASE WHEN is_read THEN 1 ELSE 0 END) * 100, 1) as read_percentage
      FROM notifications
    `;
    
    console.log(`\n📈 Notification Stats:`);
    console.log(`- Read: ${readStats[0].read_count} (${readStats[0].read_percentage}%)`);
    console.log(`- Unread: ${readStats[0].unread_count} (${100 - readStats[0].read_percentage}%)`);
    
  } catch (error) {
    console.error('❌ Error:', error);
  }
}

async function completeNotifications(users, projects, count) {
  const types = ['info', 'warning', 'error', 'success', 'reminder'];
  const categories = ['task', 'project', 'system', 'deadline', 'achievement', 'safety'];
  const priorities = ['low', 'medium', 'high', 'urgent'];
  
  for (let i = 0; i < count; i++) {
    const user = getRandomItem(users);
    const project = projects.length > 0 ? getRandomItem(projects) : null;
    const isRead = Math.random() < 0.7;
    const createdAt = getBusinessHoursDate(14);
    
    await sql`
      INSERT INTO notifications (
        title, message, type, category, priority, user_id, is_read, 
        read_at, project_id, created_at
      ) VALUES (
        ${'Alert: ' + Math.random().toString(36).substring(2, 8).toUpperCase()}, 
        ${'Important update regarding project progress. Please review when convenient.'},
        ${getRandomItem(types)}, ${getRandomItem(categories)}, ${getRandomItem(priorities)}, 
        ${user.id}, ${isRead}, ${isRead ? new Date().toISOString() : null}, 
        ${project?.id || null}, ${createdAt}
      )
    `;
  }
  
  console.log(`✅ ${count} notifications added`);
}

async function addActivities(users, projects, count) {
  const actions = ['created', 'updated', 'completed', 'assigned', 'approved'];
  const targetTypes = ['project', 'task', 'document', 'equipment'];
  
  for (let i = 0; i < count; i++) {
    const user = getRandomItem(users);
    const project = getRandomItem(projects);
    const occurredAt = getBusinessHoursDate(7);
    
    await sql`
      INSERT INTO activities (
        title, description, activity_type, action, actor_type, actor_id,
        actor_name, target_type, target_name, project_id, impact_level,
        is_public, is_important, occurred_at, created_at
      ) VALUES (
        ${'Activity: ' + Math.random().toString(36).substring(2, 6).toUpperCase()},
        ${'User performed an action in the system.'},
        'user_action', ${getRandomItem(actions)}, 'user', ${user.id},
        ${user.first_name + ' ' + user.last_name}, ${getRandomItem(targetTypes)},
        ${project.project_name}, ${project.id}, ${getRandomItem(['low', 'medium', 'high'])},
        true, ${Math.random() < 0.2}, ${occurredAt}, ${occurredAt}
      )
    `;
  }
  
  console.log(`✅ ${count} activities added`);
}

async function addCommunicationLogs(users, projects, count) {
  const types = ['email', 'sms'];
  
  for (let i = 0; i < count; i++) {
    const fromUser = getRandomItem(users);
    const toUser = getRandomItem(users.filter(u => u.id !== fromUser.id));
    const project = getRandomItem(projects);
    const type = getRandomItem(types);
    const createdAt = getBusinessHoursDate(7);
    
    await sql`
      INSERT INTO communication_logs (
        type, direction, status, from_type, from_id, from_name, from_address,
        to_type, to_id, to_name, to_address, subject, message, project_id,
        priority, sent_at, created_at
      ) VALUES (
        ${type}, 'outbound', 'sent', 'user', ${fromUser.id},
        ${fromUser.first_name + ' ' + fromUser.last_name}, 
        ${type === 'email' ? fromUser.email : generateSAMobileNumber()},
        'user', ${toUser.id}, ${toUser.first_name + ' ' + toUser.last_name},
        ${type === 'email' ? toUser.email : generateSAMobileNumber()},
        ${type === 'email' ? 'Project Update' : null},
        ${'Communication message regarding project activities.'},
        ${project.id}, 'normal', ${createdAt}, ${createdAt}
      )
    `;
  }
  
  console.log(`✅ ${count} communication logs added`);
}

async function addInAppMessages(users, projects, count) {
  for (let i = 0; i < count; i++) {
    const fromUser = getRandomItem(users);
    const toUser = getRandomItem(users.filter(u => u.id !== fromUser.id));
    const project = getRandomItem(projects);
    const sentAt = getBusinessHoursDate(7);
    
    await sql`
      INSERT INTO in_app_messages (
        subject, content, from_user_id, to_user_id, project_id,
        is_read, sent_at, created_at
      ) VALUES (
        ${'Message: ' + Math.random().toString(36).substring(2, 6).toUpperCase()},
        ${'In-app message regarding project coordination and updates.'},
        ${fromUser.id}, ${toUser.id}, ${project.id}, ${Math.random() < 0.6},
        ${sentAt}, ${sentAt}
      )
    `;
  }
  
  console.log(`✅ ${count} in-app messages added`);
}

main().catch(console.error);