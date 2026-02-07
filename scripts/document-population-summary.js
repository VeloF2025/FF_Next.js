const { Client } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL || 
  'process.env.DATABASE_URL';

const client = new Client({
  connectionString: DATABASE_URL,
});

async function generateComprehensiveReport() {
  try {
    console.log('📊 FIBREFLOW DOCUMENT MANAGEMENT SYSTEM - POPULATION REPORT');
    console.log('='.repeat(70));
    
    await client.connect();
    
    // 1. Overall Statistics
    console.log('\n1. OVERALL STATISTICS');
    console.log('-'.repeat(30));
    
    const overallStats = await Promise.all([
      client.query('SELECT COUNT(*) as count FROM document_folders'),
      client.query('SELECT COUNT(*) as count FROM documents'),
      client.query('SELECT COUNT(*) as count FROM document_access_logs'),
      client.query('SELECT COUNT(*) as count FROM document_shares'),
      client.query('SELECT COUNT(*) as count FROM document_comments')
    ]);
    
    console.log(`📁 Document Folders: ${overallStats[0].rows[0].count}`);
    console.log(`📄 Documents: ${overallStats[1].rows[0].count}`);
    console.log(`📊 Access Logs: ${overallStats[2].rows[0].count}`);
    console.log(`🔗 Document Shares: ${overallStats[3].rows[0].count}`);
    console.log(`💬 Comments: ${overallStats[4].rows[0].count}`);
    
    // 2. Document Types and Categories
    console.log('\n2. DOCUMENT BREAKDOWN BY TYPE');
    console.log('-'.repeat(40));
    
    const docTypes = await client.query(`
      SELECT 
        document_type,
        category,
        COUNT(*) as count,
        ROUND(AVG(file_size)/1024) as avg_size_kb,
        SUM(download_count) as total_downloads,
        SUM(view_count) as total_views
      FROM documents 
      GROUP BY document_type, category
      ORDER BY count DESC
    `);
    
    docTypes.rows.forEach(type => {
      console.log(`   ${type.document_type}/${type.category}: ${type.count} docs | ${type.avg_size_kb}KB avg | ${type.total_downloads} downloads | ${type.total_views} views`);
    });
    
    // 3. File Types and Sizes
    console.log('\n3. FILE FORMATS AND SIZES');
    console.log('-'.repeat(35));
    
    const fileTypes = await client.query(`
      SELECT 
        file_extension,
        mime_type,
        COUNT(*) as count,
        ROUND(AVG(file_size)/1024) as avg_size_kb,
        ROUND(SUM(file_size)::numeric/1024/1024, 2) as total_size_mb
      FROM documents 
      GROUP BY file_extension, mime_type
      ORDER BY count DESC
    `);
    
    fileTypes.rows.forEach(type => {
      console.log(`   .${type.file_extension} (${type.mime_type}): ${type.count} files | ${type.avg_size_kb}KB avg | ${type.total_size_mb}MB total`);
    });
    
    // 4. Folder Structure
    console.log('\n4. FOLDER STRUCTURE');
    console.log('-'.repeat(25));
    
    const folders = await client.query(`
      SELECT 
        folder_name,
        folder_type,
        document_count,
        ROUND(total_size::numeric/1024/1024, 2) as total_size_mb
      FROM document_folders 
      WHERE parent_folder_id IS NOT NULL
      ORDER BY document_count DESC
    `);
    
    folders.rows.forEach(folder => {
      console.log(`   📁 ${folder.folder_name} (${folder.folder_type}): ${folder.document_count} docs | ${folder.total_size_mb}MB`);
    });
    
    // 5. Access Patterns
    console.log('\n5. ACCESS PATTERNS');
    console.log('-'.repeat(25));
    
    const accessStats = await client.query(`
      SELECT 
        access_type,
        COUNT(*) as count,
        ROUND(AVG(request_duration)) as avg_duration_ms,
        COUNT(CASE WHEN was_successful = false THEN 1 END) as failures
      FROM document_access_logs 
      GROUP BY access_type
      ORDER BY count DESC
    `);
    
    accessStats.rows.forEach(stat => {
      const successRate = ((stat.count - stat.failures) / stat.count * 100).toFixed(1);
      console.log(`   ${stat.access_type.toUpperCase()}: ${stat.count} requests | ${stat.avg_duration_ms}ms avg | ${successRate}% success rate`);
    });
    
    // 6. Document Sharing
    console.log('\n6. DOCUMENT SHARING');
    console.log('-'.repeat(25));
    
    const sharingStats = await client.query(`
      SELECT 
        share_type,
        COUNT(*) as count,
        COUNT(CASE WHEN is_active = true THEN 1 END) as active_shares,
        AVG(access_count) as avg_accesses
      FROM document_shares 
      GROUP BY share_type
      ORDER BY count DESC
    `);
    
    if (sharingStats.rows.length > 0) {
      sharingStats.rows.forEach(stat => {
        console.log(`   ${stat.share_type.toUpperCase()}: ${stat.count} shares | ${stat.active_shares} active | ${Math.round(stat.avg_accesses)} avg accesses`);
      });
    } else {
      console.log('   No document shares found');
    }
    
    // 7. Document Comments
    console.log('\n7. DOCUMENT COMMENTS');
    console.log('-'.repeat(25));
    
    const commentStats = await client.query(`
      SELECT 
        comment_type,
        COUNT(*) as count,
        COUNT(CASE WHEN status = 'resolved' THEN 1 END) as resolved,
        COUNT(CASE WHEN status = 'open' THEN 1 END) as open
      FROM document_comments 
      GROUP BY comment_type
      ORDER BY count DESC
    `);
    
    if (commentStats.rows.length > 0) {
      commentStats.rows.forEach(stat => {
        console.log(`   ${stat.comment_type.toUpperCase()}: ${stat.count} comments | ${stat.resolved} resolved | ${stat.open} open`);
      });
    } else {
      console.log('   No comments found');
    }
    
    // 8. Sample Document Names
    console.log('\n8. SAMPLE DOCUMENT NAMES');
    console.log('-'.repeat(30));
    
    const sampleDocs = await client.query(`
      SELECT 
        document_id,
        display_name,
        document_type,
        ROUND(file_size/1024) as size_kb,
        download_count,
        view_count,
        created_at::date
      FROM documents 
      ORDER BY created_at DESC
      LIMIT 15
    `);
    
    sampleDocs.rows.forEach(doc => {
      console.log(`   ${doc.document_id}: ${doc.display_name}`);
      console.log(`      Type: ${doc.document_type} | Size: ${doc.size_kb}KB | Downloads: ${doc.download_count} | Views: ${doc.view_count} | Created: ${doc.created_at}`);
    });
    
    // 9. Metadata Examples
    console.log('\n9. METADATA EXAMPLES');
    console.log('-'.repeat(25));
    
    const metadataExamples = await client.query(`
      SELECT 
        document_type,
        md5_hash,
        author_name,
        company_name,
        amount,
        currency,
        technical_specs,
        location_data
      FROM documents 
      WHERE author_name IS NOT NULL OR amount IS NOT NULL OR technical_specs != '{}'
      LIMIT 5
    `);
    
    metadataExamples.rows.forEach(doc => {
      console.log(`   📄 ${doc.document_type.toUpperCase()}`);
      console.log(`      MD5: ${doc.md5_hash}`);
      if (doc.author_name) console.log(`      Author: ${doc.author_name}`);
      if (doc.company_name) console.log(`      Company: ${doc.company_name}`);
      if (doc.amount) console.log(`      Amount: ${doc.currency} ${doc.amount}`);
      if (doc.technical_specs && JSON.stringify(doc.technical_specs) !== '{}') {
        console.log(`      Technical Specs: ${JSON.stringify(doc.technical_specs)}`);
      }
      if (doc.location_data && JSON.stringify(doc.location_data) !== '{}') {
        const location = JSON.parse(doc.location_data);
        if (location.latitude) console.log(`      Location: ${location.latitude}, ${location.longitude}`);
      }
      console.log('');
    });
    
    // 10. Summary
    console.log('\n10. SUMMARY');
    console.log('-'.repeat(15));
    
    const totalSize = await client.query('SELECT SUM(file_size) as total_bytes FROM documents');
    const totalSizeMB = Math.round(totalSize.rows[0].total_bytes / 1024 / 1024);
    
    console.log(`✅ Successfully populated FibreFlow document management system`);
    console.log(`📊 Total Documents: ${overallStats[1].rows[0].count}`);
    console.log(`💾 Total Size: ${totalSizeMB} MB`);
    console.log(`🗂️  Organized in ${overallStats[0].rows[0].count} folders`);
    console.log(`📈 ${overallStats[2].rows[0].count} access log entries`);
    console.log(`🔗 ${overallStats[3].rows[0].count} document shares`);
    console.log(`💬 ${overallStats[4].rows[0].count} comments`);
    console.log('');
    console.log('🎉 Document database population completed successfully!');
    console.log('The system now contains realistic document references with:');
    console.log('   • SOW files with versions and amendments');
    console.log('   • Financial documents with amounts and tax details');
    console.log('   • Technical reports with specifications');
    console.log('   • Site photos with GPS coordinates and camera metadata');
    console.log('   • Compliance documents with expiry dates');
    console.log('   • Progress reports and drawings');
    console.log('   • Comprehensive access logs and sharing permissions');
    
  } catch (error) {
    console.error('❌ Error generating report:', error);
  } finally {
    await client.end();
  }
}

generateComprehensiveReport();