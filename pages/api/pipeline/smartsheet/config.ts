/**
 * API: Smartsheet sync configuration
 * GET /api/pipeline/smartsheet/config - List configs
 * POST /api/pipeline/smartsheet/config - Create config
 * PUT /api/pipeline/smartsheet/config - Update config
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { log } from '@/lib/logger';import { apiResponse } from '@/lib/apiResponse';
import { pipelineSmartsheetService } from '@/modules/pipeline/services';
import { withAuth } from '@/lib/auth';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    switch (req.method) {
      case 'GET': {
        const configs = await pipelineSmartsheetService.getActiveSyncConfigs();
        return apiResponse.success(res, { configs });
      }

      case 'POST': {
        const config = await pipelineSmartsheetService.createSyncConfig(req.body);
        return apiResponse.created(res, config);
      }

      case 'PUT': {
        const { id, ...updates } = req.body;
        if (!id) {
          return apiResponse.badRequest(res, 'Config ID required');
        }
        const config = await pipelineSmartsheetService.updateSyncConfig(id, updates);
        if (!config) {
          return apiResponse.notFound(res, 'Sync config', id);
        }
        return apiResponse.success(res, config);
      }

      default:
        return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET', 'POST', 'PUT']);
    }
  } catch (error) {
   log.error('smartsheet-config', { error: error instanceof Error ? error.message : String(error) });
    log.error('smartsheet-config', { error: error instanceof Error ? error.message : String(error) });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
