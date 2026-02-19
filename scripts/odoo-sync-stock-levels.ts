/**
 * Odoo Stock Level Sync Script
 *
 * Run: npx tsx scripts/odoo-sync-stock-levels.ts [--dry-run]
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { OdooClient } from '../src/services/odoo/odooClient';
import { syncStockLevels } from '../src/services/odoo/entities/stockLevelSync';

const ODOO_CONFIG = {
  url: 'https://velocityfibre.odoo.com',
  db: 'velocityfibre',
  username: 'jacques@velocityfibre.co.za',
  password: 'Ledene9685@',
};

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log('===================================================================');
  console.log('                 ODOO STOCK LEVEL SYNC                              ');
  console.log('===================================================================');
  console.log('Mode:', dryRun ? 'DRY RUN' : 'LIVE');
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

  const result = await syncStockLevels(client, databaseUrl, {
    dryRun,
    limit: 1000,
  });

  // Print results
  console.log('\n===================================================================');
  console.log('                         RESULTS                                   ');
  console.log('===================================================================\n');

  console.log('STOCK LEVELS:');
  console.log('  Created:', result.created);
  console.log('  Updated:', result.updated);
  console.log('  Skipped:', result.skipped);
  console.log('  Errors: ', result.errors.length);

  // Summary by action
  const byAction = result.details.reduce((acc, d) => {
    acc[d.action] = (acc[d.action] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
  console.log('\nBy Action:', byAction);

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
      const qty = detail.quantity !== undefined ? ` qty:${detail.quantity}` : '';
      console.log(`  ${icon} ${detail.productName} @ ${detail.locationName}${qty} - ${detail.action}`);
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
