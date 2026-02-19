/**
 * Odoo GRN (Goods Receipt Notes) Sync Script
 *
 * Run: npx tsx scripts/odoo-sync-grn.ts [--dry-run] [--skip-existing]
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { OdooClient } from '../src/services/odoo/odooClient';
import { syncStockReceipts } from '../src/services/odoo/entities/stockReceiptSync';

const ODOO_CONFIG = {
  url: 'https://velocityfibre.odoo.com',
  db: 'velocityfibre',
  username: 'jacques@velocityfibre.co.za',
  password: 'Ledene9685@',
};

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const skipExisting = process.argv.includes('--skip-existing');

  console.log('===================================================================');
  console.log('              ODOO GRN (STOCK RECEIPT) SYNC                        ');
  console.log('===================================================================');
  console.log('Mode:', dryRun ? 'DRY RUN' : 'LIVE');
  console.log('Skip existing:', skipExisting ? 'Yes' : 'No');
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

  const result = await syncStockReceipts(client, databaseUrl, {
    dryRun,
    skipExisting,
    limit: 500,
  });

  // Print results
  console.log('\n===================================================================');
  console.log('                         RESULTS                                   ');
  console.log('===================================================================\n');

  console.log('GOODS RECEIPT NOTES:');
  console.log('  Created:', result.created);
  console.log('  Updated:', result.updated);
  console.log('  Skipped:', result.skipped);
  console.log('  Errors: ', result.errors.length);

  // Print details (first 30)
  const details = result.details.slice(0, 30);
  if (details.length > 0) {
    console.log('\nDETAILS (first 30):');
    console.log('-------------------------------------------------------------------');
    for (const detail of details) {
      const icon =
        detail.action === 'created'
          ? '+'
          : detail.action === 'updated'
          ? '~'
          : detail.action === 'skipped'
          ? '-'
          : 'X';
      const items = detail.itemsCreated ? ` (${detail.itemsCreated} items)` : '';
      const grn = detail.grnNumber ? ` → ${detail.grnNumber}` : '';
      console.log(`  ${icon} [${detail.odooId}] ${detail.odooName}${grn}${items} - ${detail.action}`);
      if (detail.message) {
        console.log('      ' + detail.message);
      }
    }
    if (result.details.length > 30) {
      console.log(`  ... and ${result.details.length - 30} more`);
    }
  }

  // Print errors
  if (result.errors.length > 0) {
    console.log('\nERRORS (first 15):');
    console.log('-------------------------------------------------------------------');
    for (const error of result.errors.slice(0, 15)) {
      console.log('  X ' + error);
    }
  }

  console.log('\n' + (dryRun ? 'DRY RUN - No changes were made' : 'Sync complete!'));
}

main().catch((err) => {
  console.error('Script failed:', err.message);
  process.exit(1);
});
