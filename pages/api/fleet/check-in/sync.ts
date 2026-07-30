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
import {
  withFleetAuth,
  type FleetAuthenticatedRequest,
} from '@/lib/auth/middleware';
import { canAccessPortalVehicle } from '@/modules/fleet/portal/authorization';
import { log } from '@/lib/logger';

function applyPortalIdentity(
  req: FleetAuthenticatedRequest,
  request: SyncCheckRecordRequest
): SyncCheckRecordRequest {
  if (req.authType !== 'portal' || !req.portalSession) return request;

  return {
    ...request,
    vehicleId: req.portalSession.vehicleId,
    driverId: req.portalSession.driverId ?? request.driverId,
    driverName: req.portalSession.driverName ?? request.driverName,
  };
}

async function handler(req: FleetAuthenticatedRequest, res: NextApiResponse) {
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
          const submittedRequest = body as SyncCheckRecordRequest;

          if (!submittedRequest.offlineId) {
            return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Offline ID is required');
          }
          if (!submittedRequest.vehicleId) {
            return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Vehicle ID is required');
          }
          if (!submittedRequest.driverId) {
            return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Driver ID is required');
          }
          if (!canAccessPortalVehicle(req, submittedRequest.vehicleId)) {
            return apiResponse.error(
              res,
              ErrorCode.FORBIDDEN,
              'Vehicle does not match the authenticated portal session'
            );
          }

          const request = applyPortalIdentity(req, submittedRequest);
          const result = await syncOfflineCheckRecord(request);
          return apiResponse.success(res, result);
        }

        // Handle batch sync
        const submittedRequests = body as SyncCheckRecordRequest[];
        if (
          submittedRequests.some(
            (request) =>
              request.vehicleId &&
              !canAccessPortalVehicle(req, request.vehicleId)
          )
        ) {
          return apiResponse.error(
            res,
            ErrorCode.FORBIDDEN,
            'Vehicle does not match the authenticated portal session'
          );
        }
        const requests = submittedRequests.map((request) =>
          applyPortalIdentity(req, request)
        );
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
    log.error('Internal error', { error: { error } }, 'SyncApi');
    return apiResponse.internalError(res, error);
  }
}

export default withFleetAuth(handler);
