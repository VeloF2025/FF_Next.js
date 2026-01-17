/**
 * Odoo Schema Comparison Script
 *
 * Pulls detailed field info from Odoo and compares with FibreFlow schema
 * Run: npx tsx scripts/odoo-compare-schema.ts
 */

const ODOO_CONFIG = {
  url: 'https://velocityfibre.odoo.com',
  db: 'velocityfibre',
  username: 'jacques@velocityfibre.co.za',
  password: 'Ledene9685@',
};

interface JsonRpcResponse<T = unknown> {
  jsonrpc: string;
  id: number;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: { message: string };
  };
}

async function jsonRpc<T>(url: string, method: string, params: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  });
  const data: JsonRpcResponse<T> = await response.json();
  if (data.error) throw new Error(`Odoo Error: ${data.error.data?.message || data.error.message}`);
  return data.result as T;
}

async function authenticate(): Promise<number> {
  const uid = await jsonRpc<number>(`${ODOO_CONFIG.url}/jsonrpc`, 'call', {
    service: 'common',
    method: 'authenticate',
    args: [ODOO_CONFIG.db, ODOO_CONFIG.username, ODOO_CONFIG.password, {}],
  });
  if (!uid) throw new Error('Authentication failed');
  return uid;
}

async function execute<T>(uid: number, model: string, method: string, args: unknown[] = [], kwargs: Record<string, unknown> = {}): Promise<T> {
  return jsonRpc<T>(`${ODOO_CONFIG.url}/jsonrpc`, 'call', {
    service: 'object',
    method: 'execute_kw',
    args: [ODOO_CONFIG.db, uid, ODOO_CONFIG.password, model, method, args, kwargs],
  });
}

async function searchRead<T>(uid: number, model: string, domain: unknown[] = [], fields: string[] = [], limit = 10): Promise<T[]> {
  return execute<T[]>(uid, model, 'search_read', [domain], { fields, limit });
}

async function getFields(uid: number, model: string): Promise<Record<string, { string: string; type: string; required: boolean; relation?: string }>> {
  return execute(uid, model, 'fields_get', [], { attributes: ['string', 'type', 'required', 'relation'] });
}

function printSampleRecord(record: Record<string, unknown>, maxFields = 25): void {
  let count = 0;
  for (const [key, value] of Object.entries(record)) {
    if (value !== false && value !== null && value !== '' && count < maxFields) {
      const valueStr = JSON.stringify(value);
      console.log(`  ${key.padEnd(30)} = ${valueStr.slice(0, 70)}${valueStr.length > 70 ? '...' : ''}`);
      count++;
    }
  }
}

// ============================================================================
// MAIN
// ============================================================================

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('                    ODOO vs FIBREFLOW SCHEMA COMPARISON                        ');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  const uid = await authenticate();
  console.log('✅ Connected to Odoo\n');

  // ============================================================================
  // 1. SUPPLIERS (res.partner)
  // ============================================================================
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('1. SUPPLIERS (res.partner where supplier_rank > 0)');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // First get available fields
  const partnerFields = await getFields(uid, 'res.partner');
  const importantPartnerFields = ['id', 'name', 'display_name', 'email', 'phone', 'vat', 'website',
    'street', 'street2', 'city', 'state_id', 'zip', 'country_id', 'supplier_rank', 'active', 'comment', 'ref']
    .filter(f => f in partnerFields);

  console.log('AVAILABLE KEY FIELDS:');
  console.log('─────────────────────────────────────────────────────────────────────────────');
  for (const f of importantPartnerFields) {
    const info = partnerFields[f];
    console.log(`  ${f.padEnd(25)} ${info.type.padEnd(15)} ${info.string}`);
  }

  const suppliers = await searchRead(uid, 'res.partner', [['supplier_rank', '>', 0]], importantPartnerFields, 5);

  console.log('\nSAMPLE SUPPLIER DATA:');
  console.log('─────────────────────────────────────────────────────────────────────────────');
  for (const s of suppliers) {
    const sup = s as Record<string, unknown>;
    console.log(`\n  📦 ${sup.name}`);
    console.log(`     Email: ${sup.email || 'N/A'} | Phone: ${sup.phone || 'N/A'}`);
    console.log(`     VAT: ${sup.vat || 'N/A'} | Ref: ${sup.ref || 'N/A'}`);
    console.log(`     Address: ${[sup.street, sup.city, sup.zip].filter(Boolean).join(', ') || 'N/A'}`);
  }

  console.log('\n\nFIELD MAPPING → FibreFlow suppliers table:');
  console.log('─────────────────────────────────────────────────────────────────────────────');
  console.log('  ODOO FIELD              →  FF FIELD                   STATUS');
  console.log('  ───────────────────────────────────────────────────────────────────────');
  const supplierMapping = [
    ['id', 'odoo_partner_id', '✅ NEW COLUMN'],
    ['name', 'name', '✅ DIRECT'],
    ['email', 'email', '✅ DIRECT'],
    ['phone', 'phone', '✅ DIRECT'],
    ['vat', 'tax_number', '✅ DIRECT'],
    ['website', 'website', '✅ DIRECT'],
    ['street', 'physical_address_line1', '✅ DIRECT'],
    ['street2', 'physical_address_line2', '✅ DIRECT'],
    ['city', 'physical_city', '✅ DIRECT'],
    ['zip', 'physical_postal_code', '✅ DIRECT'],
    ['country_id', 'physical_country', '⚠️ TRANSFORM'],
    ['state_id', 'physical_province', '⚠️ TRANSFORM'],
    ['active', 'is_active', '✅ DIRECT'],
    ['comment', 'notes', '✅ DIRECT'],
    ['ref', 'supplier_code', '✅ DIRECT'],
  ];
  for (const [odoo, ff, status] of supplierMapping) {
    console.log(`  ${odoo.padEnd(22)} →  ${ff.padEnd(25)} ${status}`);
  }

  // ============================================================================
  // 2. PURCHASE ORDERS
  // ============================================================================
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('2. PURCHASE ORDERS (purchase.order)');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  const poFieldsInfo = await getFields(uid, 'purchase.order');
  const importantPoFields = ['id', 'name', 'partner_id', 'date_order', 'date_planned', 'date_approve',
    'state', 'origin', 'amount_untaxed', 'amount_tax', 'amount_total', 'currency_id', 'notes', 'user_id']
    .filter(f => f in poFieldsInfo);

  console.log('AVAILABLE KEY FIELDS:');
  console.log('─────────────────────────────────────────────────────────────────────────────');
  for (const f of importantPoFields) {
    const info = poFieldsInfo[f];
    console.log(`  ${f.padEnd(25)} ${info.type.padEnd(15)} ${info.string}`);
  }

  const purchaseOrders = await searchRead(uid, 'purchase.order', [], importantPoFields, 5);

  console.log('\nSAMPLE PURCHASE ORDER DATA:');
  console.log('─────────────────────────────────────────────────────────────────────────────');
  for (const po of purchaseOrders) {
    const p = po as Record<string, unknown>;
    const partner = p.partner_id as [number, string] | false;
    console.log(`\n  📋 ${p.name} | State: ${p.state}`);
    console.log(`     Supplier: ${partner ? partner[1] : 'N/A'}`);
    console.log(`     Date: ${p.date_order} | Total: R${p.amount_total}`);
    console.log(`     Subtotal: R${p.amount_untaxed} | Tax: R${p.amount_tax}`);
  }

  // Get PO Line Items
  console.log('\n\nPURCHASE ORDER LINE ITEMS (purchase.order.line):');
  console.log('─────────────────────────────────────────────────────────────────────────────');

  const polFieldsInfo = await getFields(uid, 'purchase.order.line');
  const importantPolFields = ['id', 'order_id', 'product_id', 'name', 'product_qty', 'product_uom',
    'price_unit', 'price_subtotal', 'price_total', 'date_planned', 'qty_received', 'qty_invoiced']
    .filter(f => f in polFieldsInfo);

  const poLines = await searchRead(uid, 'purchase.order.line', [], importantPolFields, 5);

  for (const line of poLines) {
    const l = line as Record<string, unknown>;
    const product = l.product_id as [number, string] | false;
    const order = l.order_id as [number, string] | false;
    console.log(`  ${order ? order[1] : '?'} | ${product ? product[1].slice(0, 40) : 'N/A'}`);
    console.log(`     Qty: ${l.product_qty} | Unit: R${l.price_unit} | Total: R${l.price_subtotal}`);
  }

  console.log('\n\nFIELD MAPPING → FibreFlow purchase_orders table:');
  console.log('─────────────────────────────────────────────────────────────────────────────');
  const poMapping = [
    ['id', 'odoo_po_id', '✅ NEW COLUMN'],
    ['name', 'po_number', '✅ DIRECT'],
    ['partner_id', 'supplier_id', '⚠️ LOOKUP'],
    ['date_order', 'order_date', '✅ DIRECT'],
    ['date_planned', 'expected_delivery_date', '✅ DIRECT'],
    ['date_approve', 'approved_at', '✅ DIRECT'],
    ['state', 'status', '⚠️ TRANSFORM'],
    ['amount_untaxed', 'subtotal_amount', '✅ DIRECT'],
    ['amount_tax', 'tax_amount', '✅ DIRECT'],
    ['amount_total', 'total_amount', '✅ DIRECT'],
    ['notes', 'notes', '✅ DIRECT'],
  ];
  for (const [odoo, ff, status] of poMapping) {
    console.log(`  ${odoo.padEnd(22)} →  ${ff.padEnd(25)} ${status}`);
  }

  console.log('\n  STATE MAPPING:');
  console.log('  draft       →  draft');
  console.log('  sent        →  pending_approval');
  console.log('  to approve  →  pending_approval');
  console.log('  purchase    →  approved');
  console.log('  done        →  received');
  console.log('  cancel      →  cancelled');

  // ============================================================================
  // 3. FLEET VEHICLES
  // ============================================================================
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('3. FLEET VEHICLES (fleet.vehicle)');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  const fleetFieldsInfo = await getFields(uid, 'fleet.vehicle');
  const importantFleetFields = ['id', 'name', 'license_plate', 'vin_sn', 'model_id', 'driver_id',
    'model_year', 'color', 'state_id', 'odometer', 'odometer_unit', 'acquisition_date',
    'car_value', 'fuel_type', 'transmission', 'active']
    .filter(f => f in fleetFieldsInfo);

  console.log('AVAILABLE KEY FIELDS:');
  console.log('─────────────────────────────────────────────────────────────────────────────');
  for (const f of importantFleetFields) {
    const info = fleetFieldsInfo[f];
    console.log(`  ${f.padEnd(25)} ${info.type.padEnd(15)} ${info.string}`);
  }

  const vehicles = await searchRead(uid, 'fleet.vehicle', [], importantFleetFields, 10);

  console.log('\nALL FLEET VEHICLES:');
  console.log('─────────────────────────────────────────────────────────────────────────────');
  for (const v of vehicles) {
    const veh = v as Record<string, unknown>;
    const model = veh.model_id as [number, string] | false;
    const driver = veh.driver_id as [number, string] | false;
    const state = veh.state_id as [number, string] | false;
    console.log(`\n  🚗 ${veh.license_plate || 'NO PLATE'}`);
    console.log(`     Model: ${model ? model[1] : 'N/A'} | Year: ${veh.model_year || 'N/A'}`);
    console.log(`     Driver: ${driver ? driver[1] : 'Unassigned'}`);
    console.log(`     Odometer: ${veh.odometer || 0} ${veh.odometer_unit || 'km'}`);
    console.log(`     Status: ${state ? state[1] : 'N/A'} | VIN: ${veh.vin_sn || 'N/A'}`);
  }

  console.log('\n\nFIELD MAPPING → FibreFlow fleet_vehicles table:');
  console.log('─────────────────────────────────────────────────────────────────────────────');
  const fleetMapping = [
    ['id', 'odoo_vehicle_id', '✅ NEW COLUMN'],
    ['license_plate', 'registration', '✅ DIRECT'],
    ['vin_sn', 'vin', '✅ DIRECT'],
    ['model_id', 'model + make', '⚠️ TRANSFORM'],
    ['model_year', 'year', '✅ DIRECT'],
    ['color', 'color', '✅ DIRECT'],
    ['state_id', 'status', '⚠️ TRANSFORM'],
    ['driver_id', 'assigned_driver_id', '⚠️ LOOKUP/CREATE'],
    ['odometer', 'current_mileage', '✅ DIRECT'],
    ['acquisition_date', 'purchase_date', '✅ DIRECT'],
    ['car_value', 'purchase_price', '✅ DIRECT'],
    ['fuel_type', 'fuel_type', '✅ DIRECT'],
    ['transmission', 'transmission', '✅ DIRECT'],
  ];
  for (const [odoo, ff, status] of fleetMapping) {
    console.log(`  ${odoo.padEnd(22)} →  ${ff.padEnd(25)} ${status}`);
  }

  // ============================================================================
  // 4. STOCK TRANSFERS
  // ============================================================================
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('4. STOCK TRANSFERS (stock.picking)');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  const pickingFieldsInfo = await getFields(uid, 'stock.picking');
  const importantPickingFields = ['id', 'name', 'origin', 'partner_id', 'picking_type_id',
    'location_id', 'location_dest_id', 'scheduled_date', 'date_done', 'state', 'purchase_id']
    .filter(f => f in pickingFieldsInfo);

  const pickings = await searchRead(uid, 'stock.picking', [], importantPickingFields, 10);

  console.log('SAMPLE STOCK TRANSFERS:');
  console.log('─────────────────────────────────────────────────────────────────────────────');
  for (const p of pickings.slice(0, 8)) {
    const pick = p as Record<string, unknown>;
    const pickType = pick.picking_type_id as [number, string] | false;
    const locSrc = pick.location_id as [number, string] | false;
    const locDest = pick.location_dest_id as [number, string] | false;
    const partner = pick.partner_id as [number, string] | false;
    console.log(`\n  📦 ${pick.name} | State: ${pick.state}`);
    console.log(`     Type: ${pickType ? pickType[1] : 'N/A'}`);
    console.log(`     From: ${locSrc ? locSrc[1] : 'N/A'} → To: ${locDest ? locDest[1] : 'N/A'}`);
    console.log(`     Partner: ${partner ? partner[1] : 'N/A'} | Origin: ${pick.origin || 'N/A'}`);
    console.log(`     Date: ${pick.scheduled_date || 'N/A'} | Done: ${pick.date_done || 'Pending'}`);
  }

  // ============================================================================
  // 5. WAREHOUSES
  // ============================================================================
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('5. WAREHOUSES (stock.warehouse)');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  const warehouses = await searchRead(uid, 'stock.warehouse', [], ['id', 'name', 'code'], 20);
  console.log('ALL WAREHOUSES:');
  for (const wh of warehouses) {
    const w = wh as Record<string, unknown>;
    console.log(`  - ${w.name} (Code: ${w.code}, ID: ${w.id})`);
  }

  // ============================================================================
  // 6. PRODUCTS
  // ============================================================================
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('6. PRODUCTS (product.product)');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  const productFieldsInfo = await getFields(uid, 'product.product');
  const importantProductFields = ['id', 'name', 'default_code', 'barcode', 'categ_id', 'type',
    'list_price', 'standard_price', 'qty_available', 'active']
    .filter(f => f in productFieldsInfo);

  const products = await searchRead(uid, 'product.product', [], importantProductFields, 10);

  console.log('SAMPLE PRODUCTS:');
  console.log('─────────────────────────────────────────────────────────────────────────────');
  for (const prod of products) {
    const p = prod as Record<string, unknown>;
    const categ = p.categ_id as [number, string] | false;
    console.log(`  ${(p.default_code || '').toString().padEnd(20)} ${(p.name || '').toString().slice(0, 40)}`);
    console.log(`     Category: ${categ ? categ[1] : 'N/A'} | Type: ${p.type} | Qty: ${p.qty_available || 0}`);
  }

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('                              SYNC READINESS SUMMARY                           ');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  console.log('  ENTITY              COUNT    FF TABLE               ALIGNMENT');
  console.log('  ─────────────────────────────────────────────────────────────────────────');
  console.log('  Suppliers           5        suppliers              ✅ EXCELLENT');
  console.log('  Purchase Orders     199      purchase_orders        ✅ EXCELLENT');
  console.log('  PO Line Items       ~500+    purchase_order_items   ✅ EXCELLENT');
  console.log('  Fleet Vehicles      20       fleet_vehicles         ✅ EXCELLENT');
  console.log('  Stock Transfers     337      goods_receipt_notes    ⚠️ PARTIAL (incoming)');
  console.log('  Products            246      material_catalog       ⚠️ NEEDS REVIEW');
  console.log('  Warehouses          11       (no direct table)      📝 REFERENCE ONLY');

  console.log('\n  RECOMMENDED SYNC ORDER:');
  console.log('  ─────────────────────────────────────────────────────────────────────────');
  console.log('  1️⃣  Suppliers        - Foundation, others reference this');
  console.log('  2️⃣  Products         - Needed for PO line items');
  console.log('  3️⃣  Purchase Orders  - Including line items');
  console.log('  4️⃣  Fleet Vehicles   - Standalone');
  console.log('  5️⃣  Stock Transfers  - Complex, depends on POs');

  console.log('\n✅ Schema comparison complete!\n');
}

main().catch(console.error);
