/**
 * API Route: All Contractors Documents Summary
 *
 * GET /api/contractors-documents-report-summary
 *
 * Returns document completion summary for all active contractors
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { generateAllContractorsSummary } from '@/modules/contractor-documents-report/services/documentReportService';
import { log } from '@/lib/logger';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  try {
    // Generate summary for all contractors
    const summary = await generateAllContractorsSummary();

    return apiResponse.success(res, summary);
  } catch (error) {
    log.error('[contractors-documents-report-summary] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
