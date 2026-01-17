/**
 * Odoo Explorer Script
 *
 * Quick script to connect to Odoo and explore available data
 * Run: npx ts-node scripts/odoo-explore.ts
 */

const ODOO_CONFIG = {
  url: 'https://velocityfibre.odoo.com',
  db: 'velocityfibre',  // Usually the subdomain for Odoo SaaS
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
    data?: {
      name: string;
      debug: string;
      message: string;
      arguments: string[];
    };
  };
}

async function jsonRpc<T>(url: string, method: string, params: Record<string, unknown>): Promise<T> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: method,
      params: params,
    }),
  });

  const data: JsonRpcResponse<T> = await response.json();

  if (data.error) {
    throw new Error(`Odoo Error: ${data.error.message} - ${data.error.data?.message || ''}`);
  }

  return data.result as T;
}

async function authenticate(): Promise<number> {
  console.log('\n🔐 Authenticating with Odoo...');
  console.log(`   URL: ${ODOO_CONFIG.url}`);
  console.log(`   Database: ${ODOO_CONFIG.db}`);
  console.log(`   User: ${ODOO_CONFIG.username}`);

  const uid = await jsonRpc<number>(
    `${ODOO_CONFIG.url}/jsonrpc`,
    'call',
    {
      service: 'common',
      method: 'authenticate',
      args: [ODOO_CONFIG.db, ODOO_CONFIG.username, ODOO_CONFIG.password, {}],
    }
  );

  if (!uid) {
    throw new Error('Authentication failed - check credentials or database name');
  }

  console.log(`   ✅ Authenticated! User ID: ${uid}`);
  return uid;
}

async function getServerVersion(): Promise<void> {
  console.log('\n📌 Getting Odoo version...');

  const version = await jsonRpc<{ server_version: string; server_version_info: number[] }>(
    `${ODOO_CONFIG.url}/jsonrpc`,
    'call',
    {
      service: 'common',
      method: 'version',
      args: [],
    }
  );

  console.log(`   Odoo Version: ${version.server_version}`);
}

async function execute<T>(uid: number, model: string, method: string, args: unknown[] = [], kwargs: Record<string, unknown> = {}): Promise<T> {
  return jsonRpc<T>(
    `${ODOO_CONFIG.url}/jsonrpc`,
    'call',
    {
      service: 'object',
      method: 'execute_kw',
      args: [ODOO_CONFIG.db, uid, ODOO_CONFIG.password, model, method, args, kwargs],
    }
  );
}

async function searchRead<T>(uid: number, model: string, domain: unknown[] = [], fields: string[] = [], limit = 5): Promise<T[]> {
  return execute<T[]>(uid, model, 'search_read', [domain], { fields, limit });
}

async function searchCount(uid: number, model: string, domain: unknown[] = []): Promise<number> {
  return execute<number>(uid, model, 'search_count', [domain]);
}

async function getFields(uid: number, model: string): Promise<Record<string, unknown>> {
  return execute<Record<string, unknown>>(uid, model, 'fields_get', [], { attributes: ['string', 'type', 'required'] });
}

async function exploreModel(uid: number, model: string, label: string): Promise<void> {
  console.log(`\n📊 ${label} (${model})`);

  try {
    const count = await searchCount(uid, model);
    console.log(`   Total records: ${count}`);

    if (count > 0) {
      // Get first few records
      const records = await searchRead(uid, model, [], [], 3);
      console.log(`   Sample record keys: ${Object.keys(records[0] || {}).slice(0, 10).join(', ')}...`);

      // Show some data
      for (const record of records.slice(0, 2)) {
        const rec = record as Record<string, unknown>;
        const name = rec.name || rec.display_name || rec.id;
        console.log(`   - ${name}`);
      }
    }
  } catch (error) {
    const err = error as Error;
    console.log(`   ⚠️  Cannot access: ${err.message.slice(0, 100)}`);
  }
}

async function main(): Promise<void> {
  console.log('═══════════════════════════════════════════════════════════');
  console.log('                    ODOO EXPLORER                          ');
  console.log('═══════════════════════════════════════════════════════════');

  try {
    // Get version first (doesn't require auth)
    await getServerVersion();

    // Authenticate
    const uid = await authenticate();

    // Explore key models
    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('                  EXPLORING DATA                           ');
    console.log('═══════════════════════════════════════════════════════════');

    // Suppliers/Vendors
    await exploreModel(uid, 'res.partner', 'Suppliers/Contacts');

    // Check supplier-specific (partner with supplier_rank > 0)
    console.log('\n📊 Suppliers Only (supplier_rank > 0)');
    try {
      const supplierCount = await searchCount(uid, 'res.partner', [['supplier_rank', '>', 0]]);
      console.log(`   Supplier count: ${supplierCount}`);

      if (supplierCount > 0) {
        const suppliers = await searchRead(uid, 'res.partner', [['supplier_rank', '>', 0]], ['name', 'email', 'phone', 'vat'], 5);
        for (const s of suppliers) {
          const sup = s as Record<string, unknown>;
          console.log(`   - ${sup.name} (${sup.email || 'no email'})`);
        }
      }
    } catch (e) {
      console.log(`   ⚠️  Cannot filter suppliers`);
    }

    // Purchase Orders
    await exploreModel(uid, 'purchase.order', 'Purchase Orders');

    // Stock/Inventory
    await exploreModel(uid, 'stock.picking', 'Stock Transfers/Deliveries');
    await exploreModel(uid, 'stock.warehouse', 'Warehouses');
    await exploreModel(uid, 'stock.location', 'Stock Locations');

    // Fleet
    await exploreModel(uid, 'fleet.vehicle', 'Fleet Vehicles');
    await exploreModel(uid, 'fleet.vehicle.model', 'Vehicle Models');

    // Assets
    await exploreModel(uid, 'account.asset', 'Assets (account.asset)');
    await exploreModel(uid, 'account.asset.asset', 'Assets (account.asset.asset - older)');

    // Products/Items
    await exploreModel(uid, 'product.product', 'Products');
    await exploreModel(uid, 'product.template', 'Product Templates');

    // Additional useful models
    await exploreModel(uid, 'stock.move', 'Stock Moves');
    await exploreModel(uid, 'account.move', 'Account Moves/Invoices');

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('                  FIELD DETAILS                            ');
    console.log('═══════════════════════════════════════════════════════════');

    // Get detailed fields for key models
    const modelsToDetail = ['res.partner', 'purchase.order', 'fleet.vehicle'];

    for (const model of modelsToDetail) {
      console.log(`\n📋 Fields for ${model}:`);
      try {
        const fields = await getFields(uid, model);
        const fieldNames = Object.keys(fields).slice(0, 20);
        console.log(`   ${fieldNames.join(', ')}...`);
        console.log(`   (Total: ${Object.keys(fields).length} fields)`);
      } catch (e) {
        console.log(`   ⚠️  Cannot get fields`);
      }
    }

    console.log('\n═══════════════════════════════════════════════════════════');
    console.log('                  EXPLORATION COMPLETE                      ');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('\n✅ Connection successful! Ready to plan sync strategy.\n');

  } catch (error) {
    const err = error as Error;
    console.error('\n❌ Error:', err.message);

    if (err.message.includes('Authentication failed')) {
      console.log('\nTroubleshooting:');
      console.log('1. Verify the database name (try "velocityfibre-main" or check Odoo URL)');
      console.log('2. Ensure username and password are correct');
      console.log('3. Check if API access is enabled for this user');
    }
  }
}

main();
