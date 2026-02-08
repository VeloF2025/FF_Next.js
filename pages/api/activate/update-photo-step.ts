/**
 * API Route: /api/activate/update-photo-step
 *
 * Purpose: Update a single photo's step assignment without re-categorizing
 * Method: POST
 *
 * This allows editing individual photo categorizations after approval,
 * without having to re-run the entire VLM categorization.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import pool from '@/lib/db';
import { log } from '@/lib/logger';
import { VlmCategorizationResult, Photo } from '@/modules/activate/types/unified.types';
import { recordCorrection, RecordCorrectionInput } from '@/modules/qa-learning';
import { STEP_LABELS } from '@/modules/activate/utils/stepMapper';

interface UpdatePhotoStepRequest {
  dropNumber: string;
  photoFilename: string;
  newStep: number;
  reason?: string;
}

interface UpdatePhotoStepResponse {
  dropNumber: string;
  photoFilename: string;
  previousStep: number;
  newStep: number;
  updatedAt: string;
}

/**
 * POST /api/activate/update-photo-step
 * Update a single photo's step assignment
 */
async function handlePost(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  try {
    const userId = (req as AuthenticatedNextApiRequest).user.id;
    const updatedBy = userId || 'anonymous';

    const { dropNumber, photoFilename, newStep, reason } = req.body as UpdatePhotoStepRequest;

    // Validation
    if (!dropNumber) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'dropNumber is required');
    }
    if (!photoFilename) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'photoFilename is required');
    }
    if (newStep === undefined || newStep === null || newStep < 0 || newStep > 10) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'newStep must be between 0 and 10');
    }

    log.info('UpdatePhotoStep', `Updating ${photoFilename} in ${dropNumber} to step ${newStep}`);

    // Get current data
    const result = await pool.query(
      `SELECT vlm_categorization_status, vlm_categorization_results, photos_metadata
       FROM dr_photo_unified_reviews
       WHERE drop_number = $1`,
      [dropNumber]
    );

    if (result.rows.length === 0) {
      return apiResponse.notFound(res, 'Review', dropNumber);
    }

    const row = result.rows[0];
    const currentResults: VlmCategorizationResult[] = row.vlm_categorization_results || [];
    const currentPhotos: Photo[] = row.photos_metadata || [];

    // Find the photo in categorization results
    const catIndex = currentResults.findIndex((r) => r.photo_filename === photoFilename);
    if (catIndex === -1) {
      return apiResponse.error(res, ErrorCode.NOT_FOUND, `Photo ${photoFilename} not found in categorization`);
    }

    const catResult = currentResults[catIndex];
    const previousStep = catResult.human_override_step ?? catResult.vlm_predicted_step;

    // Update categorization result
    const updatedCatResult: VlmCategorizationResult = {
      ...catResult,
      human_approved: newStep === catResult.vlm_predicted_step,
      human_override_step: newStep === catResult.vlm_predicted_step ? null : newStep,
      human_override_reason: newStep === catResult.vlm_predicted_step ? null : (reason || 'Manual edit'),
    };

    const updatedResults = [...currentResults];
    updatedResults[catIndex] = updatedCatResult;

    // Update photos_metadata
    const updatedPhotos = currentPhotos.map((photo) => {
      if (photo.filename === photoFilename) {
        return { ...photo, step: newStep };
      }
      return photo;
    });

    // Update database
    await pool.query(
      `UPDATE dr_photo_unified_reviews
       SET
         vlm_categorization_results = $1,
         photos_metadata = $2,
         updated_at = NOW()
       WHERE drop_number = $3`,
      [JSON.stringify(updatedResults), JSON.stringify(updatedPhotos), dropNumber]
    );

    log.info('UpdatePhotoStep', `Updated ${photoFilename} from step ${previousStep} to ${newStep}`, {
      dropNumber,
      updatedBy,
    });

    // Record correction for HITL learning if step changed from VLM prediction
    if (newStep !== catResult.vlm_predicted_step) {
      const correction: RecordCorrectionInput = {
        workflowType: 'dr_photo',
        photoFilename: catResult.photo_filename,
        photoDescription: catResult.vlm_identified_as || undefined,
        vlmPredictedStep: catResult.vlm_predicted_step,
        vlmPredictedCategory: catResult.vlm_predicted_category,
        vlmConfidence: catResult.vlm_confidence,
        vlmReasoning: catResult.vlm_reasoning || undefined,
        correctStep: newStep,
        correctCategory: STEP_LABELS[newStep] || `Step ${newStep}`,
        correctionReason: reason || 'Manual edit',
        correctedBy: updatedBy,
      };

      recordCorrection(correction).catch((err) => {
        log.warn('UpdatePhotoStep', 'Failed to record correction for HITL learning', {
          photoFilename,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }

    const response: UpdatePhotoStepResponse = {
      dropNumber,
      photoFilename,
      previousStep,
      newStep,
      updatedAt: new Date().toISOString(),
    };

    return apiResponse.success(res, response);
  } catch (error) {
    log.error('UpdatePhotoStep', 'Error updating photo step', error);
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
  } else {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }
}

export default withAuth(handler);
