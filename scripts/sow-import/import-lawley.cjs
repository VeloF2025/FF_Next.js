#!/usr/bin/env node
const { Client } = require('pg');
const XLSX = require('xlsx');
const path = require('path');
require('dotenv').config();

// Database configuration
const pgConfig = {
  connectionString: process.env.DATABASE_URL || 'process.env.DATABASE_URL',
  ssl: { rejectUnauthorized: false }
};

// Lawley Project Configuration
const LAWLEY_PROJECT = {
  id: null, // Will be generated or fetched
  name: 'Lawley',
  client_name: 'Lawley Municipality',
  location: 'Lawley, Gauteng',
  latitude: -26.2837,
  longitude: 27.8999,
  status: 'active',
  start_date: new Date().toISOString().split('T')[0],
  description: 'Fiber network deployment project for Lawley area',
  municipality: 'City of Johannesburg',
  province: 'Gauteng'
};

// File paths
const DROPS_FILE = './docs/Uploads/Lawley/Drops_Lawley.xlsx';
const FIBRE_FILE = './docs/Uploads/Lawley/Fibre_Lawley.xlsx';
const BATCH_SIZE = 1000;

async function createOrGetProject(client) {
  console.log('\n📁 SETTING UP LAWLEY PROJECT...');
  console.log('=' .repeat(60));
  
  try {
    // Check if Lawley project already exists
    const existingProject = await client.query(
      `SELECT id, project_name, project_code, status FROM projects WHERE project_name = $1 OR location ILIKE $2`,
      [LAWLEY_PROJECT.name, '%Lawley%']
    );
    
    if (existingProject.rows.length > 0) {
      console.log(`✓ Found existing project: ${existingProject.rows[0].project_name} (${existingProject.rows[0].id})`);
      return existingProject.rows[0].id;
    }
    
    // First check if we need to create a client
    let clientId = null;
    const clientCheck = await client.query(
      `SELECT id FROM clients WHERE company_name = $1`,
      [LAWLEY_PROJECT.client_name]
    );
    
    if (clientCheck.rows.length > 0) {
      clientId = clientCheck.rows[0].id;
      console.log(`✓ Found existing client: ${LAWLEY_PROJECT.client_name}`);
    } else {
      // Create client
      const clientResult = await client.query(
        `INSERT INTO clients (company_name, city, status) 
         VALUES ($1, $2, 'active')
         RETURNING id`,
        [LAWLEY_PROJECT.client_name, LAWLEY_PROJECT.location]
      );
      clientId = clientResult.rows[0].id;
      console.log(`✓ Created new client: ${LAWLEY_PROJECT.client_name}`);
    }
    
    // Generate project code
    const projectCode = `LAW-${Date.now().toString().slice(-6)}`;
    
    // Create new Lawley project
    console.log('Creating new Lawley project...');
    const createResult = await client.query(
      `INSERT INTO projects (
        project_code, project_name, client_id, location, status, start_date,
        description, latitude, longitude,
        created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
      RETURNING id, project_name, project_code`,
      [
        projectCode,
        LAWLEY_PROJECT.name,
        clientId,
        LAWLEY_PROJECT.location,
        LAWLEY_PROJECT.status,
        LAWLEY_PROJECT.start_date,
        LAWLEY_PROJECT.description,
        LAWLEY_PROJECT.latitude,
        LAWLEY_PROJECT.longitude
      ]
    );
    
    console.log(`✅ Created new project: ${createResult.rows[0].project_name} (${createResult.rows[0].id})`);
    console.log(`   Project Code: ${createResult.rows[0].project_code}`);
    console.log(`   Location: ${LAWLEY_PROJECT.location}`);
    console.log(`   GPS: ${LAWLEY_PROJECT.latitude}, ${LAWLEY_PROJECT.longitude}`);
    return createResult.rows[0].id;
    
  } catch (error) {
    console.error('❌ Error setting up project:', error.message);
    throw error;
  }
}

async function importDrops(client, projectId) {
  console.log('\n💧 IMPORTING DROPS DATA...');
  console.log('=' .repeat(60));
  console.log(`File: ${path.basename(DROPS_FILE)}`);
  
  try {
    // Read Excel file
    const workbook = XLSX.readFile(DROPS_FILE);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const drops = XLSX.utils.sheet_to_json(worksheet);
    
    console.log(`📊 Total records in Excel: ${drops.length}`);
    
    // Clear existing drops for this project
    console.log('Clearing existing drops for project...');
    await client.query('DELETE FROM sow_drops WHERE project_id = $1', [projectId]);
    console.log('✓ Cleared existing drops\n');
    
    const startTime = Date.now();
    let totalInserted = 0;
    let skipped = 0;
    
    // Process in batches
    for (let i = 0; i < drops.length; i += BATCH_SIZE) {
      const batch = drops.slice(i, i + BATCH_SIZE);
      const batchStart = Date.now();
      
      // Build multi-value INSERT
      const values = [];
      const placeholders = [];
      let valueIndex = 1;
      
      batch.forEach((drop) => {
        // Map Excel columns to database fields - check various column name formats
        const dropNumber = drop.label || drop.Label || drop.drop_number || drop['Drop Number'] || drop['DROP ID'];
        const poleNumber = drop.strtfeat || drop['Start Feature'] || drop.pole_number || drop['Pole Number'];
        
        if (!dropNumber) {
          skipped++;
          return;
        }
        
        // Build placeholders for this row (19 columns)
        const rowPlaceholders = [];
        for (let j = 0; j < 19; j++) {
          rowPlaceholders.push(`$${valueIndex++}`);
        }
        placeholders.push(`(${rowPlaceholders.join(', ')})`);
        
        // Add values - being flexible with column names
        values.push(
          projectId,                                           // project_id
          dropNumber,                                          // drop_number
          poleNumber || null,                                  // pole_number
          drop.type || drop.Type || drop['Cable Type'] || null, // cable_type
          drop.spec || drop.Spec || drop['Cable Spec'] || null, // cable_spec
          parseFloat(drop.dim2 || drop.Length || drop.length) || null, // cable_length
          drop.cblcpty || drop['Cable Capacity'] || null,     // cable_capacity
          drop.strtfeat || drop['Start Point'] || null,       // start_point
          drop.endfeat || drop['End Point'] || null,          // end_point
          LAWLEY_PROJECT.latitude,                            // latitude (use project default)
          LAWLEY_PROJECT.longitude,                           // longitude (use project default)
          drop.endfeat || drop.Address || null,               // address
          parseInt(drop.pon_no || drop['PON No']) || null,    // pon_no
          parseInt(drop.zone_no || drop['Zone No']) || null,  // zone_no
          drop.mun || drop.Municipality || LAWLEY_PROJECT.municipality, // municipality
          drop.status || drop.Status || 'planned',            // status
          drop.datecrtd ? new Date(drop.datecrtd) : new Date(), // created_date
          drop.crtdby || drop['Created By'] || 'Import',      // created_by
          JSON.stringify(drop)                                // raw_data
        );
      });
      
      if (placeholders.length > 0) {
        const query = `
          INSERT INTO sow_drops (
            project_id, drop_number, pole_number, cable_type, cable_spec,
            cable_length, cable_capacity, start_point, end_point,
            latitude, longitude, address, pon_no, zone_no,
            municipality, status, created_date, created_by, raw_data
          ) VALUES ${placeholders.join(', ')}
          ON CONFLICT (project_id, drop_number) DO UPDATE SET
            pole_number = EXCLUDED.pole_number,
            cable_type = EXCLUDED.cable_type,
            cable_spec = EXCLUDED.cable_spec,
            cable_length = EXCLUDED.cable_length,
            cable_capacity = EXCLUDED.cable_capacity,
            start_point = EXCLUDED.start_point,
            end_point = EXCLUDED.end_point,
            latitude = EXCLUDED.latitude,
            longitude = EXCLUDED.longitude,
            address = EXCLUDED.address,
            municipality = EXCLUDED.municipality,
            status = EXCLUDED.status,
            raw_data = EXCLUDED.raw_data,
            updated_at = NOW()
          RETURNING id, drop_number
        `;
        
        try {
          const result = await client.query(query, values);
          totalInserted += result.rows.length;
          
          const batchTime = ((Date.now() - batchStart) / 1000).toFixed(2);
          const rate = Math.round(result.rows.length / parseFloat(batchTime));
          console.log(`✅ Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${totalInserted} drops imported (${rate}/sec)`);
        } catch (batchError) {
          console.error(`❌ Error in batch starting at ${i}:`, batchError.message);
        }
      }
    }
    
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    const avgRate = Math.round(totalInserted / parseFloat(totalTime));
    
    // Verify final count
    const countResult = await client.query(
      'SELECT COUNT(*) FROM sow_drops WHERE project_id = $1',
      [projectId]
    );
    
    console.log('\n' + '=' .repeat(60));
    console.log('✅ DROPS IMPORT COMPLETE');
    console.log(`   Imported: ${totalInserted} drops`);
    console.log(`   Skipped: ${skipped} records (no drop number)`);
    console.log(`   Time: ${totalTime} seconds`);
    console.log(`   Rate: ${avgRate} drops/sec`);
    console.log(`   Final count in DB: ${countResult.rows[0].count} drops`);
    
    return totalInserted;
    
  } catch (error) {
    console.error('❌ Error importing drops:', error.message);
    throw error;
  }
}

async function importFibre(client, projectId) {
  console.log('\n🔌 IMPORTING FIBRE DATA...');
  console.log('=' .repeat(60));
  console.log(`File: ${path.basename(FIBRE_FILE)}`);
  
  try {
    // Read Excel file
    const workbook = XLSX.readFile(FIBRE_FILE);
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const segments = XLSX.utils.sheet_to_json(worksheet);
    
    console.log(`📊 Total records in Excel: ${segments.length}`);
    
    // Clear existing fibre for this project
    console.log('Clearing existing fibre segments for project...');
    await client.query('DELETE FROM sow_fibre WHERE project_id = $1', [projectId]);
    console.log('✓ Cleared existing fibre segments\n');
    
    const startTime = Date.now();
    let totalInserted = 0;
    let skipped = 0;
    
    // Deduplicate by segment_id
    const uniqueSegments = {};
    segments.forEach(segment => {
      const segmentId = segment.label || segment.Label || segment['Segment ID'] || segment.segment_id;
      if (segmentId && !uniqueSegments[segmentId]) {
        uniqueSegments[segmentId] = segment;
      }
    });
    
    const dedupedSegments = Object.values(uniqueSegments);
    console.log(`Deduped from ${segments.length} to ${dedupedSegments.length} unique segments`);
    
    // Process in smaller batches for fibre
    const FIBRE_BATCH_SIZE = 500;
    for (let i = 0; i < dedupedSegments.length; i += FIBRE_BATCH_SIZE) {
      const batch = dedupedSegments.slice(i, i + FIBRE_BATCH_SIZE);
      const batchStart = Date.now();
      
      // Build multi-value INSERT
      const values = [];
      const placeholders = [];
      let valueIndex = 1;
      
      batch.forEach((segment) => {
        // Map Excel columns to database fields - check various column name formats
        const segmentId = segment.label || segment.Label || segment['Segment ID'] || segment.segment_id;
        
        if (!segmentId) {
          skipped++;
          return;
        }
        
        // Build placeholders for this row (13 columns)
        const rowPlaceholders = [];
        for (let j = 0; j < 13; j++) {
          rowPlaceholders.push(`$${valueIndex++}`);
        }
        placeholders.push(`(${rowPlaceholders.join(', ')})`);
        
        // Determine completion status
        const isComplete = segment.Complete === 'Yes' || segment.Status === 'Completed' || segment.status === 'completed';
        
        // Add values matching sow_fibre table structure
        values.push(
          projectId,                                           // project_id
          segmentId,                                          // segment_id
          segment['Cable Size'] || segment.cable_size || segment.Size || '48F', // cable_size
          segment.Layer || segment.layer || 'Core',           // layer
          parseFloat(segment.Length || segment.length || segment.Distance) || 0, // distance
          parseInt(segment['PON No'] || segment.pon_no) || null, // pon_no
          parseInt(segment['Zone No'] || segment.zone_no) || null, // zone_no
          segment['String Com'] || segment['String Completed'] || null, // string_completed
          segment['Date Comp'] || segment['Date Completed'] ? new Date(segment['Date Comp'] || segment['Date Completed']) : null, // date_completed
          segment.Contractor || segment.contractor || 'Lawley Team', // contractor
          isComplete ? 'completed' : 'planned',               // status
          isComplete,                                          // is_complete
          JSON.stringify(segment)                             // raw_data
        );
      });
      
      if (placeholders.length > 0) {
        const query = `
          INSERT INTO sow_fibre (
            project_id, segment_id, cable_size, layer, distance,
            pon_no, zone_no, string_completed, date_completed,
            contractor, status, is_complete, raw_data
          ) VALUES ${placeholders.join(', ')}
          ON CONFLICT (project_id, segment_id) DO UPDATE SET
            cable_size = EXCLUDED.cable_size,
            layer = EXCLUDED.layer,
            distance = EXCLUDED.distance,
            pon_no = EXCLUDED.pon_no,
            zone_no = EXCLUDED.zone_no,
            string_completed = EXCLUDED.string_completed,
            date_completed = EXCLUDED.date_completed,
            contractor = EXCLUDED.contractor,
            status = EXCLUDED.status,
            is_complete = EXCLUDED.is_complete,
            raw_data = EXCLUDED.raw_data,
            updated_at = NOW()
          RETURNING id, segment_id
        `;
        
        try {
          const result = await client.query(query, values);
          totalInserted += result.rows.length;
          
          const batchTime = ((Date.now() - batchStart) / 1000).toFixed(2);
          const rate = Math.round(result.rows.length / parseFloat(batchTime));
          console.log(`✅ Batch ${Math.floor(i / FIBRE_BATCH_SIZE) + 1}: ${totalInserted} fibre segments imported (${rate}/sec)`);
        } catch (batchError) {
          console.error(`❌ Error in batch starting at ${i}:`, batchError.message);
        }
      }
    }
    
    const totalTime = ((Date.now() - startTime) / 1000).toFixed(2);
    const avgRate = Math.round(totalInserted / parseFloat(totalTime));
    
    // Verify final count and total length
    const countResult = await client.query(
      'SELECT COUNT(*) as count, SUM(distance) as total_length FROM sow_fibre WHERE project_id = $1',
      [projectId]
    );
    
    console.log('\n' + '=' .repeat(60));
    console.log('✅ FIBRE IMPORT COMPLETE');
    console.log(`   Imported: ${totalInserted} fibre segments`);
    console.log(`   Skipped: ${skipped} records (no segment ID)`);
    console.log(`   Time: ${totalTime} seconds`);
    console.log(`   Rate: ${avgRate} segments/sec`);
    console.log(`   Final count in DB: ${countResult.rows[0].count} segments`);
    console.log(`   Total cable length: ${parseFloat(countResult.rows[0].total_length || 0).toFixed(2)} meters`);
    
    return totalInserted;
    
  } catch (error) {
    console.error('❌ Error importing fibre:', error.message);
    throw error;
  }
}

async function verifyImport(client, projectId) {
  console.log('\n📊 VERIFYING IMPORT...');
  console.log('=' .repeat(60));
  
  try {
    // Get project details
    const projectResult = await client.query(
      'SELECT project_name, location, latitude, longitude FROM projects WHERE id = $1',
      [projectId]
    );
    const project = projectResult.rows[0];
    
    // Get SOW data counts
    const dropsCount = await client.query(
      'SELECT COUNT(*) as count FROM sow_drops WHERE project_id = $1',
      [projectId]
    );
    
    const fibreCount = await client.query(
      `SELECT 
        COUNT(*) as count, 
        SUM(distance) as total_length,
        COUNT(CASE WHEN is_complete = true THEN 1 END) as completed_count
       FROM sow_fibre WHERE project_id = $1`,
      [projectId]
    );
    
    console.log('✅ IMPORT VERIFICATION COMPLETE\n');
    console.log('Project Details:');
    console.log(`   Name: ${project.project_name}`);
    console.log(`   Location: ${project.location}`);
    console.log(`   GPS: ${project.latitude}, ${project.longitude}\n`);
    
    console.log('SOW Data Summary:');
    console.log(`   Drops: ${dropsCount.rows[0].count} records`);
    console.log(`   Fibre: ${fibreCount.rows[0].count} segments`);
    console.log(`   Total Cable: ${parseFloat(fibreCount.rows[0].total_length || 0).toFixed(2)} meters`);
    console.log(`   Completed Segments: ${fibreCount.rows[0].completed_count || 0}`);
    
    console.log('\n✅ Data is now available in:');
    console.log('   - SOW Management: /pages/sow/list');
    console.log('   - Pole Tracker: /pages/pole-tracker/');
    console.log('   - Project Dashboard: /pages/projects/[id]');
    
    return true;
    
  } catch (error) {
    console.error('❌ Error verifying import:', error.message);
    return false;
  }
}

async function main() {
  console.log('\n🚀 LAWLEY SOW DATA IMPORT');
  console.log('=' .repeat(60));
  console.log('Starting comprehensive Lawley data import...');
  console.log(`Database: ${pgConfig.connectionString.split('@')[1].split('/')[0]}`);
  console.log(`Drops file: ${path.basename(DROPS_FILE)}`);
  console.log(`Fibre file: ${path.basename(FIBRE_FILE)}`);
  console.log('=' .repeat(60));
  
  const client = new Client(pgConfig);
  
  try {
    await client.connect();
    console.log('✓ Connected to Neon Database');
    
    // Step 1: Create or get Lawley project
    const projectId = await createOrGetProject(client);
    LAWLEY_PROJECT.id = projectId;
    
    // Step 2: Import Drops data
    const dropsImported = await importDrops(client, projectId);
    
    // Step 3: Import Fibre data
    const fibreImported = await importFibre(client, projectId);
    
    // Step 4: Verify import
    await verifyImport(client, projectId);
    
    console.log('\n' + '=' .repeat(60));
    console.log('🎉 LAWLEY IMPORT COMPLETED SUCCESSFULLY!');
    console.log('=' .repeat(60));
    console.log(`Project ID: ${projectId}`);
    console.log(`Total Drops: ${dropsImported}`);
    console.log(`Total Fibre: ${fibreImported}`);
    console.log('\nYou can now view the imported data in the application.');
    
  } catch (error) {
    console.error('\n❌ IMPORT FAILED:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  } finally {
    await client.end();
    console.log('\n✓ Database connection closed');
  }
}

// Run the import
main().catch(console.error);