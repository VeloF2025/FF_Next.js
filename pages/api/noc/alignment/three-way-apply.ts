/**
 * Three-Way Alignment Apply Actions Endpoint
 * 🟢 WORKING: Applies suggested alignment actions (update statuses, etc.)
 *
 * @endpoint POST /api/noc/alignment/three-way-apply
 *
 * Request body:
 * - actions: AlignmentAction[] - Actions to apply
 * - dryRun: boolean (optional, default false) - Preview without applying
 *
 * Response:
 * - { success, applied, skipped, errors }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createLogger } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import {
  applyAlignmentActions,
  type AlignmentAction,
} from '@/modules/noc/services/threeWayAlignmentService';
import { withAuth } from '@/lib/auth';

const logger = createLogger('maintenance:three-way-apply');

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  try {
    const { actions, dryRun = false } = req.body;

    if (!actions || !Array.isArray(actions)) {
      return apiResponse.badRequest(res, 'Missing or invalid actions array');
    }

    if (actions.length === 0) {
      return apiResponse.success(res, {
        applied: 0,
        skipped: 0,
        errors: [],
        message: 'No actions to apply',
      });
    }

    logger.info('Applying alignment actions', {
      count: actions.length,
      dryRun,
    });

    const result = await applyAlignmentActions(actions as AlignmentAction[], {
      dryRun,
    });

    logger.info('Alignment actions applied', {
      applied: result.applied,
      skipped: result.skipped,
      errors: result.errors.length,
    });

    return apiResponse.success(res, result);
  } catch (error) {
    logger.error('Failed to apply alignment actions', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
