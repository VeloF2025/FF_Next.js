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
import { withAuth, withRole, AuthenticatedNextApiRequest } from '@/lib/auth';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { waDate, oesDate, project } = req.query;

    // Validate required parameters
    if (!waDate) {
      return res.status(400).json({
        error: 'Missing required parameter: waDate',
      });
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
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}

export default withAuth(withRole('manager')(handler));
