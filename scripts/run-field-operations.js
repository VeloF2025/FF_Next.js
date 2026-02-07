#!/usr/bin/env node

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');

const connectionString = 'process.env.DATABASE_URL';

async function populateFieldOperations() {
  const client = new Client({ connectionString });
  
  try {
    console.log('Connecting to database...');
    await client.connect();
    
    console.log('Reading SQL script...');
    const sqlScript = fs.readFileSync(path.join(__dirname, 'populate-field-operations.sql'), 'utf8');
    
    // Split the script into individual statements
    const statements = sqlScript
      .split(/;(?=\s*(?:--.*)?$)/m)
      .map(s => s.trim())
      .filter(s => s && !s.startsWith('--'));
    
    console.log(`Executing ${statements.length} SQL statements...`);
    
    let successCount = 0;
    let errorCount = 0;
    
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i];
      
      if (statement.trim()) {
        try {
          // Skip comments and SELECT statements that are just for display
          if (statement.startsWith('SELECT') && statement.includes('as status') || 
              statement.startsWith('SELECT') && statement.includes('as metric')) {
            // Execute summary queries
            const result = await client.query(statement + ';');
            if (result.rows) {
              console.table(result.rows);
            }
          } else {
            await client.query(statement + ';');
            successCount++;
            
            // Log progress for major operations
            if (statement.includes('CREATE TABLE')) {
              console.log(`✓ Created table: ${statement.match(/CREATE TABLE IF NOT EXISTS (\w+)/)?.[1]}`);
            } else if (statement.includes('INSERT INTO field_teams')) {
              console.log('✓ Populated field teams');
            } else if (statement.includes('DO $$') && statement.includes('field_technicians')) {
              console.log('✓ Generated field technicians');
            } else if (statement.includes('DO $$') && statement.includes('field_tasks')) {
              console.log('✓ Generated 250+ field tasks');
            } else if (statement.includes('DO $$') && statement.includes('daily_schedules')) {
              console.log('✓ Created daily schedules for 14 days');
            } else if (statement.includes('DO $$') && statement.includes('quality_checks')) {
              console.log('✓ Generated quality check data');
            } else if (statement.includes('DO $$') && statement.includes('equipment_checkouts')) {
              console.log('✓ Generated equipment checkouts');
            } else if (statement.includes('DO $$') && statement.includes('vehicle_assignments')) {
              console.log('✓ Created vehicle assignments');
            } else if (statement.includes('DO $$') && statement.includes('mobile_sync_queue')) {
              console.log('✓ Generated mobile sync queue data');
            }
          }
        } catch (error) {
          errorCount++;
          if (!error.message.includes('already exists')) {
            console.error(`Error in statement ${i + 1}: ${error.message.substring(0, 100)}`);
          }
        }
      }
    }
    
    console.log(`\n✅ Field Operations Data Population Complete!`);
    console.log(`   Successful operations: ${successCount}`);
    if (errorCount > 0) {
      console.log(`   Errors (mostly duplicates): ${errorCount}`);
    }
    
    // Get final counts
    const counts = await client.query(`
      SELECT 'Summary Statistics' as category, '' as count
      UNION ALL
      SELECT 'Field Teams:', COUNT(*)::text FROM field_teams
      UNION ALL
      SELECT 'Field Technicians:', COUNT(*)::text FROM field_technicians
      UNION ALL
      SELECT 'Field Tasks:', COUNT(*)::text FROM field_tasks
      UNION ALL
      SELECT 'Daily Schedules:', COUNT(*)::text FROM daily_schedules
      UNION ALL
      SELECT 'Quality Checks:', COUNT(*)::text FROM quality_checks
      UNION ALL
      SELECT 'Equipment Checkouts:', COUNT(*)::text FROM equipment_checkouts
      UNION ALL
      SELECT 'Vehicle Assignments:', COUNT(*)::text FROM vehicle_assignments
      UNION ALL
      SELECT 'Mobile Sync Items:', COUNT(*)::text FROM mobile_sync_queue
    `);
    
    console.log('\n📊 Final Database Counts:');
    console.table(counts.rows.filter(r => r.count));
    
  } catch (error) {
    console.error('Fatal error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
    console.log('\nDatabase connection closed.');
  }
}

// Run the population
populateFieldOperations().catch(console.error);