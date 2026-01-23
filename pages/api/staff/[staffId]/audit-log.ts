/**
 * Staff Audit Log API
 * GET /api/staff/[staffId]/audit-log - Get audit trail for a staff member
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { getAuditLog } from '@/services/staff/staffAuditService';
import { createLogger } from '@/lib/logger';

const logger = createLogger('StaffAuditLogAPI');

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { staffId } = req.query;

  if (!staffId || typeof staffId !== 'string') {
    return res.status(400).json({ error: 'Staff ID is required' });
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

    return res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error('Failed to fetch audit log', { staffId, error: errorMessage });
    return res.status(500).json({ error: 'Failed to fetch audit log' });
  }
}
