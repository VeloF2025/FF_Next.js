#!/usr/bin/env tsx

import { neon } from '@neondatabase/serverless';

const DATABASE_URL = 'process.env.DATABASE_URL';
const sql = neon(DATABASE_URL);

async function testEndpoints() {
  console.log('🔍 Testing All API Endpoints\n');
  console.log('=====================================\n');
  
  const endpoints = [
    { name: 'Projects', query: sql`SELECT * FROM projects LIMIT 5` },
    { name: 'Staff', query: sql`SELECT * FROM staff LIMIT 5` },
    { name: 'Clients', query: sql`SELECT * FROM clients LIMIT 5` },
    { name: 'SOW Imports', query: sql`SELECT * FROM sow_imports LIMIT 5` },
    { 
      name: 'Analytics Stats', 
      query: sql`
        SELECT 
          COUNT(*) as total_projects,
          COUNT(CASE WHEN status = 'active' THEN 1 END) as active_projects
        FROM projects
      ` 
    }
  ];
  
  for (const endpoint of endpoints) {
    try {
      console.log(`📊 Testing ${endpoint.name}:`);
      const result = await endpoint.query;
      
      if (result && result.length > 0) {
        console.log(`  ✅ Success - ${result.length} records found`);
        if (endpoint.name === 'Analytics Stats') {
          console.log(`     Total Projects: ${result[0].total_projects}`);
          console.log(`     Active Projects: ${result[0].active_projects}`);
        } else {
          console.log(`     Sample: ${JSON.stringify(result[0]).substring(0, 100)}...`);
        }
      } else {
        console.log(`  ⚠️  Warning - No data found (empty table)`);
      }
    } catch (error) {
      console.log(`  ❌ Error - ${error.message}`);
    }
    console.log();
  }
  
  // Test complex queries that the APIs use
  console.log('🔄 Testing Complex Queries:\n');
  
  try {
    console.log('1. Projects with Client Names:');
    const projectsWithClients = await sql`
      SELECT 
        p.id, 
        p.project_name, 
        c.client_name 
      FROM projects p
      LEFT JOIN clients c ON p.client_id = c.id::text::uuid
      LIMIT 3
    `;
    console.log(`  ✅ Found ${projectsWithClients.length} projects with client data`);
  } catch (error) {
    console.log(`  ❌ Error - ${error.message}`);
  }
  
  try {
    console.log('\n2. Staff Full Names:');
    const staffWithNames = await sql`
      SELECT 
        id,
        CONCAT(first_name, ' ', last_name) as full_name,
        department
      FROM staff
      LIMIT 3
    `;
    console.log(`  ✅ Found ${staffWithNames.length} staff members`);
    staffWithNames.forEach(s => console.log(`     - ${s.full_name} (${s.department})`));
  } catch (error) {
    console.log(`  ❌ Error - ${error.message}`);
  }
  
  try {
    console.log('\n3. SOW Import Summary:');
    const sowSummary = await sql`
      SELECT 
        import_type,
        COUNT(*) as count,
        SUM(total_records) as total_records
      FROM sow_imports
      GROUP BY import_type
    `;
    console.log(`  ✅ SOW Import Types:`);
    sowSummary.forEach(s => console.log(`     - ${s.import_type}: ${s.count} imports, ${s.total_records} total records`));
  } catch (error) {
    console.log(`  ❌ Error - ${error.message}`);
  }
  
  console.log('\n=====================================');
  console.log('✅ All tests completed!');
}

testEndpoints();