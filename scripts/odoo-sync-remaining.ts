/**
 * Odoo Remaining Data Sync
 * Syncs: Vendor Bills, Serial Numbers, Reorder Rules, Warehouses→Locations,
 *        Product Categories, Fleet Vehicles (update), Fleet Service Logs,
 *        Project↔Warehouse mapping
 *
 * Run: npx tsx scripts/odoo-sync-remaining.ts [--dry-run]
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { OdooClient } from '../src/services/odoo/odooClient';
import { neon } from '@neondatabase/serverless';

const ODOO_CONFIG = {
  url: 'https://velocityfibre.odoo.com',
  db: 'velocityfibre',
  username: 'jacques@velocityfibre.co.za',
  password: 'Ledene9685@',
};

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) { console.error('No DATABASE_URL'); process.exit(1); }

  const sql = neon(dbUrl);
  const client = new OdooClient(ODOO_CONFIG);

  console.log('===================================================================');
  console.log('           ODOO REMAINING DATA SYNC                                ');
  console.log('===================================================================');
  console.log('Mode:', dryRun ? 'DRY RUN' : 'LIVE');
  console.log('');

  const conn = await client.testConnection();
  if (!conn.success) { console.error('Connection failed'); process.exit(1); }
  console.log('Connected to Odoo', conn.version, '\n');

  // ================================================================
  // 1. WAREHOUSES → stock_locations + projects mapping
  // ================================================================
  console.log('--- 1. WAREHOUSES → STOCK LOCATIONS ---');
  const warehouses = await client.searchRead<{
    id: number; name: string; code: string; active: boolean;
    partner_id: [number, string] | false;
  }>('stock.warehouse', {
    fields: ['id', 'name', 'code', 'active', 'partner_id'],
    limit: 50,
  });
  console.log(`  Odoo warehouses: ${warehouses.length}`);

  // Get existing locations
  const existingLocs = await sql`SELECT id, name, code FROM stock_locations`;
  const locByCode = new Map(existingLocs.map((l: { code: string; id: string }) => [l.code, l.id]));
  const locByName = new Map(existingLocs.map((l: { name: string; id: string }) => [l.name.toLowerCase(), l.id]));

  let whCreated = 0, whUpdated = 0, whSkipped = 0;
  for (const wh of warehouses) {
    // Map warehouse code to location code pattern
    const locCode = `WH-${wh.code}`;
    const existing = locByCode.get(locCode) || locByCode.get(wh.code) || locByName.get(wh.name.toLowerCase());

    if (existing) {
      whSkipped++;
      console.log(`  - ${wh.code} ${wh.name} (already exists)`);
    } else {
      if (!dryRun) {
        await sql`
          INSERT INTO stock_locations (id, name, code, location_type, is_active, created_at, updated_at)
          VALUES (gen_random_uuid(), ${wh.name}, ${locCode}, 'warehouse', ${wh.active}, NOW(), NOW())
        `;
      }
      whCreated++;
      console.log(`  + ${wh.code} ${wh.name} → NEW location`);
    }

    // Update project mapping if warehouse code matches
    if (!dryRun) {
      await sql`
        UPDATE projects SET odoo_warehouse_id = ${wh.id}
        WHERE odoo_warehouse_code = ${wh.code} AND odoo_warehouse_id IS NULL
      `;
    }
  }
  console.log(`  Result: ${whCreated} created, ${whUpdated} updated, ${whSkipped} skipped\n`);

  // ================================================================
  // 2. VENDOR BILLS → vendor_invoices
  // ================================================================
  console.log('--- 2. VENDOR BILLS → VENDOR INVOICES ---');
  const bills = await client.searchRead<{
    id: number; name: string; ref: string; partner_id: [number, string] | false;
    amount_untaxed: number; amount_tax: number; amount_total: number;
    amount_residual: number; state: string; payment_state: string;
    invoice_date: string; invoice_date_due: string; date: string;
    invoice_origin: string;
  }>('account.move', {
    domain: [['move_type', '=', 'in_invoice']],
    fields: ['id', 'name', 'ref', 'partner_id', 'amount_untaxed', 'amount_tax',
      'amount_total', 'amount_residual', 'state', 'payment_state',
      'invoice_date', 'invoice_date_due', 'date', 'invoice_origin'],
    limit: 500,
    order: 'invoice_date DESC',
  });
  console.log(`  Odoo vendor bills: ${bills.length}`);

  // Build supplier map (odoo_partner_id → FF supplier_id)
  const supplierMap = await sql`SELECT id, odoo_partner_id FROM suppliers WHERE odoo_partner_id IS NOT NULL`;
  const supplierByOdoo = new Map(supplierMap.map((s: { odoo_partner_id: number; id: number }) =>
    [s.odoo_partner_id, s.id]));

  // Check existing invoices
  const existingInvoices = await sql`SELECT odoo_move_id FROM vendor_invoices WHERE odoo_move_id IS NOT NULL`;
  const existingMoveIds = new Set(existingInvoices.map((i: { odoo_move_id: number }) => i.odoo_move_id));

  // Build PO map (odoo origin → PO id)
  const poMap = await sql`SELECT id, po_number FROM purchase_orders`;
  const poByNumber = new Map(poMap.map((p: { po_number: string; id: string }) => [p.po_number, p.id]));

  let billCreated = 0, billSkipped = 0;
  for (const bill of bills) {
    if (existingMoveIds.has(bill.id)) {
      billSkipped++;
      continue;
    }

    const partnerId = bill.partner_id ? bill.partner_id[0] : null;
    const supplierId = partnerId ? supplierByOdoo.get(partnerId) : null;

    // Try to link to PO via invoice_origin (e.g., "P00123")
    let poId = null;
    if (bill.invoice_origin) {
      const origins = bill.invoice_origin.split(',').map((s: string) => s.trim());
      for (const origin of origins) {
        if (poByNumber.has(origin)) {
          poId = poByNumber.get(origin);
          break;
        }
      }
    }

    // Map Odoo states
    const status = bill.state === 'posted' ? 'approved' :
                   bill.state === 'draft' ? 'draft' :
                   bill.state === 'cancel' ? 'cancelled' : bill.state;
    const paymentStatus = bill.payment_state === 'paid' ? 'paid' :
                          bill.payment_state === 'partial' ? 'partial' :
                          bill.payment_state === 'not_paid' ? 'unpaid' :
                          bill.payment_state === 'in_payment' ? 'in_payment' : bill.payment_state;

    if (!dryRun) {
      await sql`
        INSERT INTO vendor_invoices (
          id, invoice_number, reference, supplier_id, purchase_order_id,
          invoice_date, due_date, accounting_date,
          amount_untaxed, amount_tax, amount_total, amount_paid, amount_residual,
          currency, status, payment_status,
          odoo_move_id, odoo_partner_id, odoo_origin, odoo_synced_at,
          created_at, updated_at
        ) VALUES (
          gen_random_uuid(), ${bill.name}, ${bill.ref || null}, ${supplierId}, ${poId},
          ${bill.invoice_date || null}, ${bill.invoice_date_due || null}, ${bill.date || null},
          ${bill.amount_untaxed}, ${bill.amount_tax}, ${bill.amount_total},
          ${bill.amount_total - bill.amount_residual}, ${bill.amount_residual},
          'ZAR', ${status}, ${paymentStatus},
          ${bill.id}, ${partnerId}, ${bill.invoice_origin || null}, NOW(),
          NOW(), NOW()
        )
      `;
    }
    billCreated++;
    const supplierName = bill.partner_id ? bill.partner_id[1] : 'N/A';
    console.log(`  + ${bill.name} | ${supplierName} | R${bill.amount_total} | ${status} | PO:${poId ? 'linked' : 'none'}`);
  }
  console.log(`  Result: ${billCreated} created, ${billSkipped} skipped\n`);

  // ================================================================
  // 3. SERIAL NUMBERS → stock_serials
  // ================================================================
  console.log('--- 3. SERIAL NUMBERS → STOCK SERIALS ---');
  const lots = await client.searchRead<{
    id: number; name: string; product_id: [number, string] | false;
    create_date: string; write_date: string;
  }>('stock.lot', {
    fields: ['id', 'name', 'product_id', 'create_date', 'write_date'],
    limit: 1000,
  });
  console.log(`  Odoo lots/serials: ${lots.length}`);

  // Build stock_items map (odoo_product_id → FF id)
  const itemMap = await sql`SELECT id, odoo_product_id FROM stock_items WHERE odoo_product_id IS NOT NULL`;
  const itemByOdoo = new Map(itemMap.map((i: { odoo_product_id: number; id: string }) =>
    [i.odoo_product_id, i.id]));

  // Check existing serials
  const existingSerials = await sql`SELECT serial_number FROM stock_serials`;
  const existingSerialNums = new Set(existingSerials.map((s: { serial_number: string }) => s.serial_number));

  let serialCreated = 0, serialSkipped = 0;
  for (const lot of lots) {
    if (existingSerialNums.has(lot.name)) {
      serialSkipped++;
      continue;
    }

    const productOdooId = lot.product_id ? lot.product_id[0] : null;
    const stockItemId = productOdooId ? itemByOdoo.get(productOdooId) : null;

    if (!stockItemId) {
      console.log(`  ? ${lot.name} - no matching stock item (odoo product: ${lot.product_id ? lot.product_id[1] : 'N/A'})`);
      serialSkipped++;
      continue;
    }

    if (!dryRun) {
      await sql`
        INSERT INTO stock_serials (
          id, stock_item_id, serial_number, status, condition,
          received_date, created_at, updated_at
        ) VALUES (
          gen_random_uuid(), ${stockItemId}, ${lot.name}, 'available', 'good',
          ${lot.create_date}, NOW(), NOW()
        )
      `;
    }
    serialCreated++;
    const productName = lot.product_id ? lot.product_id[1] : 'N/A';
    console.log(`  + ${lot.name} → ${productName}`);
  }
  console.log(`  Result: ${serialCreated} created, ${serialSkipped} skipped\n`);

  // ================================================================
  // 4. REORDER RULES → stock_items min/max
  // ================================================================
  console.log('--- 4. REORDER RULES → STOCK ITEMS MIN/MAX ---');
  const rules = await client.searchRead<{
    id: number; product_id: [number, string] | false;
    product_min_qty: number; product_max_qty: number;
    qty_to_order: number;
  }>('stock.warehouse.orderpoint', {
    fields: ['id', 'product_id', 'product_min_qty', 'product_max_qty', 'qty_to_order'],
    limit: 500,
  });
  console.log(`  Odoo reorder rules: ${rules.length}`);

  let rulesUpdated = 0, rulesSkipped = 0;
  for (const rule of rules) {
    const productOdooId = rule.product_id ? rule.product_id[0] : null;
    const stockItemId = productOdooId ? itemByOdoo.get(productOdooId) : null;

    if (!stockItemId) {
      rulesSkipped++;
      continue;
    }

    // Only update if reorder qty is meaningful (> 0)
    if (rule.qty_to_order > 0 || rule.product_min_qty > 0 || rule.product_max_qty > 0) {
      if (!dryRun) {
        await sql`
          UPDATE stock_items
          SET min_stock_level = ${rule.product_min_qty},
              max_stock_level = ${rule.product_max_qty},
              reorder_quantity = ${rule.qty_to_order},
              updated_at = NOW()
          WHERE id = ${stockItemId}
        `;
      }
      rulesUpdated++;
      const name = rule.product_id ? rule.product_id[1] : 'N/A';
      console.log(`  ~ ${name}: min=${rule.product_min_qty} max=${rule.product_max_qty} reorder=${rule.qty_to_order}`);
    } else {
      rulesSkipped++;
    }
  }
  console.log(`  Result: ${rulesUpdated} updated, ${rulesSkipped} skipped\n`);

  // ================================================================
  // 5. PRODUCT CATEGORIES → stock_items.category update
  // ================================================================
  console.log('--- 5. PRODUCT CATEGORIES ---');
  const categories = await client.searchRead<{
    id: number; name: string; complete_name: string;
    parent_id: [number, string] | false;
  }>('product.category', {
    fields: ['id', 'name', 'complete_name', 'parent_id'],
    limit: 100,
  });
  console.log(`  Odoo categories: ${categories.length}`);
  for (const cat of categories) {
    console.log(`  - [${cat.id}] ${cat.complete_name}`);
  }
  // Categories are already synced via product sync (categ_id maps to category field)
  console.log('  (Categories already mapped via product sync)\n');

  // ================================================================
  // 6. FLEET VEHICLES — update existing with missing Odoo data
  // ================================================================
  console.log('--- 6. FLEET VEHICLES UPDATE ---');
  const odooVehicles = await client.searchRead<{
    id: number; name: string; license_plate: string;
    model_id: [number, string] | false; driver_id: [number, string] | false;
    odometer: number; state_id: [number, string] | false;
    vin_sn: string; color: string; model_year: string;
    acquisition_date: string;
  }>('fleet.vehicle', {
    fields: ['id', 'name', 'license_plate', 'model_id', 'driver_id',
      'odometer', 'state_id', 'vin_sn', 'color', 'model_year', 'acquisition_date'],
    limit: 100,
  });
  console.log(`  Odoo vehicles: ${odooVehicles.length}`);

  // Get existing vehicles by odoo_vehicle_id
  const existingVehicles = await sql`SELECT id, registration, odoo_vehicle_id, current_odometer FROM fleet_vehicles`;
  const vehicleByOdoo = new Map(existingVehicles.map((v: { odoo_vehicle_id: number; id: string; current_odometer: number }) =>
    [v.odoo_vehicle_id, { id: v.id, odometer: v.current_odometer }]));
  const vehicleByReg = new Map(existingVehicles.map((v: { registration: string; id: string }) =>
    [v.registration?.replace(/\s/g, '').toUpperCase(), v.id]));

  let vehUpdated = 0, vehCreated = 0, vehSkipped = 0;
  for (const v of odooVehicles) {
    const plate = (v.license_plate || '').replace(/\s/g, '').toUpperCase();
    const existing = vehicleByOdoo.get(v.id) || (plate ? { id: vehicleByReg.get(plate) } : null);

    if (existing?.id) {
      // Update odometer if Odoo has a newer value
      if (!dryRun) {
        await sql`
          UPDATE fleet_vehicles
          SET odoo_vehicle_id = ${v.id},
              current_odometer = GREATEST(COALESCE(current_odometer, 0), ${v.odometer || 0}),
              updated_at = NOW()
          WHERE id = ${existing.id}
        `;
      }
      vehUpdated++;
      console.log(`  ~ ${plate || v.name} odometer:${v.odometer} (updated)`);
    } else if (plate) {
      // New vehicle not in FF
      if (!dryRun) {
        const modelName = v.model_id ? v.model_id[1] : '';
        const parts = modelName.split('/').map((s: string) => s.trim());
        const make = parts[0] || 'Unknown';
        const model = parts.slice(1).join(' ') || 'Unknown';

        await sql`
          INSERT INTO fleet_vehicles (
            id, registration, make, model, year, color, vin,
            status, current_odometer, odometer_unit, odoo_vehicle_id,
            created_at, updated_at
          ) VALUES (
            gen_random_uuid(), ${plate}, ${make}, ${model},
            ${v.model_year ? parseInt(v.model_year) : null}, ${v.color || null}, ${v.vin_sn || null},
            'active', ${v.odometer || 0}, 'km', ${v.id},
            NOW(), NOW()
          )
        `;
      }
      vehCreated++;
      console.log(`  + ${plate} ${v.name} (NEW)`);
    } else {
      vehSkipped++;
    }
  }
  console.log(`  Result: ${vehCreated} created, ${vehUpdated} updated, ${vehSkipped} skipped\n`);

  // ================================================================
  // 7. FLEET SERVICE LOGS → fleet_service_logs
  // ================================================================
  console.log('--- 7. FLEET SERVICE LOGS ---');
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
  console.log(`  Odoo service logs: ${serviceLogs.length}`);

  // Check if fleet_service_logs has odoo columns
  const logCols = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'fleet_service_logs' ORDER BY ordinal_position
  `;
  console.log(`  fleet_service_logs columns: ${logCols.map((c: { column_name: string }) => c.column_name).join(', ')}`);

  // Check existing service logs
  const existingLogs = await sql`SELECT id, odoo_service_id FROM fleet_service_logs WHERE odoo_service_id IS NOT NULL`;
  const existingLogIds = new Set(existingLogs.map((l: { odoo_service_id: number }) => l.odoo_service_id));

  // Get vehicle id map (odoo_vehicle_id → FF vehicle id)
  const vehMap = await sql`SELECT id, odoo_vehicle_id FROM fleet_vehicles WHERE odoo_vehicle_id IS NOT NULL`;
  const vehByOdoo = new Map(vehMap.map((v: { odoo_vehicle_id: number; id: string }) =>
    [v.odoo_vehicle_id, v.id]));

  let logCreated = 0, logSkipped = 0;
  for (const log of serviceLogs) {
    if (existingLogIds.has(log.id)) {
      logSkipped++;
      continue;
    }

    const vehicleOdooId = log.vehicle_id ? log.vehicle_id[0] : null;
    const vehicleId = vehicleOdooId ? vehByOdoo.get(vehicleOdooId) : null;

    if (!vehicleId) {
      logSkipped++;
      continue;
    }

    if (!dryRun) {
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
    }
    logCreated++;
  }
  console.log(`  Result: ${logCreated} created, ${logSkipped} skipped\n`);

  // ================================================================
  // SUMMARY
  // ================================================================
  console.log('===================================================================');
  console.log('                         SUMMARY                                   ');
  console.log('===================================================================');
  console.log(`Warehouses→Locations: ${whCreated} created, ${whSkipped} existing`);
  console.log(`Vendor Bills:         ${billCreated} created, ${billSkipped} existing`);
  console.log(`Serial Numbers:       ${serialCreated} created, ${serialSkipped} skipped`);
  console.log(`Reorder Rules:        ${rulesUpdated} items updated, ${rulesSkipped} skipped`);
  console.log(`Fleet Vehicles:       ${vehCreated} new, ${vehUpdated} updated, ${vehSkipped} skipped`);
  console.log(`Fleet Service Logs:   ${logCreated} created, ${logSkipped} skipped`);
  console.log('\n' + (dryRun ? 'DRY RUN - No changes were made' : 'Sync complete!'));
}

main().catch((err) => {
  console.error('Script failed:', err.message);
  process.exit(1);
});
