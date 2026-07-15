/**
 * FNO QField reports API.
 *
 * GET /api/construction-qa/fno-reports
 * Query:
 *   mode=summary | detail (default detail)
 *   fno=herotel | fibertime (detail only, default herotel)
 *   projectId=<uuid> (optional detail filter)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth/middleware';
import { log } from '@/lib/logger';
import {
  getFnoScopeActualReport,
  getFnoSummary,
  normalizeFnoKey,
} from '@/modules/construction-qa/services/fnoQfieldReportService';

function validProjectId(input: string | string[] | undefined): string | undefined {
  const value = Array.isArray(input) ? input[0] : input;
  if (!value) return undefined;
  return /^[0-9a-f-]{36}$/i.test(value) ? value : undefined;
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['GET']);
  }

  try {
    const mode = Array.isArray(req.query.mode) ? req.query.mode[0] : req.query.mode;

    if (mode === 'summary') {
      const summary = await getFnoSummary();
      return apiResponse.success(res, { summary });
    }

    const fnoKey = normalizeFnoKey(req.query.fno);
    const projectId = validProjectId(req.query.projectId);
    const report = await getFnoScopeActualReport(fnoKey, projectId);
    return apiResponse.success(res, report);
  } catch (error) {
    log.error('Failed to load FNO QField report', { error: (error as Error).message }, 'FnoQfieldReportsAPI');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
