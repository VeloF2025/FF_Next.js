/**
 * Recovery Approval API
 *
 * GET  /api/system/approve-recovery - Get pending approvals
 * POST /api/system/approve-recovery - Approve or reject action
 *
 * NOTE: Works with the Python AI Recovery Agent on Velocity server.
 * Approval decisions are written to the database and picked up by the daemon.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, withRole, getSession } from '@/lib/auth';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { withErrorHandler } from '@/lib/api-error-handler';
import { log } from '@/lib/logger';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  switch (req.method) {
    case 'GET':
      return getPending(req, res);
    case 'POST':
      return processDecision(req, res);
    default:
      return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
  }
}

async function getPending(req: NextApiRequest, res: NextApiResponse) {
  const module = await import('@/lib/db');
  const db = module.db || module.default;
  if (!db) {
    return apiResponse.error(res, ErrorCode.DATABASE_ERROR, 'Database not available');
  }

  const { status, riskLevel } = req.query;

  let query = `
    SELECT
      q.id,
      q.incident_id,
      q.action_id,
      q.approval_token as token,
      q.status,
      q.requested_at,
      q.token_expires_at as expires_at,
      q.decided_at,
      q.decided_by,
      a.action_name,
      a.risk_level,
      a.command_template,
      s.name as service_name,
      i.error_message as reason,
      i.root_cause
    FROM recovery_approval_queue q
    JOIN recovery_actions a ON q.action_id = a.id
    JOIN infrastructure_services s ON a.service_id = s.id
    LEFT JOIN infrastructure_incidents i ON q.incident_id = i.id
    WHERE 1=1
  `;
  const params: string[] = [];

  if (status) {
    params.push(status as string);
    query += ` AND q.status = $${params.length}`;
  } else {
    query += ` AND q.status = 'pending'`;
  }

  if (riskLevel) {
    params.push(riskLevel as string);
    query += ` AND a.risk_level = $${params.length}`;
  }

  query += ` ORDER BY q.requested_at DESC LIMIT 50`;

  const result = await db.query(query, params);
  const pending = Array.isArray(result) ? result : result?.rows || [];

  // Count pending
  const countResult = await db.query(`
    SELECT COUNT(*) as count FROM recovery_approval_queue WHERE status = 'pending'
  `);
  const countRow = Array.isArray(countResult) ? countResult[0] : countResult?.rows?.[0];

  return apiResponse.success(res, {
    pending: pending.map((row: Record<string, unknown>) => ({
      id: row.id,
      incidentId: row.incident_id,
      actionId: row.action_id,
      token: row.token,
      status: row.status,
      actionName: row.action_name,
      serviceName: row.service_name,
      riskLevel: row.risk_level,
      reason: row.reason,
      rootCause: row.root_cause,
      requestedAt: row.requested_at,
      expiresAt: row.expires_at,
      decidedAt: row.decided_at,
      decidedBy: row.decided_by,
    })),
    pendingCount: parseInt(countRow?.count || '0', 10),
  });
}

async function processDecision(req: NextApiRequest, res: NextApiResponse) {
  const module = await import('@/lib/db');
  const db = module.db || module.default;
  if (!db) {
    return apiResponse.error(res, ErrorCode.DATABASE_ERROR, 'Database not available');
  }

  // Support both old (pendingId, action) and new (queueId, approved) formats
  const pendingId = req.body.pendingId || req.body.queueId;
  const action = req.body.action || (req.body.approved ? 'approve' : 'reject');
  const { reason } = req.body;
  const session = await getSession(req, res);

  if (!pendingId) {
    return apiResponse.badRequest(res, 'Pending ID is required');
  }

  if (!action || !['approve', 'reject'].includes(action)) {
    return apiResponse.badRequest(res, 'Action must be "approve" or "reject"');
  }

  const decidedBy = (session as unknown as { user?: { id?: string } } | null)?.user?.id || req.body.decidedBy || 'dashboard';
  const newStatus = action === 'approve' ? 'approved' : 'rejected';

  try {
    // Update the approval queue - the Python daemon will pick this up
    const result = await db.query(
      `UPDATE recovery_approval_queue
       SET status = $1, decided_at = NOW(), decided_by = $2
       WHERE id = $3::uuid AND status = 'pending'
       RETURNING id, action_id`,
      [newStatus, decidedBy, pendingId]
    );

    const updated = Array.isArray(result) ? result[0] : result?.rows?.[0];

    if (!updated) {
      return apiResponse.notFound(res, 'Approval item', pendingId);
    }

    log.info(`Recovery action ${newStatus}`, {
      queueId: pendingId,
      actionId: updated.action_id,
      decidedBy,
    });

    return apiResponse.success(res, {
      [action === 'approve' ? 'approved' : 'rejected']: true,
      queueId: pendingId,
      status: newStatus,
      reason,
    });
  } catch (err) {
    log.error('Failed to process approval decision', { error: err, pendingId });
    return apiResponse.error(res, ErrorCode.INTERNAL_ERROR, 'Failed to process decision');
  }
}

export default withAuth(withRole('super_admin')(withErrorHandler(handler)));
