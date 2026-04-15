/**
 * API Route: /api/activate/record-comment-correction
 *
 * Records a human rewrite of a VLM-generated photo comment. Used for HITL
 * few-shot learning so future auto-generated comments match human tone,
 * specificity, and issue-calling style.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import {
  recordCommentCorrection,
  PassFailCommentServiceError,
  type QaDecisionValue,
} from '@/modules/qa-learning';
import { logActivity } from '@/modules/activate/services/activityLogService';

interface Body {
  photoFilename: string;
  dropNumber: string;
  step: number;
  stepLabel?: string;
  decision: QaDecisionValue;
  vlmConfidence?: number;
  vlmReasoning?: string;
  photoDescription?: string;
  vlmComment: string;
  correctedComment: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  const body = req.body as Body;
  if (!body.photoFilename || !body.dropNumber) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'photoFilename and dropNumber are required');
  }
  if (!body.vlmComment || !body.correctedComment) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'vlmComment and correctedComment are required');
  }
  if (body.vlmComment.trim() === body.correctedComment.trim()) {
    return apiResponse.success(res, { recorded: false, reason: 'Comment unchanged' });
  }

  const userId = ((req as unknown as Record<string, unknown>).userId as string) || 'unknown';

  try {
    const correction = await recordCommentCorrection({
      workflowType: 'dr_photo',
      dropNumber: body.dropNumber,
      photoFilename: body.photoFilename,
      photoDescription: body.photoDescription,
      step: body.step,
      stepLabel: body.stepLabel,
      decision: body.decision,
      vlmConfidence: body.vlmConfidence,
      vlmReasoning: body.vlmReasoning,
      vlmComment: body.vlmComment,
      correctedComment: body.correctedComment,
      correctedBy: userId,
    });

    await logActivity(
      body.dropNumber,
      'HITL_COMMENT_CORRECTION',
      {
        photoFilename: body.photoFilename,
        step: body.step,
        decision: body.decision,
        correctionId: correction.id,
      },
      userId
    );

    log.info('RecordCommentCorrection', {
      action: 'recorded',
      dropNumber: body.dropNumber,
      photo: body.photoFilename,
      step: body.step,
    });

    return apiResponse.success(res, { recorded: true, correctionId: correction.id });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (error instanceof PassFailCommentServiceError && error.code === 'NO_CORRECTION_NEEDED') {
      return apiResponse.success(res, { recorded: false, reason: msg });
    }
    log.error('RecordCommentCorrection', { action: 'failed', error: msg });
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, msg);
  }
}

export default withAuth(handler);
