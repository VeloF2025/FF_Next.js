/**
 * Odoo Purchase Order Sync Script
 *
 * Run: npx tsx scripts/odoo-sync-po.ts [--dry-run] [--no-line-items]
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { OdooClient } from '../src/services/odoo/odooClient';
import { syncPurchaseOrders } from '../src/services/odoo/entities/purchaseOrderSync';

const ODOO_CONFIG = {
  url: 'https://velocityfibre.odoo.com',
  db: 'velocityfibre',
  username: 'jacques@velocityfibre.co.za',
  password: 'Ledene9685@',
};

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const includeLineItems = !process.argv.includes('--no-line-items');

  console.log('===================================================================');
  console.log('                 ODOO PURCHASE ORDER SYNC                          ');
  console.log('===================================================================');
  console.log('Mode:', dryRun ? 'DRY RUN' : 'LIVE');
  console.log('Include line items:', includeLineItems ? 'Yes' : 'No');
  console.log('');

  const client = new OdooClient(ODOO_CONFIG);

  // Test connection
  console.log('Testing Odoo connection...');
  const connectionTest = await client.testConnection();
  if (!connectionTest.success) {
    console.error('Failed to connect to Odoo:', connectionTest.message);
    process.exit(1);
  }
  console.log('Connected to Odoo', connectionTest.version, '\n');

  // Run sync
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL not found in environment');
    process.exit(1);
  }

  const result = await syncPurchaseOrders(client, databaseUrl, {
    dryRun,
    includeLineItems,
  });

  // Print results
  console.log('\n===================================================================');
  console.log('                         RESULTS                                   ');
  console.log('===================================================================\n');

  console.log('PURCHASE ORDERS:');
  console.log('  Created:', result.orders.created);
  console.log('  Updated:', result.orders.updated);
  console.log('  Skipped:', result.orders.skipped);
  console.log('  Errors: ', result.orders.errors.length);

  if (includeLineItems) {
    console.log('\nLINE ITEMS:');
    console.log('  Created:', result.lineItems.created);
    console.log('  Updated:', result.lineItems.updated);
    console.log('  Errors: ', result.lineItems.errors.length);
  }

  // Print order details (first 30)
  const orderDetails = result.details.slice(0, 30);
  if (orderDetails.length > 0) {
    console.log('\nORDER DETAILS (first 30):');
    console.log('-------------------------------------------------------------------');
    for (const detail of orderDetails) {
      const icon =
        detail.action === 'created'
          ? '+'
          : detail.action === 'updated'
          ? '~'
          : detail.action === 'skipped'
          ? '-'
          : 'X';
      console.log('  ' + icon + ' [' + detail.odooId + '] ' + detail.poNumber + ' - ' + detail.action);
      if (detail.message) {
        console.log('      ' + detail.message);
      }
    }
    if (result.details.length > 30) {
      console.log(`  ... and ${result.details.length - 30} more`);
    }
  }

  // Print errors
  const allErrors = [
    ...result.orders.errors.slice(0, 10),
    ...result.lineItems.errors.slice(0, 5),
  ];
  if (allErrors.length > 0) {
    console.log('\nERRORS (first 15):');
    console.log('-------------------------------------------------------------------');
    for (const error of allErrors) {
      console.log('  X ' + error);
    }
  }

  console.log('\n' + (dryRun ? 'DRY RUN - No changes were made' : 'Sync complete!'));
}

main().catch((err) => {
  console.error('Script failed:', err.message);
  process.exit(1);
});
