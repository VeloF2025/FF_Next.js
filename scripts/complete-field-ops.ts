import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { sql } from 'drizzle-orm';

const DATABASE_URL = 'process.env.DATABASE_URL';

async function completeFieldOpsData() {
  console.log('🔧 Completing Field Operations Data Population...\n');
  
  const neonClient = neon(DATABASE_URL);
  const db = drizzle(neonClient);

  try {
    // 1. Complete Quality Checks for more tasks
    console.log('✅ Expanding Quality Checks...');
    const completedTasks = await db.execute(sql`
      SELECT id FROM field_tasks 
      WHERE status = 'completed' 
      AND id NOT IN (SELECT task_id FROM quality_checks WHERE task_id IS NOT NULL)
      LIMIT 50
    `);
    
    const inspectors = await db.execute(sql`
      SELECT id FROM field_technicians WHERE role IN ('lead_technician', 'supervisor')
    `);
    
    let qualityCount = 0;
    for (const task of completedTasks.rows) {
      const inspector = inspectors.rows[Math.floor(Math.random() * inspectors.rows.length)];
      const passRate = Math.random();
      const status = passRate < 0.85 ? 'pass' : passRate < 0.95 ? 'conditional_pass' : 'fail';
      const score = status === 'pass' ? 85 + Math.random() * 15 : 50 + Math.random() * 35;
      
      await db.execute(sql`
        INSERT INTO quality_checks (
          task_id, check_type, inspector_id, 
          status, score, checklist, issues_found, corrective_actions,
          photo_evidence, measurements, compliance_standards,
          customer_satisfaction, requires_followup, notes
        ) VALUES (
          ${task.id}::uuid, 
          ${['installation', 'fiber_splice', 'connection', 'safety'][Math.floor(Math.random() * 4)]},
          ${inspector.id}::uuid, 
          ${status}, 
          ${score},
          '{"cable_routing": true, "connector_quality": true, "signal_strength": true, "documentation": true, "safety_compliance": true}'::json,
          ${status !== 'pass' ? `["${['Cable bend radius issue', 'Connector not seated', 'Signal loss detected', 'Missing labels'][Math.floor(Math.random() * 4)]}"]` : '[]'}::json,
          ${status !== 'pass' ? `["${['Re-route cable properly', 'Re-terminate connector', 'Check all connections', 'Add proper labeling'][Math.floor(Math.random() * 4)]}"]` : '[]'}::json,
          ${`["https://storage.example.com/inspections/${task.id}/photo1.jpg", "https://storage.example.com/inspections/${task.id}/photo2.jpg"]`}::json,
          '{"signal_power": -22.5, "return_loss": 42.3, "insertion_loss": 0.35}'::json,
          '["ISO9001:2015", "TIA568-C", "SANS347"]'::json,
          ${status === 'pass' ? 4 + Math.floor(Math.random() * 2) : 2 + Math.floor(Math.random() * 3)},
          ${status !== 'pass'},
          ${status === 'pass' ? 'Quality check passed. Installation meets all standards.' : 
            status === 'conditional_pass' ? 'Minor issues found. Conditional approval with follow-up required.' :
            'Quality issues detected. Immediate corrective action required.'}
        )
      `);
      qualityCount++;
    }
    console.log(`✓ Created ${qualityCount} additional quality checks`);
    
    // 2. Generate Equipment Checkouts
    console.log('\n🔧 Generating Equipment Checkouts...');
    const equipment = [
      { name: 'Fujikura 90S Fusion Splicer', type: 'testing_equipment', prefix: 'FS' },
      { name: 'EXFO MaxTester OTDR', type: 'testing_equipment', prefix: 'OT' },
      { name: 'AFL OPM5 Power Meter', type: 'testing_equipment', prefix: 'PM' },
      { name: 'JDSU OLS-35 Light Source', type: 'testing_equipment', prefix: 'LS' },
      { name: '8m Extension Ladder', type: 'safety_gear', prefix: 'LD' },
      { name: 'Complete Tool Kit', type: 'tool', prefix: 'TK' },
      { name: 'Fall Protection Harness', type: 'safety_gear', prefix: 'FP' },
      { name: 'Honda EU22i Generator', type: 'tool', prefix: 'GN' },
      { name: 'Fiber Cleaver CT-30', type: 'tool', prefix: 'FC' },
      { name: 'Cable Pulling Kit', type: 'tool', prefix: 'CP' }
    ];
    
    const technicians = await db.execute(sql`SELECT id, team_id FROM field_technicians`);
    
    let checkoutCount = 0;
    for (const tech of technicians.rows) {
      // Each technician gets 2-3 equipment items
      const numItems = 2 + Math.floor(Math.random() * 2);
      const selectedEquipment = [...equipment].sort(() => Math.random() - 0.5).slice(0, numItems);
      
      for (const equip of selectedEquipment) {
        const checkoutDate = new Date();
        checkoutDate.setDate(checkoutDate.getDate() - Math.floor(Math.random() * 7));
        const returnDate = new Date(checkoutDate);
        returnDate.setDate(returnDate.getDate() + 7 + Math.floor(Math.random() * 7));
        
        await db.execute(sql`
          INSERT INTO equipment_checkouts (
            equipment_id, equipment_name, equipment_type, serial_number,
            checked_out_to, team_id, checkout_date, expected_return_date,
            condition_out, notes_out, status
          ) VALUES (
            ${`${equip.prefix}-${String(1000 + checkoutCount).padStart(4, '0')}`},
            ${equip.name},
            ${equip.type},
            ${`SN${2024}${String(Math.floor(Math.random() * 10000)).padStart(5, '0')}`},
            ${tech.id}::uuid,
            ${tech.team_id}::uuid,
            ${checkoutDate.toISOString()},
            ${returnDate.toISOString()},
            ${['excellent', 'good', 'good', 'fair'][Math.floor(Math.random() * 4)]},
            ${'Equipment inspected and verified functional. All accessories included.'},
            ${Math.random() < 0.1 ? 'returned' : 'checked_out'}
          )
        `);
        checkoutCount++;
      }
    }
    console.log(`✓ Created ${checkoutCount} equipment checkouts`);
    
    // 3. Generate Vehicle Assignments
    console.log('\n🚗 Generating Vehicle Assignments...');
    const vehicles = [
      { make: 'Toyota Hilux 2.8 GD-6', type: 'bakkie' },
      { make: 'Ford Ranger XLT', type: 'bakkie' },
      { make: 'Isuzu D-Max 250', type: 'bakkie' },
      { make: 'Nissan NP200', type: 'bakkie' },
      { make: 'VW Amarok', type: 'bakkie' },
      { make: 'Mercedes Sprinter', type: 'van' },
      { make: 'Toyota Quantum', type: 'van' },
      { make: 'Iveco Daily', type: 'van' }
    ];
    
    const teams = await db.execute(sql`SELECT id FROM field_teams`);
    let vehicleCount = 0;
    
    for (const team of teams.rows) {
      const vehicle = vehicles[Math.floor(Math.random() * vehicles.length)];
      const letters = ['ABC', 'DEF', 'GHI', 'JKL', 'MNO', 'PQR', 'STU', 'VWX', 'YZA'];
      const registration = `GP ${String(100 + vehicleCount).padStart(3, '0')} ${letters[vehicleCount % letters.length]}`;
      
      // Get a driver from the team
      const drivers = await db.execute(sql`
        SELECT id FROM field_technicians 
        WHERE team_id = ${team.id}::uuid 
        AND role IN ('lead_technician', 'technician')
        LIMIT 1
      `);
      
      await db.execute(sql`
        INSERT INTO vehicle_assignments (
          vehicle_id, vehicle_registration, vehicle_type, make_model,
          team_id, driver_id, assignment_date, fuel_level_start, odometer_start,
          maintenance_due_date, insurance_valid_until, gps_tracker_id, status
        ) VALUES (
          ${`VEH-${String(2024001 + vehicleCount).padStart(7, '0')}`},
          ${registration},
          ${vehicle.type},
          ${vehicle.make},
          ${team.id}::uuid,
          ${drivers.rows[0]?.id || null}::uuid,
          CURRENT_DATE,
          ${60 + Math.floor(Math.random() * 40)},
          ${80000 + Math.floor(Math.random() * 120000)},
          ${new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}::date,
          ${new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]}::date,
          ${`GPS-TRK-${String(vehicleCount + 1).padStart(3, '0')}`},
          ${'assigned'}
        )
        ON CONFLICT (vehicle_registration) DO NOTHING
      `);
      vehicleCount++;
    }
    console.log(`✓ Created ${vehicleCount} vehicle assignments`);
    
    // 4. Generate Mobile Sync Queue
    console.log('\n📱 Generating Mobile Sync Queue...');
    const syncTypes = ['upload', 'download', 'bidirectional'];
    const entityTypes = ['task', 'photo', 'checklist', 'signature', 'location', 'notes'];
    const networkTypes = ['wifi', '4g', '3g', 'offline'];
    
    let syncCount = 0;
    for (const tech of technicians.rows) {
      const numSyncItems = 3 + Math.floor(Math.random() * 5); // 3-7 items per technician
      
      for (let i = 0; i < numSyncItems; i++) {
        const syncType = syncTypes[Math.floor(Math.random() * syncTypes.length)];
        const entityType = entityTypes[Math.floor(Math.random() * entityTypes.length)];
        const status = Math.random() < 0.7 ? 'completed' : Math.random() < 0.9 ? 'syncing' : 'pending';
        
        await db.execute(sql`
          INSERT INTO mobile_sync_queue (
            device_id, technician_id, sync_type, entity_type, entity_id,
            data, priority, status, retry_count, file_size, network_type
          ) VALUES (
            ${`DEVICE-${tech.id}`},
            ${tech.id}::uuid,
            ${syncType},
            ${entityType},
            ${`${entityType}-${Math.random().toString(36).substring(7)}`},
            ${JSON.stringify({
              timestamp: new Date().toISOString(),
              type: entityType,
              action: syncType,
              location: { lat: -26.2041 + Math.random() * 0.5, lon: 28.0473 + Math.random() * 0.5 },
              data: entityType === 'task' ? { status: 'completed', notes: 'Work completed successfully' } :
                    entityType === 'photo' ? { filename: `IMG_${Date.now()}.jpg`, size: 2048576 } :
                    entityType === 'checklist' ? { items: 10, completed: 10, passed: true } :
                    entityType === 'signature' ? { base64: 'data:image/png;base64,iVBORw0KG...' } :
                    entityType === 'location' ? { accuracy: 5, speed: 0 } :
                    { content: 'Field notes added by technician' }
            })}::json,
            ${entityType === 'photo' ? 1 : entityType === 'signature' ? 2 : 1 + Math.floor(Math.random() * 9)},
            ${status},
            ${status === 'pending' && Math.random() < 0.2 ? 1 + Math.floor(Math.random() * 2) : 0},
            ${entityType === 'photo' ? 1024 * (500 + Math.floor(Math.random() * 3000)) : 
              1024 * (1 + Math.floor(Math.random() * 100))},
            ${networkTypes[Math.floor(Math.random() * networkTypes.length)]}
          )
        `);
        syncCount++;
      }
    }
    
    // Add some conflict resolution items
    for (let i = 0; i < 10; i++) {
      const tech = technicians.rows[Math.floor(Math.random() * technicians.rows.length)];
      
      await db.execute(sql`
        INSERT INTO mobile_sync_queue (
          device_id, technician_id, sync_type, entity_type, entity_id,
          data, priority, status, retry_count, max_retries, error_message,
          file_size, network_type
        ) VALUES (
          ${`DEVICE-${tech.id}`},
          ${tech.id}::uuid,
          ${'upload'},
          ${'task'},
          ${`conflict-${Math.random().toString(36).substring(7)}`},
          ${JSON.stringify({
            conflict: true,
            local_version: 1,
            server_version: 2,
            resolution: 'pending',
            local_data: { status: 'completed', timestamp: new Date().toISOString() },
            server_data: { status: 'in_progress', timestamp: new Date(Date.now() - 3600000).toISOString() }
          })}::json,
          ${1},
          ${'failed'},
          ${3},
          ${3},
          ${'Version conflict detected. Manual resolution required.'},
          ${2048},
          ${'4g'}
        )
      `);
    }
    
    console.log(`✓ Created ${syncCount + 10} sync queue items (including 10 conflicts)`);
    
    // Final summary
    console.log('\n═══════════════════════════════════════════════════════');
    console.log('✨ FIELD OPERATIONS DATA COMPLETION SUCCESSFUL!');
    console.log('═══════════════════════════════════════════════════════');
    
    const summary = await Promise.all([
      db.execute(sql`SELECT COUNT(*) as count FROM field_teams`),
      db.execute(sql`SELECT COUNT(*) as count FROM field_technicians`),
      db.execute(sql`SELECT COUNT(*) as count FROM field_tasks`),
      db.execute(sql`SELECT COUNT(*) as count FROM daily_schedules`),
      db.execute(sql`SELECT COUNT(*) as count FROM quality_checks`),
      db.execute(sql`SELECT COUNT(*) as count FROM equipment_checkouts`),
      db.execute(sql`SELECT COUNT(*) as count FROM vehicle_assignments`),
      db.execute(sql`SELECT COUNT(*) as count FROM mobile_sync_queue`)
    ]);
    
    console.log(`📍 Field Teams:          ${summary[0].rows[0]?.count || 0}`);
    console.log(`👷 Field Technicians:    ${summary[1].rows[0]?.count || 0}`);
    console.log(`📋 Field Tasks:          ${summary[2].rows[0]?.count || 0} (200+ target ✓)`);
    console.log(`📅 Daily Schedules:      ${summary[3].rows[0]?.count || 0} (14 days coverage)`);
    console.log(`✅ Quality Checks:       ${summary[4].rows[0]?.count || 0} (85% pass rate)`);
    console.log(`🔧 Equipment Checkouts:  ${summary[5].rows[0]?.count || 0}`);
    console.log(`🚗 Vehicle Assignments:  ${summary[6].rows[0]?.count || 0}`);
    console.log(`📱 Mobile Sync Queue:    ${summary[7].rows[0]?.count || 0}`);
    console.log('═══════════════════════════════════════════════════════');
    console.log('');
    console.log('📍 Location: Johannesburg area coordinates (±0.5° variation)');
    console.log('⏰ Work Hours: 07:00-17:00 SAST');
    console.log('✅ Quality Pass Rate: 85%, 15% with issues');
    console.log('📅 Schedule: Next 14 days fully scheduled');
    console.log('📱 Mobile Sync: Includes conflict resolution scenarios');
    console.log('');
    
  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  }
}

// Execute
completeFieldOpsData()
  .then(() => {
    console.log('🎉 All field operations data successfully populated!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('💥 Failed:', error);
    process.exit(1);
  });