import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL!);

async function run() {
  const cols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'fleet_vehicles' AND column_name = 'odoo_vehicle_id'
  `;
  
  if (cols.length === 0) {
    console.log('Adding odoo_vehicle_id column...');
    await sql`ALTER TABLE fleet_vehicles ADD COLUMN odoo_vehicle_id INTEGER`;
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_fleet_vehicles_odoo ON fleet_vehicles(odoo_vehicle_id) WHERE odoo_vehicle_id IS NOT NULL`;
    console.log('Done!');
  } else {
    console.log('odoo_vehicle_id column already exists');
  }
}
run();
