/**
 * POST /api/activate/recheck-serial-mismatch
 *
 * Runs a second-pass VLM analysis on serial mismatch photos.
 * Called automatically by send-feedback (fire-and-forget) and manually
 * via the Re-analyse Serial button in the QA review UI.
 *
 * Auth required.
 *
 * Status: WORKING
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import { runSerialRecheck } from '@/modules/activate/services/serialRecheckService';
import type { AuthenticatedNextApiRequest } from '@/lib/auth';

async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  if (req.method !== 'POST') {
    res.status(405).json({ success: false, error: { message: 'Method not allowed' } });
    return;
  }

  const { dropNumber, source } = req.body as {
    dropNumber?: string;
    source?: 'auto' | 'manual';
  };

  if (!dropNumber) {
    apiResponse.badRequest(res, 'dropNumber is required');
    return;
  }

  const userId = (req as AuthenticatedNextApiRequest).user?.id;
  const recheckSource: 'auto' | 'manual' = source === 'manual' ? 'manual' : 'auto';

  log.info(
    `Recheck requested for ${dropNumber} (source=${recheckSource}, userId=${userId ?? 'n/a'})`,
    undefined,
    'RecheckSerialMismatch'
  );

  try {
    const result = await runSerialRecheck(dropNumber, recheckSource, userId);
    apiResponse.success(res, result);
  } catch (error) {
    log.error(
      `Recheck failed for ${dropNumber}`,
      { dropNumber, error },
      'RecheckSerialMismatch'
    );
    apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
