#!/usr/bin/env node
/**
 * SharePoint DR Photo Sync Cron Job
 *
 * Daily sync of DR photos to SharePoint for DRs that have folders created but photos not yet synced.
 *
 * Usage:
 *   npx tsx scripts/cron/sharepoint-dr-sync.ts
 *
 * VPS Cron Setup (10 PM daily - after work hours):
 *   0 22 * * * cd /var/www/fibreflow && /usr/bin/npx tsx scripts/cron/sharepoint-dr-sync.ts >> /var/log/sharepoint-sync.log 2>&1
 *
 * Status: NEW
 * NLNH Confidence: HIGH
 */

import { neon } from '@neondatabase/serverless';

// Load environment variables
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.production' });

const DATABASE_URL = process.env.DATABASE_URL;
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3005';
const SHAREPOINT_ENABLED = process.env.SHAREPOINT_DR_SYNC_ENABLED === 'true';

// Batch size for processing
const BATCH_SIZE = 50;

// Delay between batches (ms)
const BATCH_DELAY = 5000;

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not set');
  process.exit(1);
}

if (!SHAREPOINT_ENABLED) {
  console.log('ℹ️ SharePoint DR sync is disabled (SHAREPOINT_DR_SYNC_ENABLED != true)');
  process.exit(0);
}

const sql = neon(DATABASE_URL);

interface SyncStats {
  totalProcessed: number;
  succeeded: number;
  failed: number;
  batches: number;
  errors: string[];
}

/**
 * Get DRs that need photo sync (folder created but photos not synced)
 */
async function getDrsPendingSync(limit: number): Promise<string[]> {
  const result = await sql`
    SELECT drop_number
    FROM sharepoint_dr_sync
    WHERE folder_created = true
      AND photos_synced = false
      AND (sync_retry_count < 3 OR sync_retry_count IS NULL)
    ORDER BY created_at ASC
    LIMIT ${limit}
  `;

  return result.map(r => r.drop_number as string);
}

/**
 * Get DRs that need folder creation (in drops table but not in sync table)
 */
async function getDrsPendingFolders(limit: number): Promise<string[]> {
  const result = await sql`
    SELECT d.drop_number
    FROM drops d
    LEFT JOIN sharepoint_dr_sync s ON d.drop_number = s.drop_number
    WHERE s.id IS NULL
      AND d.site_submitted = true
    ORDER BY d.created_at DESC
    LIMIT ${limit}
  `;

  return result.map(r => r.drop_number as string);
}

/**
 * Call batch sync API
 */
async function callBatchSync(
  action: 'verify_folders' | 'sync_photos',
  dropNumbers: string[]
): Promise<{ success: boolean; processed: number; succeeded: number; failed: number; errors: Array<{ dropNumber: string; error: string }> }> {
  try {
    const response = await fetch(`${BASE_URL}/api/activate/sharepoint-sync-batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, dropNumbers }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`API returned ${response.status}: ${errorText}`);
    }

    const result = await response.json();
    return result.data || result;
  } catch (error) {
    return {
      success: false,
      processed: dropNumbers.length,
      succeeded: 0,
      failed: dropNumbers.length,
      errors: dropNumbers.map(dn => ({
        dropNumber: dn,
        error: error instanceof Error ? error.message : 'Unknown error',
      })),
    };
  }
}

/**
 * Main sync function
 */
async function main() {
  console.log('🚀 Starting SharePoint DR photo sync cron job...');
  console.log(`📅 Date: ${new Date().toISOString()}`);
  console.log(`🔗 API Base URL: ${BASE_URL}`);

  const stats: SyncStats = {
    totalProcessed: 0,
    succeeded: 0,
    failed: 0,
    batches: 0,
    errors: [],
  };

  try {
    // === PHASE 1: Create folders for DRs missing them ===
    console.log('\n📁 Phase 1: Checking for DRs needing folder creation...');

    const drsPendingFolders = await getDrsPendingFolders(BATCH_SIZE * 2);
    console.log(`   Found ${drsPendingFolders.length} DRs needing folders`);

    if (drsPendingFolders.length > 0) {
      // Process in batches
      for (let i = 0; i < drsPendingFolders.length; i += BATCH_SIZE) {
        const batch = drsPendingFolders.slice(i, i + BATCH_SIZE);
        console.log(`   Processing folder batch ${Math.floor(i / BATCH_SIZE) + 1}...`);

        const result = await callBatchSync('verify_folders', batch);
        stats.batches++;
        stats.totalProcessed += result.processed;
        stats.succeeded += result.succeeded;
        stats.failed += result.failed;

        if (result.errors && result.errors.length > 0) {
          stats.errors.push(...result.errors.map(e => `${e.dropNumber}: ${e.error}`));
        }

        console.log(`   Batch result: ${result.succeeded} succeeded, ${result.failed} failed`);

        // Delay between batches
        if (i + BATCH_SIZE < drsPendingFolders.length) {
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
        }
      }
    }

    // === PHASE 2: Sync photos for DRs with folders ===
    console.log('\n📸 Phase 2: Syncing photos for DRs with folders...');

    const drsPendingSync = await getDrsPendingSync(BATCH_SIZE * 4);
    console.log(`   Found ${drsPendingSync.length} DRs pending photo sync`);

    if (drsPendingSync.length > 0) {
      // Process in batches
      for (let i = 0; i < drsPendingSync.length; i += BATCH_SIZE) {
        const batch = drsPendingSync.slice(i, i + BATCH_SIZE);
        console.log(`   Processing photo batch ${Math.floor(i / BATCH_SIZE) + 1}...`);

        const result = await callBatchSync('sync_photos', batch);
        stats.batches++;
        stats.totalProcessed += result.processed;
        stats.succeeded += result.succeeded;
        stats.failed += result.failed;

        if (result.errors && result.errors.length > 0) {
          stats.errors.push(...result.errors.map(e => `${e.dropNumber}: ${e.error}`));
        }

        console.log(`   Batch result: ${result.succeeded} succeeded, ${result.failed} failed`);

        // Delay between batches
        if (i + BATCH_SIZE < drsPendingSync.length) {
          await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
        }
      }
    }

    // === SUMMARY ===
    console.log('\n📊 Sync Summary:');
    console.log(`   Total Processed: ${stats.totalProcessed}`);
    console.log(`   Succeeded: ${stats.succeeded}`);
    console.log(`   Failed: ${stats.failed}`);
    console.log(`   Batches: ${stats.batches}`);

    if (stats.errors.length > 0) {
      console.log('\n❌ Errors:');
      stats.errors.slice(0, 20).forEach(e => console.log(`   - ${e}`));
      if (stats.errors.length > 20) {
        console.log(`   ... and ${stats.errors.length - 20} more`);
      }
    }

    console.log('\n✅ SharePoint DR sync completed');
    process.exit(stats.failed > 0 ? 1 : 0);
  } catch (error) {
    console.error('\n❌ Sync failed with error:', error);
    process.exit(1);
  }
}

// Run main function
main();
