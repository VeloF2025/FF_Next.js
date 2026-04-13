/**
 * Cron: Civil QA SharePoint Sync
 *
 * POST /api/cron/construction-qa-sp-sync
 *
 * Nightly 02:00 SAST — processes all pending sp_sync reviews.
 * Auth: CRON_SECRET Bearer token.
 * Loops until no pending reviews remain (max 20 iterations × 20 reviews = 400 per run).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import { syncReview } from '@/modules/construction-qa/services/sharepointSyncService';

const MAX_ITERATIONS = 20;
const BATCH_SIZE = 20;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'POST']);
  }

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const provided =
      req.headers.authorization?.replace('Bearer ', '') ||
      (req.query.secret as string | undefined);
    if (provided !== cronSecret) {
      return apiResponse.unauthorized(res);
    }
  }

  log.info('CronSpSync', { action: 'start' });

  let totalSynced = 0;
  let totalFailed = 0;
  let iterations = 0;

  try {
    const spProjectId = process.env.SHAREPOINT_QA_PROJECT_ID || null;

    while (iterations < MAX_ITERATIONS) {
      const result = spProjectId
        ? await pool.query(
            `SELECT id FROM construction_qa_reviews
             WHERE sp_sync_status = 'pending'
               AND project_id = $1::uuid
             ORDER BY updated_at ASC
             LIMIT $2`,
            [spProjectId, BATCH_SIZE],
          )
        : await pool.query(
            `SELECT id FROM construction_qa_reviews
             WHERE sp_sync_status = 'pending'
             ORDER BY updated_at ASC
             LIMIT $1`,
            [BATCH_SIZE],
          );

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pending = result.rows as any[];
      if (pending.length === 0) break;

      for (const row of pending) {
        try {
          await syncReview(row.id);
          totalSynced++;
        } catch (err) {
          totalFailed++;
          log.warn('CronSpSync', {
            action: 'review_failed',
            reviewId: row.id,
            error: (err as Error).message,
          });
        }
      }

      iterations++;
    }

    log.info('CronSpSync', { action: 'complete', totalSynced, totalFailed, iterations });

    return res.status(200).json({
      success: true,
      totalSynced,
      totalFailed,
      iterations,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const message = (error as Error).message;
    log.error('CronSpSync', { action: 'fatal', error: message });
    return res.status(500).json({ error: message });
  }
}
