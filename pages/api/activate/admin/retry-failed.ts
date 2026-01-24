/**
 * API Route: /api/activate/retry-failed
 *
 * Purpose: Retry failed VLM categorizations
 * Method: POST (retry specific DR or all eligible), GET (list failed DRs)
 *
 * This endpoint handles the retry queue for failed categorizations.
 * Called manually or by a cron job to process failed items.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, withRole, AuthenticatedNextApiRequest } from '@/lib/auth';

// Configure Neon WebSocket
neonConfig.webSocketConstructor = ws;

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require',
});

// Max retry attempts before giving up
const MAX_RETRY_ATTEMPTS = 5;

// FibreFlow API base URL for internal calls
const API_BASE = process.env.NEXTAUTH_URL || 'http://localhost:3005';

interface FailedDR {
  dropNumber: string;
  project: string | null;
  retryCount: number;
  lastError: string | null;
  nextRetryAt: string | null;
  failedAt: string;
}

interface RetryResult {
  dropNumber: string;
  success: boolean;
  message: string;
}

/**
 * GET /api/activate/retry-failed
 *
 * List all failed categorizations that are eligible for retry
 */
async function handleGet(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  try {
    const result = await pool.query(`
      SELECT
        drop_number,
        project,
        vlm_retry_count as retry_count,
        vlm_last_error as last_error,
        vlm_next_retry_at as next_retry_at,
        updated_at as failed_at
      FROM dr_photo_unified_reviews
      WHERE vlm_categorization_status = 'failed'
        AND (vlm_retry_count IS NULL OR vlm_retry_count < $1)
      ORDER BY updated_at DESC
      LIMIT 100
    `, [MAX_RETRY_ATTEMPTS]);

    const failedDRs: FailedDR[] = result.rows.map((row) => ({
      dropNumber: row.drop_number,
      project: row.project,
      retryCount: row.retry_count || 0,
      lastError: row.last_error,
      nextRetryAt: row.next_retry_at,
      failedAt: row.failed_at,
    }));

    // Count eligible for immediate retry
    const eligibleNow = failedDRs.filter(
      (dr) => !dr.nextRetryAt || new Date(dr.nextRetryAt) <= new Date()
    ).length;

    return apiResponse.success(res, {
      totalFailed: failedDRs.length,
      eligibleForRetry: eligibleNow,
      maxRetryAttempts: MAX_RETRY_ATTEMPTS,
      failedDRs,
    });
  } catch (error) {
    log.error('RetryFailed', 'Error fetching failed DRs', error);
    return apiResponse.internalError(res, error);
  }
}

/**
 * POST /api/activate/retry-failed
 *
 * Retry failed categorizations
 * Body: { dropNumber?: string, limit?: number }
 * - dropNumber: specific DR to retry
 * - limit: max number of DRs to retry (default 10)
 */
async function handlePost(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  try {
    const { dropNumber, limit = 10 } = req.body;

    let drsToRetry: string[];

    if (dropNumber) {
      // Retry specific DR
      drsToRetry = [dropNumber];
    } else {
      // Get DRs eligible for retry
      const result = await pool.query(`
        SELECT drop_number
        FROM dr_photo_unified_reviews
        WHERE vlm_categorization_status = 'failed'
          AND (vlm_retry_count IS NULL OR vlm_retry_count < $1)
          AND (vlm_next_retry_at IS NULL OR vlm_next_retry_at <= NOW())
        ORDER BY
          vlm_retry_count ASC NULLS FIRST,
          updated_at ASC
        LIMIT $2
      `, [MAX_RETRY_ATTEMPTS, limit]);

      drsToRetry = result.rows.map((row) => row.drop_number);
    }

    if (drsToRetry.length === 0) {
      return apiResponse.success(res, {
        message: 'No DRs eligible for retry',
        processed: 0,
        results: [],
      });
    }

    log.info('RetryFailed', `Retrying ${drsToRetry.length} failed DR(s)`);

    const results: RetryResult[] = [];

    for (const dr of drsToRetry) {
      try {
        // Mark as processing
        await pool.query(
          `UPDATE dr_photo_unified_reviews
           SET vlm_categorization_status = 'processing', updated_at = NOW()
           WHERE drop_number = $1`,
          [dr]
        );

        // Call process-new-dr endpoint internally
        const response = await fetch(`${API_BASE}/api/activate/process-new-dr`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ dropNumber: dr }),
        });

        const data = await response.json();

        if (data.success && data.data?.categorizationStatus === 'categorized') {
          // Reset retry tracking on success
          await pool.query(
            `UPDATE dr_photo_unified_reviews
             SET vlm_retry_count = 0, vlm_last_error = NULL, vlm_next_retry_at = NULL
             WHERE drop_number = $1`,
            [dr]
          );

          results.push({
            dropNumber: dr,
            success: true,
            message: 'Categorization successful',
          });
        } else {
          results.push({
            dropNumber: dr,
            success: false,
            message: data.data?.categorizationStatus || 'Failed',
          });
        }
      } catch (error) {
        log.error('RetryFailed', `Error retrying ${dr}`, error);
        results.push({
          dropNumber: dr,
          success: false,
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      }

      // Small delay between retries
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    const successCount = results.filter((r) => r.success).length;

    return apiResponse.success(res, {
      message: `Processed ${results.length} DR(s), ${successCount} successful`,
      processed: results.length,
      successful: successCount,
      failed: results.length - successCount,
      results,
    });
  } catch (error) {
    log.error('RetryFailed', 'Error in retry handler', error);
    return apiResponse.internalError(res, error);
  }
}

/**
 * Main handler
 */
async function handler(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method === 'GET') {
    return handleGet(req, res);
  } else if (req.method === 'POST') {
    return handlePost(req, res);
  } else {
    return apiResponse.error(res, ErrorCode.METHOD_NOT_ALLOWED, 'Method not allowed');
  }
}

export default withAuth(withRole('admin')(handler));
