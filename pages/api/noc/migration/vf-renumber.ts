/**
 * VF Migration Renumber Endpoint
 * 🟢 WORKING: Triggers migration of tickets to VF format
 *
 * @endpoint POST /api/noc/migration/vf-renumber
 *
 * Request body:
 * - dryRun: boolean (optional, default false) - Preview changes without applying
 * - batchSize: number (optional, default 100) - Batch size for processing
 *
 * Response:
 * - MigrationResult with summary, mappings, and errors
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { createLogger } from '@/lib/logger';
import { apiResponse } from '@/lib/apiResponse';
import {
  migrateTicketsToVfFormat,
  rollbackMigration,
  getMigrationStatus,
} from '@/modules/noc/services/ticketMigrationService';
import { withAuth } from '@/lib/auth';

const logger = createLogger('maintenance:vf-renumber');

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === 'GET') {
    // GET returns migration status
    try {
      const status = await getMigrationStatus();
      return apiResponse.success(res, status);
    } catch (error) {
      return apiResponse.internalError(res, error);
    }
  }

  if (req.method === 'DELETE') {
    // DELETE triggers rollback
    try {
      const { dryRun = false } = req.body || {};

      logger.info('Starting VF migration rollback', { dryRun });

      const result = await rollbackMigration({ dryRun });

      logger.info('Rollback completed', {
        restored: result.restored,
        errors: result.errors.length,
      });

      return apiResponse.success(res, result);
    } catch (error) {
      logger.error('Rollback failed', {
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      return apiResponse.internalError(res, error);
    }
  }

  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown');
  }

  try {
    const { dryRun = false, batchSize = 100, userId } = req.body || {};

    logger.info('Starting VF migration', { dryRun, batchSize });

    const result = await migrateTicketsToVfFormat({
      dryRun,
      batchSize,
      userId,
    });

    logger.info('Migration completed', {
      total: result.total,
      migrated: result.migrated,
      skipped: result.skipped,
      errors: result.errors.length,
      dryRun: result.dry_run,
    });

    return apiResponse.success(res, result);
  } catch (error) {
    logger.error('VF migration failed', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
