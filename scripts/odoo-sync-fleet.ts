/**
 * Odoo Fleet Sync Script
 *
 * Run: npx tsx scripts/odoo-sync-fleet.ts [--dry-run] [--no-service-logs] [--no-odometer]
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { OdooClient } from '../src/services/odoo/odooClient';
import { syncFleet } from '../src/services/odoo/entities/fleetSync';

const ODOO_CONFIG = {
  url: 'https://velocityfibre.odoo.com',
  db: 'velocityfibre',
  username: 'jacques@velocityfibre.co.za',
  password: 'Ledene9685@',
};

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const includeServiceLogs = !process.argv.includes('--no-service-logs');
  const includeOdometer = !process.argv.includes('--no-odometer');

  console.log('===================================================================');
  console.log('                    ODOO FLEET SYNC                                ');
  console.log('===================================================================');
  console.log('Mode:', dryRun ? 'DRY RUN' : 'LIVE');
  console.log('Include service logs:', includeServiceLogs ? 'Yes' : 'No');
  console.log('Include odometer:', includeOdometer ? 'Yes' : 'No');
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

  const result = await syncFleet(client, databaseUrl, {
    dryRun,
    includeServiceLogs,
    includeOdometer,
  });

  // Print results
  console.log('\n===================================================================');
  console.log('                         RESULTS                                   ');
  console.log('===================================================================\n');

  console.log('VEHICLES:');
  console.log('  Created:', result.vehicles.created);
  console.log('  Updated:', result.vehicles.updated);
  console.log('  Errors: ', result.vehicles.errors.length);

  if (includeServiceLogs) {
    console.log('\nSERVICE LOGS:');
    console.log('  Created:', result.serviceLogs.created);
    console.log('  Updated:', result.serviceLogs.updated);
    console.log('  Errors: ', result.serviceLogs.errors.length);
  }

  if (includeOdometer) {
    console.log('\nODOMETER READINGS:');
    console.log('  Created:', result.odometer.created);
    console.log('  Updated:', result.odometer.updated);
    console.log('  Errors: ', result.odometer.errors.length);
  }

  // Print vehicle details
  const vehicleDetails = result.details.filter((d) => d.type === 'vehicle');
  if (vehicleDetails.length > 0) {
    console.log('\nVEHICLE DETAILS:');
    console.log('-------------------------------------------------------------------');
    for (const detail of vehicleDetails) {
      const icon = detail.action === 'created' ? '+' :
                   detail.action === 'updated' ? '~' :
                   detail.action === 'error' ? 'X' : '-';
      console.log('  ' + icon + ' [' + detail.odooId + '] ' + detail.name + ' - ' + detail.action);
      if (detail.message) {
        console.log('      ' + detail.message);
      }
    }
  }

  // Print errors
  const allErrors = [
    ...result.vehicles.errors,
    ...result.serviceLogs.errors.slice(0, 5),
    ...result.odometer.errors.slice(0, 5),
  ];
  if (allErrors.length > 0) {
    console.log('\nERRORS (first 15):');
    console.log('-------------------------------------------------------------------');
    for (const error of allErrors.slice(0, 15)) {
      console.log('  X ' + error);
    }
  }

  console.log('\n' + (dryRun ? 'DRY RUN - No changes were made' : 'Sync complete!'));
}

main().catch((err) => {
  console.error('Script failed:', err.message);
  process.exit(1);
});
