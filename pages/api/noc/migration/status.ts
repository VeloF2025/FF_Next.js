/**
 * VF Migration Status Endpoint
 * 🟢 WORKING: Returns migration status and statistics
 *
 * @endpoint GET /api/noc/migration/status
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createLogger } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import { getMigrationStatus } from '@/modules/noc/services/ticketMigrationService';
import { withAuth } from '@/lib/auth';

const logger = createLogger('maintenance:migration-status');

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown');
  }

  try {
    logger.info('Fetching VF migration status');

    const status = await getMigrationStatus();

    logger.info('Migration status retrieved', {
      total: status.total_tickets,
      vf_format: status.vf_format,
      ff_format: status.ff_format,
    });

    return apiResponse.success(res, status);
  } catch (error) {
    logger.error('Failed to get migration status', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
