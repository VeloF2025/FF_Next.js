/**
 * Single Wayleave Approval API
 * GET /api/projects/[projectId]/wayleaves/[approvalId] - Get single wayleave approval
 * PUT /api/projects/[projectId]/wayleaves/[approvalId] - Update wayleave approval
 * DELETE /api/projects/[projectId]/wayleaves/[approvalId] - Delete wayleave approval
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { sql } from '@/lib/neon';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { log } from '@/lib/logger';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { projectId, approvalId } = req.query;

  if (!projectId || typeof projectId !== 'string') {
    return apiResponse.badRequest(res, 'Project ID is required');
  }

  if (!approvalId || typeof approvalId !== 'string') {
    return apiResponse.badRequest(res, 'Approval ID is required');
  }

  switch (req.method) {
    case 'GET':
      return handleGet(res, projectId, approvalId);
    case 'PUT':
      return handlePut(req as AuthenticatedNextApiRequest, res, projectId, approvalId);
    case 'DELETE':
      return handleDelete(req as AuthenticatedNextApiRequest, res, projectId, approvalId);
    default:
      return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'PUT', 'DELETE']);
  }
}

/**
 * GET /api/projects/[projectId]/wayleaves/[approvalId]
 * Get single wayleave approval with type info
 */
async function handleGet(res: NextApiResponse, projectId: string, approvalId: string) {
  try {
    // Verify project exists and get pipeline link
    const projectResult = await sql`
      SELECT id, pipeline_project_id FROM projects WHERE id = ${projectId}
    `;

    if (projectResult.length === 0) {
      return apiResponse.notFound(res, 'Project', projectId);
    }

    const project = projectResult[0] as { id: string; pipeline_project_id: string | null };

    if (!project.pipeline_project_id) {
      return apiResponse.badRequest(res, 'Project does not have a pipeline link');
    }

    // Fetch approval with type info
    const result = await sql`
      SELECT
        a.*,
        t.code AS approval_type_code,
        t.name AS approval_type_name,
        t.category AS approval_type_category,
        COALESCE(t.is_compulsory, false) AS approval_type_is_compulsory,
        t.condition_type AS approval_type_condition_type
      FROM pipeline_project_approvals a
      JOIN pipeline_approval_types t ON a.approval_type_id = t.id
      WHERE a.id = ${approvalId}
        AND a.pipeline_project_id = ${project.pipeline_project_id}
        AND t.category = 'wayleave'
    `;

    if (result.length === 0) {
      return apiResponse.notFound(res, 'Wayleave approval', approvalId);
    }

    return apiResponse.success(res, result[0]);
  } catch (error) {
    log.error('Failed to fetch wayleave approval', { projectId, approvalId, error }, 'wayleaves-api');
    return apiResponse.databaseError(res, error, 'Failed to fetch wayleave approval');
  }
}

/**
 * PUT /api/projects/[projectId]/wayleaves/[approvalId]
 * Update wayleave approval
 */
async function handlePut(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse,
  projectId: string,
  approvalId: string
) {
  try {
    const userName = req.user?.name || req.user?.id || 'unknown';
    const input = req.body;

    // Verify project exists and get pipeline link
    const projectResult = await sql`
      SELECT id, pipeline_project_id FROM projects WHERE id = ${projectId}
    `;

    if (projectResult.length === 0) {
      return apiResponse.notFound(res, 'Project', projectId);
    }

    const project = projectResult[0] as { id: string; pipeline_project_id: string | null };

    if (!project.pipeline_project_id) {
      return apiResponse.badRequest(res, 'Project does not have a pipeline link');
    }

    // Verify approval exists and belongs to this project
    const existing = await sql`
      SELECT a.id
      FROM pipeline_project_approvals a
      JOIN pipeline_approval_types t ON a.approval_type_id = t.id
      WHERE a.id = ${approvalId}
        AND a.pipeline_project_id = ${project.pipeline_project_id}
        AND t.category = 'wayleave'
    `;

    if (existing.length === 0) {
      return apiResponse.notFound(res, 'Wayleave approval', approvalId);
    }

    // Build update query with only provided fields
    const updateFields: string[] = [];
    const values: unknown[] = [];
    let paramIdx = 1;

    const addField = (field: string, value: unknown) => {
      if (value !== undefined) {
        updateFields.push(`${field} = $${paramIdx}`);
        values.push(value);
        paramIdx++;
      }
    };

    addField('status', input.status);
    addField('is_required', input.is_required);
    addField('application_date', input.application_date);
    addField('application_reference', input.application_reference);
    addField('application_document_url', input.application_document_url);
    addField('authority_name', input.authority_name);
    addField('authority_contact_name', input.authority_contact_name);
    addField('authority_contact_email', input.authority_contact_email);
    addField('authority_contact_phone', input.authority_contact_phone);
    addField('authority_address', input.authority_address);
    addField('assigned_officer', input.assigned_officer);
    addField('next_followup_date', input.next_followup_date);
    addField('followup_notes', input.followup_notes);
    addField('approval_date', input.approval_date);
    addField('approval_reference', input.approval_reference);
    addField('approval_document_url', input.approval_document_url);
    addField('issue_date', input.issue_date);
    addField('expiry_date', input.expiry_date);
    addField('application_fee', input.application_fee);
    addField('fee_paid', input.fee_paid);
    addField('fee_paid_date', input.fee_paid_date);
    addField('fee_receipt_reference', input.fee_receipt_reference);
    addField('fee_receipt_url', input.fee_receipt_url);
    addField('coverage_description', input.coverage_description);
    addField('conditions', input.conditions);
    addField('notes', input.notes);

    if (input.affected_coordinates !== undefined) {
      addField('affected_coordinates', input.affected_coordinates ? JSON.stringify(input.affected_coordinates) : null);
    }

    if (updateFields.length === 0) {
      return apiResponse.badRequest(res, 'No fields to update');
    }

    // Add updated_at and updated_by
    updateFields.push(`updated_at = NOW()`);
    updateFields.push(`updated_by = $${paramIdx}`);
    values.push(userName);
    paramIdx++;

    // Add WHERE clause
    values.push(approvalId);

    const query = `
      UPDATE pipeline_project_approvals
      SET ${updateFields.join(', ')}
      WHERE id = $${paramIdx}
      RETURNING *
    `;

    await sql.query(query, values);

    // Fetch updated with type info
    const result = await sql`
      SELECT
        a.*,
        t.code AS approval_type_code,
        t.name AS approval_type_name,
        t.category AS approval_type_category,
        COALESCE(t.is_compulsory, false) AS approval_type_is_compulsory,
        t.condition_type AS approval_type_condition_type
      FROM pipeline_project_approvals a
      JOIN pipeline_approval_types t ON a.approval_type_id = t.id
      WHERE a.id = ${approvalId}
    `;

    log.info('Updated wayleave approval', {
      projectId,
      approvalId,
      updatedBy: userName,
    }, 'wayleaves-api');

    return apiResponse.success(res, result[0], 'Wayleave approval updated successfully');
  } catch (error) {
    log.error('Failed to update wayleave approval', { projectId, approvalId, error }, 'wayleaves-api');
    return apiResponse.databaseError(res, error, 'Failed to update wayleave approval');
  }
}

/**
 * DELETE /api/projects/[projectId]/wayleaves/[approvalId]
 * Delete wayleave approval
 */
async function handleDelete(
  req: AuthenticatedNextApiRequest,
  res: NextApiResponse,
  projectId: string,
  approvalId: string
) {
  try {
    const userName = req.user?.name || req.user?.id || 'unknown';

    // Verify project exists and get pipeline link
    const projectResult = await sql`
      SELECT id, pipeline_project_id FROM projects WHERE id = ${projectId}
    `;

    if (projectResult.length === 0) {
      return apiResponse.notFound(res, 'Project', projectId);
    }

    const project = projectResult[0] as { id: string; pipeline_project_id: string | null };

    if (!project.pipeline_project_id) {
      return apiResponse.badRequest(res, 'Project does not have a pipeline link');
    }

    // Verify approval exists and belongs to this project
    const existing = await sql`
      SELECT a.id, t.is_compulsory
      FROM pipeline_project_approvals a
      JOIN pipeline_approval_types t ON a.approval_type_id = t.id
      WHERE a.id = ${approvalId}
        AND a.pipeline_project_id = ${project.pipeline_project_id}
        AND t.category = 'wayleave'
    `;

    if (existing.length === 0) {
      return apiResponse.notFound(res, 'Wayleave approval', approvalId);
    }

    const approval = existing[0] as { id: string; is_compulsory: boolean };

    if (approval.is_compulsory) {
      return apiResponse.badRequest(res, 'Cannot delete compulsory wayleave approvals');
    }

    // Delete the approval
    await sql`
      DELETE FROM pipeline_project_approvals
      WHERE id = ${approvalId}
    `;

    log.info('Deleted wayleave approval', {
      projectId,
      approvalId,
      deletedBy: userName,
    }, 'wayleaves-api');

    return apiResponse.success(res, { deleted: true }, 'Wayleave approval deleted successfully');
  } catch (error) {
    log.error('Failed to delete wayleave approval', { projectId, approvalId, error }, 'wayleaves-api');
    return apiResponse.databaseError(res, error, 'Failed to delete wayleave approval');
  }
}

export default withAuth(withErrorHandler(handler));
