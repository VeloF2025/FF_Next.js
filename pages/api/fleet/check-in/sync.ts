/**
 * API: Fleet Check-In Offline Sync
 * POST /api/fleet/check-in/sync - Sync offline check-in records
 * GET /api/fleet/check-in/sync?offlineIds=id1,id2 - Check sync status
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import {
  syncOfflineCheckRecord,
  checkSyncStatus,
} from '@/modules/fleet/services/checkInService';
import type { SyncCheckRecordRequest, SyncCheckRecordResponse } from '@/modules/fleet/types/check-in.types';
import { withFleetAuth } from '@/lib/auth/middleware';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    switch (req.method) {
      case 'GET': {
        // Check sync status for given offline IDs
        const { offlineIds } = req.query;

        if (!offlineIds || typeof offlineIds !== 'string') {
          return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Offline IDs are required (comma-separated)');
        }

        const ids = offlineIds.split(',').filter(Boolean);
        if (ids.length === 0) {
          return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'At least one offline ID is required');
        }

        const status = await checkSyncStatus(ids);
        return apiResponse.success(res, status);
      }

      case 'POST': {
        const body = req.body;

        // Handle single record sync
        if (!Array.isArray(body)) {
          const request = body as SyncCheckRecordRequest;

          if (!request.offlineId) {
            return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Offline ID is required');
          }
          if (!request.vehicleId) {
            return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Vehicle ID is required');
          }
          if (!request.driverId) {
            return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Driver ID is required');
          }

          const result = await syncOfflineCheckRecord(request);
          return apiResponse.success(res, result);
        }

        // Handle batch sync
        const requests = body as SyncCheckRecordRequest[];
        const results: SyncCheckRecordResponse[] = [];

        for (const request of requests) {
          if (!request.offlineId || !request.vehicleId || !request.driverId) {
            results.push({
              success: false,
              offlineId: request.offlineId || 'unknown',
              error: 'Missing required fields',
            });
            continue;
          }

          const result = await syncOfflineCheckRecord(request);
          results.push({
            ...result,
            offlineId: request.offlineId,
          });
        }

        return apiResponse.success(res, results);
      }

      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
    }
  } catch (error) {
    return apiResponse.internalError(res, error);
  }
}

export default withFleetAuth(handler);
