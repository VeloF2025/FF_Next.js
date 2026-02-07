const { Client } = require('pg');
const crypto = require('crypto');

const DATABASE_URL = process.env.DATABASE_URL || 
  'process.env.DATABASE_URL';

const client = new Client({
  connectionString: DATABASE_URL,
});

function uuidv4() {
  return crypto.randomUUID();
}

function generateRandomDate(start = new Date(2022, 0, 1), end = new Date()) {
  return new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
}

function getRandomElement(array) {
  return array[Math.floor(Math.random() * array.length)];
}

function generateMD5Hash(input) {
  return crypto.createHash('md5').update(input).digest('hex');
}

async function addDocumentShares() {
  console.log('🔗 Adding document shares...');
  
  // Get existing document IDs
  const docResult = await client.query('SELECT id FROM documents LIMIT 100');
  const documentIds = docResult.rows.map(row => row.id);
  
  const shares = [];
  const shareTypes = ['link', 'email', 'user'];
  
  // Create shares for about 30% of documents
  const documentsToShare = documentIds.slice(0, Math.floor(documentIds.length * 0.3));
  
  for (const documentId of documentsToShare) {
    const share = {
      id: uuidv4(),
      share_id: `SHARE-${String(Math.floor(Math.random() * 999999)).padStart(6, '0')}`,
      document_id: documentId,
      shared_by: '00000000-0000-0000-0000-000000000001',
      share_type: getRandomElement(shareTypes),
      share_url: `https://app.fibreflow.com/shared/${uuidv4()}`,
      access_token: uuidv4(),
      shared_with_users: JSON.stringify([]),
      shared_with_emails: JSON.stringify(['partner@example.com', 'client@example.com']),
      shared_with_roles: JSON.stringify(['client', 'contractor']),
      can_view: true,
      can_download: Math.random() > 0.3,
      can_edit: false,
      can_comment: Math.random() > 0.5,
      can_share: false,
      requires_password: Math.random() > 0.7,
      password_hash: Math.random() > 0.7 ? generateMD5Hash('sharepassword123') : null,
      requires_login: Math.random() > 0.4,
      expiry_date: Math.random() > 0.6 ? new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) : null,
      max_accesses: Math.random() > 0.8 ? Math.floor(Math.random() * 50) + 10 : null,
      access_count: Math.floor(Math.random() * 20),
      is_active: Math.random() > 0.1,
      last_accessed: Math.random() > 0.3 ? generateRandomDate() : null,
      unique_accessors: JSON.stringify(['192.168.1.100', '192.168.1.101']),
      metadata: JSON.stringify({}),
      created_at: generateRandomDate(),
      updated_at: generateRandomDate()
    };
    
    shares.push(share);
  }
  
  // Insert shares in batches
  const batchSize = 25;
  for (let i = 0; i < shares.length; i += batchSize) {
    const batch = shares.slice(i, i + batchSize);
    const values = batch.map(s => {
      return `('${s.id}', '${s.share_id}', '${s.document_id}', '${s.shared_by}', '${s.share_type}', '${s.share_url}', '${s.access_token}', '${s.shared_with_users}', '${s.shared_with_emails}', '${s.shared_with_roles}', ${s.can_view}, ${s.can_download}, ${s.can_edit}, ${s.can_comment}, ${s.can_share}, ${s.requires_password}, ${s.password_hash ? `'${s.password_hash}'` : 'NULL'}, ${s.requires_login}, ${s.expiry_date ? `'${s.expiry_date.toISOString()}'` : 'NULL'}, ${s.max_accesses || 'NULL'}, ${s.access_count}, ${s.is_active}, ${s.last_accessed ? `'${s.last_accessed.toISOString()}'` : 'NULL'}, '${s.unique_accessors}', '${s.metadata}', '${s.created_at.toISOString()}', '${s.updated_at.toISOString()}')`;
    }).join(', ');
    
    await client.query(`
      INSERT INTO document_shares (id, share_id, document_id, shared_by, share_type, share_url, access_token, shared_with_users, shared_with_emails, shared_with_roles, can_view, can_download, can_edit, can_comment, can_share, requires_password, password_hash, requires_login, expiry_date, max_accesses, access_count, is_active, last_accessed, unique_accessors, metadata, created_at, updated_at)
      VALUES ${values}
      ON CONFLICT (share_id) DO NOTHING
    `);
  }
  
  console.log(`✅ Created ${shares.length} document shares`);
}

async function addDocumentComments() {
  console.log('💬 Adding document comments...');
  
  // Get some existing document IDs
  const docResult = await client.query('SELECT id FROM documents LIMIT 50');
  const documentIds = docResult.rows.map(row => row.id);
  
  const comments = [];
  const commentTypes = ['general', 'review', 'approval', 'question'];
  const sampleComments = [
    'This document looks good, approved for next phase.',
    'Please review the technical specifications in section 3.',
    'The budget allocation seems reasonable for this project.',
    'Can we get more details on the timeline?',
    'Great work on the site survey documentation.',
    'This needs to be updated with the latest client requirements.',
    'All safety protocols are properly documented.',
    'Please add more photos of the installation site.',
    'The contract terms look acceptable.',
    'We need approval from the client before proceeding.',
  ];
  
  // Create 1-3 comments per document
  for (const documentId of documentIds) {
    const commentCount = Math.floor(Math.random() * 3) + 1;
    
    for (let i = 0; i < commentCount; i++) {
      const comment = {
        id: uuidv4(),
        document_id: documentId,
        user_id: '00000000-0000-0000-0000-000000000001',
        comment_text: getRandomElement(sampleComments),
        comment_type: getRandomElement(commentTypes),
        parent_comment_id: null,
        thread_id: uuidv4(),
        page_number: Math.random() > 0.5 ? Math.floor(Math.random() * 10) + 1 : null,
        x_position: null,
        y_position: null,
        status: getRandomElement(['open', 'resolved', 'dismissed']),
        resolved_by: Math.random() > 0.6 ? '00000000-0000-0000-0000-000000000001' : null,
        resolved_date: Math.random() > 0.6 ? generateRandomDate() : null,
        resolution: Math.random() > 0.7 ? 'Issue has been addressed and resolved.' : null,
        attachments: JSON.stringify([]),
        mentions: JSON.stringify([]),
        is_private: Math.random() > 0.8,
        priority: getRandomElement(['low', 'normal', 'high']),
        metadata: JSON.stringify({}),
        created_at: generateRandomDate(),
        updated_at: generateRandomDate()
      };
      
      comments.push(comment);
    }
  }
  
  // Insert comments in batches
  const batchSize = 25;
  for (let i = 0; i < comments.length; i += batchSize) {
    const batch = comments.slice(i, i + batchSize);
    const values = batch.map(c => {
      return `('${c.id}', '${c.document_id}', '${c.user_id}', '${c.comment_text.replace(/'/g, "''")}', '${c.comment_type}', ${c.parent_comment_id ? `'${c.parent_comment_id}'` : 'NULL'}, '${c.thread_id}', ${c.page_number || 'NULL'}, ${c.x_position || 'NULL'}, ${c.y_position || 'NULL'}, '${c.status}', ${c.resolved_by ? `'${c.resolved_by}'` : 'NULL'}, ${c.resolved_date ? `'${c.resolved_date.toISOString()}'` : 'NULL'}, ${c.resolution ? `'${c.resolution.replace(/'/g, "''")}'` : 'NULL'}, '${c.attachments}', '${c.mentions}', ${c.is_private}, '${c.priority}', '${c.metadata}', '${c.created_at.toISOString()}', '${c.updated_at.toISOString()}')`;
    }).join(', ');
    
    await client.query(`
      INSERT INTO document_comments (id, document_id, user_id, comment_text, comment_type, parent_comment_id, thread_id, page_number, x_position, y_position, status, resolved_by, resolved_date, resolution, attachments, mentions, is_private, priority, metadata, created_at, updated_at)
      VALUES ${values}
    `);
  }
  
  console.log(`✅ Created ${comments.length} document comments`);
}

async function addMoreAccessLogs() {
  console.log('📊 Adding more access logs...');
  
  // Get existing document IDs
  const docResult = await client.query('SELECT id FROM documents');
  const documentIds = docResult.rows.map(row => row.id);
  
  const accessLogs = [];
  const accessTypes = ['view', 'download', 'edit', 'share'];
  const accessMethods = ['web', 'api', 'mobile'];
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 15_0 like Mac OS X) AppleWebKit/605.1.15'
  ];
  
  // Generate additional access logs for documents that have fewer than 3 logs
  const logCountQuery = await client.query(`
    SELECT document_id, COUNT(*) as log_count 
    FROM document_access_logs 
    GROUP BY document_id 
    HAVING COUNT(*) < 3
  `);
  
  for (const row of logCountQuery.rows) {
    const documentId = row.document_id;
    const neededLogs = 3 - parseInt(row.log_count);
    
    for (let i = 0; i < neededLogs; i++) {
      const accessLog = {
        id: uuidv4(),
        document_id: documentId,
        user_id: '00000000-0000-0000-0000-000000000001',
        access_type: getRandomElement(accessTypes),
        access_method: getRandomElement(accessMethods),
        ip_address: `192.168.1.${Math.floor(Math.random() * 254) + 1}`,
        user_agent: getRandomElement(userAgents),
        session_id: uuidv4(),
        request_duration: Math.floor(Math.random() * 5000) + 100,
        bytes_transferred: Math.floor(Math.random() * 1000000) + 1000,
        was_successful: Math.random() > 0.05,
        error_message: Math.random() > 0.95 ? 'Network timeout' : null,
        referer_url: '/dashboard/documents',
        device_type: getRandomElement(['desktop', 'mobile', 'tablet']),
        browser_name: getRandomElement(['Chrome', 'Firefox', 'Safari', 'Edge']),
        browser_version: `${Math.floor(Math.random() * 20) + 90}.0`,
        metadata: JSON.stringify({}),
        accessed_at: generateRandomDate()
      };
      
      accessLogs.push(accessLog);
    }
  }
  
  // Insert access logs in batches
  const batchSize = 50;
  for (let i = 0; i < accessLogs.length; i += batchSize) {
    const batch = accessLogs.slice(i, i + batchSize);
    const values = batch.map(log => 
      `('${log.id}', '${log.document_id}', '${log.user_id}', '${log.access_type}', '${log.access_method}', '${log.ip_address}', '${log.user_agent.replace(/'/g, "''")}', '${log.session_id}', ${log.request_duration}, ${log.bytes_transferred}, ${log.was_successful}, ${log.error_message ? `'${log.error_message}'` : 'NULL'}, '${log.referer_url}', '${log.device_type}', '${log.browser_name}', '${log.browser_version}', '${log.metadata}', '${log.accessed_at.toISOString()}')`
    ).join(', ');
    
    await client.query(`
      INSERT INTO document_access_logs (id, document_id, user_id, access_type, access_method, ip_address, user_agent, session_id, request_duration, bytes_transferred, was_successful, error_message, referer_url, device_type, browser_name, browser_version, metadata, accessed_at)
      VALUES ${values}
      ON CONFLICT (id) DO NOTHING
    `);
  }
  
  console.log(`✅ Created ${accessLogs.length} additional access logs`);
}

async function updateStatistics() {
  console.log('📈 Updating folder statistics...');
  
  // Update folder document counts and total sizes
  await client.query(`
    UPDATE document_folders 
    SET document_count = (
      SELECT COUNT(*) 
      FROM documents 
      WHERE documents.folder_id = document_folders.id
    ),
    total_size = (
      SELECT COALESCE(SUM(file_size), 0)
      FROM documents 
      WHERE documents.folder_id = document_folders.id
    ),
    last_activity = NOW()
    WHERE id IN (
      SELECT DISTINCT folder_id 
      FROM documents 
      WHERE folder_id IS NOT NULL
    )
  `);
  
  console.log('✅ Updated folder statistics');
}

async function main() {
  try {
    console.log('🚀 Adding additional document data...');
    
    await client.connect();
    console.log('✅ Connected to database');
    
    await addDocumentShares();
    await addDocumentComments();
    await addMoreAccessLogs();
    await updateStatistics();
    
    // Final statistics
    const results = await Promise.all([
      client.query('SELECT COUNT(*) FROM document_folders'),
      client.query('SELECT COUNT(*) FROM documents'),
      client.query('SELECT COUNT(*) FROM document_access_logs'),
      client.query('SELECT COUNT(*) FROM document_shares'),
      client.query('SELECT COUNT(*) FROM document_comments')
    ]);
    
    console.log('🎉 Document data population completed!');
    console.log('📊 Final statistics:');
    console.log(`   - Folders: ${results[0].rows[0].count}`);
    console.log(`   - Documents: ${results[1].rows[0].count}`);
    console.log(`   - Access Logs: ${results[2].rows[0].count}`);
    console.log(`   - Shares: ${results[3].rows[0].count}`);
    console.log(`   - Comments: ${results[4].rows[0].count}`);
    
    // Show some sample statistics
    const sampleStats = await client.query(`
      SELECT 
        document_type,
        category,
        COUNT(*) as count,
        AVG(file_size)::int as avg_size_bytes,
        SUM(download_count) as total_downloads
      FROM documents 
      GROUP BY document_type, category
      ORDER BY count DESC
      LIMIT 10
    `);
    
    console.log('\n📈 Document statistics by type:');
    sampleStats.rows.forEach(stat => {
      console.log(`   - ${stat.document_type}/${stat.category}: ${stat.count} docs, avg ${Math.round(stat.avg_size_bytes/1024)}KB, ${stat.total_downloads} downloads`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();