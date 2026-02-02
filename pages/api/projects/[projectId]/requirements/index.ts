/**
 * Project Requirements API
 * GET /api/projects/[projectId]/requirements - List requirements (optionally filter by stage)
 * POST /api/projects/[projectId]/requirements - Create a custom requirement
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { createLoggedSql } from '@/lib/db-logger';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';

const sql = createLoggedSql(process.env.DATABASE_URL!);

export interface ProjectRequirement {
  id: string;
  projectId: string;
  requirementType: string;
  requirementName: string;
  description: string | null;
  isCompleted: boolean;
  completedAt: string | null;
  completedBy: string | null;
  documentId: string | null;
  documentUrl: string | null;
  expiryDate: string | null;
  expiryAlertSent: boolean;
  stage: 'pipeline' | 'planning' | 'execution' | 'closure';
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface RequirementsResponse {
  requirements: ProjectRequirement[];
  summary: {
    total: number;
    completed: number;
    pending: number;
    byStage: Record<string, { total: number; completed: number }>;
  };
}

export default withAuth(withErrorHandler(async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  const userId = (req as AuthenticatedNextApiRequest).user.id;
  const projectId = req.query.projectId as string;

  if (!projectId) {
    return apiResponse.badRequest(res, 'Project ID is required');
  }

  // GET - List requirements
  if (req.method === 'GET') {
    try {
      const stage = req.query.stage as string | undefined;
      const includeCompleted = req.query.includeCompleted !== 'false';

      // Build query based on filters
      let requirements;
      if (stage && !includeCompleted) {
        requirements = await sql`
          SELECT
            id, project_id, requirement_type, requirement_name, description,
            is_completed, completed_at, completed_by, document_id, document_url,
            expiry_date, expiry_alert_sent, stage, sort_order, created_at, updated_at
          FROM project_requirements
          WHERE project_id = ${projectId}
            AND stage = ${stage}
            AND is_completed = false
          ORDER BY sort_order, requirement_name
        `;
      } else if (stage) {
        requirements = await sql`
          SELECT
            id, project_id, requirement_type, requirement_name, description,
            is_completed, completed_at, completed_by, document_id, document_url,
            expiry_date, expiry_alert_sent, stage, sort_order, created_at, updated_at
          FROM project_requirements
          WHERE project_id = ${projectId}
            AND stage = ${stage}
          ORDER BY sort_order, requirement_name
        `;
      } else if (!includeCompleted) {
        requirements = await sql`
          SELECT
            id, project_id, requirement_type, requirement_name, description,
            is_completed, completed_at, completed_by, document_id, document_url,
            expiry_date, expiry_alert_sent, stage, sort_order, created_at, updated_at
          FROM project_requirements
          WHERE project_id = ${projectId}
            AND is_completed = false
          ORDER BY
            CASE stage WHEN 'pipeline' THEN 1 WHEN 'planning' THEN 2 WHEN 'execution' THEN 3 WHEN 'closure' THEN 4 END,
            sort_order, requirement_name
        `;
      } else {
        requirements = await sql`
          SELECT
            id, project_id, requirement_type, requirement_name, description,
            is_completed, completed_at, completed_by, document_id, document_url,
            expiry_date, expiry_alert_sent, stage, sort_order, created_at, updated_at
          FROM project_requirements
          WHERE project_id = ${projectId}
          ORDER BY
            CASE stage WHEN 'pipeline' THEN 1 WHEN 'planning' THEN 2 WHEN 'execution' THEN 3 WHEN 'closure' THEN 4 END,
            sort_order, requirement_name
        `;
      }

      // Calculate summary
      const allRequirements = stage ? requirements : await sql`
        SELECT stage, is_completed
        FROM project_requirements
        WHERE project_id = ${projectId}
      `;

      const byStage: Record<string, { total: number; completed: number }> = {};
      let total = 0;
      let completed = 0;

      for (const req of allRequirements) {
        const s = req.stage as string;
        if (!byStage[s]) {
          byStage[s] = { total: 0, completed: 0 };
        }
        byStage[s].total++;
        total++;
        if (req.is_completed) {
          byStage[s].completed++;
          completed++;
        }
      }

      const response: RequirementsResponse = {
        requirements: requirements.map(transformRequirement),
        summary: {
          total,
          completed,
          pending: total - completed,
          byStage,
        },
      };

      return apiResponse.success(res, response);
    } catch (error) {
      log.error('Failed to fetch project requirements', { projectId, error });
      return apiResponse.databaseError(res, error, 'Failed to fetch requirements');
    }
  }

  // POST - Create custom requirement
  if (req.method === 'POST') {
    try {
      const {
        requirementType,
        requirementName,
        description,
        stage,
        expiryDate,
        sortOrder,
      } = req.body;

      // Validation
      if (!requirementType) {
        return apiResponse.validationError(res, { requirementType: 'Requirement type is required' });
      }
      if (!requirementName) {
        return apiResponse.validationError(res, { requirementName: 'Requirement name is required' });
      }
      if (!stage || !['pipeline', 'planning', 'execution', 'closure'].includes(stage)) {
        return apiResponse.validationError(res, { stage: 'Valid stage is required' });
      }

      // Check for duplicate
      const existing = await sql`
        SELECT id FROM project_requirements
        WHERE project_id = ${projectId}
        AND requirement_type = ${requirementType}
        AND stage = ${stage}
      `;

      if (existing.length > 0) {
        return apiResponse.conflict(res, `Requirement type '${requirementType}' already exists for stage '${stage}'`);
      }

      // Get max sort order for this stage
      const maxSortResult = await sql`
        SELECT COALESCE(MAX(sort_order), 0) + 1 as next_sort
        FROM project_requirements
        WHERE project_id = ${projectId}
        AND stage = ${stage}
      `;
      const nextSort = sortOrder ?? maxSortResult[0]?.next_sort ?? 1;

      // Create requirement
      const result = await sql`
        INSERT INTO project_requirements (
          project_id,
          requirement_type,
          requirement_name,
          description,
          stage,
          expiry_date,
          sort_order
        ) VALUES (
          ${projectId},
          ${requirementType},
          ${requirementName},
          ${description || null},
          ${stage},
          ${expiryDate || null},
          ${nextSort}
        )
        RETURNING *
      `;

      const created = result[0] as Record<string, unknown> | undefined;

      if (!created) {
        return apiResponse.internalError(res, new Error('Failed to create requirement'));
      }

      log.info('Project requirement created', {
        projectId,
        requirementId: created.id,
        requirementType,
        stage,
        createdBy: userId,
      });

      return apiResponse.created(res, {
        requirement: transformRequirement(created),
      });
    } catch (error) {
      log.error('Failed to create project requirement', { projectId, error });
      return apiResponse.databaseError(res, error, 'Failed to create requirement');
    }
  }

  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
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
