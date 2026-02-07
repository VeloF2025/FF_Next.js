#!/usr/bin/env node
/**
 * Batch sync ONT/UPS serials from 1Map API to drops table
 *
 * Usage:
 *   node scripts/sync-1map-serials.js [project]
 *   node scripts/sync-1map-serials.js Lawley
 *   node scripts/sync-1map-serials.js all
 *
 * Environment:
 *   DATABASE_URL - Neon PostgreSQL connection string
 */

const { neon } = require('@neondatabase/serverless');

// Configuration
const ONEMAP_BASE_URL = 'http://100.96.203.105:8003/api/record';
const BATCH_SIZE = 100;        // Drops per batch
const CONCURRENCY = 10;        // Parallel requests to 1Map
const DELAY_BETWEEN_BATCHES = 1000; // ms between batches

// Database connection
const DATABASE_URL = process.env.DATABASE_URL ||
  'process.env.DATABASE_URL';
const sql = neon(DATABASE_URL);

// Stats tracking
const stats = {
  total: 0,
  processed: 0,
  updated: 0,
  noData: 0,
  errors: 0,
  startTime: null
};

/**
 * Extract clean serial number from barcode data
 * Some barcodes contain encoded data like: [)>06...SALCLB477FDD0...
 * We need to extract just the serial number (e.g., ALCLB477FDD0)
 */
function parseSerialFromBarcode(barcode) {
  if (!barcode) return null;

  // If it's a clean serial (alphanumeric, reasonable length), return as-is
  if (/^[A-Za-z0-9]{8,20}$/.test(barcode)) {
    return barcode;
  }

  // Try to extract serial from encoded barcode data
  // Pattern: Look for SALCLXXXX or similar after control chars
  const match = barcode.match(/S(ALCL[A-Z0-9]{8,12})/);
  if (match) {
    return match[1];
  }

  // Fallback: truncate to 100 chars if too long
  if (barcode.length > 100) {
    return barcode.substring(0, 100);
  }

  return barcode;
}

async function fetch1MapData(drNumber) {
  try {
    const response = await fetch(`${ONEMAP_BASE_URL}/${drNumber}`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });

    if (!response.ok) {
      if (response.status === 404) return null;
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();
    if (data.detail) return null; // Not found message

    return data;
  } catch (error) {
    return null;
  }
}

async function updateDrop(drNumber, ontSerial, upsSerial) {
  try {
    await sql`
      UPDATE drops
      SET
        ont_serial = COALESCE(${ontSerial}, ont_serial),
        mini_ups_serial = COALESCE(${upsSerial}, mini_ups_serial),
        updated_at = NOW()
      WHERE drop_number = ${drNumber}
    `;
    return true;
  } catch (error) {
    console.error(`  Error updating ${drNumber}: ${error.message}`);
    return false;
  }
}

async function processDrop(drNumber) {
  const data = await fetch1MapData(drNumber);

  if (!data) {
    stats.noData++;
    return { status: 'no_data' };
  }

  const ontSerial = parseSerialFromBarcode(data.ont_barcode);
  const upsSerial = parseSerialFromBarcode(data.ups_serial);

  if (!ontSerial && !upsSerial) {
    stats.noData++;
    return { status: 'no_data' };
  }

  const success = await updateDrop(drNumber, ontSerial, upsSerial);
  if (success) {
    stats.updated++;
    return { status: 'updated', ont: ontSerial, ups: upsSerial };
  } else {
    stats.errors++;
    return { status: 'error' };
  }
}

async function processInParallel(drops, concurrency) {
  const results = [];
  for (let i = 0; i < drops.length; i += concurrency) {
    const batch = drops.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(d => processDrop(d.drop_number))
    );
    results.push(...batchResults);
    stats.processed += batch.length;
  }
  return results;
}

function printProgress() {
  const elapsed = (Date.now() - stats.startTime) / 1000;
  const rate = stats.processed / elapsed;
  const remaining = stats.total - stats.processed;
  const eta = remaining / rate;

  process.stdout.write(
    `\r  Progress: ${stats.processed}/${stats.total} (${((stats.processed/stats.total)*100).toFixed(1)}%) | ` +
    `Updated: ${stats.updated} | No Data: ${stats.noData} | Errors: ${stats.errors} | ` +
    `Rate: ${rate.toFixed(1)}/s | ETA: ${Math.ceil(eta/60)}min   `
  );
}

async function syncProject(projectName) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Syncing: ${projectName}`);
  console.log(`${'='.repeat(60)}`);

  // Reset stats
  stats.processed = 0;
  stats.updated = 0;
  stats.noData = 0;
  stats.errors = 0;
  stats.startTime = Date.now();

  // Get total count
  const countResult = await sql`
    SELECT COUNT(*) as total
    FROM drops d
    LEFT JOIN projects p ON d.project_id = p.id
    WHERE (d.ont_serial IS NULL OR d.mini_ups_serial IS NULL)
      AND d.drop_number IS NOT NULL
      AND d.drop_number ~ '^DR[0-9]+$'
      AND LOWER(p.project_name) = LOWER(${projectName})
  `;
  stats.total = parseInt(countResult[0]?.total || '0');

  if (stats.total === 0) {
    console.log(`  No drops need syncing for ${projectName}`);
    return;
  }

  console.log(`  Total drops to sync: ${stats.total}`);
  console.log(`  Batch size: ${BATCH_SIZE}, Concurrency: ${CONCURRENCY}`);
  console.log('');

  let offset = 0;
  while (offset < stats.total) {
    // Fetch batch of drops
    const drops = await sql`
      SELECT d.drop_number
      FROM drops d
      LEFT JOIN projects p ON d.project_id = p.id
      WHERE (d.ont_serial IS NULL OR d.mini_ups_serial IS NULL)
        AND d.drop_number IS NOT NULL
        AND d.drop_number ~ '^DR[0-9]+$'
        AND LOWER(p.project_name) = LOWER(${projectName})
      ORDER BY d.drop_number
      LIMIT ${BATCH_SIZE}
      OFFSET ${offset}
    `;

    if (drops.length === 0) break;

    // Process batch with parallel requests
    await processInParallel(drops, CONCURRENCY);

    printProgress();

    offset += BATCH_SIZE;

    // Small delay between batches
    if (offset < stats.total) {
      await new Promise(r => setTimeout(r, DELAY_BETWEEN_BATCHES));
    }
  }

  const elapsed = (Date.now() - stats.startTime) / 1000;
  console.log(`\n\n  Completed ${projectName}:`);
  console.log(`    Processed: ${stats.processed}`);
  console.log(`    Updated: ${stats.updated}`);
  console.log(`    No Data: ${stats.noData}`);
  console.log(`    Errors: ${stats.errors}`);
  console.log(`    Time: ${(elapsed/60).toFixed(1)} minutes`);
}

async function main() {
  const project = process.argv[2] || 'all';
  const projects = project.toLowerCase() === 'all'
    ? ['Lawley', 'Mohadin', 'Mamelodi', 'Etwatwa']
    : [project];

  console.log('\n======================================');
  console.log('  1Map Serial Sync');
  console.log('======================================');
  console.log(`  Projects: ${projects.join(', ')}`);
  console.log(`  1Map API: ${ONEMAP_BASE_URL}`);
  console.log(`  Database: ${DATABASE_URL.split('@')[1]?.split('/')[0] || 'configured'}`);

  const totalStartTime = Date.now();

  for (const proj of projects) {
    await syncProject(proj);
  }

  const totalElapsed = (Date.now() - totalStartTime) / 1000;
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  All done! Total time: ${(totalElapsed/60).toFixed(1)} minutes`);
  console.log(`${'='.repeat(60)}\n`);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
