/**
 * Odoo Supplier Sync Script
 *
 * Run: npx tsx scripts/odoo-sync-suppliers.ts [--dry-run]
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { OdooClient } from '../src/services/odoo/odooClient';
import { syncSuppliers } from '../src/services/odoo/entities/supplierSync';

const ODOO_CONFIG = {
  url: 'https://velocityfibre.odoo.com',
  db: 'velocityfibre',
  username: 'jacques@velocityfibre.co.za',
  password: 'Ledene9685@',
};

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                 ODOO SUPPLIER SYNC                             ');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Mode: ${dryRun ? 'DRY RUN (no changes will be made)' : 'LIVE'}\n`);

  const client = new OdooClient(ODOO_CONFIG);

  // Test connection
  console.log('Testing Odoo connection...');
  const connectionTest = await client.testConnection();
  if (!connectionTest.success) {
    console.error('Failed to connect to Odoo:', connectionTest.message);
    process.exit(1);
  }
  console.log(`Connected to Odoo ${connectionTest.version}\n`);

  // Run sync
  console.log('Starting supplier sync...\n');

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL not found in environment');
    process.exit(1);
  }

  const result = await syncSuppliers(client, databaseUrl, { dryRun });

  // Print results
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                        RESULTS                                 ');
  console.log('═══════════════════════════════════════════════════════════════\n');

  console.log(`Created: ${result.created}`);
  console.log(`Updated: ${result.updated}`);
  console.log(`Skipped: ${result.skipped}`);
  console.log(`Errors:  ${result.errors.length}`);

  if (result.details.length > 0) {
    console.log('\nDetails:');
    console.log('─────────────────────────────────────────────────────────────────');
    for (const detail of result.details) {
      const icon = detail.action === 'created' ? '➕' :
                   detail.action === 'updated' ? '✏️' :
                   detail.action === 'error' ? '❌' : '⏭️';
      console.log(`  ${icon} [${detail.odooId}] ${detail.name} - ${detail.action}`);
      if (detail.message) {
        console.log(`      ${detail.message}`);
      }
    }
  }

  if (result.errors.length > 0) {
    console.log('\nErrors:');
    console.log('─────────────────────────────────────────────────────────────────');
    for (const error of result.errors) {
      console.log(`  ❌ ${error}`);
    }
  }

  console.log('\n' + (dryRun ? '⚠️  DRY RUN - No changes were made' : '✅ Sync complete!'));
}

main().catch((err) => {
  console.error('Script failed:', err.message);
  process.exit(1);
});
