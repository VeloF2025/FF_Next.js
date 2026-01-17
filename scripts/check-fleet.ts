import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL!);

async function check() {
  // Count all vehicles
  const total = await sql`SELECT COUNT(*) as count FROM fleet_vehicles`;
  console.log('Total fleet vehicles:', total[0].count);

  // Count Odoo-synced vs others
  const odooCount = await sql`SELECT COUNT(*) as count FROM fleet_vehicles WHERE odoo_vehicle_id IS NOT NULL`;
  const nonOdooCount = await sql`SELECT COUNT(*) as count FROM fleet_vehicles WHERE odoo_vehicle_id IS NULL`;
  console.log('Odoo-synced:', odooCount[0].count);
  console.log('Non-Odoo (existing/seed):', nonOdooCount[0].count);

  if (Number(total[0].count) > 0) {
    console.log('\n--- EXISTING VEHICLES ---');
    const all = await sql`
      SELECT id, registration, make, model, odoo_vehicle_id, created_at
      FROM fleet_vehicles
      ORDER BY created_at DESC
      LIMIT 25
    `;
    for (const v of all) {
      const source = v.odoo_vehicle_id ? 'Odoo ID: ' + v.odoo_vehicle_id : 'Seed/Manual';
      const makeModel = (v.make || '') + ' ' + (v.model || '');
      console.log('  [' + v.registration + '] ' + makeModel.trim() + ' - ' + source);
    }
  }

  // Check service logs
  const serviceLogs = await sql`SELECT COUNT(*) as count FROM fleet_service_logs`;
  console.log('\nFleet service logs:', serviceLogs[0].count);

  // Check odometer history
  const odometer = await sql`SELECT COUNT(*) as count FROM fleet_odometer_history`;
  console.log('Odometer history entries:', odometer[0].count);
}
check();
