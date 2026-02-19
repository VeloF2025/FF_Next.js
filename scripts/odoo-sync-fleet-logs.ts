/**
 * Odoo Fleet Service Logs Sync (standalone retry)
 * Run: npx tsx scripts/odoo-sync-fleet-logs.ts
 */
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { OdooClient } from '../src/services/odoo/odooClient';
import { neon } from '@neondatabase/serverless';

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) { console.error('No DATABASE_URL'); process.exit(1); }

  const sql = neon(dbUrl);
  const client = new OdooClient({
    url: 'https://velocityfibre.odoo.com',
    db: 'velocityfibre',
    username: 'jacques@velocityfibre.co.za',
    password: 'Ledene9685@',
  });
  await client.testConnection();

  console.log('--- FLEET SERVICE LOGS SYNC ---');
  const serviceLogs = await client.searchRead<{
    id: number; vehicle_id: [number, string] | false;
    description: string; date: string; amount: number;
    odometer: number; service_type_id: [number, string] | false;
    state: string; notes: string;
  }>('fleet.vehicle.log.services', {
    fields: ['id', 'vehicle_id', 'description', 'date', 'amount',
      'odometer', 'service_type_id', 'state', 'notes'],
    limit: 1000,
    order: 'date DESC',
  });
  console.log(`Odoo service logs: ${serviceLogs.length}`);

  const existingLogs = await sql`SELECT odoo_service_id FROM fleet_service_logs WHERE odoo_service_id IS NOT NULL`;
  const existingLogIds = new Set(existingLogs.map((l: { odoo_service_id: number }) => l.odoo_service_id));
  console.log(`Already synced: ${existingLogIds.size}`);

  const vehMap = await sql`SELECT id, odoo_vehicle_id FROM fleet_vehicles WHERE odoo_vehicle_id IS NOT NULL`;
  const vehByOdoo = new Map(vehMap.map((v: { odoo_vehicle_id: number; id: string }) =>
    [v.odoo_vehicle_id, v.id]));

  let created = 0;
  let skipped = 0;
  for (const log of serviceLogs) {
    if (existingLogIds.has(log.id)) { skipped++; continue; }
    const vehicleOdooId = log.vehicle_id ? log.vehicle_id[0] : null;
    const vehicleId = vehicleOdooId ? vehByOdoo.get(vehicleOdooId) : null;
    if (!vehicleId) { skipped++; continue; }

    await sql`
      INSERT INTO fleet_service_logs (
        id, vehicle_id, service_type, description, service_date,
        amount, odometer_value, odometer_unit,
        odoo_service_id, synced_at, created_at, updated_at
      ) VALUES (
        gen_random_uuid(), ${vehicleId},
        ${log.service_type_id ? log.service_type_id[1] : 'General'},
        ${log.description || 'Odoo service log'},
        ${log.date || null},
        ${log.amount || 0}, ${log.odometer || null}, 'km',
        ${log.id}, NOW(), NOW(), NOW()
      )
    `;
    created++;
  }
  console.log(`Created: ${created}, Skipped: ${skipped}`);
}

main().catch((err) => {
  console.error('Failed:', err.message);
  process.exit(1);
});
