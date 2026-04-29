import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { withAuth, getAuthUser } from '@/lib/auth';
import { log } from '@/lib/logger';
import {
  getTrainingDrop,
  excludeTrainingDrop,
} from '@/modules/vlm-training/services/trainingDataService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { dropNumber } = req.query;
  if (typeof dropNumber !== 'string') {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Invalid drop number');
  }

  if (req.method === 'GET') {
    try {
      const drop = await getTrainingDrop(dropNumber);
      if (!drop) {
        return apiResponse.notFound(res, 'Training drop', dropNumber);
      }
      return apiResponse.success(res, drop);
    } catch (err) {
      log.error('Failed to fetch training drop', { err, dropNumber }, 'vlm-training');
      return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Failed to fetch training drop');
    }
  }

  if (req.method === 'PATCH') {
    // Exclude from training (HITL kill switch)
    try {
      const user = getAuthUser(req);
      const { reason } = req.body as { reason?: string };

      if (!reason?.trim()) {
        return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'reason is required');
      }

      const updated = await excludeTrainingDrop(
        dropNumber,
        reason.trim(),
        user?.email ?? 'unknown'
      );

      if (!updated) {
        return apiResponse.notFound(res, 'Training drop or already excluded', dropNumber);
      }

      return apiResponse.success(res, { dropNumber, excluded: true });
    } catch (err) {
      log.error('Failed to exclude training drop', { err, dropNumber }, 'vlm-training');
      return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Failed to exclude training drop');
    }
  }

  return apiResponse.error(res, ErrorCode.METHOD_NOT_ALLOWED, 'Method not allowed');
}

export default withAuth(handler);
