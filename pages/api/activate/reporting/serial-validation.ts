/**
 * API Route: /api/activate/reporting/serial-validation
 *
 * Purpose: Get serial validation report (ONT/UPS matching)
 * Method: GET
 *
 * Query Parameters:
 * - dateFrom (required): Start date (YYYY-MM-DD)
 * - dateTo (required): End date (YYYY-MM-DD)
 * - project (optional): Filter by project name
 * - mismatchesOnly (optional): Only return mismatches (boolean)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getSerialValidationReport } from '@/modules/activate/services/reportingService';
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
    const { dateFrom, dateTo, project, mismatchesOnly } = req.query;

    // Validate required parameters
    if (!dateFrom || !dateTo) {
      return res.status(400).json({
        error: 'Missing required parameters: dateFrom and dateTo',
      });
    }

    const dateFromStr = Array.isArray(dateFrom) ? dateFrom[0] : dateFrom;
    const dateToStr = Array.isArray(dateTo) ? dateTo[0] : dateTo;
    const projectStr = project
      ? Array.isArray(project)
        ? project[0]
        : project
      : undefined;
    const mismatchesOnlyBool =
      mismatchesOnly === 'true' || mismatchesOnly === '1';

    log.info('SerialValidationAPI', 'Fetching serial validation report', {
      dateFrom: dateFromStr,
      dateTo: dateToStr,
      project: projectStr,
      mismatchesOnly: mismatchesOnlyBool,
    });

    const data = await getSerialValidationReport(
      dateFromStr,
      dateToStr,
      projectStr || undefined,
      mismatchesOnlyBool
    );

    return res.status(200).json(data);
  } catch (error) {
    log.error('SerialValidationAPI', 'Failed to fetch serial validation report', {
      error,
    });
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Internal server error',
    });
  }
}

export default withAuth(withRole('manager')(handler));
