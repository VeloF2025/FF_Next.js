/**
 * API Route: /api/activate/check-photos
 *
 * Purpose: Quick check if photos exist for a DR before starting categorization
 * Method: GET
 *
 * This is a lightweight check that doesn't trigger downloads or retries.
 * Use this to show status in UI before starting the full categorization process.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { checkPhotosExist } from '@/modules/activate/services/photoFetchService';

interface CheckPhotosResponse {
  dropNumber: string;
  photosExist: boolean;
  photoCount: number;
  needsDownload: boolean;
  message: string;
}

/**
 * GET /api/activate/check-photos?dropNumber=XXX
 * Quick check if photos are available
 */
async function handleGet(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  try {
    const { dropNumber } = req.query;

    if (!dropNumber || typeof dropNumber !== 'string') {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'dropNumber query param is required');
    }

    log.debug(`Checking photo availability for ${dropNumber}`, undefined, 'CheckPhotos');

    const result = await checkPhotosExist(dropNumber);

    let message: string;
    if (result.exists) {
      message = `${result.count} photos available`;
    } else if (result.needsDownload) {
      message = 'Photos not synced yet - will download when categorization starts';
    } else {
      message = 'No photos found';
    }

    const response: CheckPhotosResponse = {
      dropNumber,
      photosExist: result.exists,
      photoCount: result.count,
      needsDownload: result.needsDownload,
      message,
    };

    return apiResponse.success(res, response);
  } catch (error) {
    log.error('Error checking photos', { error: error }, 'CheckPhotos');
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
  if (req.method === 'GET') {
    return handleGet(req, res);
  } else {
    return apiResponse.error(res, ErrorCode.METHOD_NOT_ALLOWED, 'Method not allowed');
  }
}

export default withAuth(handler);
