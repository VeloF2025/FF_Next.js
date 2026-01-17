import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL!);

async function cleanup() {
  console.log('Cleaning up Hilux seed vehicle and all related data...\n');

  // Get the vehicle ID
  const vehicle = await sql`
    SELECT id FROM fleet_vehicles WHERE registration = 'GP 456-789'
  `;

  if (vehicle.length === 0) {
    console.log('Hilux not found, already deleted');
    return;
  }

  const vehicleId = vehicle[0].id;
  console.log('Vehicle ID:', vehicleId);

  // Delete all related records
  console.log('\nDeleting related records:');

  // vehicle_assignments uses fleet_vehicle_id
  await sql`DELETE FROM vehicle_assignments WHERE fleet_vehicle_id = ${vehicleId}::uuid`;
  console.log('  - vehicle_assignments cleared');

  // fleet_gps_jobs uses vehicle_id
  await sql`DELETE FROM fleet_gps_jobs WHERE vehicle_id = ${vehicleId}::uuid`;
  console.log('  - fleet_gps_jobs cleared');

  // fleet_service_logs uses vehicle_id
  await sql`DELETE FROM fleet_service_logs WHERE vehicle_id = ${vehicleId}::uuid`;
  console.log('  - fleet_service_logs cleared');

  // fleet_odometer_history uses vehicle_id
  await sql`DELETE FROM fleet_odometer_history WHERE vehicle_id = ${vehicleId}::uuid`;
  console.log('  - fleet_odometer_history cleared');

  // Now delete the vehicle
  console.log('\nDeleting Hilux seed vehicle...');
  const deleted = await sql`
    DELETE FROM fleet_vehicles
    WHERE registration = 'GP 456-789'
    RETURNING registration, make, model
  `;

  if (deleted.length > 0) {
    console.log('Deleted:', deleted[0].registration, deleted[0].make, deleted[0].model);
  }

  // Show remaining
  const remaining = await sql`SELECT registration, make, model FROM fleet_vehicles`;
  console.log('\nRemaining vehicles:');
  for (const v of remaining) {
    console.log('  -', v.registration, v.make, v.model);
  }
}
cleanup();
