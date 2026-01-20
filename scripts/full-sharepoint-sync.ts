#!/usr/bin/env node
/**
 * Full SharePoint DR Photo Sync Script
 *
 * Comprehensive sync of all installed DRs to SharePoint.
 * - Creates folder hierarchy for each DR
 * - Syncs photos from OneMap
 * - Updates activity log for each DR
 * - Processes by project (smallest first)
 * - Resumes from last checkpoint if interrupted
 *
 * Usage:
 *   npx tsx scripts/full-sharepoint-sync.ts
 *   npx tsx scripts/full-sharepoint-sync.ts --project Mamelodi
 *   npx tsx scripts/full-sharepoint-sync.ts --resume
 *
 * Status: NEW
 * NLNH Confidence: HIGH
 */

import { neon } from '@neondatabase/serverless';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

// Load environment variables
dotenv.config({ path: '.env.production' });

const DATABASE_URL = process.env.DATABASE_URL;
const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3006';
const SHAREPOINT_ENABLED = process.env.SHAREPOINT_DR_SYNC_ENABLED === 'true';

// Configuration
const BATCH_SIZE = 50;  // DRs per batch
const BATCH_DELAY = 3000;  // Delay between batches (ms)
const DR_DELAY = 200;  // Delay between individual DR syncs (ms)
const CHECKPOINT_FILE = '/tmp/sharepoint-full-sync-checkpoint.json';

// Progress tracking
interface SyncCheckpoint {
  project: string;
  lastDropNumber: string;
  totalProcessed: number;
  totalSucceeded: number;
  totalFailed: number;
  startedAt: string;
  lastUpdatedAt: string;
}

interface SyncStats {
  project: string;
  processed: number;
  succeeded: number;
  failed: number;
  errors: Array<{ dropNumber: string; error: string }>;
}

if (!DATABASE_URL) {
  console.error('❌ DATABASE_URL not set');
  process.exit(1);
}

if (!SHAREPOINT_ENABLED) {
  console.log('ℹ️ SharePoint DR sync is disabled (SHAREPOINT_DR_SYNC_ENABLED != true)');
  process.exit(0);
}

const sql = neon(DATABASE_URL);

/**
 * Load checkpoint from file
 */
function loadCheckpoint(): SyncCheckpoint | null {
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) {
      const data = fs.readFileSync(CHECKPOINT_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch {
    console.log('⚠️ Could not load checkpoint, starting fresh');
  }
  return null;
}

/**
 * Save checkpoint to file
 */
function saveCheckpoint(checkpoint: SyncCheckpoint): void {
  try {
    fs.writeFileSync(CHECKPOINT_FILE, JSON.stringify(checkpoint, null, 2));
  } catch (error) {
    console.error('⚠️ Failed to save checkpoint:', error);
  }
}

/**
 * Clear checkpoint file
 */
function clearCheckpoint(): void {
  try {
    if (fs.existsSync(CHECKPOINT_FILE)) {
      fs.unlinkSync(CHECKPOINT_FILE);
    }
  } catch {
    // Ignore
  }
}

/**
 * Get installed DRs for a project that need syncing
 */
async function getInstalledDrsForProject(
  projectName: string,
  afterDropNumber?: string,
  limit: number = BATCH_SIZE
): Promise<string[]> {
  let result;

  if (afterDropNumber) {
    result = await sql`
      SELECT d.drop_number
      FROM drops d
      JOIN projects p ON d.project_id = p.id
      LEFT JOIN sharepoint_dr_sync s ON d.drop_number = s.drop_number
      WHERE p.project_name = ${projectName}
        AND d.site_submitted = true
        AND (s.photos_synced IS NULL OR s.photos_synced = false)
        AND d.drop_number > ${afterDropNumber}
      ORDER BY d.drop_number ASC
      LIMIT ${limit}
    `;
  } else {
    result = await sql`
      SELECT d.drop_number
      FROM drops d
      JOIN projects p ON d.project_id = p.id
      LEFT JOIN sharepoint_dr_sync s ON d.drop_number = s.drop_number
      WHERE p.project_name = ${projectName}
        AND d.site_submitted = true
        AND (s.photos_synced IS NULL OR s.photos_synced = false)
      ORDER BY d.drop_number ASC
      LIMIT ${limit}
    `;
  }

  return result.map(r => r.drop_number as string);
}

/**
 * Get count of DRs needing sync for a project
 */
async function getProjectSyncCount(projectName: string): Promise<number> {
  const result = await sql`
    SELECT COUNT(*) as count
    FROM drops d
    JOIN projects p ON d.project_id = p.id
    LEFT JOIN sharepoint_dr_sync s ON d.drop_number = s.drop_number
    WHERE p.project_name = ${projectName}
      AND d.site_submitted = true
      AND (s.photos_synced IS NULL OR s.photos_synced = false)
  `;
  return Number(result[0]?.count || 0);
}

/**
 * Sync a single DR via the API
 */
async function syncSingleDr(dropNumber: string): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(`${BASE_URL}/api/activate/sharepoint-sync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dropNumber, action: 'full' }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `HTTP ${response.status}: ${errorText}` };
    }

    const result = await response.json();
    if (result.success === false || result.data?.success === false) {
      return { success: false, error: result.error || result.data?.error || 'Unknown error' };
    }

    return { success: true };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Log activity for a DR
 */
async function logDrActivity(
  dropNumber: string,
  eventType: string,
  eventData: Record<string, unknown>
): Promise<void> {
  try {
    await sql`
      INSERT INTO dr_activity_log (drop_number, event_type, event_data, actor, created_at)
      VALUES (${dropNumber}, ${eventType}, ${JSON.stringify(eventData)}::jsonb, 'full-sync', NOW())
    `;
  } catch (error) {
    // Silently ignore activity log errors - non-critical
  }
}

/**
 * Process a single project
 */
async function processProject(projectName: string, checkpoint?: SyncCheckpoint): Promise<SyncStats> {
  console.log(`\n🏗️ Processing project: ${projectName}`);

  const stats: SyncStats = {
    project: projectName,
    processed: 0,
    succeeded: 0,
    failed: 0,
    errors: [],
  };

  // Get total count
  const totalCount = await getProjectSyncCount(projectName);
  console.log(`   📊 DRs needing sync: ${totalCount}`);

  if (totalCount === 0) {
    console.log(`   ✅ All DRs already synced for ${projectName}`);
    return stats;
  }

  let lastDropNumber = checkpoint?.project === projectName ? checkpoint.lastDropNumber : undefined;
  let batchNum = 1;

  while (true) {
    // Get next batch
    const dropNumbers = await getInstalledDrsForProject(projectName, lastDropNumber, BATCH_SIZE);

    if (dropNumbers.length === 0) {
      console.log(`   ✅ Completed all batches for ${projectName}`);
      break;
    }

    console.log(`   📦 Batch ${batchNum}: ${dropNumbers.length} DRs (${stats.processed + dropNumbers.length}/${totalCount})`);

    // Process each DR in the batch
    for (const dropNumber of dropNumbers) {
      // Rate limit
      if (stats.processed > 0) {
        await new Promise(resolve => setTimeout(resolve, DR_DELAY));
      }

      const result = await syncSingleDr(dropNumber);
      stats.processed++;

      if (result.success) {
        stats.succeeded++;
        // Log success activity
        await logDrActivity(dropNumber, 'sharepoint_synced', {
          source: 'full-sync',
          timestamp: new Date().toISOString(),
        });
        process.stdout.write('.');
      } else {
        stats.failed++;
        stats.errors.push({ dropNumber, error: result.error || 'Unknown' });
        // Log failure activity
        await logDrActivity(dropNumber, 'sharepoint_sync_failed', {
          source: 'full-sync',
          error: result.error,
          timestamp: new Date().toISOString(),
        });
        process.stdout.write('x');
      }

      lastDropNumber = dropNumber;
    }

    process.stdout.write('\n');

    // Save checkpoint after each batch
    const currentCheckpoint: SyncCheckpoint = {
      project: projectName,
      lastDropNumber: lastDropNumber || '',
      totalProcessed: stats.processed,
      totalSucceeded: stats.succeeded,
      totalFailed: stats.failed,
      startedAt: checkpoint?.startedAt || new Date().toISOString(),
      lastUpdatedAt: new Date().toISOString(),
    };
    saveCheckpoint(currentCheckpoint);

    // Progress update
    console.log(`   📈 Progress: ${stats.succeeded} succeeded, ${stats.failed} failed`);

    // Delay between batches
    if (dropNumbers.length === BATCH_SIZE) {
      console.log(`   ⏳ Waiting ${BATCH_DELAY / 1000}s before next batch...`);
      await new Promise(resolve => setTimeout(resolve, BATCH_DELAY));
    }

    batchNum++;
  }

  return stats;
}

/**
 * Main function
 */
async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('           FULL SHAREPOINT DR PHOTO SYNC');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`📅 Started: ${new Date().toISOString()}`);
  console.log(`🔗 API Base URL: ${BASE_URL}`);
  console.log(`📦 Batch Size: ${BATCH_SIZE}`);
  console.log('');

  // Parse arguments
  const args = process.argv.slice(2);
  const resumeMode = args.includes('--resume');
  const projectArg = args.find(a => a.startsWith('--project='))?.split('=')[1];

  // Load checkpoint if resuming
  let checkpoint: SyncCheckpoint | null = null;
  if (resumeMode) {
    checkpoint = loadCheckpoint();
    if (checkpoint) {
      console.log(`🔄 Resuming from checkpoint:`);
      console.log(`   Project: ${checkpoint.project}`);
      console.log(`   Last DR: ${checkpoint.lastDropNumber}`);
      console.log(`   Processed: ${checkpoint.totalProcessed}`);
      console.log('');
    } else {
      console.log('⚠️ No checkpoint found, starting fresh');
    }
  }

  // Define project order (smallest to largest)
  const projectOrder = projectArg ? [projectArg] : ['Mamelodi', 'Mohadin', 'Lawley'];

  // Get total counts
  console.log('📊 Initial counts:');
  let grandTotal = 0;
  for (const project of projectOrder) {
    const count = await getProjectSyncCount(project);
    console.log(`   ${project}: ${count} DRs`);
    grandTotal += count;
  }
  console.log(`   TOTAL: ${grandTotal} DRs`);

  // Track overall stats
  const allStats: SyncStats[] = [];
  let grandProcessed = 0;
  let grandSucceeded = 0;
  let grandFailed = 0;

  // Process each project
  for (const project of projectOrder) {
    // Skip projects before checkpoint project if resuming
    if (checkpoint && projectOrder.indexOf(project) < projectOrder.indexOf(checkpoint.project)) {
      console.log(`\n⏭️ Skipping ${project} (already completed)`);
      continue;
    }

    const stats = await processProject(project, checkpoint);
    allStats.push(stats);

    grandProcessed += stats.processed;
    grandSucceeded += stats.succeeded;
    grandFailed += stats.failed;

    // Clear checkpoint for next project
    checkpoint = null;
  }

  // Final summary
  console.log('\n═══════════════════════════════════════════════════════════════');
  console.log('                    SYNC COMPLETE');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`📅 Completed: ${new Date().toISOString()}`);
  console.log(`📊 Total Processed: ${grandProcessed}`);
  console.log(`✅ Total Succeeded: ${grandSucceeded}`);
  console.log(`❌ Total Failed: ${grandFailed}`);
  console.log('');

  // Per-project summary
  console.log('📋 Per-Project Summary:');
  for (const stats of allStats) {
    console.log(`   ${stats.project}: ${stats.succeeded}/${stats.processed} (${stats.failed} failed)`);
  }

  // Show errors if any
  const allErrors = allStats.flatMap(s => s.errors);
  if (allErrors.length > 0) {
    console.log('\n❌ Errors (first 20):');
    allErrors.slice(0, 20).forEach(e => {
      console.log(`   ${e.dropNumber}: ${e.error}`);
    });
    if (allErrors.length > 20) {
      console.log(`   ... and ${allErrors.length - 20} more`);
    }
  }

  // Clear checkpoint on successful completion
  if (grandFailed === 0) {
    clearCheckpoint();
    console.log('\n✅ All DRs synced successfully!');
  } else {
    console.log('\n⚠️ Some DRs failed. Run with --resume to retry.');
  }

  process.exit(grandFailed > 0 ? 1 : 0);
}

// Run
main().catch(error => {
  console.error('\n❌ Fatal error:', error);
  process.exit(1);
});
