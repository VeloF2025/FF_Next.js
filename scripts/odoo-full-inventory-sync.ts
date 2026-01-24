#!/usr/bin/env npx ts-node
/**
 * Odoo Full Inventory Sync CLI
 *
 * Orchestrates complete inventory sync from Odoo to FibreFlow in correct order:
 * 1. Suppliers (prerequisite)
 * 2. Products/Stock Items (prerequisite)
 * 3. Location Mappings (setup)
 * 4. Stock Receipts (GRN)
 * 5. Stock Transfers
 * 6. Stock Levels
 *
 * Usage:
 *   npx ts-node scripts/odoo-full-inventory-sync.ts [options]
 *
 * Options:
 *   --dry-run         Preview changes without making them
 *   --skip-suppliers  Skip supplier sync (if already done)
 *   --skip-products   Skip product sync (if already done)
 *   --only <step>     Run only specific step (suppliers, products, receipts, transfers, levels)
 *   --limit <n>       Limit records per step (default: 500)
 *   --stats           Show sync statistics only
 *   --help            Show this help message
 *
 * Environment:
 *   DATABASE_URL      PostgreSQL connection string (required)
 *   ODOO_URL          Odoo server URL
 *   ODOO_DB           Odoo database name
 *   ODOO_USERNAME     Odoo username
 *   ODOO_PASSWORD     Odoo password
 */

import { OdooClient } from '../src/services/odoo/odooClient';
import { syncSuppliers } from '../src/services/odoo/entities/supplierSync';
import { syncProducts } from '../src/services/odoo/entities/productSync';
import { syncStockReceipts, getStockReceiptSyncStats } from '../src/services/odoo/entities/stockReceiptSync';
import { syncStockTransfers, getStockTransferSyncStats } from '../src/services/odoo/entities/stockTransferSync';
import { syncStockLevels, getStockLevelSyncStats, compareStockLevels } from '../src/services/odoo/entities/stockLevelSync';

// ============================================================================
// Configuration
// ============================================================================

const DATABASE_URL = process.env.DATABASE_URL;
const ODOO_URL = process.env.ODOO_URL || 'https://velocityfibre.odoo.com';
const ODOO_DB = process.env.ODOO_DB || 'velocityfibre';
const ODOO_USERNAME = process.env.ODOO_USERNAME || 'hein@velocityfibre.co.za';
const ODOO_PASSWORD = process.env.ODOO_PASSWORD || 'Velocity@2025!';

// ============================================================================
// CLI Argument Parsing
// ============================================================================

interface CLIArgs {
  dryRun: boolean;
  skipSuppliers: boolean;
  skipProducts: boolean;
  only?: string;
  limit: number;
  showStats: boolean;
  help: boolean;
}

function parseArgs(): CLIArgs {
  const args = process.argv.slice(2);
  const result: CLIArgs = {
    dryRun: false,
    skipSuppliers: false,
    skipProducts: false,
    limit: 500,
    showStats: false,
    help: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--dry-run':
        result.dryRun = true;
        break;
      case '--skip-suppliers':
        result.skipSuppliers = true;
        break;
      case '--skip-products':
        result.skipProducts = true;
        break;
      case '--only':
        result.only = args[++i];
        break;
      case '--limit':
        result.limit = parseInt(args[++i], 10);
        break;
      case '--stats':
        result.showStats = true;
        break;
      case '--help':
      case '-h':
        result.help = true;
        break;
    }
  }

  return result;
}

function showHelp(): void {
  console.log(`
Odoo Full Inventory Sync CLI

Orchestrates complete inventory sync from Odoo in correct dependency order.

Usage:
  npx ts-node scripts/odoo-full-inventory-sync.ts [options]

Options:
  --dry-run         Preview changes without making them
  --skip-suppliers  Skip supplier sync (if already synced recently)
  --skip-products   Skip product sync (if already synced recently)
  --only <step>     Run only specific step:
                    - suppliers
                    - products
                    - receipts (GRN/stock receipts)
                    - transfers (internal transfers)
                    - levels (stock levels/quants)
  --limit <n>       Limit records per step (default: 500)
  --stats           Show sync statistics only
  --help, -h        Show this help message

Sync Order (dependencies enforced):
  1. Suppliers    → Required for GRN supplier linking
  2. Products     → Required for all stock operations
  3. Receipts     → Creates goods_receipt_notes from stock.picking (incoming)
  4. Transfers    → Creates stock_movements from stock.picking (internal)
  5. Levels       → Updates stock_levels from stock.quant

Examples:
  # Full dry run
  DATABASE_URL='...' npx ts-node scripts/odoo-full-inventory-sync.ts --dry-run

  # Sync only GRN/receipts (assumes suppliers and products are synced)
  DATABASE_URL='...' npx ts-node scripts/odoo-full-inventory-sync.ts --only receipts

  # Full sync skipping prerequisites
  DATABASE_URL='...' npx ts-node scripts/odoo-full-inventory-sync.ts --skip-suppliers --skip-products

  # Check current sync status
  DATABASE_URL='...' npx ts-node scripts/odoo-full-inventory-sync.ts --stats
  `);
}

// ============================================================================
// Statistics Display
// ============================================================================

async function showStats(client: OdooClient): Promise<void> {
  if (!DATABASE_URL) {
    console.error('ERROR: DATABASE_URL is required');
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('Odoo Inventory Sync Statistics');
  console.log('='.repeat(60));
  console.log('');

  // Stock Receipts
  const receiptStats = await getStockReceiptSyncStats(DATABASE_URL);
  console.log('Stock Receipts (GRN):');
  console.log(`  Total GRNs:     ${receiptStats.totalGRNs}`);
  console.log(`  Odoo synced:    ${receiptStats.odooSynced}`);
  console.log(`  Manual/Local:   ${receiptStats.notSynced}`);
  console.log(`  Last sync:      ${receiptStats.lastSync?.toISOString() || 'Never'}`);
  console.log('');

  // Stock Transfers
  const transferStats = await getStockTransferSyncStats(DATABASE_URL);
  console.log('Stock Transfers:');
  console.log(`  Total movements: ${transferStats.totalMovements}`);
  console.log(`  Odoo synced:     ${transferStats.odooSynced}`);
  console.log(`  Last sync:       ${transferStats.lastSync?.toISOString() || 'Never'}`);
  if (transferStats.byType.length > 0) {
    console.log('  By type:');
    for (const t of transferStats.byType) {
      console.log(`    ${t.type}: ${t.count}`);
    }
  }
  console.log('');

  // Stock Levels
  const levelStats = await getStockLevelSyncStats(DATABASE_URL);
  console.log('Stock Levels:');
  console.log(`  Total levels:   ${levelStats.totalLevels}`);
  console.log(`  Odoo synced:    ${levelStats.odooSynced}`);
  console.log(`  Total quantity: ${levelStats.totalQuantity.toLocaleString()}`);
  console.log(`  Last sync:      ${levelStats.lastSync?.toISOString() || 'Never'}`);
  if (levelStats.byWarehouse.length > 0) {
    console.log('  By warehouse:');
    for (const w of levelStats.byWarehouse) {
      console.log(`    ${w.warehouseName || 'Unknown'}: ${w.count} items, ${w.totalQty} qty`);
    }
  }
  console.log('');

  // Discrepancy check
  console.log('Checking for quantity discrepancies...');
  const comparison = await compareStockLevels(client, DATABASE_URL, { limit: 500 });
  console.log(`  Matches:       ${comparison.matches}`);
  console.log(`  Discrepancies: ${comparison.discrepancies.length}`);
  if (comparison.discrepancies.length > 0) {
    console.log('  Top discrepancies:');
    for (const d of comparison.discrepancies.slice(0, 5)) {
      console.log(`    ${d.productName}: Odoo=${d.odooQty}, FF=${d.ffQty}, Diff=${d.difference}`);
    }
  }
  console.log('');
}

// ============================================================================
// Sync Steps
// ============================================================================

interface StepResult {
  step: string;
  success: boolean;
  created: number;
  updated: number;
  errors: number;
  message: string;
}

async function runSupplierSync(
  client: OdooClient,
  dryRun: boolean
): Promise<StepResult> {
  console.log('\n📦 Step 1: Syncing Suppliers...\n');

  const result = await syncSuppliers(client, DATABASE_URL!, { dryRun });

  return {
    step: 'Suppliers',
    success: result.errors.length === 0,
    created: result.created,
    updated: result.updated,
    errors: result.errors.length,
    message: `Created: ${result.created}, Updated: ${result.updated}, Errors: ${result.errors.length}`,
  };
}

async function runProductSync(
  client: OdooClient,
  dryRun: boolean,
  limit: number
): Promise<StepResult> {
  console.log('\n📦 Step 2: Syncing Products...\n');

  const result = await syncProducts(client, DATABASE_URL!, { dryRun, limit });

  return {
    step: 'Products',
    success: result.errors.length === 0,
    created: result.created,
    updated: result.updated,
    errors: result.errors.length,
    message: `Created: ${result.created}, Updated: ${result.updated}, Errors: ${result.errors.length}`,
  };
}

async function runReceiptSync(
  client: OdooClient,
  dryRun: boolean,
  limit: number
): Promise<StepResult> {
  console.log('\n📦 Step 3: Syncing Stock Receipts (GRN)...\n');

  const result = await syncStockReceipts(client, DATABASE_URL!, { dryRun, limit });

  return {
    step: 'Stock Receipts',
    success: result.errors.length === 0,
    created: result.created,
    updated: result.updated,
    errors: result.errors.length,
    message: `Created: ${result.created}, Updated: ${result.updated}, Skipped: ${result.skipped}, Errors: ${result.errors.length}`,
  };
}

async function runTransferSync(
  client: OdooClient,
  dryRun: boolean,
  limit: number
): Promise<StepResult> {
  console.log('\n📦 Step 4: Syncing Stock Transfers...\n');

  const result = await syncStockTransfers(client, DATABASE_URL!, { dryRun, limit });

  return {
    step: 'Stock Transfers',
    success: result.errors.length === 0,
    created: result.created,
    updated: result.updated,
    errors: result.errors.length,
    message: `Created: ${result.created}, Updated: ${result.updated}, Skipped: ${result.skipped}, Errors: ${result.errors.length}`,
  };
}

async function runLevelSync(
  client: OdooClient,
  dryRun: boolean,
  limit: number
): Promise<StepResult> {
  console.log('\n📦 Step 5: Syncing Stock Levels...\n');

  const result = await syncStockLevels(client, DATABASE_URL!, { dryRun, limit });

  return {
    step: 'Stock Levels',
    success: result.errors.length === 0,
    created: result.created,
    updated: result.updated,
    errors: result.errors.length,
    message: `Created: ${result.created}, Updated: ${result.updated}, Skipped: ${result.skipped}, Errors: ${result.errors.length}`,
  };
}

// ============================================================================
// Main Execution
// ============================================================================

async function runFullSync(args: CLIArgs): Promise<void> {
  if (!DATABASE_URL) {
    console.error('ERROR: DATABASE_URL environment variable is required');
    process.exit(1);
  }

  console.log('='.repeat(60));
  console.log('Odoo Full Inventory Sync');
  console.log('='.repeat(60));
  console.log('');

  if (args.dryRun) {
    console.log('*** DRY RUN - No changes will be made ***');
    console.log('');
  }

  console.log('Configuration:');
  console.log(`  Odoo URL:       ${ODOO_URL}`);
  console.log(`  Odoo DB:        ${ODOO_DB}`);
  console.log(`  Limit per step: ${args.limit}`);
  console.log(`  Only step:      ${args.only || 'all'}`);
  console.log(`  Skip suppliers: ${args.skipSuppliers}`);
  console.log(`  Skip products:  ${args.skipProducts}`);
  console.log('');

  // Initialize Odoo client
  console.log('Connecting to Odoo...');
  const client = new OdooClient({
    url: ODOO_URL,
    db: ODOO_DB,
    username: ODOO_USERNAME,
    password: ODOO_PASSWORD,
  });

  await client.authenticate();
  console.log('✓ Connected to Odoo\n');

  const results: StepResult[] = [];
  const startTime = Date.now();

  // Run steps in order (or just the specified one)
  const shouldRun = (step: string) => !args.only || args.only === step;

  // Step 1: Suppliers
  if (shouldRun('suppliers') && !args.skipSuppliers) {
    results.push(await runSupplierSync(client, args.dryRun));
  }

  // Step 2: Products
  if (shouldRun('products') && !args.skipProducts) {
    results.push(await runProductSync(client, args.dryRun, args.limit));
  }

  // Step 3: Stock Receipts
  if (shouldRun('receipts')) {
    results.push(await runReceiptSync(client, args.dryRun, args.limit));
  }

  // Step 4: Stock Transfers
  if (shouldRun('transfers')) {
    results.push(await runTransferSync(client, args.dryRun, args.limit));
  }

  // Step 5: Stock Levels
  if (shouldRun('levels')) {
    results.push(await runLevelSync(client, args.dryRun, args.limit));
  }

  const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SYNC SUMMARY');
  console.log('='.repeat(60));
  console.log('');

  let totalCreated = 0;
  let totalUpdated = 0;
  let totalErrors = 0;

  for (const r of results) {
    const status = r.success ? '✓' : '✗';
    console.log(`${status} ${r.step}: ${r.message}`);
    totalCreated += r.created;
    totalUpdated += r.updated;
    totalErrors += r.errors;
  }

  console.log('');
  console.log(`Total: Created ${totalCreated}, Updated ${totalUpdated}, Errors ${totalErrors}`);
  console.log(`Time:  ${totalTime}s`);
  console.log('');
  console.log('='.repeat(60));
  console.log(args.dryRun ? 'Dry run complete!' : 'Sync complete!');
  console.log('='.repeat(60));

  if (totalErrors > 0) {
    process.exit(1);
  }
}

// ============================================================================
// Entry Point
// ============================================================================

async function main(): Promise<void> {
  const args = parseArgs();

  if (args.help) {
    showHelp();
    return;
  }

  try {
    // Initialize client for stats
    const client = new OdooClient({
      url: ODOO_URL,
      db: ODOO_DB,
      username: ODOO_USERNAME,
      password: ODOO_PASSWORD,
    });
    await client.authenticate();

    if (args.showStats) {
      await showStats(client);
    } else {
      await runFullSync(args);
    }
  } catch (error) {
    console.error('');
    console.error('ERROR:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main();
