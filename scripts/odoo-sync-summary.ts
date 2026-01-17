/**
 * Odoo Sync Summary
 *
 * Shows a summary of all synced data from Odoo to FibreFlow
 */

import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

const sql = neon(process.env.DATABASE_URL!);

async function summary() {
  console.log('===================================================================');
  console.log('              ODOO → FIBREFLOW SYNC SUMMARY                        ');
  console.log('===================================================================\n');

  // Suppliers
  const suppliers = await sql`
    SELECT COUNT(*) as total,
           COUNT(odoo_partner_id) as from_odoo
    FROM suppliers
  `;
  console.log('SUPPLIERS:');
  console.log('  Total in FF:', suppliers[0].total);
  console.log('  Synced from Odoo:', suppliers[0].from_odoo);

  // List synced suppliers
  const supplierList = await sql`
    SELECT name, odoo_partner_id FROM suppliers WHERE odoo_partner_id IS NOT NULL ORDER BY name
  `;
  for (const s of supplierList) {
    console.log('    -', `[${s.odoo_partner_id}]`, s.name);
  }

  // Purchase Orders
  const pos = await sql`
    SELECT COUNT(*) as total,
           COUNT(odoo_po_id) as from_odoo,
           SUM(total_amount) as total_value
    FROM purchase_orders
  `;
  console.log('\nPURCHASE ORDERS:');
  console.log('  Total in FF:', pos[0].total);
  console.log('  Synced from Odoo:', pos[0].from_odoo);
  console.log('  Total Value: R', Number(pos[0].total_value || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2 }));

  // PO Line Items
  const poItems = await sql`
    SELECT COUNT(*) as total,
           COUNT(odoo_line_id) as from_odoo
    FROM purchase_order_items
  `;
  console.log('\nPO LINE ITEMS:');
  console.log('  Total in FF:', poItems[0].total);
  console.log('  Synced from Odoo:', poItems[0].from_odoo);

  // Fleet Vehicles
  const vehicles = await sql`
    SELECT COUNT(*) as total,
           COUNT(odoo_vehicle_id) as from_odoo
    FROM fleet_vehicles
  `;
  console.log('\nFLEET VEHICLES:');
  console.log('  Total in FF:', vehicles[0].total);
  console.log('  Synced from Odoo:', vehicles[0].from_odoo);

  // List synced vehicles
  const vehicleList = await sql`
    SELECT registration, make, model, odoo_vehicle_id
    FROM fleet_vehicles WHERE odoo_vehicle_id IS NOT NULL ORDER BY registration
  `;
  for (const v of vehicleList.slice(0, 10)) {
    console.log('    -', `[${v.odoo_vehicle_id}]`, v.registration, '-', v.make, v.model);
  }
  if (vehicleList.length > 10) {
    console.log('    ... and', vehicleList.length - 10, 'more');
  }

  // Service Logs
  const serviceLogs = await sql`
    SELECT COUNT(*) as total,
           COUNT(odoo_service_id) as from_odoo,
           SUM(amount) as total_cost
    FROM fleet_service_logs
  `;
  console.log('\nFLEET SERVICE LOGS:');
  console.log('  Total in FF:', serviceLogs[0].total);
  console.log('  Synced from Odoo:', serviceLogs[0].from_odoo);
  console.log('  Total Service Cost: R', Number(serviceLogs[0].total_cost || 0).toLocaleString('en-ZA', { minimumFractionDigits: 2 }));

  // Odometer History
  const odometer = await sql`
    SELECT COUNT(*) as total,
           COUNT(odoo_odometer_id) as from_odoo
    FROM fleet_odometer_history
  `;
  console.log('\nODOMETER READINGS:');
  console.log('  Total in FF:', odometer[0].total);
  console.log('  Synced from Odoo:', odometer[0].from_odoo);

  console.log('\n===================================================================');
  console.log('                         SYNC COMPLETE                             ');
  console.log('===================================================================\n');

  // Show what's NOT synced
  console.log('NOT YET SYNCED (requires additional migration):');
  console.log('  - Products/Materials (200 in Odoo, 158 in FF material_catalog)');
  console.log('  - Stock Transfers/GRNs (100 in Odoo, 0 GRNs in FF)');
  console.log('  - Assets (check Odoo for asset count)');
}

summary().catch(console.error);
