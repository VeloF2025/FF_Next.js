/**
 * API Route: /api/activate/approve-categorization
 *
 * Purpose: Human approval/override of VLM photo categorizations
 * Method: POST
 *
 * This endpoint:
 * 1. Accepts human approvals/overrides for VLM predictions
 * 2. Updates photos_metadata with final step assignments
 * 3. Marks categorization as approved
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import pool from '@/lib/db';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { log } from '@/lib/logger';
import {
  ApproveCategorizeRequest,
  ApproveCategorizeResponse,
  VlmCategorizationResult,
  Photo,
} from '@/modules/activate/types/unified.types';
import { recordCorrection, RecordCorrectionInput } from '@/modules/qa-learning';
import { STEP_LABELS } from '@/modules/activate/utils/stepMapper';

/**
 * POST /api/activate/approve-categorization
 * Approve or override VLM categorizations
 */
async function handlePost(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  try {
    // Get authenticated user
    const userId = (req as AuthenticatedNextApiRequest).user.id;
    const approvedBy = userId || 'anonymous';

    const { dropNumber, approvals, approve_all } = req.body as ApproveCategorizeRequest;

    if (!dropNumber) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'dropNumber is required');
    }

    log.info('ApproveCategorization', `Processing approval for ${dropNumber}`, {
      approve_all,
      approvalCount: approvals?.length || 0,
    });

    // Get current categorization results
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

    if (row.vlm_categorization_status !== 'categorized') {
      return apiResponse.error(
        res,
        ErrorCode.BAD_REQUEST,
        `Cannot approve: categorization status is '${row.vlm_categorization_status}', expected 'categorized'`
      );
    }

    const currentResults: VlmCategorizationResult[] = row.vlm_categorization_results || [];
    const currentPhotos: Photo[] = row.photos_metadata || [];

    if (currentResults.length === 0) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'No categorization results to approve');
    }

    // Process approvals
    let approvedCount = 0;
    let overriddenCount = 0;

    const updatedResults: VlmCategorizationResult[] = currentResults.map((catResult) => {
      if (approve_all) {
        // Approve all predictions
        approvedCount++;
        return {
          ...catResult,
          human_approved: true,
          human_override_step: null,
          human_override_reason: null,
        };
      }

      // Find specific approval for this photo
      const approval = approvals?.find((a) => a.photo_filename === catResult.photo_filename);

      if (!approval) {
        // No approval provided, keep as-is
        return catResult;
      }

      if (approval.approved) {
        // Approved as-is
        approvedCount++;
        return {
          ...catResult,
          human_approved: true,
          human_override_step: null,
          human_override_reason: null,
        };
      } else if (approval.override_step !== undefined) {
        // Overridden with different step
        overriddenCount++;
        return {
          ...catResult,
          human_approved: false,
          human_override_step: approval.override_step,
          human_override_reason: approval.override_reason || null,
        };
      }

      return catResult;
    });

    // Build updated photos_metadata with final step assignments
    const updatedPhotos: Photo[] = currentPhotos.map((photo) => {
      const catResult = updatedResults.find((r) => r.photo_filename === photo.filename);

      if (!catResult) {
        return photo;
      }

      // Determine final step: human override takes precedence, then VLM prediction
      const finalStep =
        catResult.human_override_step !== null
          ? catResult.human_override_step
          : catResult.vlm_predicted_step;

      return {
        ...photo,
        step: finalStep,
      };
    });

    // If no photos in metadata, create from categorization results
    const photosToStore =
      updatedPhotos.length > 0
        ? updatedPhotos
        : updatedResults.map((catResult) => ({
            filename: catResult.photo_filename,
            step:
              catResult.human_override_step !== null
                ? catResult.human_override_step
                : catResult.vlm_predicted_step,
            url: `/api/activate/photo/${dropNumber}/${catResult.photo_filename}`,
            original_type: catResult.original_type,
          }));

    // Update database
    await pool.query(
      `UPDATE dr_photo_unified_reviews
       SET
         vlm_categorization_status = 'approved',
         vlm_categorization_results = $1,
         vlm_approved_by = $2,
         vlm_approved_at = NOW(),
         photos_metadata = $3,
         updated_at = NOW()
       WHERE drop_number = $4`,
      [JSON.stringify(updatedResults), approvedBy, JSON.stringify(photosToStore), dropNumber]
    );

    log.info('ApproveCategorization', `Approved categorization for ${dropNumber}`, {
      approvedCount,
      overriddenCount,
      totalPhotos: photosToStore.length,
    });

    // HITL Learning: Record human overrides as corrections for few-shot learning
    // Only record when human disagreed with VLM (override_step differs from vlm_predicted_step)
    const correctionsToRecord: RecordCorrectionInput[] = [];

    for (const catResult of updatedResults) {
      // Check if this was an override (human_override_step is set and differs from VLM prediction)
      if (
        catResult.human_override_step !== null &&
        catResult.human_override_step !== catResult.vlm_predicted_step
      ) {
        correctionsToRecord.push({
          workflowType: 'dr_photo',
          photoFilename: catResult.photo_filename,
          photoDescription: catResult.vlm_identified_as || undefined,
          vlmPredictedStep: catResult.vlm_predicted_step,
          vlmPredictedCategory: catResult.vlm_predicted_category,
          vlmConfidence: catResult.vlm_confidence,
          vlmReasoning: catResult.vlm_reasoning || undefined,
          correctStep: catResult.human_override_step,
          correctCategory: STEP_LABELS[catResult.human_override_step] || `Step ${catResult.human_override_step}`,
          correctionReason: catResult.human_override_reason || undefined,
          correctedBy: approvedBy,
        });
      }
    }

    // Record corrections asynchronously (don't block response)
    if (correctionsToRecord.length > 0) {
      Promise.all(
        correctionsToRecord.map((correction) =>
          recordCorrection(correction).catch((err) => {
            log.warn('ApproveCategorization', 'Failed to record correction for few-shot learning', {
              photoFilename: correction.photoFilename,
              error: err instanceof Error ? err.message : String(err),
            });
          })
        )
      ).then((results) => {
        const successCount = results.filter((r) => r !== undefined).length;
        log.info('ApproveCategorization', `Recorded ${successCount}/${correctionsToRecord.length} corrections for HITL learning`);
      });
    }

    const response: ApproveCategorizeResponse = {
      dropNumber,
      status: 'approved',
      approved_count: approvedCount,
      overridden_count: overriddenCount,
      photos_metadata: photosToStore,
    };

    return apiResponse.success(res, response);
  } catch (error) {
    log.error('ApproveCategorization', 'Error during approval', error);
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
    return apiResponse.error(res, ErrorCode.METHOD_NOT_ALLOWED, 'Method not allowed');
  }
}

export default withAuth(handler);
