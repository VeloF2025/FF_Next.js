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
    // Get latest run
    const runResult = await pool.query(
      `SELECT id, oes_batch_id, total_oes_rows, cache_hits, cache_misses,
              matches, mismatches_note2, mismatches_note4, ups_swaps,
              duplicates_skipped, api_lookups_queued, status,
              started_at, completed_at, error_message
       FROM olt_auto_detect_runs
       ORDER BY id DESC
       LIMIT 1`
    );

    if (runResult.rows.length === 0) {
      return apiResponse.success(res, { hasRun: false });
    }

    const run = runResult.rows[0];

    // Get queue progress
    const queueResult = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'pending')::int AS pending,
         COUNT(*) FILTER (WHERE status = 'completed')::int AS completed,
         COUNT(*) FILTER (WHERE status = 'error')::int AS errors,
         COUNT(*)::int AS total
       FROM olt_onemap_lookup_queue
       WHERE oes_batch_id = $1`,
      [run.oes_batch_id]
    );

    const queue = queueResult.rows[0] || { pending: 0, completed: 0, errors: 0, total: 0 };

    return apiResponse.success(res, {
      hasRun: true,
      run: {
        id: run.id,
        oesBatchId: run.oes_batch_id,
        totalOesRows: run.total_oes_rows,
        cacheHits: run.cache_hits,
        cacheMisses: run.cache_misses,
        matches: run.matches,
        mismatchesNote2: run.mismatches_note2,
        mismatchesNote4: run.mismatches_note4,
        upsSwaps: run.ups_swaps,
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
