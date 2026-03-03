/**
 * PATCH /api/construction-qa/photo-step
 * Update a photo's checklist_step and step_label on construction_qa_photos.
 * Used by drag-and-drop reassignment in the Photo Review phase.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth/middleware';

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
    const result = await sql`
      UPDATE construction_qa_photos
      SET checklist_step = ${step},
          step_label = ${stepLabel ?? null},
          updated_at = NOW()
      WHERE id = ${photoId}::uuid
      RETURNING id
    `;

    if (result.length === 0) {
      return apiResponse.notFound(res, 'Photo', photoId);
    }

    return apiResponse.success(res, { photoId, step, stepLabel });
  } catch (error) {
    log.error('Photo step update error', { module: 'construction-qa', error: (error as Error).message });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
