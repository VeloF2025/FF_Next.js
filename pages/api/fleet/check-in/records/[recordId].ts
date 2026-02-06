/**
 * API: Fleet Check-In Record by ID
 * GET /api/fleet/check-in/records/[recordId] - Get record with details
 * PUT /api/fleet/check-in/records/[recordId] - Update status (approve/reject)
 * DELETE /api/fleet/check-in/records/[recordId] - Delete record (admin only)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { withFleetAuth } from '@/lib/auth/middleware';
import {
  getCheckRecordWithDetails,
  updateCheckRecordStatus,
  deleteCheckRecord,
} from '@/modules/fleet/services/checkInService';
import { log } from '@/lib/logger';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { recordId } = req.query;

  if (!recordId || typeof recordId !== 'string') {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Record ID is required');
  }

  try {
    switch (req.method) {
      case 'GET': {
        const record = await getCheckRecordWithDetails(recordId);
        if (!record) {
          return apiResponse.notFound(res, 'Check-in record', recordId);
        }
        return apiResponse.success(res, record);
      }

      case 'PUT': {
        const { status, approvedBy, notes } = req.body;

        if (!status || !['approved', 'rejected'].includes(status)) {
          return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Status must be "approved" or "rejected"');
        }
        if (!approvedBy) {
          return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Approver ID is required');
        }

        const record = await updateCheckRecordStatus(recordId, status, approvedBy, notes);
        if (!record) {
          return apiResponse.notFound(res, 'Check-in record', recordId);
        }
        return apiResponse.success(res, record);
      }

      case 'DELETE': {
        // Check if user is admin or super_admin (from auth context)
        const user = (req as unknown as { user?: { role?: string } }).user;
        if (!user || (user.role !== 'admin' && user.role !== 'super_admin')) {
          return apiResponse.error(res, ErrorCode.FORBIDDEN, 'Only admins can delete check-in records');
        }

        const deleted = await deleteCheckRecord(recordId);
        if (!deleted) {
          return apiResponse.notFound(res, 'Check-in record', recordId);
        }

        log.info('FleetCheckInApi', `Check-in record ${recordId} deleted by admin`);
        return apiResponse.success(res, { deleted: true });
      }

      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'PUT', 'DELETE']);
    }
  } catch (error) {
    return apiResponse.internalError(res, error);
  }
}

export default withFleetAuth(handler);
