/**
 * Staff Audit Log API
 * GET /api/staff/[staffId]/audit-log - Get audit trail for a staff member
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuditLog } from '@/services/staff/staffAuditService';
import { createLogger } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';

const logger = createLogger('StaffAuditLogAPI');

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET','POST','PUT','DELETE','PATCH']);
  }

  const { staffId } = req.query;

  if (!staffId || typeof staffId !== 'string') {
    return apiResponse.error(res, ErrorCode.BAD_REQUEST, 'Missing or invalid parameters');
  }

  try {
    const limit = parseInt(req.query.limit as string) || 50;
    const offset = parseInt(req.query.offset as string) || 0;
    const actionTypes = req.query.actionTypes
      ? (req.query.actionTypes as string).split(',')
      : undefined;

    const result = await getAuditLog(staffId, {
      limit,
      offset,
      actionTypes: actionTypes as any,
    });

    return apiResponse.success(res, {
      success: true,
      data: result,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to fetch audit log', { staffId, error: errorMessage });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
