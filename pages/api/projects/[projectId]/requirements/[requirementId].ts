/**
 * Project Requirement API - Single Requirement Operations
 * GET /api/projects/[projectId]/requirements/[requirementId] - Get requirement
 * PATCH /api/projects/[projectId]/requirements/[requirementId] - Update requirement
 * DELETE /api/projects/[projectId]/requirements/[requirementId] - Delete requirement
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { createLoggedSql } from '@/lib/db-logger';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import type { ProjectRequirement } from './index';

const sql = createLoggedSql(process.env.DATABASE_URL!);

export default withAuth(withErrorHandler(async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  const userId = (req as AuthenticatedNextApiRequest).user.id;
  const userName = (req as AuthenticatedNextApiRequest).user.name || userId;
  const projectId = req.query.projectId as string;
  const requirementId = req.query.requirementId as string;

  if (!projectId) {
    return apiResponse.badRequest(res, 'Project ID is required');
  }
  if (!requirementId) {
    return apiResponse.badRequest(res, 'Requirement ID is required');
  }

  // GET - Get single requirement
  if (req.method === 'GET') {
    try {
      const result = await sql`
        SELECT *
        FROM project_requirements
        WHERE id = ${requirementId}
        AND project_id = ${projectId}
      `;

      if (result.length === 0 || !result[0]) {
        return apiResponse.notFound(res, 'Requirement', requirementId);
      }

      return apiResponse.success(res, {
        requirement: transformRequirement(result[0] as Record<string, unknown>),
      });
    } catch (error) {
      log.error('Failed to fetch requirement', { projectId, requirementId, error });
      return apiResponse.databaseError(res, error, 'Failed to fetch requirement');
    }
  }

  // PATCH - Update requirement
  if (req.method === 'PATCH') {
    try {
      const {
        isCompleted,
        requirementName,
        description,
        documentUrl,
        expiryDate,
        sortOrder,
      } = req.body;

      // Check requirement exists
      const existing = await sql`
        SELECT * FROM project_requirements
        WHERE id = ${requirementId}
        AND project_id = ${projectId}
      `;

      if (existing.length === 0 || !existing[0]) {
        return apiResponse.notFound(res, 'Requirement', requirementId);
      }

      const current = existing[0] as Record<string, unknown>;

      // Build update fields
      const updates: Record<string, unknown> = {};
      const completionChange = typeof isCompleted === 'boolean' && isCompleted !== current.is_completed;

      if (typeof isCompleted === 'boolean') {
        updates.is_completed = isCompleted;
        if (isCompleted && !current.is_completed) {
          updates.completed_at = new Date().toISOString();
          updates.completed_by = userName;
        } else if (!isCompleted && current.is_completed) {
          updates.completed_at = null;
          updates.completed_by = null;
        }
      }

      if (requirementName !== undefined) {
        updates.requirement_name = requirementName;
      }
      if (description !== undefined) {
        updates.description = description;
      }
      if (documentUrl !== undefined) {
        updates.document_url = documentUrl;
      }
      if (expiryDate !== undefined) {
        updates.expiry_date = expiryDate;
      }
      if (sortOrder !== undefined) {
        updates.sort_order = sortOrder;
      }

      if (Object.keys(updates).length === 0) {
        return apiResponse.badRequest(res, 'No valid fields to update');
      }

      // Update requirement
      const result = await sql`
        UPDATE project_requirements SET
          is_completed = COALESCE(${updates.is_completed ?? null}, is_completed),
          completed_at = ${updates.completed_at !== undefined ? updates.completed_at : sql`completed_at`},
          completed_by = ${updates.completed_by !== undefined ? updates.completed_by : sql`completed_by`},
          requirement_name = COALESCE(${updates.requirement_name ?? null}, requirement_name),
          description = ${updates.description !== undefined ? updates.description : sql`description`},
          document_url = ${updates.document_url !== undefined ? updates.document_url : sql`document_url`},
          expiry_date = ${updates.expiry_date !== undefined ? updates.expiry_date : sql`expiry_date`},
          sort_order = COALESCE(${updates.sort_order ?? null}, sort_order),
          updated_at = NOW()
        WHERE id = ${requirementId}
        AND project_id = ${projectId}
        RETURNING *
      `;

      const updated = result[0] as Record<string, unknown> | undefined;

      if (!updated) {
        return apiResponse.internalError(res, new Error('Failed to update requirement'));
      }

      if (completionChange) {
        log.info('Requirement completion changed', {
          projectId,
          requirementId,
          requirementType: current.requirement_type,
          isCompleted: updates.is_completed,
          updatedBy: userName,
        });
      }

      return apiResponse.success(res, {
        requirement: transformRequirement(updated),
      }, 'Requirement updated successfully');
    } catch (error) {
      log.error('Failed to update requirement', { projectId, requirementId, error });
      return apiResponse.databaseError(res, error, 'Failed to update requirement');
    }
  }

  // DELETE - Delete requirement (only custom requirements)
  if (req.method === 'DELETE') {
    try {
      // Check if it's a system requirement (seeded by default)
      const existing = await sql`
        SELECT * FROM project_requirements
        WHERE id = ${requirementId}
        AND project_id = ${projectId}
      `;

      if (existing.length === 0 || !existing[0]) {
        return apiResponse.notFound(res, 'Requirement', requirementId);
      }

      const requirement = existing[0] as Record<string, unknown>;

      // List of system requirement types that cannot be deleted
      const systemTypes = [
        'wayleave', 'permit', 'client_agreement', 'feasibility', 'documentation',
        'client_po', 'boq_approved', 'contractor_appointed', 'sow_signed', 'mba_signed',
        'budget_approved', 'hs_verified', 'team_assigned',
        'drops_complete', 'qa_passed',
        'final_inspection', 'client_handover',
      ];

      if (systemTypes.includes(requirement.requirement_type as string)) {
        return apiResponse.forbidden(res, 'System requirements cannot be deleted');
      }

      await sql`
        DELETE FROM project_requirements
        WHERE id = ${requirementId}
        AND project_id = ${projectId}
      `;

      log.info('Custom requirement deleted', {
        projectId,
        requirementId,
        requirementType: requirement.requirement_type as string,
        deletedBy: userName,
      });

      return apiResponse.success(res, null, 'Requirement deleted successfully');
    } catch (error) {
      log.error('Failed to delete requirement', { projectId, requirementId, error });
      return apiResponse.databaseError(res, error, 'Failed to delete requirement');
    }
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'PATCH', 'DELETE']);
}));

function transformRequirement(row: Record<string, unknown>): ProjectRequirement {
  return {
    id: row.id as string,
    projectId: row.project_id as string,
    requirementType: row.requirement_type as string,
    requirementName: row.requirement_name as string,
    description: row.description as string | null,
    isCompleted: row.is_completed as boolean,
    completedAt: row.completed_at as string | null,
    completedBy: row.completed_by as string | null,
    documentId: row.document_id as string | null,
    documentUrl: row.document_url as string | null,
    expiryDate: row.expiry_date as string | null,
    expiryAlertSent: row.expiry_alert_sent as boolean,
    stage: row.stage as ProjectRequirement['stage'],
    sortOrder: row.sort_order as number,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}
