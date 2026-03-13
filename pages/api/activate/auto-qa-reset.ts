/**
 * API Route: /api/activate/auto-qa-reset
 *
 * Purpose: Reset auto-QA decision so DR can be manually reviewed
 * Method: POST
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import pool from '@/lib/db';
import { log } from '@/lib/logger';
import { logActivity } from '@/modules/activate/services/activityLogService';

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    return apiResponse.error(res, ErrorCode.METHOD_NOT_ALLOWED, 'POST only');
  }

  const dropNumber = (req.query.dropNumber || req.body?.dropNumber) as string;

  if (!dropNumber) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'dropNumber is required');
  }

  try {
    await pool.query(
      `UPDATE dr_photo_unified_reviews
       SET
         auto_qa_processed = false,
         qa_decision = NULL,
         qa_decision_reasons = NULL,
         qa_decision_at = NULL,
         qa_decision_by = NULL,
         qa_phase = 'prerequisites',
         human_review_status = NULL,
         updated_at = NOW()
       WHERE drop_number = $1`,
      [dropNumber]
    );

    await logActivity(dropNumber, 'AUTO_QA_RESET', {
      reason: 'Human operator rejected auto-QA, requesting manual review',
    }, 'system');

    log.info('AutoQaReset', `Reset auto-QA for ${dropNumber}`);
    return apiResponse.success(res, { dropNumber, reset: true });
  } catch (error) {
    log.error('AutoQaReset', 'Error resetting auto-QA', error instanceof Error ? error : undefined);
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
