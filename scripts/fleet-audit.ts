import { neon } from '@neondatabase/serverless';

const sql = neon(process.env.DATABASE_URL!);

async function audit() {
  const reg = 'KR27FNGP';

  // 1. Vehicle
  const vehicle = await sql`SELECT * FROM fleet_vehicles WHERE registration = ${reg}`;
  console.log('=== 1. VEHICLE ===');
  console.log(JSON.stringify(vehicle[0] || 'NOT FOUND', null, 2));

  if (!vehicle[0]) {
    console.log('Vehicle not found, stopping audit');
    return;
  }
  const vid = vehicle[0].id;

  // 2. Calibration
  const calibration = await sql`SELECT * FROM fleet_vehicle_calibration WHERE vehicle_id = ${vid}`;
  console.log('\n=== 2. CALIBRATION ===');
  console.log(calibration.length ? JSON.stringify(calibration[0], null, 2) : 'NO CALIBRATION');

  // 3. Check-ins
  const checkIns = await sql`SELECT id, check_type, check_date, status, odometer_reading, driver_name FROM fleet_check_records WHERE vehicle_id = ${vid} ORDER BY created_at DESC LIMIT 5`;
  console.log('\n=== 3. CHECK-INS (last 5) ===');
  console.log(JSON.stringify(checkIns, null, 2));

  // 4. Odometer history
  const odometer = await sql`SELECT reading, source, recorded_at, discrepancy_flag FROM fleet_odometer_history WHERE vehicle_id = ${vid} ORDER BY recorded_at DESC LIMIT 5`;
  console.log('\n=== 4. ODOMETER HISTORY ===');
  console.log(JSON.stringify(odometer, null, 2));

  // 5. Fuel transactions
  const fuel = await sql`SELECT transaction_date, litres, amount_rand, odometer_reading FROM fleet_fuel_transactions WHERE vehicle_id = ${vid} ORDER BY transaction_date DESC LIMIT 5`;
  console.log('\n=== 5. FUEL TRANSACTIONS ===');
  console.log(JSON.stringify(fuel, null, 2));

  // 6. Documents
  const docs = await sql`SELECT document_type, document_name, expiry_date FROM fleet_vehicle_documents WHERE vehicle_id = ${vid}`;
  console.log('\n=== 6. DOCUMENTS ===');
  console.log(JSON.stringify(docs, null, 2));

  // 7. License disc
  const disc = await sql`SELECT license_number, expiry_date, status FROM fleet_license_disc WHERE vehicle_id = ${vid}`;
  console.log('\n=== 7. LICENSE DISC ===');
  console.log(JSON.stringify(disc, null, 2));

  // 8. Insurance
  const insurance = await sql`SELECT insurance_company, policy_number, expiry_date FROM fleet_vehicle_insurance WHERE vehicle_id = ${vid}`;
  console.log('\n=== 8. INSURANCE ===');
  console.log(JSON.stringify(insurance, null, 2));

  // 9. Finance
  const finance = await sql`SELECT finance_company, finance_type, monthly_payment FROM fleet_vehicle_finance WHERE vehicle_id = ${vid}`;
  console.log('\n=== 9. FINANCE ===');
  console.log(JSON.stringify(finance, null, 2));

  // 10. Lease
  const lease = await sql`SELECT company_name, lease_type, monthly_cost, end_date FROM fleet_vehicle_lease WHERE vehicle_id = ${vid}`;
  console.log('\n=== 10. LEASE ===');
  console.log(JSON.stringify(lease, null, 2));

  // 11. Assignment - get assigned driver from fleet_vehicles table
  const driverId = vehicle[0].assigned_driver_id;
  const driver = driverId
    ? await sql`SELECT id, first_name, last_name, phone, email, status FROM staff WHERE id = ${driverId}`
    : [];
  console.log('\n=== 11. ASSIGNED DRIVER ===');
  console.log(JSON.stringify(driver, null, 2));

  // 12. Photos from check-ins
  const photos = await sql`SELECT cp.photo_type, cp.file_url, cp.latitude, cp.longitude, cr.check_date
    FROM fleet_check_photos cp
    JOIN fleet_check_records cr ON cr.id = cp.record_id
    WHERE cr.vehicle_id = ${vid}
    ORDER BY cp.captured_at DESC LIMIT 10`;
  console.log('\n=== 12. CHECK-IN PHOTOS (last 10) ===');
  console.log(JSON.stringify(photos, null, 2));

  // 13. VLM Results
  const vlm = await sql`SELECT pvr.analysis_type, pvr.extracted_value, pvr.confidence, pvr.processing_status
    FROM fleet_photo_vlm_results pvr
    JOIN fleet_check_photos cp ON cp.id = pvr.photo_id
    JOIN fleet_check_records cr ON cr.id = cp.record_id
    WHERE cr.vehicle_id = ${vid}
    ORDER BY pvr.created_at DESC LIMIT 10`;
  console.log('\n=== 13. VLM RESULTS (last 10) ===');
  console.log(JSON.stringify(vlm, null, 2));

  // 14. Fuel anomalies
  const anomalies = await sql`SELECT anomaly_type, severity, status, detected_at FROM fleet_fuel_anomalies WHERE vehicle_id = ${vid} ORDER BY detected_at DESC LIMIT 5`;
  console.log('\n=== 14. FUEL ANOMALIES ===');
  console.log(JSON.stringify(anomalies, null, 2));

  // 15. GPS Jobs
  const gpsJobs = await sql`SELECT id, file_name, status, total_gps_points, period_start, period_end FROM fleet_gps_jobs WHERE vehicle_id = ${vid} ORDER BY created_at DESC LIMIT 5`;
  console.log('\n=== 15. GPS INVESTIGATION JOBS ===');
  console.log(JSON.stringify(gpsJobs, null, 2));

  // 16. Service intervals
  const services = await sql`SELECT service_type, next_service_date, next_service_km FROM fleet_service_intervals WHERE vehicle_id = ${vid}`;
  console.log('\n=== 16. SERVICE INTERVALS ===');
  console.log(JSON.stringify(services, null, 2));

  // 17. Portal sessions
  const sessions = await sql`SELECT * FROM fleet_portal_sessions WHERE vehicle_id = ${vid} ORDER BY created_at DESC LIMIT 5`;
  console.log('\n=== 17. PORTAL SESSIONS ===');
  console.log(JSON.stringify(sessions, null, 2));

  // SUMMARY
  console.log('\n========== AUDIT SUMMARY ==========');
  console.log(`Vehicle: ${vehicle[0].registration} (${vehicle[0].make} ${vehicle[0].model})`);
  console.log(`Status: ${vehicle[0].status}`);
  console.log(`Calibrated: ${calibration.length > 0 ? 'YES' : 'NO'}`);
  console.log(`Check-ins: ${checkIns.length}`);
  console.log(`Odometer readings: ${odometer.length}`);
  console.log(`Fuel transactions: ${fuel.length}`);
  console.log(`Documents: ${docs.length}`);
  console.log(`License disc: ${disc.length > 0 ? disc[0].status : 'NONE'}`);
  console.log(`Insurance: ${insurance.length > 0 ? 'YES' : 'NO'}`);
  console.log(`Photos: ${photos.length}`);
  console.log(`VLM results: ${vlm.length}`);
}

audit().catch(console.error);
