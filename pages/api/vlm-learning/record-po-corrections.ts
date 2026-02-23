import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { recordPOFormCorrections } from '@/modules/projects/services/poExtractionService';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth/middleware';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || '');
  }

  try {
    const { extraction, formData, context } = req.body;

    if (!extraction || !formData) {
      return apiResponse.badRequest(res, 'extraction and formData are required');
    }

    await recordPOFormCorrections(extraction, formData, context);

    return apiResponse.success(res, { recorded: true });
  } catch (err) {
    log.error('Failed to record PO form corrections', { err });
    return apiResponse.error(res, 'Failed to record corrections');
  }
}

export default withAuth(handler);
