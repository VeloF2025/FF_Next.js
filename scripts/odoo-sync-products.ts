/**
 * Odoo Product Sync Script
 *
 * Run: npx tsx scripts/odoo-sync-products.ts [--dry-run] [--only-with-stock]
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { OdooClient } from '../src/services/odoo/odooClient';
import { syncProducts } from '../src/services/odoo/entities/productSync';

const ODOO_CONFIG = {
  url: 'https://velocityfibre.odoo.com',
  db: 'velocityfibre',
  username: 'jacques@velocityfibre.co.za',
  password: 'Ledene9685@',
};

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const onlyWithStock = process.argv.includes('--only-with-stock');

  console.log('===================================================================');
  console.log('                   ODOO PRODUCT SYNC                               ');
  console.log('===================================================================');
  console.log('Mode:', dryRun ? 'DRY RUN' : 'LIVE');
  console.log('Only with stock:', onlyWithStock ? 'Yes' : 'No (all products)');
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

  const result = await syncProducts(client, databaseUrl, {
    dryRun,
    onlyWithStock,
  });

  // Print results
  console.log('\n===================================================================');
  console.log('                         RESULTS                                   ');
  console.log('===================================================================\n');

  console.log('STOCK ITEMS:');
  console.log('  Created:', result.created);
  console.log('  Updated:', result.updated);
  console.log('  Skipped:', result.skipped);
  console.log('  Errors: ', result.errors.length);

  // Group by category
  const byCategory = new Map<string, { created: number; updated: number }>();
  for (const d of result.details) {
    if (d.action === 'error') continue;
    // Extract category from item code pattern
    const parts = d.itemCode.split('-');
    const cat = parts[0] || 'Other';
    if (!byCategory.has(cat)) byCategory.set(cat, { created: 0, updated: 0 });
    const stats = byCategory.get(cat)!;
    if (d.action === 'created') stats.created++;
    if (d.action === 'updated') stats.updated++;
  }

  console.log('\nBy Category Prefix:');
  for (const [cat, stats] of Array.from(byCategory.entries()).sort((a, b) => b[1].created + b[1].updated - a[1].created - a[1].updated)) {
    console.log(`  ${cat}: ${stats.created} created, ${stats.updated} updated`);
  }

  // Print details (first 30)
  console.log('\nDETAILS (first 30):');
  console.log('-------------------------------------------------------------------');
  for (const detail of result.details.slice(0, 30)) {
    const icon =
      detail.action === 'created' ? '+' :
      detail.action === 'updated' ? '~' :
      detail.action === 'skipped' ? '-' : 'X';
    const msg = detail.message ? ` (${detail.message})` : '';
    console.log(`  ${icon} [${detail.odooId}] ${detail.itemCode.substring(0, 50)}${msg}`);
  }
  if (result.details.length > 30) {
    console.log(`  ... and ${result.details.length - 30} more`);
  }

  // Print errors
  if (result.errors.length > 0) {
    console.log('\nERRORS:');
    console.log('-------------------------------------------------------------------');
    for (const error of result.errors.slice(0, 10)) {
      console.log('  X', error);
    }
  }

  console.log('\n' + (dryRun ? 'DRY RUN - No changes were made' : 'Sync complete!'));
}

main().catch((err) => {
  console.error('Script failed:', err.message);
  process.exit(1);
});
