/**
 * API Route: Contractor Documents Report
 *
 * GET /api/contractors-documents-report?contractorId={id}
 *
 * Returns complete document status report for a single contractor
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { generateContractorDocumentReport } from '@/modules/contractor-documents-report/services/documentReportService';
import { log } from '@/lib/logger';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  try {
    const { contractorId } = req.query;

    // Validation
    if (!contractorId || typeof contractorId !== 'string') {
      return apiResponse.validationError(res, {
        contractorId: 'Contractor ID is required',
      });
    }

    // Generate report
    const report = await generateContractorDocumentReport(contractorId);

    if (!report) {
      return apiResponse.notFound(res, 'Contractor', contractorId);
    }

    return apiResponse.success(res, report);
  } catch (error) {
    log.error('[contractors-documents-report] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
