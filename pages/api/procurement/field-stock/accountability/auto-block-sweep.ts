/**
 * Holder Auto-Block Sweep API
 * POST /api/procurement/field-stock/accountability/auto-block-sweep
 *
 * Tier 3.2 (SOP-4.4): scan every holder with aged_no_evidence serials and block
 * those over the `stock_accountability_config` policy threshold (mig 411). No-op
 * when the policy is disabled (the default). Manual admin trigger; the same
 * service backs the nightly cron (scripts/cron/holder-auto-block-sweep.ts).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { query } from '@/lib/db-pool';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { runAutoBlockSweep } from '@/modules/procurement/field-stock/services/autoBlockSweep';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  try {
    const result = await runAutoBlockSweep(query, 'auto-block:sweep');
    log.info(
      'Holder auto-block sweep complete',
      {
        enabled: result.enabled,
        evaluated: result.evaluated,
        blocked: result.blocked.length,
        alreadyBlocked: result.alreadyBlocked,
      },
      'field-stock',
    );
    return apiResponse.success(res, result);
  } catch (error: unknown) {
    log.error('Holder auto-block sweep failed', { error }, 'field-stock');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
