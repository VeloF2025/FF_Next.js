/**
 * AUTO-PROCESS API ENDPOINT
 * POST /api/foto/auto-process
 *
 * Called by cron job every 5 minutes to automatically:
 * 1. Find new drops from wa-monitor (qa_photo_reviews)
 * 2. Check if photos exist in BOSS VPS
 * 3. Run AI evaluation
 * 4. Send WhatsApp feedback
 *
 * SAFE ADDITION - Does not modify any existing flows
 * Manual evaluation and feedback still work exactly as before
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';
import { autoProcessDropsBatch, type AutoProcessorStats } from '@/modules/photo-review/services/autoEvaluator';

// ==================== CONFIGURATION ====================

const CONFIG = {
  // Feature flag to enable/disable auto-processing
  ENABLED: process.env.AUTO_EVALUATOR_ENABLED !== 'false', // Default: enabled

  // Security: Require API key for cron job (optional)
  API_KEY: process.env.AUTO_EVALUATOR_API_KEY,

  // Processing limits
  MAX_DROPS_PER_RUN: 10, // Process max 10 drops per cron run

  // Time window (only process drops from last N hours)
  HOURS_LOOKBACK: 24, // Look at drops from last 24 hours
};

// ==================== DATABASE ====================

function getDbConnection() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error('DATABASE_URL environment variable is not set');
  }
  return neon(databaseUrl);
}

/**
 * Get new drops that haven't been evaluated yet
 */
async function getNewDropsForEvaluation(limit: number = 10): Promise<Array<{
  drop_number: string;
  project: string;
  created_at: Date;
  submitted_by?: string;
}>> {
  try {
    const sql = getDbConnection();

    // Calculate time window
    const hoursAgo = new Date();
    hoursAgo.setHours(hoursAgo.getHours() - CONFIG.HOURS_LOOKBACK);

    // Query for new drops that:
    // 1. Were created in the last 24 hours
    // 2. Haven't been evaluated yet (overall_status is pending or null)
    // 3. Have a valid drop number
    // After migration 127: Use unified table directly
    const rows = await sql`
      SELECT
        drop_number,
        project_name as project,
        created_at,
        submitted_by
      FROM dr_photo_unified_reviews
      WHERE
        (overall_status IS NULL OR overall_status = 'pending')
        AND drop_number IS NOT NULL
        AND drop_number != ''
        AND created_at >= ${hoursAgo}
        AND project_name NOT IN ('Marketing Activations', 'Unknown')
      ORDER BY created_at ASC
      LIMIT ${limit}
    `;

    return rows.map(row => ({
      drop_number: row.drop_number,
      project: row.project || 'Unknown',
      created_at: new Date(row.created_at),
      submitted_by: row.submitted_by,
    }));
  } catch (error) {
    console.error('[AUTO-PROCESS] Error fetching new drops:', error);
    throw new Error('Failed to fetch new drops from database');
  }
}

/**
 * Save processing state/stats (for monitoring)
 */
async function saveProcessingState(stats: AutoProcessorStats): Promise<void> {
  try {
    const sql = getDbConnection();

    // Update or insert processing state
    await sql`
      INSERT INTO foto_auto_processor_state (
        id,
        last_processed_timestamp,
        last_run_at,
        processed_count,
        error_count,
        last_error
      ) VALUES (
        1,  -- Single row for state
        NOW(),
        NOW(),
        ${stats.total_processed},
        ${stats.failed},
        ${stats.errors.length > 0 ? stats.errors[0] : null}
      )
      ON CONFLICT (id) DO UPDATE SET
        last_processed_timestamp = NOW(),
        last_run_at = NOW(),
        processed_count = foto_auto_processor_state.processed_count + EXCLUDED.processed_count,
        error_count = foto_auto_processor_state.error_count + EXCLUDED.error_count,
        last_error = EXCLUDED.last_error,
        updated_at = NOW()
    `;

    console.log('[AUTO-PROCESS] State saved:', stats);
  } catch (error) {
    // Don't fail the process if state saving fails
    console.error('[AUTO-PROCESS] Failed to save state (non-critical):', error);
  }
}

// ==================== MAIN HANDLER ====================

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  // Only accept POST requests
  if (req.method !== 'POST') {
    return res.status(405).json({
      error: 'Method not allowed',
      message: 'This endpoint only accepts POST requests'
    });
  }

  // Check if feature is enabled
  if (!CONFIG.ENABLED) {
    return res.status(200).json({
      success: true,
      message: 'Auto-evaluator is disabled',
      stats: {
        total_processed: 0,
        successful: 0,
        failed: 0,
        skipped: 0,
      },
    });
  }

  // Optional: Check API key (for cron job security)
  if (CONFIG.API_KEY) {
    const providedKey = req.headers['x-api-key'] || req.query.api_key;
    if (providedKey !== CONFIG.API_KEY) {
      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid or missing API key'
      });
    }
  }

  console.log('[AUTO-PROCESS] Starting auto-evaluation run...');

  try {
    // 1. Get new drops that need evaluation
    const newDrops = await getNewDropsForEvaluation(CONFIG.MAX_DROPS_PER_RUN);

    if (newDrops.length === 0) {
      console.log('[AUTO-PROCESS] No new drops to process');
      return res.status(200).json({
        success: true,
        message: 'No new drops to process',
        stats: {
          total_processed: 0,
          successful: 0,
          failed: 0,
          skipped: 0,
        },
      });
    }

    console.log(`[AUTO-PROCESS] Found ${newDrops.length} new drops to process:`,
      newDrops.map(d => d.drop_number).join(', ')
    );

    // 2. Process drops in batch
    const stats = await autoProcessDropsBatch(newDrops);

    // 3. Save processing state (for monitoring)
    await saveProcessingState(stats);

    // 4. Return results
    const successRate = stats.total_processed > 0
      ? Math.round((stats.successful / stats.total_processed) * 100)
      : 0;

    console.log(
      `[AUTO-PROCESS] ✅ Run complete: ${stats.successful}/${stats.total_processed} successful (${successRate}%)`
    );

    return res.status(200).json({
      success: true,
      message: `Processed ${stats.total_processed} drops (${successRate}% success rate)`,
      stats: stats,
      drops_processed: newDrops.map(d => ({
        drop_number: d.drop_number,
        project: d.project,
      })),
    });

  } catch (error) {
    console.error('[AUTO-PROCESS] ❌ Error in auto-process:', error);

    // Log error to state table
    try {
      await saveProcessingState({
        total_processed: 0,
        successful: 0,
        failed: 1,
        skipped: 0,
        errors: [error instanceof Error ? error.message : 'Unknown error'],
      });
    } catch (stateError) {
      console.error('[AUTO-PROCESS] Failed to save error state:', stateError);
    }

    return res.status(500).json({
      error: 'Auto-processing failed',
      message: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}

export default withAuth(getNewDropsForEvaluation);