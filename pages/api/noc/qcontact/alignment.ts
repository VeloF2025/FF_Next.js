/**
 * QContact Alignment Report Endpoint
 * 🟢 WORKING: Generates alignment report comparing QContact and FibreFlow tickets
 *
 * @endpoint GET /api/noc/qcontact/alignment
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createLogger } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import { generateAlignmentReport } from '@/modules/noc/services/qcontactAlignmentService';
import { withAuth } from '@/lib/auth';

const logger = createLogger('qcontact-alignment');

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  try {
    logger.info('Generating QContact alignment report');

    const report = await generateAlignmentReport();

    logger.info('Alignment report generated', {
      aligned: report.summary.aligned,
      misaligned: report.summary.misaligned,
      missingInFibreflow: report.summary.missing_in_fibreflow,
    });

    return apiResponse.success(res, report);
  } catch (error) {
    logger.error('Failed to generate alignment report', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
