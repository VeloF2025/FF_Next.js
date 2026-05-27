import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { withAuth, withPermission, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { log } from '@/lib/logger';
import { getPoleSnagReport } from '@/modules/works-qa/services/photoSnagService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  const poleId = typeof req.query.pole_id === 'string' ? req.query.pole_id : null;
  if (!poleId) return apiResponse.error(res, ErrorCode.VALIDATION_ERROR, 'pole_id query param is required');
  const userId = (req as AuthenticatedNextApiRequest).user.id;
  try {
    const report = await getPoleSnagReport(poleId, userId);
    return apiResponse.success(res, report);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error('works-qa/pole-snag-report', { error: msg, poleId });
    if (msg.includes('not found')) return apiResponse.notFound(res, 'Pole', poleId);
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(withPermission('construction-qa.works-qa', 'view')(handler));
