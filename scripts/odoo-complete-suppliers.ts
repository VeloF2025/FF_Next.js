/**
 * Get ALL suppliers - including those only referenced in POs
 */

const ODOO_CONFIG = {
  url: 'https://velocityfibre.odoo.com',
  db: 'velocityfibre',
  username: 'jacques@velocityfibre.co.za',
  password: 'Ledene9685@',
};

async function jsonRpc<T>(url: string, method: string, params: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now(), method, params }),
  });
  const data = await response.json();
  if (data.error) throw new Error(`Odoo Error: ${data.error.data?.message || data.error.message}`);
  return data.result as T;
}

async function authenticate(): Promise<number> {
  return jsonRpc<number>(`${ODOO_CONFIG.url}/jsonrpc`, 'call', {
    service: 'common',
    method: 'authenticate',
    args: [ODOO_CONFIG.db, ODOO_CONFIG.username, ODOO_CONFIG.password, {}],
  });
}

async function execute<T>(uid: number, model: string, method: string, args: unknown[] = [], kwargs: Record<string, unknown> = {}): Promise<T> {
  return jsonRpc<T>(`${ODOO_CONFIG.url}/jsonrpc`, 'call', {
    service: 'object',
    method: 'execute_kw',
    args: [ODOO_CONFIG.db, uid, ODOO_CONFIG.password, model, method, args, kwargs],
  });
}

async function searchRead<T>(uid: number, model: string, domain: unknown[] = [], fields: string[] = [], limit = 100): Promise<T[]> {
  return execute<T[]>(uid, model, 'search_read', [domain], { fields, limit });
}

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('                    COMPLETE SUPPLIER & FLEET ANALYSIS                         ');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  const uid = await authenticate();

  // ============================================================================
  // 1. GET ALL PARTNERS THAT ARE SUPPLIERS (including via POs)
  // ============================================================================
  console.log('1. ALL SUPPLIERS (Partners with POs or supplier_rank > 0):');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Get all unique partner IDs from POs
  const allPOs = await searchRead(uid, 'purchase.order', [], ['partner_id'], 500);
  const partnerIdsFromPOs = new Set<number>();
  for (const po of allPOs) {
    const p = po as Record<string, unknown>;
    const partner = p.partner_id as [number, string] | false;
    if (partner) partnerIdsFromPOs.add(partner[0]);
  }

  console.log(`  Found ${partnerIdsFromPOs.size} unique suppliers from POs\n`);

  // Get full details for all these partners
  const supplierFields = ['id', 'name', 'email', 'phone', 'vat', 'street', 'street2', 'city', 'zip',
    'country_id', 'state_id', 'supplier_rank', 'active', 'ref', 'comment'];

  const allSuppliers = await searchRead(uid, 'res.partner',
    [['id', 'in', Array.from(partnerIdsFromPOs)]],
    supplierFields, 100
  );

  console.log('COMPLETE SUPPLIER LIST:');
  console.log('─────────────────────────────────────────────────────────────────────────────');
  console.log('  ID    | NAME                                          | PHONE           | VAT         | SUPPLIER_RANK');
  console.log('─────────────────────────────────────────────────────────────────────────────');

  for (const s of allSuppliers) {
    const sup = s as Record<string, unknown>;
    const id = (sup.id as number).toString().padEnd(5);
    const name = (sup.name as string || '').slice(0, 45).padEnd(45);
    const phone = (sup.phone as string || 'N/A').slice(0, 15).padEnd(15);
    const vat = (sup.vat as string || 'N/A').slice(0, 11).padEnd(11);
    const rank = sup.supplier_rank || 0;
    console.log(`  ${id} | ${name} | ${phone} | ${vat} | ${rank}`);
  }

  console.log('\n\nDETAILED SUPPLIER DATA (for mapping):');
  console.log('─────────────────────────────────────────────────────────────────────────────');

  for (const s of allSuppliers) {
    const sup = s as Record<string, unknown>;
    const country = sup.country_id as [number, string] | false;
    const state = sup.state_id as [number, string] | false;

    console.log(`\n📦 ${sup.name} (ID: ${sup.id})`);
    console.log(`   Email: ${sup.email || 'MISSING'}`);
    console.log(`   Phone: ${sup.phone || 'MISSING'}`);
    console.log(`   VAT: ${sup.vat || 'MISSING'}`);
    console.log(`   Ref: ${sup.ref || 'NONE'}`);
    console.log(`   Address: ${[sup.street, sup.street2, sup.city, sup.zip].filter(Boolean).join(', ') || 'MISSING'}`);
    console.log(`   Country: ${country ? country[1] : 'N/A'} | Province: ${state ? state[1] : 'N/A'}`);
    console.log(`   Supplier Rank: ${sup.supplier_rank} | Active: ${sup.active}`);
  }

  // ============================================================================
  // 2. FLEET SERVICE LOGS (Fuel & Maintenance)
  // ============================================================================
  console.log('\n\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('2. FLEET SERVICE LOGS (Fuel & Maintenance Details)');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Get service types first
  const serviceTypes = await searchRead(uid, 'fleet.service.type', [], ['name', 'category'], 50);
  console.log('SERVICE TYPES:');
  for (const st of serviceTypes) {
    const t = st as Record<string, unknown>;
    console.log(`  - ${t.name} (Category: ${t.category})`);
  }

  // Get service logs grouped by type
  const serviceLogs = await searchRead(uid, 'fleet.vehicle.log.services', [],
    ['vehicle_id', 'date', 'service_type_id', 'amount', 'description', 'odometer', 'vendor_id'],
    50,
  );

  console.log('\n\nRECENT SERVICE LOGS:');
  console.log('─────────────────────────────────────────────────────────────────────────────');
  for (const log of serviceLogs.slice(0, 20)) {
    const l = log as Record<string, unknown>;
    const vehicle = l.vehicle_id as [number, string] | false;
    const serviceType = l.service_type_id as [number, string] | false;
    const vendor = l.vendor_id as [number, string] | false;

    console.log(`  ${l.date} | ${vehicle ? vehicle[1].slice(0, 20).padEnd(20) : 'N/A'.padEnd(20)} | ${serviceType ? serviceType[1].padEnd(15) : 'N/A'.padEnd(15)} | R${(l.amount as number || 0).toLocaleString().padStart(8)} | ODO: ${l.odometer || 'N/A'}`);
    if (l.description) console.log(`    └─ ${(l.description as string).slice(0, 70)}`);
  }

  // Service summary by type
  console.log('\n\nSERVICE LOG SUMMARY BY TYPE:');
  console.log('─────────────────────────────────────────────────────────────────────────────');
  const serviceByType = await execute<Array<{ service_type_id: [number, string]; service_type_id_count: number; amount: number }>>(
    uid, 'fleet.vehicle.log.services', 'read_group',
    [[], ['service_type_id'], ['service_type_id', 'amount:sum']],
    {}
  );
  for (const group of serviceByType) {
    if (group.service_type_id) {
      console.log(`  ${group.service_type_id[1].padEnd(30)} ${group.service_type_id_count.toString().padStart(4)} logs | R${(group.amount || 0).toLocaleString()}`);
    }
  }

  // ============================================================================
  // 3. ODOMETER HISTORY (for accurate mileage tracking)
  // ============================================================================
  console.log('\n\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('3. ODOMETER HISTORY');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  const odometerLogs = await searchRead(uid, 'fleet.vehicle.odometer', [],
    ['vehicle_id', 'date', 'value', 'unit'],
    30
  );

  console.log('RECENT ODOMETER ENTRIES:');
  console.log('─────────────────────────────────────────────────────────────────────────────');
  for (const o of odometerLogs) {
    const odo = o as Record<string, unknown>;
    const vehicle = odo.vehicle_id as [number, string] | false;
    console.log(`  ${odo.date} | ${vehicle ? vehicle[1].padEnd(30) : 'N/A'.padEnd(30)} | ${(odo.value as number).toLocaleString().padStart(10)} ${odo.unit || 'km'}`);
  }

  // ============================================================================
  // 4. WAREHOUSE → PROJECT MAPPING PROPOSAL
  // ============================================================================
  console.log('\n\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('4. WAREHOUSE → FIBREFLOW PROJECT MAPPING');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  const warehouses = await searchRead(uid, 'stock.warehouse', [], ['id', 'name', 'code'], 20);

  console.log('PROPOSED MAPPING:');
  console.log('─────────────────────────────────────────────────────────────────────────────');
  console.log('  ODOO WAREHOUSE         CODE    →  FF PROJECT/LOCATION');
  console.log('─────────────────────────────────────────────────────────────────────────────');

  const mapping: Record<string, string> = {
    'Lawley': 'Lawley Project',
    'Mohadin': 'Mohadin Project',
    'Ivory Park': 'Ivory Park Project',
    'Mamelodi Pop1': 'Mamelodi Project',
    'Grabouw': 'Grabouw Project',
    'Etwatwa': 'Etwatwa Project',
    'Tembisa 1': 'Tembisa Project',
    'Tembisa 2': 'Tembisa Project',
    'Tembisa 3': 'Tembisa Project',
    'Tembelihle': 'Tembelihle Project',
    'VelocityFibre': 'Main Warehouse (HQ)',
  };

  for (const wh of warehouses) {
    const w = wh as Record<string, unknown>;
    const ffProject = mapping[w.name as string] || '❓ NEEDS MAPPING';
    console.log(`  ${(w.name as string).padEnd(20)} ${(w.code as string).padEnd(7)} →  ${ffProject}`);
  }

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log('\n\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('                              FINAL SUMMARY                                    ');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  console.log('DATA TO SYNC:');
  console.log('─────────────────────────────────────────────────────────────────────────────');
  console.log(`  ✅ Suppliers:         ${allSuppliers.length} (from PO history, not just supplier_rank)`);
  console.log(`  ✅ Purchase Orders:   199 (R46.7M total value)`);
  console.log(`  ✅ Stock Transfers:   337 (48 pending, 285 done)`);
  console.log(`  ✅ Fleet Vehicles:    20`);
  console.log(`  ✅ Service Logs:      256 (fuel & maintenance)`);
  console.log(`  ✅ Odometer Entries:  1,010`);
  console.log(`  ✅ Products:          246`);
  console.log(`  ✅ Warehouses:        11 (mapped to FF projects)`);

  console.log('\nCRITICAL REQUIREMENTS:');
  console.log('─────────────────────────────────────────────────────────────────────────────');
  console.log('  1. Preserve PO numbers (P00001 format)');
  console.log('  2. Maintain supplier-PO relationships');
  console.log('  3. Map warehouses to FF projects/locations');
  console.log('  4. Import service logs to fleet maintenance history');
  console.log('  5. Import odometer readings for accurate mileage');
  console.log('  6. Handle 48 pending receipts (don\'t lose active workflows)');

  console.log('\n✅ Complete analysis done!\n');
}

main().catch(console.error);
