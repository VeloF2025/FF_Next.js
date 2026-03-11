/**
 * GET/POST /api/qfield/qa-assignments
 * Manage QA photo assignments
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, AuthenticatedRequest } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method === 'GET') {
    return handleGet(req, res);
  } else if (req.method === 'POST') {
    return handlePost(req, res);
  }

  return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['GET', 'POST']);
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { assignee, validationId, pending } = req.query;

    let assignments;
    if (validationId) {
      // Get assignment history for a specific validation
      assignments = await sql`
        SELECT
          a.*,
          v.photo_key,
          v.work_type,
          v.workflow_status
        FROM qfield_qa_assignments a
        JOIN qfield_photo_validations v ON a.validation_id = v.id
        WHERE a.validation_id = ${validationId}::uuid
        ORDER BY a.assigned_at DESC
      `;
    } else if (assignee) {
      // Get assignments for a specific user
      const pendingOnly = pending === 'true';
      if (pendingOnly) {
        assignments = await sql`
          SELECT
            a.*,
            v.photo_key,
            v.work_type,
            v.workflow_status,
            v.vlm_confidence,
            v.priority
          FROM qfield_qa_assignments a
          JOIN qfield_photo_validations v ON a.validation_id = v.id
          WHERE a.assigned_to = ${assignee}
            AND a.completed_at IS NULL
            AND v.workflow_status IN ('pending', 'in_review')
          ORDER BY
            CASE v.priority
              WHEN 'urgent' THEN 1
              WHEN 'high' THEN 2
              WHEN 'normal' THEN 3
              WHEN 'low' THEN 4
            END,
            a.due_date ASC NULLS LAST
        `;
      } else {
        assignments = await sql`
          SELECT
            a.*,
            v.photo_key,
            v.work_type,
            v.workflow_status,
            v.vlm_confidence
          FROM qfield_qa_assignments a
          JOIN qfield_photo_validations v ON a.validation_id = v.id
          WHERE a.assigned_to = ${assignee}
          ORDER BY a.assigned_at DESC
          LIMIT 100
        `;
      }
    } else {
      // Get recent assignments (for admin view)
      assignments = await sql`
        SELECT
          a.*,
          v.photo_key,
          v.work_type,
          v.workflow_status
        FROM qfield_qa_assignments a
        JOIN qfield_photo_validations v ON a.validation_id = v.id
        ORDER BY a.assigned_at DESC
        LIMIT 50
      `;
    }

    return apiResponse.success(res, assignments);
  } catch (error) {
    log.error('qfield-qa-assignments', error instanceof Error ? { message: error.message } : { error }, 'Fetch failed');
    return apiResponse.databaseError(res, error);
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    const authReq = req as AuthenticatedRequest;
    const userId = authReq.user?.email || authReq.user?.username || 'unknown';

    const { validationIds, assignee, dueDate, priority, notes } = req.body;

    if (!validationIds?.length || !assignee) {
      return apiResponse.badRequest(res, 'validationIds and assignee required');
    }

    const results: Array<{ id: string; success: boolean; error?: string }> = [];

    for (const validationId of validationIds) {
      try {
        // Update validation record
        await sql`
          UPDATE qfield_photo_validations
          SET
            assigned_to = ${assignee},
            assigned_at = NOW(),
            due_date = ${dueDate || null}::timestamptz,
            priority = ${priority || 'normal'},
            workflow_status = 'in_review'
          WHERE id = ${validationId}::uuid
        `;

        // Create assignment record
        await sql`
          INSERT INTO qfield_qa_assignments (
            validation_id, assigned_to, assigned_by, due_date, priority, notes
          ) VALUES (
            ${validationId}::uuid, ${assignee}, ${userId},
            ${dueDate || null}::timestamptz, ${priority || 'normal'}, ${notes || null}
          )
        `;

        // Record action
        await sql`
          INSERT INTO qfield_qa_actions (
            validation_id, action_type, action_by, new_value, notes
          ) VALUES (
            ${validationId}::uuid,
            'assign',
            ${userId},
            ${JSON.stringify({ assigned_to: assignee, priority, due_date: dueDate })}::jsonb,
            ${notes || null}
          )
        `;

        results.push({ id: validationId, success: true });
      } catch (error) {
        log.error('QaAssignmentsApi', 'Operation failed', { error });
        results.push({
          id: validationId,
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    const successCount = results.filter(r => r.success).length;
    return apiResponse.success(res, {
      total: results.length,
      success: successCount,
      failed: results.length - successCount,
      results,
    }, `Assigned ${successCount}/${results.length} photos to ${assignee}`);
  } catch (error) {
    log.error('qfield-qa-assignments', error instanceof Error ? { message: error.message } : { error }, 'Assign failed');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
