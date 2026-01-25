/**
 * API Route: /api/activate/human-review
 *
 * Purpose: Phase 3 - Human review actions (approve/reject steps)
 * Method: POST (submit review), GET (get review status)
 *
 * This endpoint handles:
 * - Starting a human review session
 * - Approving individual steps
 * - Rejecting steps with reasons
 * - Completing the review
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from 'pg';

import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import {
  logHumanReviewStarted,
  logHumanReviewCompleted,
  logStepApproval,
  logStepRejection,
} from '@/modules/activate/services/activityLogService';
import { STEP_LABELS } from '@/modules/activate/utils/stepMapper';

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

// ============================================================================
// TYPES
// ============================================================================

interface StepReviewAction {
  step: number;
  action: 'approve' | 'reject';
  reason?: string;
  overrideVlm?: boolean;
}

interface StartReviewRequest {
  action: 'start';
  dropNumber: string;
  userId: string;
}

interface SubmitStepRequest {
  action: 'step';
  dropNumber: string;
  userId: string;
  stepReview: StepReviewAction;
}

interface CompleteReviewRequest {
  action: 'complete';
  dropNumber: string;
  userId: string;
}

type HumanReviewRequest = StartReviewRequest | SubmitStepRequest | CompleteReviewRequest;

// ============================================================================
// HANDLERS
// ============================================================================

/**
 * Handle starting a review session
 */
async function handleStartReview(
  dropNumber: string,
  userId: string,
  res: NextApiResponse
): Promise<void> {
  log.info('HumanReview', `Starting review for ${dropNumber} by ${userId}`);

  // Check if already being reviewed
  const lockResult = await pool.query(
    `SELECT locked_by, locked_at
     FROM dr_photo_unified_reviews
     WHERE drop_number = $1`,
    [dropNumber]
  );

  if (lockResult.rows.length === 0) {
    return apiResponse.notFound(res, 'Review', dropNumber);
  }

  const current = lockResult.rows[0];

  // Check if locked by another user (within 10 minutes)
  if (current.locked_by && current.locked_by !== userId) {
    const lockTime = new Date(current.locked_at);
    const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

    if (lockTime > tenMinutesAgo) {
      return apiResponse.error(
        res,
        ErrorCode.CONFLICT,
        `Review is locked by another user (${current.locked_by})`
      );
    }
  }

  // Lock the review and set status
  await pool.query(
    `UPDATE dr_photo_unified_reviews
     SET
       locked_by = $1,
       locked_at = NOW(),
       human_review_status = 'in_progress',
       updated_at = NOW()
     WHERE drop_number = $2`,
    [userId, dropNumber]
  );

  // Log activity
  await logHumanReviewStarted(dropNumber, userId);

  return apiResponse.success(res, {
    dropNumber,
    status: 'started',
    lockedBy: userId,
    message: 'Review session started',
  });
}

/**
 * Handle step approval/rejection
 */
async function handleStepReview(
  dropNumber: string,
  userId: string,
  stepReview: StepReviewAction,
  res: NextApiResponse
): Promise<void> {
  const { step, action, reason, overrideVlm } = stepReview;
  const stepLabel = STEP_LABELS[step] || `Step ${step}`;

  log.info('HumanReview', `${action} step ${step} for ${dropNumber}`, { reason, overrideVlm });

  // Verify the user has the lock
  const lockResult = await pool.query(
    `SELECT locked_by, human_qa_overrides
     FROM dr_photo_unified_reviews
     WHERE drop_number = $1`,
    [dropNumber]
  );

  if (lockResult.rows.length === 0) {
    return apiResponse.notFound(res, 'Review', dropNumber);
  }

  const current = lockResult.rows[0];

  if (current.locked_by !== userId) {
    return apiResponse.error(
      res,
      ErrorCode.FORBIDDEN,
      'You do not have the review lock'
    );
  }

  // Get current overrides
  const overrides = current.human_qa_overrides || {};

  // Add the new override
  overrides[step] = {
    action,
    reason: reason || null,
    overrideVlm: overrideVlm || false,
    reviewedBy: userId,
    reviewedAt: new Date().toISOString(),
  };

  // Update database
  await pool.query(
    `UPDATE dr_photo_unified_reviews
     SET
       human_qa_overrides = $1,
       updated_at = NOW()
     WHERE drop_number = $2`,
    [JSON.stringify(overrides), dropNumber]
  );

  // Log activity
  if (action === 'approve') {
    await logStepApproval(dropNumber, step, stepLabel, userId);
  } else {
    await logStepRejection(dropNumber, step, stepLabel, reason || 'No reason provided', userId);
  }

  return apiResponse.success(res, {
    dropNumber,
    step,
    stepLabel,
    action,
    reason,
    overrideVlm,
    message: `Step ${step} ${action}d`,
  });
}

/**
 * Handle completing the review
 */
async function handleCompleteReview(
  dropNumber: string,
  userId: string,
  res: NextApiResponse
): Promise<void> {
  log.info('HumanReview', `Completing review for ${dropNumber} by ${userId}`);

  // Verify the user has the lock
  const lockResult = await pool.query(
    `SELECT locked_by, human_qa_overrides
     FROM dr_photo_unified_reviews
     WHERE drop_number = $1`,
    [dropNumber]
  );

  if (lockResult.rows.length === 0) {
    return apiResponse.notFound(res, 'Review', dropNumber);
  }

  const current = lockResult.rows[0];

  if (current.locked_by !== userId) {
    return apiResponse.error(
      res,
      ErrorCode.FORBIDDEN,
      'You do not have the review lock'
    );
  }

  // Count approved and rejected
  const overrides = current.human_qa_overrides || {};
  let approved = 0;
  let rejected = 0;

  for (const stepData of Object.values(overrides) as Array<{ action: string }>) {
    if (stepData.action === 'approve') approved++;
    if (stepData.action === 'reject') rejected++;
  }

  // Complete the review
  await pool.query(
    `UPDATE dr_photo_unified_reviews
     SET
       locked_by = NULL,
       locked_at = NULL,
       human_review_status = 'completed',
       human_review_completed_at = NOW(),
       human_reviewer_id = $1,
       updated_at = NOW()
     WHERE drop_number = $2`,
    [userId, dropNumber]
  );

  // Log activity
  await logHumanReviewCompleted(dropNumber, userId, approved, rejected);

  return apiResponse.success(res, {
    dropNumber,
    status: 'completed',
    reviewedBy: userId,
    approved,
    rejected,
    message: 'Review completed',
  });
}

/**
 * POST /api/activate/human-review
 * Handle review actions
 */
async function handlePost(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  try {
    const body = req.body as HumanReviewRequest;

    if (!body.dropNumber) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'dropNumber is required');
    }

    if (!body.userId) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'userId is required');
    }

    switch (body.action) {
      case 'start':
        return handleStartReview(body.dropNumber, body.userId, res);

      case 'step':
        if (!body.stepReview) {
          return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'stepReview is required');
        }
        return handleStepReview(body.dropNumber, body.userId, body.stepReview, res);

      case 'complete':
        return handleCompleteReview(body.dropNumber, body.userId, res);

      default:
        return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Invalid action');
    }
  } catch (error) {
    log.error('HumanReview', 'Error during human review', error);
    return apiResponse.internalError(res, error);
  }
}

/**
 * GET /api/activate/human-review?dropNumber=XXX
 * Get review status
 */
async function handleGet(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  try {
    const { dropNumber } = req.query;

    if (!dropNumber || typeof dropNumber !== 'string') {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'dropNumber query param is required');
    }

    const result = await pool.query(
      `SELECT
         locked_by, locked_at,
         human_review_status, human_review_completed_at, human_reviewer_id,
         human_qa_overrides, vlm_qa_results, vlm_qa_summary
       FROM dr_photo_unified_reviews
       WHERE drop_number = $1`,
      [dropNumber]
    );

    if (result.rows.length === 0) {
      return apiResponse.notFound(res, 'Review', dropNumber);
    }

    const row = result.rows[0];
    const overrides = row.human_qa_overrides || {};
    const qaResults = row.vlm_qa_results || {};

    // Count stats
    let approved = 0;
    let rejected = 0;
    let pending = 0;

    const stepResults = qaResults.stepResults || [];
    for (const stepResult of stepResults) {
      const override = overrides[stepResult.step];
      if (override) {
        if (override.action === 'approve') approved++;
        if (override.action === 'reject') rejected++;
      } else {
        pending++;
      }
    }

    return apiResponse.success(res, {
      dropNumber,
      lockedBy: row.locked_by,
      lockedAt: row.locked_at,
      status: row.human_review_status || 'pending',
      completedAt: row.human_review_completed_at,
      reviewerId: row.human_reviewer_id,
      overrides,
      vlmSummary: row.vlm_qa_summary,
      stats: {
        total: stepResults.length,
        approved,
        rejected,
        pending,
      },
    });
  } catch (error) {
    log.error('HumanReview', 'Error getting review status', error);
    return apiResponse.internalError(res, error);
  }
}

/**
 * DELETE /api/activate/human-review?dropNumber=XXX&userId=YYY
 * Release review lock
 */
async function handleDelete(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  try {
    const { dropNumber, userId } = req.query;

    if (!dropNumber || typeof dropNumber !== 'string') {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'dropNumber query param is required');
    }

    if (!userId || typeof userId !== 'string') {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'userId query param is required');
    }

    // Verify the user has the lock
    const lockResult = await pool.query(
      `SELECT locked_by
       FROM dr_photo_unified_reviews
       WHERE drop_number = $1`,
      [dropNumber]
    );

    if (lockResult.rows.length === 0) {
      return apiResponse.notFound(res, 'Review', dropNumber);
    }

    const current = lockResult.rows[0];

    if (current.locked_by !== userId) {
      return apiResponse.error(
        res,
        ErrorCode.FORBIDDEN,
        'You do not have the review lock'
      );
    }

    // Release the lock
    await pool.query(
      `UPDATE dr_photo_unified_reviews
       SET
         locked_by = NULL,
         locked_at = NULL,
         updated_at = NOW()
       WHERE drop_number = $1`,
      [dropNumber]
    );

    return apiResponse.success(res, {
      dropNumber,
      message: 'Review lock released',
    });
  } catch (error) {
    log.error('HumanReview', 'Error releasing lock', error);
    return apiResponse.internalError(res, error);
  }
}

/**
 * Main handler
 */
async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method === 'POST') {
    return handlePost(req, res);
  } else if (req.method === 'GET') {
    return handleGet(req, res);
  } else if (req.method === 'DELETE') {
    return handleDelete(req, res);
  } else {
    return apiResponse.error(res, ErrorCode.METHOD_NOT_ALLOWED, 'Method not allowed');
  }
}

export default withAuth(handler);
