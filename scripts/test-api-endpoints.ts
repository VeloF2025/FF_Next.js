#!/usr/bin/env tsx

import { neon } from '@neondatabase/serverless';

const DATABASE_URL = 'process.env.DATABASE_URL';

async function testDatabaseConnection() {
  console.log('Testing database connection...');
  const sql = neon(DATABASE_URL);
  
  try {
    // Test connection
    const result = await sql`SELECT current_database(), current_user, version()`;
    console.log('✅ Database connected successfully');
    console.log('Database:', result[0].current_database);
    console.log('User:', result[0].current_user);
    
    // Check if tables exist
    const tables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `;
    console.log('\n📊 Available tables:');
    tables.forEach(t => console.log('  -', t.table_name));
    
    // Test each table
    console.log('\n🔍 Testing table data:');
    
    // Projects
    try {
      const projects = await sql`SELECT COUNT(*) as count FROM projects`;
      console.log(`  ✓ projects: ${projects[0].count} records`);
    } catch (e) {
      console.log('  ✗ projects: Error -', e.message);
    }
    
    // Clients
    try {
      const clients = await sql`SELECT COUNT(*) as count FROM clients`;
      console.log(`  ✓ clients: ${clients[0].count} records`);
    } catch (e) {
      console.log('  ✗ clients: Error -', e.message);
    }
    
    // Staff
    try {
      const staff = await sql`SELECT COUNT(*) as count FROM staff`;
      console.log(`  ✓ staff: ${staff[0].count} records`);
    } catch (e) {
      console.log('  ✗ staff: Error -', e.message);
    }
    
    // SOW Imports
    try {
      const sow = await sql`SELECT COUNT(*) as count FROM sow_imports`;
      console.log(`  ✓ sow_imports: ${sow[0].count} records`);
    } catch (e) {
      console.log('  ✗ sow_imports: Error -', e.message);
    }
    
    // Contractors
    try {
      const contractors = await sql`SELECT COUNT(*) as count FROM contractors`;
      console.log(`  ✓ contractors: ${contractors[0].count} records`);
    } catch (e) {
      console.log('  ✗ contractors: Error -', e.message);
    }
    
    // Check table structure for projects
    console.log('\n📋 Projects table structure:');
    const columns = await sql`
      SELECT column_name, data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'projects'
      ORDER BY ordinal_position
    `;
    columns.forEach(col => {
      console.log(`  - ${col.column_name}: ${col.data_type} ${col.is_nullable === 'NO' ? 'NOT NULL' : ''}`);
    });
    
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    process.exit(1);
  }
}

testDatabaseConnection();