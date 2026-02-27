/**
 * Procurement Approval Workflows Settings API
 *
 * GET: Returns all approval workflows with their levels
 * PUT: Updates workflow settings and approval levels
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth } from '@/lib/auth';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return handleGet(res);
  }

  if (req.method === 'PUT') {
    return handlePut(req, res);
  }

  return apiResponse.methodNotAllowed(res, req.method!, ['GET', 'PUT']);
}

async function handleGet(res: NextApiResponse) {
  try {
    // Get all workflows with their levels
    const workflows = await sql`
      SELECT
        aw.id,
        aw.workflow_type,
        aw.name,
        aw.description,
        aw.is_active,
        aw.escalation_enabled,
        aw.escalation_hours,
        aw.escalation_to
      FROM approval_workflows aw
      ORDER BY aw.workflow_type
    `;

    // Get all levels with optional user info
    const levels = await sql`
      SELECT
        al.id,
        al.workflow_id,
        al.level_number,
        al.name,
        al.description,
        al.min_amount,
        al.max_amount,
        al.approver_type,
        al.approver_user_id,
        al.approver_role,
        al.auto_approve,
        al.can_delegate,
        al.is_required,
        u.first_name || ' ' || u.last_name as approver_name,
        u.email as approver_email
      FROM approval_levels al
      LEFT JOIN users u ON al.approver_user_id::uuid = u.id
      ORDER BY al.workflow_id, al.level_number
    `;

    // Get available users for approver assignment
    const users = await sql`
      SELECT id, first_name, last_name, email, role
      FROM users
      WHERE is_active = true AND role IN ('admin', 'super_admin', 'manager')
      ORDER BY first_name, last_name
    `;

    // Get approval stats
    const stats = await sql`
      SELECT
        ar.document_type,
        COUNT(*)::int as total,
        COUNT(CASE WHEN ar.status = 'pending' THEN 1 END)::int as pending,
        COUNT(CASE WHEN ar.status = 'approved' THEN 1 END)::int as approved,
        COUNT(CASE WHEN ar.status = 'rejected' THEN 1 END)::int as rejected
      FROM approval_requests ar
      GROUP BY ar.document_type
    `;

    // Group levels by workflow
    const workflowsWithLevels = workflows.map((wf: Record<string, unknown>) => ({
      id: wf.id,
      workflowType: wf.workflow_type,
      name: wf.name,
      description: wf.description,
      isActive: wf.is_active,
      escalationEnabled: wf.escalation_enabled,
      escalationHours: wf.escalation_hours,
      escalationTo: wf.escalation_to,
      levels: levels
        .filter((l: Record<string, unknown>) => l.workflow_id === wf.id)
        .map((l: Record<string, unknown>) => ({
          id: l.id,
          levelNumber: l.level_number,
          name: l.name,
          description: l.description,
          minAmount: parseFloat(l.min_amount as string) || 0,
          maxAmount: l.max_amount ? parseFloat(l.max_amount as string) : null,
          approverType: l.approver_type,
          approverUserId: l.approver_user_id,
          approverRole: l.approver_role,
          approverName: l.approver_name,
          approverEmail: l.approver_email,
          autoApprove: l.auto_approve,
          canDelegate: l.can_delegate,
          isRequired: l.is_required,
        })),
    }));

    return apiResponse.success(res, {
      workflows: workflowsWithLevels,
      availableUsers: users.map((u: Record<string, unknown>) => ({
        id: u.id,
        name: `${u.first_name} ${u.last_name}`,
        email: u.email,
        role: u.role,
      })),
      availableRoles: ['admin', 'super_admin', 'manager'],
      stats: stats.map((s: Record<string, unknown>) => ({
        documentType: s.document_type,
        total: s.total,
        pending: s.pending,
        approved: s.approved,
        rejected: s.rejected,
      })),
    });
  } catch (error) {
    log.error('Failed to fetch procurement workflows', { error });
    return apiResponse.databaseError(res, error, 'Failed to fetch workflows');
  }
}

async function handlePut(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { workflowId, updates } = req.body;

    if (!workflowId) {
      return apiResponse.badRequest(res, 'workflowId is required');
    }

    // Update workflow settings
    if (updates.isActive !== undefined || updates.escalationEnabled !== undefined) {
      await sql`
        UPDATE approval_workflows
        SET
          is_active = COALESCE(${updates.isActive ?? null}, is_active),
          escalation_enabled = COALESCE(${updates.escalationEnabled ?? null}, escalation_enabled),
          escalation_hours = COALESCE(${updates.escalationHours ?? null}, escalation_hours),
          updated_at = NOW()
        WHERE id = ${workflowId}
      `;
    }

    // Update approval levels
    if (updates.levels && Array.isArray(updates.levels)) {
      for (const level of updates.levels) {
        if (level.id) {
          // Update existing level
          await sql`
            UPDATE approval_levels
            SET
              name = COALESCE(${level.name ?? null}, name),
              min_amount = COALESCE(${level.minAmount ?? null}, min_amount),
              max_amount = ${level.maxAmount ?? null},
              approver_type = COALESCE(${level.approverType ?? null}, approver_type),
              approver_user_id = ${level.approverUserId ?? null},
              approver_role = ${level.approverRole ?? null},
              auto_approve = COALESCE(${level.autoApprove ?? null}, auto_approve)
            WHERE id = ${level.id}
          `;
        } else {
          // Insert new level
          const maxLevel = await sql`
            SELECT COALESCE(MAX(level_number), 0) + 1 as next_level
            FROM approval_levels
            WHERE workflow_id = ${workflowId}
          `;
          const nextLevel = maxLevel[0]?.next_level || 1;

          await sql`
            INSERT INTO approval_levels (
              workflow_id, level_number, name, min_amount, max_amount,
              approver_type, approver_user_id, approver_role, auto_approve
            ) VALUES (
              ${workflowId}, ${nextLevel}, ${level.name},
              ${level.minAmount || 0}, ${level.maxAmount ?? null},
              ${level.approverType || 'role'}, ${level.approverUserId ?? null},
              ${level.approverRole ?? null}, ${level.autoApprove || false}
            )
          `;
        }
      }
    }

    // Delete removed levels
    if (updates.deletedLevelIds && Array.isArray(updates.deletedLevelIds)) {
      for (const levelId of updates.deletedLevelIds) {
        await sql`DELETE FROM approval_levels WHERE id = ${levelId}`;
      }
    }

    log.info('Procurement workflow updated', { workflowId });
    return apiResponse.success(res, { message: 'Workflow updated successfully' });
  } catch (error) {
    log.error('Failed to update procurement workflow', { error });
    return apiResponse.databaseError(res, error, 'Failed to update workflow');
  }
}

export default withAuth(handler);
