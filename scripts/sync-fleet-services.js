/**
 * Sync Fleet Service Records from Odoo
 *
 * Syncs fleet.vehicle.log.services from Odoo to FibreFlow fleet_service_logs table.
 */

const { neon } = require('@neondatabase/serverless');

class OdooClient {
  constructor() {
    this.url = 'https://velocityfibre.odoo.com';
    this.db = 'velocityfibre';
    this.username = 'jacques@velocityfibre.co.za';
    this.password = 'Ledene9685@';
    this.uid = null;
  }

  async authenticate() {
    const response = await fetch(`${this.url}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'call',
        params: { service: 'common', method: 'authenticate', args: [this.db, this.username, this.password, {}] },
        id: 1
      })
    });
    const data = await response.json();
    this.uid = data.result;
    if (!this.uid) throw new Error('Authentication failed');
    return this.uid;
  }

  async call(model, method, args, kwargs = {}) {
    const response = await fetch(`${this.url}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'call',
        params: { service: 'object', method: 'execute_kw', args: [this.db, this.uid, this.password, model, method, args, kwargs] },
        id: Date.now()
      })
    });
    const data = await response.json();
    if (data.error) throw new Error(data.error.data?.message || data.error.message);
    return data.result;
  }

  async getServiceLogs() {
    return this.call('fleet.vehicle.log.services', 'search_read', [[]], {
      fields: [
        'id', 'vehicle_id', 'description', 'date', 'odometer', 'amount',
        'service_type_id', 'state', 'vendor_id', 'notes', 'write_date'
      ],
      limit: 500,
      order: 'date desc'
    });
  }
}

async function syncFleetServices() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║         SYNC FLEET SERVICES FROM ODOO                        ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const client = new OdooClient();
  await client.authenticate();
  console.log('✓ Connected to Odoo\n');

  const sql = neon(process.env.DATABASE_URL);

  // Get vehicle mapping (FF id by Odoo id)
  const vehicles = await sql`
    SELECT id, odoo_vehicle_id FROM fleet_vehicles WHERE odoo_vehicle_id IS NOT NULL
  `;
  const vehicleMap = new Map(vehicles.map(v => [v.odoo_vehicle_id, v.id]));
  console.log(`Vehicle mapping: ${vehicleMap.size} vehicles\n`);

  // Get existing synced service logs
  const existingLogs = await sql`
    SELECT odoo_service_id FROM fleet_service_logs WHERE odoo_service_id IS NOT NULL
  `;
  const existingSet = new Set(existingLogs.map(l => l.odoo_service_id));
  console.log(`Already synced: ${existingSet.size} service logs\n`);

  // Fetch service logs from Odoo
  console.log('=== Fetching service logs from Odoo ===');
  const services = await client.getServiceLogs();
  console.log(`Found ${services.length} service logs in Odoo\n`);

  // Process services
  console.log('=== Syncing service logs ===');
  let created = 0, updated = 0, skipped = 0, errors = 0;

  for (const svc of services) {
    try {
      const isExisting = existingSet.has(svc.id);
      const vehicleId = svc.vehicle_id ? vehicleMap.get(svc.vehicle_id[0]) : null;

      // Skip if we can't link to a vehicle
      if (!vehicleId) {
        skipped++;
        continue;
      }

      const serviceType = svc.service_type_id ? svc.service_type_id[1] : 'General Service';
      const vendorName = svc.vendor_id ? svc.vendor_id[1] : null;

      if (isExisting) {
        // Update existing service log
        await sql`
          UPDATE fleet_service_logs SET
            service_date = ${svc.date ? new Date(svc.date) : null},
            service_type = ${serviceType},
            amount = ${svc.amount || 0},
            odometer_value = ${svc.odometer || 0},
            description = ${svc.description || svc.notes || null},
            vendor_name = ${vendorName},
            synced_at = NOW(),
            updated_at = NOW()
          WHERE odoo_service_id = ${svc.id}
        `;
        updated++;
      } else {
        // Insert new service log
        await sql`
          INSERT INTO fleet_service_logs (
            vehicle_id, odoo_service_id, service_date, service_type,
            amount, currency, odometer_value, odometer_unit,
            description, vendor_name, created_at, synced_at
          ) VALUES (
            ${vehicleId}, ${svc.id}, ${svc.date ? new Date(svc.date) : null}, ${serviceType},
            ${svc.amount || 0}, 'ZAR', ${svc.odometer || 0}, 'kilometers',
            ${svc.description || svc.notes || null}, ${vendorName}, NOW(), NOW()
          )
        `;
        created++;
      }

      // Progress
      if ((created + updated) % 50 === 0 && (created + updated) > 0) {
        console.log(`  Progress: ${created} created, ${updated} updated, ${skipped} skipped`);
      }

    } catch (e) {
      errors++;
      console.log(`  Error on service ${svc.id}: ${e.message.substring(0, 60)}`);
    }
  }

  // Final stats
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                         SYNC COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════');

  const finalStats = await sql`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE odoo_service_id IS NOT NULL) as synced,
      SUM(amount) as total_cost,
      COUNT(DISTINCT vehicle_id) as vehicles_serviced
    FROM fleet_service_logs
  `;

  const s = finalStats[0];
  console.log(`Total Service Logs: ${s.total}`);
  console.log(`  Synced from Odoo: ${s.synced}`);
  console.log(`  Vehicles Serviced: ${s.vehicles_serviced}`);
  console.log(`Total Service Cost: R ${Number(s.total_cost || 0).toLocaleString()}`);
  console.log(`\nCreated: ${created}, Updated: ${updated}, Skipped: ${skipped}, Errors: ${errors}`);
}

syncFleetServices().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
