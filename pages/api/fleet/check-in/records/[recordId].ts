/**
 * API: Fleet Check-In Record by ID
 * GET /api/fleet/check-in/records/[recordId] - Get record with details
 * PUT /api/fleet/check-in/records/[recordId] - Update status (approve/reject)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import {
  getCheckRecordWithDetails,
  updateCheckRecordStatus,
} from '@/modules/fleet/services/checkInService';

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

      default:
        return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'PUT']);
    }
  } catch (error) {
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
