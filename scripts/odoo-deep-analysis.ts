/**
 * Odoo Deep Analysis Script
 *
 * Analyzes actual usage patterns, relationships, and workflows in Odoo
 * to ensure FibreFlow can properly support the same functionality.
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
  error?: { code: number; message: string; data?: { message: string } };
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

async function searchRead<T>(uid: number, model: string, domain: unknown[] = [], fields: string[] = [], limit = 100, order = ''): Promise<T[]> {
  return execute<T[]>(uid, model, 'search_read', [domain], { fields, limit, order });
}

async function searchCount(uid: number, model: string, domain: unknown[] = []): Promise<number> {
  return execute<number>(uid, model, 'search_count', [domain]);
}

// ============================================================================
// MAIN ANALYSIS
// ============================================================================

async function main() {
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('              ODOO DEEP FUNCTIONALITY & WORKFLOW ANALYSIS                       ');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  const uid = await authenticate();
  console.log('✅ Connected to Odoo\n');

  // ============================================================================
  // 1. PURCHASE ORDER WORKFLOW ANALYSIS
  // ============================================================================
  console.log('═══════════════════════════════════════════════════════════════════════════════');
  console.log('1. PURCHASE ORDER WORKFLOW ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Get PO counts by state
  const poStates = ['draft', 'sent', 'to approve', 'purchase', 'done', 'cancel'];
  console.log('PO STATUS DISTRIBUTION:');
  console.log('─────────────────────────────────────────────────────────────────────────────');
  for (const state of poStates) {
    const count = await searchCount(uid, 'purchase.order', [['state', '=', state]]);
    const bar = '█'.repeat(Math.min(count / 5, 30));
    console.log(`  ${state.padEnd(12)} ${count.toString().padStart(4)} ${bar}`);
  }

  // Get POs by supplier
  console.log('\nPOs BY SUPPLIER:');
  console.log('─────────────────────────────────────────────────────────────────────────────');
  const posBySupplier = await execute<Array<{ partner_id: [number, string]; partner_id_count: number }>>(
    uid, 'purchase.order', 'read_group',
    [[], ['partner_id'], ['partner_id']],
    { orderby: 'partner_id_count desc' }
  );
  for (const group of posBySupplier.slice(0, 10)) {
    if (group.partner_id) {
      console.log(`  ${group.partner_id[1].slice(0, 40).padEnd(42)} ${group.partner_id_count} POs`);
    }
  }

  // Get recent PO activity
  console.log('\nRECENT PO ACTIVITY (Last 10):');
  console.log('─────────────────────────────────────────────────────────────────────────────');
  const recentPOs = await searchRead(uid, 'purchase.order', [],
    ['name', 'partner_id', 'date_order', 'amount_total', 'state', 'origin'],
    10, 'date_order desc'
  );
  for (const po of recentPOs) {
    const p = po as Record<string, unknown>;
    const partner = p.partner_id as [number, string] | false;
    const date = (p.date_order as string || '').split(' ')[0];
    console.log(`  ${p.name} | ${date} | R${(p.amount_total as number || 0).toLocaleString().padStart(10)} | ${p.state}`);
    console.log(`    └─ ${partner ? partner[1].slice(0, 50) : 'N/A'} | Origin: ${p.origin || 'N/A'}`);
  }

  // Get PO amounts summary
  console.log('\nPO FINANCIAL SUMMARY:');
  console.log('─────────────────────────────────────────────────────────────────────────────');
  const allPOs = await searchRead(uid, 'purchase.order', [['state', 'not in', ['cancel']]],
    ['amount_total', 'amount_untaxed', 'amount_tax', 'state'], 500
  );
  let totalAmount = 0, totalTax = 0, confirmedAmount = 0;
  for (const po of allPOs) {
    const p = po as Record<string, unknown>;
    totalAmount += (p.amount_total as number) || 0;
    totalTax += (p.amount_tax as number) || 0;
    if (p.state === 'purchase' || p.state === 'done') {
      confirmedAmount += (p.amount_total as number) || 0;
    }
  }
  console.log(`  Total PO Value (excl cancelled): R ${totalAmount.toLocaleString()}`);
  console.log(`  Total Tax:                       R ${totalTax.toLocaleString()}`);
  console.log(`  Confirmed/Done POs Value:        R ${confirmedAmount.toLocaleString()}`);

  // ============================================================================
  // 2. INVENTORY/STOCK WORKFLOW ANALYSIS
  // ============================================================================
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('2. INVENTORY/STOCK WORKFLOW ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Get picking types (to understand what operations are used)
  console.log('STOCK OPERATION TYPES:');
  console.log('─────────────────────────────────────────────────────────────────────────────');
  const pickingTypes = await searchRead(uid, 'stock.picking.type', [],
    ['name', 'code', 'warehouse_id', 'count_picking_ready', 'count_picking_waiting', 'count_picking_late'],
    50
  );
  for (const pt of pickingTypes) {
    const t = pt as Record<string, unknown>;
    const wh = t.warehouse_id as [number, string] | false;
    console.log(`  ${(t.name as string || '').padEnd(30)} Code: ${t.code}`);
    console.log(`    └─ Warehouse: ${wh ? wh[1] : 'N/A'} | Ready: ${t.count_picking_ready} | Waiting: ${t.count_picking_waiting} | Late: ${t.count_picking_late}`);
  }

  // Stock transfer status distribution
  console.log('\nSTOCK TRANSFER STATUS:');
  console.log('─────────────────────────────────────────────────────────────────────────────');
  const pickingStates = ['draft', 'waiting', 'confirmed', 'assigned', 'done', 'cancel'];
  for (const state of pickingStates) {
    const count = await searchCount(uid, 'stock.picking', [['state', '=', state]]);
    const bar = '█'.repeat(Math.min(count / 10, 30));
    console.log(`  ${state.padEnd(12)} ${count.toString().padStart(4)} ${bar}`);
  }

  // Stock by warehouse
  console.log('\nSTOCK TRANSFERS BY WAREHOUSE (Destination):');
  console.log('─────────────────────────────────────────────────────────────────────────────');
  const transfersByWarehouse = await execute<Array<{ location_dest_id: [number, string]; location_dest_id_count: number }>>(
    uid, 'stock.picking', 'read_group',
    [[['state', '=', 'done']], ['location_dest_id'], ['location_dest_id']],
    { orderby: 'location_dest_id_count desc' }
  );
  for (const group of transfersByWarehouse.slice(0, 10)) {
    if (group.location_dest_id) {
      console.log(`  ${group.location_dest_id[1].padEnd(35)} ${group.location_dest_id_count} transfers`);
    }
  }

  // ============================================================================
  // 3. FLEET MANAGEMENT ANALYSIS
  // ============================================================================
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('3. FLEET MANAGEMENT ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Vehicle status distribution
  console.log('VEHICLE STATUS DISTRIBUTION:');
  console.log('─────────────────────────────────────────────────────────────────────────────');
  const vehiclesByState = await execute<Array<{ state_id: [number, string]; state_id_count: number }>>(
    uid, 'fleet.vehicle', 'read_group',
    [[], ['state_id'], ['state_id']],
    {}
  );
  for (const group of vehiclesByState) {
    if (group.state_id) {
      console.log(`  ${group.state_id[1].padEnd(20)} ${group.state_id_count} vehicles`);
    }
  }

  // Vehicles by model
  console.log('\nVEHICLES BY MODEL:');
  console.log('─────────────────────────────────────────────────────────────────────────────');
  const vehiclesByModel = await execute<Array<{ model_id: [number, string]; model_id_count: number }>>(
    uid, 'fleet.vehicle', 'read_group',
    [[], ['model_id'], ['model_id']],
    {}
  );
  for (const group of vehiclesByModel) {
    if (group.model_id) {
      console.log(`  ${group.model_id[1].padEnd(35)} ${group.model_id_count} vehicles`);
    }
  }

  // Check for fuel logs
  console.log('\nFUEL LOG ANALYSIS:');
  console.log('─────────────────────────────────────────────────────────────────────────────');
  try {
    const fuelLogCount = await searchCount(uid, 'fleet.vehicle.log.fuel', []);
    console.log(`  Total fuel log entries: ${fuelLogCount}`);

    if (fuelLogCount > 0) {
      const recentFuel = await searchRead(uid, 'fleet.vehicle.log.fuel', [],
        ['vehicle_id', 'date', 'liter', 'price_per_liter', 'amount', 'odometer'],
        5, 'date desc'
      );
      console.log('  Recent fuel entries:');
      for (const f of recentFuel) {
        const fuel = f as Record<string, unknown>;
        const vehicle = fuel.vehicle_id as [number, string] | false;
        console.log(`    ${fuel.date} | ${vehicle ? vehicle[1].slice(0, 20) : 'N/A'} | ${fuel.liter}L @ R${fuel.price_per_liter} = R${fuel.amount}`);
      }
    }
  } catch (e) {
    console.log('  ⚠️ Fuel log module not accessible or empty');
  }

  // Check for service logs
  console.log('\nSERVICE/MAINTENANCE LOG ANALYSIS:');
  console.log('─────────────────────────────────────────────────────────────────────────────');
  try {
    const serviceLogCount = await searchCount(uid, 'fleet.vehicle.log.services', []);
    console.log(`  Total service log entries: ${serviceLogCount}`);

    if (serviceLogCount > 0) {
      const recentService = await searchRead(uid, 'fleet.vehicle.log.services', [],
        ['vehicle_id', 'date', 'service_type_id', 'amount', 'description'],
        5, 'date desc'
      );
      console.log('  Recent service entries:');
      for (const s of recentService) {
        const svc = s as Record<string, unknown>;
        const vehicle = svc.vehicle_id as [number, string] | false;
        const serviceType = svc.service_type_id as [number, string] | false;
        console.log(`    ${svc.date} | ${vehicle ? vehicle[1].slice(0, 15) : 'N/A'} | ${serviceType ? serviceType[1] : 'N/A'} | R${svc.amount}`);
      }
    }
  } catch (e) {
    console.log('  ⚠️ Service log module not accessible or empty');
  }

  // Check for odometer logs
  console.log('\nODOMETER TRACKING:');
  console.log('─────────────────────────────────────────────────────────────────────────────');
  try {
    const odometerCount = await searchCount(uid, 'fleet.vehicle.odometer', []);
    console.log(`  Total odometer entries: ${odometerCount}`);
  } catch (e) {
    console.log('  ⚠️ Odometer tracking not available (using vehicle.odometer field instead)');
  }

  // ============================================================================
  // 4. PRODUCT/INVENTORY ANALYSIS
  // ============================================================================
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('4. PRODUCT & INVENTORY ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // Products by category
  console.log('PRODUCTS BY CATEGORY:');
  console.log('─────────────────────────────────────────────────────────────────────────────');
  const productsByCategory = await execute<Array<{ categ_id: [number, string]; categ_id_count: number }>>(
    uid, 'product.product', 'read_group',
    [[['active', '=', true]], ['categ_id'], ['categ_id']],
    { orderby: 'categ_id_count desc' }
  );
  for (const group of productsByCategory) {
    if (group.categ_id) {
      console.log(`  ${group.categ_id[1].padEnd(35)} ${group.categ_id_count} products`);
    }
  }

  // Products with stock
  console.log('\nPRODUCTS WITH STOCK (Top 15):');
  console.log('─────────────────────────────────────────────────────────────────────────────');
  const productsWithStock = await searchRead(uid, 'product.product',
    [['qty_available', '>', 0]],
    ['name', 'default_code', 'qty_available', 'categ_id'],
    15, 'qty_available desc'
  );
  for (const p of productsWithStock) {
    const prod = p as Record<string, unknown>;
    const categ = prod.categ_id as [number, string] | false;
    console.log(`  ${(prod.default_code || '').toString().padEnd(25)} Qty: ${(prod.qty_available as number || 0).toString().padStart(8)}`);
    console.log(`    └─ ${(prod.name as string || '').slice(0, 50)} | ${categ ? categ[1] : 'N/A'}`);
  }

  // Stock quants (actual inventory levels by location)
  console.log('\nINVENTORY BY LOCATION (stock.quant):');
  console.log('─────────────────────────────────────────────────────────────────────────────');
  try {
    const stockByLocation = await execute<Array<{ location_id: [number, string]; quantity: number }>>(
      uid, 'stock.quant', 'read_group',
      [[['quantity', '>', 0]], ['location_id'], ['quantity:sum']],
      { orderby: 'quantity desc' }
    );
    for (const group of stockByLocation.slice(0, 10)) {
      if (group.location_id) {
        console.log(`  ${group.location_id[1].padEnd(35)} ${group.quantity.toLocaleString()} units`);
      }
    }
  } catch (e) {
    console.log('  ⚠️ Stock quants not accessible');
  }

  // ============================================================================
  // 5. SUPPLIER ANALYSIS (DEEPER)
  // ============================================================================
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('5. SUPPLIER RELATIONSHIP ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // All suppliers with their PO history
  console.log('SUPPLIER PO HISTORY:');
  console.log('─────────────────────────────────────────────────────────────────────────────');
  const suppliers = await searchRead(uid, 'res.partner',
    [['supplier_rank', '>', 0]],
    ['name', 'phone', 'vat', 'street', 'city'],
    20
  );

  for (const s of suppliers) {
    const sup = s as Record<string, unknown>;
    const supplierId = sup.id as number;

    // Get PO count and total for this supplier
    const poCount = await searchCount(uid, 'purchase.order', [['partner_id', '=', supplierId]]);
    const supplierPOs = await searchRead(uid, 'purchase.order',
      [['partner_id', '=', supplierId], ['state', 'not in', ['cancel']]],
      ['amount_total'], 100
    );
    const totalSpend = supplierPOs.reduce((sum, po) => sum + ((po as Record<string, unknown>).amount_total as number || 0), 0);

    console.log(`\n  📦 ${sup.name}`);
    console.log(`     Phone: ${sup.phone || 'N/A'} | VAT: ${sup.vat || 'N/A'}`);
    console.log(`     Address: ${[sup.street, sup.city].filter(Boolean).join(', ') || 'N/A'}`);
    console.log(`     POs: ${poCount} | Total Spend: R ${totalSpend.toLocaleString()}`);
  }

  // ============================================================================
  // 6. INVOICING & BILLS ANALYSIS
  // ============================================================================
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('6. INVOICING & BILLS ANALYSIS');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  try {
    // Get vendor bills (in_invoice = vendor bill)
    const billCount = await searchCount(uid, 'account.move', [['move_type', '=', 'in_invoice']]);
    console.log(`  Total Vendor Bills: ${billCount}`);

    if (billCount > 0) {
      const bills = await searchRead(uid, 'account.move',
        [['move_type', '=', 'in_invoice']],
        ['name', 'partner_id', 'invoice_date', 'amount_total', 'state', 'payment_state'],
        10, 'invoice_date desc'
      );
      console.log('\n  RECENT VENDOR BILLS:');
      for (const b of bills) {
        const bill = b as Record<string, unknown>;
        const partner = bill.partner_id as [number, string] | false;
        console.log(`    ${bill.name} | ${bill.invoice_date} | R${bill.amount_total} | ${bill.state} | Payment: ${bill.payment_state}`);
        console.log(`      └─ ${partner ? partner[1].slice(0, 50) : 'N/A'}`);
      }
    }
  } catch (e) {
    console.log('  ⚠️ Account moves not accessible');
  }

  // ============================================================================
  // 7. KEY RELATIONSHIPS & LINKS
  // ============================================================================
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('7. KEY RELATIONSHIPS & DATA LINKS');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  // POs linked to stock pickings
  console.log('PO → STOCK TRANSFER LINKS:');
  console.log('─────────────────────────────────────────────────────────────────────────────');
  const linkedPOs = await searchRead(uid, 'stock.picking',
    [['purchase_id', '!=', false], ['state', '=', 'done']],
    ['name', 'purchase_id', 'origin', 'date_done'],
    10, 'date_done desc'
  );
  for (const p of linkedPOs) {
    const pick = p as Record<string, unknown>;
    const po = pick.purchase_id as [number, string] | false;
    console.log(`  ${pick.name} ← ${po ? po[1] : 'N/A'} (Origin: ${pick.origin})`);
  }

  // ============================================================================
  // SUMMARY
  // ============================================================================
  console.log('\n═══════════════════════════════════════════════════════════════════════════════');
  console.log('                           FUNCTIONALITY SUMMARY                               ');
  console.log('═══════════════════════════════════════════════════════════════════════════════\n');

  console.log('MODULES IN ACTIVE USE:');
  console.log('─────────────────────────────────────────────────────────────────────────────');
  console.log('  ✅ Purchase Management (199 POs)');
  console.log('  ✅ Inventory/Stock (337 transfers, 11 warehouses)');
  console.log('  ✅ Fleet Management (20 vehicles)');
  console.log('  ✅ Products/Materials (246 products)');
  console.log('  ✅ Supplier Management (5+ suppliers)');

  console.log('\nKEY WORKFLOWS TO REPLICATE:');
  console.log('─────────────────────────────────────────────────────────────────────────────');
  console.log('  1. Purchase Order → Receipt → Stock Update');
  console.log('  2. Multi-warehouse inventory tracking (Law, Moh, Tem, etc.)');
  console.log('  3. Fleet vehicle tracking with driver assignment');
  console.log('  4. Supplier spend tracking');

  console.log('\nDATA INTEGRITY REQUIREMENTS:');
  console.log('─────────────────────────────────────────────────────────────────────────────');
  console.log('  • PO numbers must be preserved (P00001, P00002, etc.)');
  console.log('  • Supplier-PO relationships must be maintained');
  console.log('  • Stock transfer origin links to POs must be preserved');
  console.log('  • Warehouse/location structure must be mapped');

  console.log('\n✅ Deep analysis complete!\n');
}

main().catch(console.error);
