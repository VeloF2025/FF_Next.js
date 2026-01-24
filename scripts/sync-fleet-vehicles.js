/**
 * Sync Fleet Vehicles from Odoo
 *
 * Syncs fleet.vehicle records from Odoo to FibreFlow fleet_vehicles table.
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

  async getVehicles() {
    return this.call('fleet.vehicle', 'search_read', [[]], {
      fields: [
        'id', 'name', 'license_plate', 'model_id', 'brand_id', 'model_year',
        'color', 'vin_sn', 'state_id', 'driver_id', 'odometer', 'odometer_unit',
        'acquisition_date', 'car_value', 'fuel_type', 'transmission', 'write_date'
      ],
      limit: 100,
      order: 'write_date desc'
    });
  }
}

// Map Odoo state to FF status
function mapStatus(odooState) {
  if (!odooState) return 'active';
  const state = odooState.toLowerCase();
  if (state.includes('downgraded') || state.includes('sold')) return 'inactive';
  if (state.includes('draft')) return 'pending';
  if (state.includes('registered') || state.includes('active')) return 'active';
  return 'active';
}

// Parse make/model from Odoo model_id
function parseModel(modelName) {
  if (!modelName) return { make: null, model: null };
  // Format is typically "Make/Model" or "Make/Model Name"
  const parts = modelName.split('/');
  return {
    make: parts[0]?.trim() || null,
    model: parts.slice(1).join('/').trim() || null
  };
}

async function syncFleetVehicles() {
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║         SYNC FLEET VEHICLES FROM ODOO                        ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');

  const client = new OdooClient();
  await client.authenticate();
  console.log('✓ Connected to Odoo\n');

  const sql = neon(process.env.DATABASE_URL);

  // Get existing synced vehicles
  const existingVehicles = await sql`
    SELECT id, odoo_vehicle_id, registration FROM fleet_vehicles WHERE odoo_vehicle_id IS NOT NULL
  `;
  const existingByOdoo = new Map(existingVehicles.map(v => [v.odoo_vehicle_id, v.id]));
  const existingByReg = new Map(existingVehicles.map(v => [v.registration?.toLowerCase(), v.id]));
  console.log(`Already synced: ${existingByOdoo.size} vehicles\n`);

  // Also get vehicles without odoo_vehicle_id to match by registration
  const unlinkedVehicles = await sql`
    SELECT id, registration FROM fleet_vehicles WHERE odoo_vehicle_id IS NULL
  `;
  unlinkedVehicles.forEach(v => {
    if (v.registration && !existingByReg.has(v.registration.toLowerCase())) {
      existingByReg.set(v.registration.toLowerCase(), v.id);
    }
  });
  console.log(`Unlinked vehicles (can match by registration): ${unlinkedVehicles.length}\n`);

  // Fetch vehicles from Odoo
  console.log('=== Fetching vehicles from Odoo ===');
  const vehicles = await client.getVehicles();
  console.log(`Found ${vehicles.length} vehicles in Odoo\n`);

  // Process vehicles
  console.log('=== Syncing vehicles ===');
  let created = 0, updated = 0, linked = 0, errors = 0;

  for (const vehicle of vehicles) {
    try {
      const registration = vehicle.license_plate || '';
      const { make, model } = vehicle.model_id ? parseModel(vehicle.model_id[1]) : { make: null, model: null };
      const status = mapStatus(vehicle.state_id ? vehicle.state_id[1] : null);

      // Check if we already have this vehicle synced
      let existingId = existingByOdoo.get(vehicle.id);

      // If not synced, try to match by registration
      if (!existingId && registration) {
        existingId = existingByReg.get(registration.toLowerCase());
      }

      if (existingId) {
        // Update existing vehicle
        await sql`
          UPDATE fleet_vehicles SET
            registration = ${registration},
            make = ${vehicle.brand_id ? vehicle.brand_id[1] : make},
            model = ${model},
            year = ${vehicle.model_year || null},
            color = ${vehicle.color || null},
            vin = ${vehicle.vin_sn || null},
            status = ${status},
            current_odometer = ${vehicle.odometer || 0},
            odometer_unit = ${vehicle.odometer_unit || 'kilometers'},
            last_odometer_update = ${vehicle.write_date ? new Date(vehicle.write_date) : null},
            odoo_vehicle_id = ${vehicle.id},
            updated_at = NOW()
          WHERE id = ${existingId}
        `;

        if (!existingByOdoo.has(vehicle.id)) {
          linked++;
          console.log(`  Linked: ${registration} to Odoo ID ${vehicle.id}`);
        } else {
          updated++;
        }
      } else {
        // Insert new vehicle
        // Determine vehicle_type from model name
        let vehicleType = 'bakkie';
        const modelLower = (model || '').toLowerCase();
        if (modelLower.includes('sedan') || modelLower.includes('car')) vehicleType = 'sedan';
        if (modelLower.includes('suv')) vehicleType = 'suv';
        if (modelLower.includes('truck')) vehicleType = 'truck';
        if (modelLower.includes('van')) vehicleType = 'van';
        if (modelLower.includes('trailer')) vehicleType = 'trailer';

        await sql`
          INSERT INTO fleet_vehicles (
            registration, vehicle_type, make, model, year, color, vin,
            status, current_odometer, odometer_unit, last_odometer_update,
            odoo_vehicle_id, created_at
          ) VALUES (
            ${registration}, ${vehicleType},
            ${vehicle.brand_id ? vehicle.brand_id[1] : make}, ${model},
            ${vehicle.model_year || null}, ${vehicle.color || null}, ${vehicle.vin_sn || null},
            ${status}, ${vehicle.odometer || 0}, ${vehicle.odometer_unit || 'kilometers'},
            ${vehicle.write_date ? new Date(vehicle.write_date) : null},
            ${vehicle.id}, NOW()
          )
        `;
        created++;
        console.log(`  Created: ${registration} (${make} ${model})`);
      }

    } catch (e) {
      errors++;
      console.log(`  Error on ${vehicle.license_plate}: ${e.message.substring(0, 60)}`);
    }
  }

  // Final stats
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                         SYNC COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════');

  const finalStats = await sql`
    SELECT
      COUNT(*) as total,
      COUNT(*) FILTER (WHERE odoo_vehicle_id IS NOT NULL) as synced,
      COUNT(*) FILTER (WHERE status = 'active') as active
    FROM fleet_vehicles
  `;

  const s = finalStats[0];
  console.log(`Total Vehicles: ${s.total}`);
  console.log(`  Synced from Odoo: ${s.synced}`);
  console.log(`  Active: ${s.active}`);
  console.log(`\nCreated: ${created}, Updated: ${updated}, Linked: ${linked}, Errors: ${errors}`);
}

syncFleetVehicles().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
