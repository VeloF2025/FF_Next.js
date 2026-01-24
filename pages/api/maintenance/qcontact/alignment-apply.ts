/**
 * QContact Alignment Apply Fixes Endpoint
 * 🟢 WORKING: Applies status alignment fixes to FibreFlow tickets
 *
 * @endpoint POST /api/maintenance/qcontact/alignment-apply
 *
 * Request body:
 * {
 *   "fixes": [
 *     { "fibreflow_id": "uuid", "new_status": "closed", "reason": "QContact is Closed" }
 *   ],
 *   "dry_run": false
 * }
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createLogger } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import {
  applyAlignmentFixes,
  AlignmentFix,
} from '@/modules/maintenance/services/qcontactAlignmentService';
import { TicketStatus } from '@/modules/maintenance/types/ticket';
import { withAuth } from '@/lib/auth';

const logger = createLogger('qcontact-alignment-apply');

interface ApplyRequest {
  fixes: AlignmentFix[];
  dry_run?: boolean;
}

// Validate TicketStatus
const validStatuses = Object.values(TicketStatus);

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown');
  }

  try {
    const body = req.body as ApplyRequest;

    if (!body.fixes || !Array.isArray(body.fixes) || body.fixes.length === 0) {
      return apiResponse.badRequest(res, 'fixes array is required');
    }

    // Validate each fix
    for (const fix of body.fixes) {
      if (!fix.fibreflow_id) {
        return apiResponse.badRequest(res, 'Each fix must have fibreflow_id');
      }
      if (!fix.new_status || !validStatuses.includes(fix.new_status as TicketStatus)) {
        return apiResponse.badRequest(
          res,
          `Invalid new_status: ${fix.new_status}. Must be one of: ${validStatuses.join(', ')}`
        );
      }
    }

    const dryRun = body.dry_run ?? false;

    logger.info(`Applying ${body.fixes.length} alignment fixes (dry_run: ${dryRun})`);

    const result = await applyAlignmentFixes(body.fixes, dryRun);

    logger.info('Alignment fixes applied', {
      applied: result.applied,
      failed: result.failed,
      dryRun,
    });

    return apiResponse.success(res, {
      ...result,
      dry_run: dryRun,
      message: dryRun
        ? `Dry run: ${result.applied} fixes would be applied`
        : `Applied ${result.applied} fixes successfully`,
    });
  } catch (error) {
    logger.error('Failed to apply alignment fixes', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
