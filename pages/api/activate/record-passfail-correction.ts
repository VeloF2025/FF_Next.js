/**
 * API Route: /api/activate/record-passfail-correction
 *
 * Records a human override of VLM's PASS/FAIL decision on an auto-QA'd photo.
 * Used for HITL few-shot learning: future auto-QA runs should match human
 * disposition on visually/semantically similar photos.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import {
  recordPassFailCorrection,
  PassFailCommentServiceError,
  type QaDecisionValue,
} from '@/modules/qa-learning';
import { logActivity } from '@/modules/activate/services/activityLogService';

interface Body {
  photoFilename: string;
  dropNumber: string;
  step: number;
  stepLabel?: string;
  vlmDecision: QaDecisionValue;
  vlmConfidence: number;
  vlmReasoning?: string;
  vlmComment?: string;
  photoDescription?: string;
  correctDecision: QaDecisionValue;
  correctionReason?: string;
}

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  const body = req.body as Body;
  if (!body.photoFilename || !body.dropNumber) {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'photoFilename and dropNumber are required');
  }
  if (body.vlmDecision === body.correctDecision) {
    return apiResponse.success(res, { recorded: false, reason: 'No correction needed — decisions match' });
  }

  const userId = ((req as unknown as Record<string, unknown>).userId as string) || 'unknown';

  try {
    const correction = await recordPassFailCorrection({
      workflowType: 'dr_photo',
      dropNumber: body.dropNumber,
      photoFilename: body.photoFilename,
      photoDescription: body.photoDescription,
      step: body.step,
      stepLabel: body.stepLabel,
      vlmDecision: body.vlmDecision,
      vlmConfidence: body.vlmConfidence,
      vlmReasoning: body.vlmReasoning,
      vlmComment: body.vlmComment,
      correctDecision: body.correctDecision,
      correctionReason: body.correctionReason ?? `Human override: ${body.vlmDecision} → ${body.correctDecision}`,
      correctedBy: userId,
    });

    await logActivity(
      body.dropNumber,
      'HITL_PASSFAIL_CORRECTION',
      {
        photoFilename: body.photoFilename,
        step: body.step,
        vlmDecision: body.vlmDecision,
        correctDecision: body.correctDecision,
        correctionId: correction.id,
      },
      userId
    );

    log.info('RecordPassFailCorrection', {
      action: 'recorded',
      dropNumber: body.dropNumber,
      photo: body.photoFilename,
      from: body.vlmDecision,
      to: body.correctDecision,
    });

    return apiResponse.success(res, { recorded: true, correctionId: correction.id });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    if (error instanceof PassFailCommentServiceError && error.code === 'NO_CORRECTION_NEEDED') {
      return apiResponse.success(res, { recorded: false, reason: msg });
    }
    log.error('RecordPassFailCorrection', { action: 'failed', error: msg });
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, msg);
  }
}

export default withAuth(handler);
