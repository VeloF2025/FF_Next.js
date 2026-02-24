/**
 * API Route: /api/activate/reporting/discrepancy
 *
 * Purpose: Get discrepancy report between WhatsApp and OES
 * Method: GET
 *
 * Query Parameters:
 * - waDate (required): WhatsApp submission date (YYYY-MM-DD)
 * - oesDate (optional): OES report date (default: waDate + 1 day)
 * - project (optional): Filter by project name
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getDiscrepancyReport } from '@/modules/activate/services/reportingService';
import { log } from '@/lib/logger';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { withAuth, withRole, AuthenticatedNextApiRequest } from '@/lib/auth';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const { waDate, oesDate, project } = req.query;

    // Validate required parameters
    if (!waDate) {
      return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Missing required parameters: dateFrom and dateTo');
    }

    const waDateStr = Array.isArray(waDate) ? waDate[0] : waDate;
    const oesDateStr = oesDate
      ? Array.isArray(oesDate)
        ? oesDate[0]
        : oesDate
      : undefined;
    const projectStr = project
      ? Array.isArray(project)
        ? project[0]
        : project
      : undefined;

    log.info('DiscrepancyAPI', 'Fetching discrepancy report', {
      waDate: waDateStr,
      oesDate: oesDateStr,
      project: projectStr,
    });

    const data = await getDiscrepancyReport(waDateStr, oesDateStr || undefined, projectStr || undefined);

    return res.status(200).json(data);
  } catch (error) {
    log.error('DiscrepancyAPI', 'Failed to fetch discrepancy report', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(withRole('manager')(handler));
