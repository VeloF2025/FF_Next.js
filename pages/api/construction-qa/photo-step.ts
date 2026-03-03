/**
 * PATCH /api/construction-qa/photo-step
 * Update a photo's checklist_step and step_label on construction_qa_photos.
 * Used by drag-and-drop reassignment in the Photo Review phase.
 *
 * Records VLM corrections when a user reassigns a VLM-processed photo
 * to a different step (HITL feedback loop for learning).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth/middleware';
import { recordVlmCorrection } from '@/services/vlmLearningService';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'PATCH') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['PATCH']);
  }

  const { photoId, step, stepLabel } = req.body;

  if (!photoId || typeof photoId !== 'string') {
    return apiResponse.badRequest(res, 'photoId is required');
  }

  // step must be a positive integer or null (null = unassigned)
  if (step !== null && (typeof step !== 'number' || step < 0 || !Number.isInteger(step))) {
    return apiResponse.badRequest(res, 'step must be a positive integer or null');
  }

  try {
    // Fetch current state before update (for VLM correction tracking)
    const [currentPhoto] = await sql`
      SELECT checklist_step, step_label, vlm_confidence, review_id
      FROM construction_qa_photos
      WHERE id = ${photoId}::uuid
    `;

    if (!currentPhoto) {
      return apiResponse.notFound(res, 'Photo', photoId);
    }

    const oldStep = currentPhoto.checklist_step;
    const oldLabel = currentPhoto.step_label;
    const newStep = step;
    const newLabel = stepLabel ?? null;

    const result = await sql`
      UPDATE construction_qa_photos
      SET checklist_step = ${newStep},
          step_label = ${newLabel},
          updated_at = NOW()
      WHERE id = ${photoId}::uuid
      RETURNING id
    `;

    if (result.length === 0) {
      return apiResponse.notFound(res, 'Photo', photoId);
    }

    // Record VLM correction if step actually changed and VLM had processed the photo
    if (oldStep !== newStep && currentPhoto.vlm_confidence != null) {
      // Fetch discipline from the review for context
      const [review] = await sql`
        SELECT discipline FROM construction_qa_reviews
        WHERE id = ${currentPhoto.review_id}::uuid
      `;

      recordVlmCorrection({
        module: 'construction_qa',
        analysisType: 'construction_photo_qa',
        sourceId: photoId,
        sourceTable: 'construction_qa_photos',
        vlmExtractedValue: `${String(oldStep ?? 'unassigned')}${oldLabel ? ` - ${oldLabel}` : ''}`,
        vlmConfidence: Number(currentPhoto.vlm_confidence),
        correctedValue: `${String(newStep ?? 'unassigned')}${newLabel ? ` - ${newLabel}` : ''}`,
        correctionReason: 'wrong_field',
        context: {
          discipline: review?.discipline || null,
          oldStep,
          newStep,
          oldLabel,
          newLabel,
        },
      }).catch((err) => {
        log.error('VLM correction recording failed (non-blocking)', {
          module: 'construction-qa',
          photoId,
          error: (err as Error).message,
        });
      });
    }

    return apiResponse.success(res, { photoId, step: newStep, stepLabel: newLabel });
  } catch (error) {
    log.error('Photo step update error', { module: 'construction-qa', error: (error as Error).message });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
