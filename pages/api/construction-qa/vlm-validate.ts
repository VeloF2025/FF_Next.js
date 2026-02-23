/**
 * POST /api/construction-qa/vlm-validate
 *
 * Triggers VLM validation for a construction QA review.
 * Processes all unvalidated photos or a specific photo.
 *
 * Body: { reviewId, discipline, photoId?, forceRerun? }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { validateReviewPhotos } from '@/modules/construction-qa/services/vlmConstructionService';
import type { Discipline } from '@/modules/construction-qa/types';
import { withAuth } from '@/lib/auth/middleware';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['POST']);
  }

  try {
    const { reviewId, discipline, photoId, forceRerun } = req.body;

    if (!reviewId || !discipline) {
      return apiResponse.badRequest(res, 'reviewId and discipline are required');
    }

    const validDisciplines = ['civil', 'optical', 'splicing'];
    if (!validDisciplines.includes(discipline)) {
      return apiResponse.badRequest(res, `discipline must be one of: ${validDisciplines.join(', ')}`);
    }

    const result = await validateReviewPhotos({
      reviewId,
      discipline: discipline as Discipline,
      photoId,
      forceRerun: Boolean(forceRerun),
    });

    return apiResponse.success(res, {
      reviewId,
      ...result,
    });
  } catch (error) {
    log.error('VLM validate error', { module: 'construction-qa', error: (error as Error).message });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
