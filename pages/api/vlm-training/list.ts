import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { withAuth, withRole } from '@/lib/auth';
import { log } from '@/lib/logger';
import { listTrainingDrops } from '@/modules/vlm-training/services/trainingDataService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.error(res, ErrorCode.METHOD_NOT_ALLOWED, 'Method not allowed');
  }

  try {
    const { page, pageSize, region, minSteps, activeOnly, excludedOnly } = req.query;

    const pageNum = page ? parseInt(page as string, 10) : 1;
    const pageSizeNum = pageSize ? parseInt(pageSize as string, 10) : 50;

    if (isNaN(pageNum) || pageNum < 1) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'page must be a positive integer');
    }
    if (isNaN(pageSizeNum) || pageSizeNum < 1) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'pageSize must be a positive integer');
    }

    const result = await listTrainingDrops({
      page: pageNum,
      pageSize: pageSizeNum,
      region: region as string | undefined,
      minSteps: minSteps ? parseInt(minSteps as string, 10) : undefined,
      activeOnly: activeOnly === 'true',
      excludedOnly: excludedOnly === 'true',
    });

    return res.status(200).json({
      success: true,
      data: result.rows,
      pagination: {
        page: pageNum,
        pageSize: pageSizeNum,
        total: result.total,
        totalPages: Math.ceil(result.total / pageSizeNum),
      },
      regions: result.regions,
    });
  } catch (err) {
    log.error('Failed to list training drops', { err }, 'vlm-training');
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Failed to list training drops');
  }
}

export default withAuth(withRole('manager')(handler));
