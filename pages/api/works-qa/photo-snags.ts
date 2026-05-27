import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { withAuth, withPermission } from '@/lib/auth';
import { log } from '@/lib/logger';
import { listPhotoSnags } from '@/modules/works-qa/services/photoSnagService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return apiResponse.methodNotAllowed(res, req.method!, ['GET']);
  const poleId = typeof req.query.pole_id === 'string' ? req.query.pole_id : null;
  if (!poleId) return apiResponse.error(res, ErrorCode.VALIDATION_ERROR, 'pole_id query param is required');
  try {
    const snags = await listPhotoSnags(poleId);
    return apiResponse.success(res, { snags });
  } catch (err) {
    log.error('works-qa/photo-snags', { error: err instanceof Error ? err.message : String(err), poleId });
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(withPermission('construction-qa.works-qa', 'view')(handler));
