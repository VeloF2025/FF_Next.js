/**
 * OLT Auto-Detect Status API
 *
 * GET: Get latest auto-detect run status for UI polling.
 *
 * Returns latest run stats + pending queue count.
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    // Get active run first (running/processing_queue), fall back to latest
    const runResult = await pool.query(
      `SELECT id, oes_batch_id, total_oes_rows, cache_hits, cache_misses,
              matches, mismatches_note2, mismatches_note4, ups_swaps,
              duplicates_skipped, api_lookups_queued, status,
              started_at, completed_at, error_message
       FROM olt_auto_detect_runs
       ORDER BY
         CASE WHEN status IN ('running', 'processing_queue') THEN 0 ELSE 1 END,
         id DESC
       LIMIT 1`
    );

    if (runResult.rows.length === 0) {
      return apiResponse.success(res, { hasRun: false });
    }

    const run = runResult.rows[0];

    // Get queue progress - check across ALL batches for this run's batch,
    // but also check global pending items (in case run was cleaned up)
    const queueResult = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
         COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
         COUNT(*) FILTER (WHERE status = 'processing')::int AS processing,
         COUNT(*) FILTER (WHERE status = 'error')::int AS errors,
         COUNT(*)::int AS total
       FROM olt_onemap_lookup_queue
       WHERE oes_batch_id = $1`,
      [run.oes_batch_id]
    );

    const queue = queueResult.rows[0] || { pending: 0, completed: 0, processing: 0, errors: 0, total: 0 };

    // Get live mismatch type counts from completed queue items
    const liveCountsResult = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE mismatch_type = 'match')::int AS queue_matches,
         COUNT(*) FILTER (WHERE mismatch_type LIKE 'note4%')::int AS queue_mismatches,
         COUNT(*) FILTER (WHERE mismatch_type = 'note2_not_on_1map')::int AS queue_not_found,
         COUNT(*) FILTER (WHERE mismatch_type = 'note4_ups_swap')::int AS queue_swaps
       FROM olt_onemap_lookup_queue
       WHERE oes_batch_id = $1 AND status = 'completed'`,
      [run.oes_batch_id]
    );
    const live = liveCountsResult.rows[0] || { queue_matches: 0, queue_mismatches: 0, queue_not_found: 0, queue_swaps: 0 };

    // Combine cache-phase counts with live queue counts
    const totalMatches = (run.matches || 0) + live.queue_matches;
    const totalMismatches = (run.mismatches_note4 || 0) + live.queue_mismatches;
    const totalNotFound = (run.mismatches_note2 || 0) + live.queue_not_found;
    const totalSwaps = (run.ups_swaps || 0) + live.queue_swaps;

    return apiResponse.success(res, {
      hasRun: true,
      run: {
        id: run.id,
        oesBatchId: run.oes_batch_id,
        totalOesRows: run.total_oes_rows,
        cacheHits: run.cache_hits,
        cacheMisses: run.cache_misses,
        matches: totalMatches,
        mismatchesNote2: totalNotFound,
        mismatchesNote4: totalMismatches,
        upsSwaps: totalSwaps,
        duplicatesSkipped: run.duplicates_skipped,
        apiLookupsQueued: run.api_lookups_queued,
        status: run.status,
        startedAt: run.started_at,
        completedAt: run.completed_at,
        errorMessage: run.error_message,
      },
      queue: {
        pending: queue.pending,
        completed: queue.completed,
        errors: queue.errors,
        total: queue.total,
      },
    });
  } catch (error) {
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
