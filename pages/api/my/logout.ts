/**
 * POST /api/my/logout — revoke the current /my portal session and clear cookie.
 *
 * Always returns 200 (idempotent) — calling logout without a session is a
 * no-op. Avoids leaking whether a session was present.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { revokeSession } from '@/modules/attendance/portal/sessionUtils';

export const config = {
  api: {
    bodyParser: { sizeLimit: '4kb' },
  },
};

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['POST']);
  }

  try {
    await revokeSession(req, res);
    return apiResponse.success(res, { ok: true });
  } catch (err) {
    log.error('[my-logout] unexpected error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return apiResponse.internalError(res, err);
  }
}
