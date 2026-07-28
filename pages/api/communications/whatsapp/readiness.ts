/**
 * WhatsApp Cloud go-live readiness (read-only)
 * GET /api/communications/whatsapp/readiness
 *
 * Reports which provider is active and whether each Cloud credential exists.
 * Presence only — credential values never leave the server.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withRole } from '@/lib/auth';
import { log } from '@/lib/logger';
import { getWaReadiness, type WaReadiness } from '@/modules/communications/whatsapp/config/waGoLive';
import type { WaAdminApiResponse } from '@/modules/communications/whatsapp/types/wa-admin.types';

async function handler(
  req: NextApiRequest,
  res: NextApiResponse<WaAdminApiResponse<WaReadiness>>
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    const readiness = await getWaReadiness();
    return res.status(200).json({ success: true, data: readiness });
  } catch (error) {
    log.error('[WA Readiness API] Error', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(withRole('manager')(handler));
