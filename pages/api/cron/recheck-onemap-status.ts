/**
 * Cron Job: Re-check OneMap Status for Not-Found DRs
 *
 * POST /api/cron/recheck-onemap-status
 *
 * Purpose: Periodically re-check DRs that were submitted via WhatsApp
 * but weren't found in 1Map at submission time (onemap_status = 'not_found').
 * When they appear in 1Map, marks them as 'resolved'.
 *
 * Run schedule: Every 30 minutes (via external cron)
 * Limit: Processes up to 50 DRs per run (configurable via ?limit=N)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';

import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

const BOSS_API_HOST = process.env.BOSS_API_HOST || 'http://100.96.203.105:8003';

interface RecheckResult {
  dropNumber: string;
  previousStatus: string;
  newStatus: string;
  foundInOneMap: boolean;
}

async function recheckDR(dropNumber: string): Promise<RecheckResult> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${BOSS_API_HOST}/api/record/${dropNumber}`, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (response.ok) {
      // DR now exists in 1Map - mark as resolved
      await pool.query(
        `UPDATE dr_photo_unified_reviews
         SET onemap_status = 'resolved', onemap_checked_at = NOW(), updated_at = NOW()
         WHERE drop_number = $1`,
        [dropNumber]
      );
      return { dropNumber, previousStatus: 'not_found', newStatus: 'resolved', foundInOneMap: true };
    }

    // Still not in 1Map - update checked_at timestamp
    await pool.query(
      `UPDATE dr_photo_unified_reviews
       SET onemap_checked_at = NOW(), updated_at = NOW()
       WHERE drop_number = $1`,
      [dropNumber]
    );
    return { dropNumber, previousStatus: 'not_found', newStatus: 'not_found', foundInOneMap: false };
  } catch (error) {
    log.warn('RecheckOneMap', `Failed to re-check ${dropNumber}`, { error });
    return { dropNumber, previousStatus: 'not_found', newStatus: 'not_found', foundInOneMap: false };
  }
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    return apiResponse.error(res, ErrorCode.METHOD_NOT_ALLOWED, 'Method not allowed');
  }

  // Verify cron secret
  const authHeader = req.headers.authorization;
  const cronSecret = process.env.CRON_SECRET;

  if (process.env.NODE_ENV === 'production' && cronSecret) {
    if (authHeader !== `Bearer ${cronSecret}`) {
      log.error('RecheckOneMap', 'Unauthorized request');
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const limit = Number(req.query.limit) || 50;

  log.info('RecheckOneMap', `Starting re-check of not_found DRs (limit: ${limit})`);

  try {
    // Find DRs that are still not_found, oldest checked first
    const notFoundDRs = await pool.query(
      `SELECT drop_number, onemap_checked_at
       FROM dr_photo_unified_reviews
       WHERE onemap_status = 'not_found'
       ORDER BY COALESCE(onemap_checked_at, created_at) ASC
       LIMIT $1`,
      [limit]
    );

    if (notFoundDRs.rows.length === 0) {
      log.info('RecheckOneMap', 'No not_found DRs to re-check');
      return apiResponse.success(res, {
        processed: 0,
        resolved: 0,
        stillNotFound: 0,
        results: [],
        timestamp: new Date().toISOString(),
      });
    }

    log.info('RecheckOneMap', `Found ${notFoundDRs.rows.length} DRs to re-check`);

    const results: RecheckResult[] = [];
    let resolved = 0;
    let stillNotFound = 0;

    for (const row of notFoundDRs.rows) {
      const result = await recheckDR(row.drop_number);
      results.push(result);

      if (result.foundInOneMap) {
        resolved++;
        log.info('RecheckOneMap', `DR ${row.drop_number} now FOUND in 1Map - resolved!`);
      } else {
        stillNotFound++;
      }
    }

    log.info('RecheckOneMap', `Re-check complete`, {
      processed: results.length,
      resolved,
      stillNotFound,
    });

    return apiResponse.success(res, {
      processed: results.length,
      resolved,
      stillNotFound,
      results,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    log.error('RecheckOneMap', 'Re-check job failed', { error });
    return apiResponse.internalError(res, error);
  }
}

export default handler;
