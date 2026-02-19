/**
 * Odoo Stock Movement Sync Script (Neon serverless)
 *
 * Replaces the pg-Pool-based StockMovementSyncService for standalone execution.
 * Run: npx tsx scripts/odoo-sync-stock-movements.ts [--dry-run] [--since YYYY-MM-DD]
 */

import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });

import { OdooClient } from '../src/services/odoo/odooClient';
import { neon } from '@neondatabase/serverless';

const ODOO_CONFIG = {
  url: 'https://velocityfibre.odoo.com',
  db: 'velocityfibre',
  username: 'jacques@velocityfibre.co.za',
  password: 'Ledene9685@',
};

function mapMovementType(pickingTypeCode: string | null): string {
  switch (pickingTypeCode) {
    case 'incoming': return 'GRN';
    case 'outgoing': return 'DELIVERY';
    case 'internal': return 'TRANSFER';
    default: return 'OTHER';
  }
}

function mapStatus(odooState: string): string {
  switch (odooState) {
    case 'draft': return 'draft';
    case 'waiting':
    case 'confirmed':
    case 'assigned': return 'pending';
    case 'done': return 'completed';
    case 'cancel': return 'cancelled';
    default: return 'pending';
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const sinceIdx = process.argv.indexOf('--since');
  const sinceDate = sinceIdx !== -1 ? process.argv[sinceIdx + 1] : null;

  console.log('===================================================================');
  console.log('              ODOO STOCK MOVEMENT SYNC (Neon)                      ');
  console.log('===================================================================');
  console.log('Mode:', dryRun ? 'DRY RUN' : 'LIVE');
  if (sinceDate) console.log('Since:', sinceDate);
  console.log('');

  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    console.error('DATABASE_URL not found in environment');
    process.exit(1);
  }

  const sql = neon(databaseUrl);
  const client = new OdooClient(ODOO_CONFIG);

  // Test Odoo connection
  console.log('Testing Odoo connection...');
  const connectionTest = await client.testConnection();
  if (!connectionTest.success) {
    console.error('Failed to connect to Odoo:', connectionTest.message);
    process.exit(1);
  }
  console.log('Connected to Odoo', connectionTest.version, '\n');

  // Load location cache
  console.log('Loading Odoo locations...');
  const locations = await client.getStockLocations({ limit: 500 });
  const locationMap = new Map<number, string>();
  for (const loc of locations) {
    locationMap.set(loc.id, loc.complete_name || loc.name);
  }
  console.log(`  Loaded ${locations.length} locations`);

  // Load picking type cache
  console.log('Loading picking types...');
  const pickingTypes = await client.searchRead<{ id: number; code: string }>(
    'stock.picking.type',
    { fields: ['id', 'code'], limit: 100 }
  );
  const pickingTypeMap = new Map<number, string>();
  for (const t of pickingTypes) {
    pickingTypeMap.set(t.id, t.code);
  }
  console.log(`  Loaded ${pickingTypes.length} picking types`);

  // Build domain for completed pickings
  const domain: unknown[] = [['state', '=', 'done']];
  if (sinceDate) {
    domain.push(['date_done', '>=', sinceDate]);
  }

  // Fetch pickings from Odoo
  console.log('\nFetching completed pickings from Odoo...');
  const pickings = await client.getStockPickings({
    domain,
    limit: 1000,
    order: 'date_done DESC',
  });
  console.log(`  Found ${pickings.length} completed pickings`);

  // Get existing Odoo picking IDs to skip duplicates
  const existingRows = await sql`
    SELECT DISTINCT odoo_picking_id FROM stock_movements WHERE odoo_picking_id IS NOT NULL
  `;
  const existingIds = new Set(existingRows.map((r: { odoo_picking_id: number }) => r.odoo_picking_id));
  console.log(`  Already synced: ${existingIds.size} pickings`);

  const newPickings = pickings.filter(p => !existingIds.has(p.id));
  console.log(`  New to sync: ${newPickings.length} pickings\n`);

  if (newPickings.length === 0) {
    console.log('Nothing new to sync!');
    return;
  }

  let synced = 0;
  let itemsSynced = 0;
  const errors: string[] = [];

  for (const picking of newPickings) {
    try {
      const typeCode = picking.picking_type_id
        ? pickingTypeMap.get(picking.picking_type_id[0]) || null
        : null;
      const movementType = mapMovementType(typeCode);
      const status = mapStatus(picking.state);
      const fromLocation = picking.location_id
        ? (locationMap.get(picking.location_id[0]) || picking.location_id[1] || 'Unknown')
        : 'Unknown';
      const toLocation = picking.location_dest_id
        ? (locationMap.get(picking.location_dest_id[0]) || picking.location_dest_id[1] || 'Unknown')
        : 'Unknown';
      const partnerName = picking.partner_id ? picking.partner_id[1] : null;

      if (dryRun) {
        const icon = movementType === 'GRN' ? '+' : movementType === 'DELIVERY' ? '→' : '↔';
        console.log(`  ${icon} [${picking.id}] ${picking.name} ${movementType} ${status} (${picking.move_ids?.length || 0} moves)`);
        synced++;
        itemsSynced += picking.move_ids?.length || 0;
        continue;
      }

      // Insert movement
      const result = await sql`
        INSERT INTO stock_movements (
          id, project_id, movement_type, reference_number, reference_type,
          from_location, to_location, status, movement_date, confirmed_at,
          notes, source_type, odoo_picking_id, odoo_synced_at
        ) VALUES (
          gen_random_uuid(), 'odoo', ${movementType}, ${picking.name}, ${typeCode || 'picking'},
          ${fromLocation}, ${toLocation}, ${status}, ${picking.scheduled_date}, ${picking.date_done},
          ${'Synced from Odoo. Partner: ' + (partnerName || 'N/A') + '. Origin: ' + (picking.origin || 'N/A')},
          'odoo', ${picking.id}, NOW()
        ) RETURNING id
      `;

      const movementId = result[0]?.id;
      if (!movementId) throw new Error('No movement ID returned');

      // Fetch and insert move lines
      let moveCount = 0;
      if (picking.move_ids && picking.move_ids.length > 0) {
        const moves = await client.getStockMovesForPickings([picking.id]);

        for (const move of moves) {
          const productName = move.product_id ? move.product_id[1] : 'Unknown Product';
          const productCode = move.product_id ? `odoo-${move.product_id[0]}` : '';
          const uom = move.product_uom ? move.product_uom[1] : 'EA';

          await sql`
            INSERT INTO stock_movement_items (
              id, stock_movement_id, project_id, item_code, description,
              planned_quantity, actual_quantity, uom, item_status, created_at
            ) VALUES (
              gen_random_uuid(), ${movementId}, 'odoo', ${productCode}, ${productName},
              ${move.product_uom_qty || 0}, ${move.quantity || move.product_uom_qty || 0},
              ${uom}, ${move.state === 'done' ? 'received' : 'pending'}, NOW()
            )
          `;
          moveCount++;
        }
      }

      synced++;
      itemsSynced += moveCount;

      const icon = movementType === 'GRN' ? '+' : movementType === 'DELIVERY' ? '→' : '↔';
      console.log(`  ${icon} [${picking.id}] ${picking.name} ${movementType} (${moveCount} items)`);
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      errors.push(`Picking ${picking.name}: ${msg}`);
      console.error(`  X ${picking.name}: ${msg}`);
    }
  }

  console.log('\n===================================================================');
  console.log('                         RESULTS                                   ');
  console.log('===================================================================\n');
  console.log('Pickings synced:', synced);
  console.log('Items synced:', itemsSynced);
  console.log('Errors:', errors.length);

  if (errors.length > 0) {
    console.log('\nERRORS (first 15):');
    for (const e of errors.slice(0, 15)) {
      console.log('  X', e);
    }
  }

  console.log('\n' + (dryRun ? 'DRY RUN - No changes were made' : 'Sync complete!'));
}

main().catch((err) => {
  console.error('Script failed:', err.message);
  process.exit(1);
});
