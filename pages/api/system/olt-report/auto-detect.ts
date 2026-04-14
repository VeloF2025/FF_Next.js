/**
 * OLT Auto-Detect API
 *
 * POST: Trigger auto-detection of OLT mismatches from OES import batch.
 * Compares OES serials against 1Map cache, creates mismatch records,
 * and queues cache misses for API lookup.
 *
 * Body: { oesBatchId: string }
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withRole } from '@/lib/auth';
import { log } from '@/lib/logger';
import { runAutoDetect } from '@/modules/data-sync/services/oltAutoDetectService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  try {
    const { oesBatchId } = req.body;

    if (!oesBatchId) {
      return apiResponse.badRequest(res, 'oesBatchId is required');
    }

    // Validate batch exists
    const batchCheck = await pool.query(
      `SELECT id FROM oes_import_batches WHERE id = $1`,
      [oesBatchId]
    );
    if (batchCheck.rows.length === 0) {
      return apiResponse.notFound(res, 'OES import batch', oesBatchId);
    }

    // Run cache phase (fast - single JOIN)
    const result = await runAutoDetect(oesBatchId);

    // If cache misses exist, fire-and-forget the queue processor
    if (result.apiLookupsQueued > 0) {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `http://localhost:${process.env.PORT || '3005'}`;
      fetch(`${baseUrl}/api/system/olt-report/process-lookup-queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ runId: result.runId }),
      }).catch(err => {
        log.warn('Failed to trigger queue processor', { error: err }, 'OltAutoDetect');
      });
    }

    return apiResponse.success(res, {
      matches: result.matches,
      mismatchesCreated: result.mismatchesNote4,
      notOnOneMap: result.mismatchesNote2,
      queuedForLookup: result.apiLookupsQueued,
      upsSwaps: result.upsSwaps,
      duplicatesSkipped: result.duplicatesSkipped,
      runId: result.runId,
    });
  } catch (error) {
    log.error('Auto-detect endpoint failed', { error: { error } }, 'OltAutoDetect');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(withRole('manager')(handler));
