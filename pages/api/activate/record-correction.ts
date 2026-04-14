/**
 * API Route: /api/activate/record-correction
 *
 * Records a human correction to VLM photo categorization for HITL learning.
 * Called from AutoQaFeedbackPhase when a reviewer changes a photo's step assignment.
 * Corrections are stored in qa_correction_examples and used as few-shot examples
 * to improve future VLM predictions.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { recordCorrection } from '@/modules/qa-learning';
import { logActivity } from '@/modules/activate/services/activityLogService';

interface RecordCorrectionBody {
  photoFilename: string;
  dropNumber: string;
  vlmPredictedStep: number;
  vlmPredictedCategory: string;
  vlmConfidence: number;
  vlmReasoning?: string;
  photoDescription?: string;
  correctStep: number;
  correctCategory: string;
  correctionReason?: string;
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  try {
    const body = req.body as RecordCorrectionBody;

    if (!body.photoFilename || !body.dropNumber) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'photoFilename and dropNumber are required');
    }

    if (body.vlmPredictedStep === body.correctStep) {
      return apiResponse.success(res, { recorded: false, reason: 'No correction needed — steps match' });
    }

    const userId = ((req as unknown as Record<string, unknown>).userId as string) || 'unknown';

    const correction = await recordCorrection({
      workflowType: 'dr_photo',
      photoFilename: body.photoFilename,
      photoDescription: body.photoDescription,
      vlmPredictedStep: body.vlmPredictedStep,
      vlmPredictedCategory: body.vlmPredictedCategory,
      vlmConfidence: body.vlmConfidence,
      vlmReasoning: body.vlmReasoning,
      correctStep: body.correctStep,
      correctCategory: body.correctCategory,
      correctionReason: body.correctionReason || `Human override: Step ${body.vlmPredictedStep} → Step ${body.correctStep}`,
      correctedBy: userId,
    });

    // Log activity for audit trail
    await logActivity(body.dropNumber, 'HITL_STEP_CORRECTION', {
      photoFilename: body.photoFilename,
      vlmPredictedStep: body.vlmPredictedStep,
      correctStep: body.correctStep,
      correctionId: correction.id,
    }, userId);

    log.info('RecordCorrection', {
      action: 'recorded',
      dropNumber: body.dropNumber,
      photo: body.photoFilename,
      from: body.vlmPredictedStep,
      to: body.correctStep,
    });

    return apiResponse.success(res, { recorded: true, correctionId: correction.id });
  } catch (error) {
    // Don't fail the request — but surface the error so silent data loss is visible
    const msg = error instanceof Error ? error.message : String(error);
    const body = req.body as Partial<RecordCorrectionBody>;
    log.error('RecordCorrection', {
      action: 'save_failed',
      error: msg,
      dropNumber: body.dropNumber,
      photoFilename: body.photoFilename,
      vlmPredictedStep: body.vlmPredictedStep,
      correctStep: body.correctStep,
    });
    return apiResponse.success(res, { recorded: false, reason: msg });
  }
}

export default withAuth(handler);
