/**
 * API Route: /api/dr-photo-unified/approve-categorization
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
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { getAuth } from '@/lib/auth-mock';
import {
  ApproveCategorizeRequest,
  ApproveCategorizeResponse,
  VlmCategorizationResult,
  Photo,
} from '@/modules/dr-photo-unified/types/unified.types';

// Configure Neon WebSocket
neonConfig.webSocketConstructor = ws;

const pool = new Pool({
  connectionString:
    process.env.DATABASE_URL ||
    'postgresql://neondb_owner:npg_MIUZXrg1tEY0@ep-dry-night-a9qyh4sj-pooler.gwc.azure.neon.tech/neondb?sslmode=require',
});

/**
 * POST /api/dr-photo-unified/approve-categorization
 * Approve or override VLM categorizations
 */
async function handlePost(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  try {
    // Get authenticated user
    const { userId } = getAuth(req);
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
            url: `/api/dr-photo-unified/photo/${dropNumber}/${catResult.photo_filename}`,
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
export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<void> {
  if (req.method === 'POST') {
    return handlePost(req, res);
  } else {
    return apiResponse.error(res, ErrorCode.METHOD_NOT_ALLOWED, 'Method not allowed');
  }
}
