/**
 * Pipeline Project Transition API
 * POST /api/pipeline/projects/[id]/transition - Transition pipeline project to planned (create in Projects table)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { createLoggedSql } from '@/lib/db-logger';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';

const sql = createLoggedSql(process.env.DATABASE_URL!);

export interface TransitionInput {
  projectManagerId?: string;
  startDate?: string;
  endDate?: string;
  budget?: number;
  notes?: string;
}

export interface TransitionResult {
  pipelineProject: {
    id: string;
    projectName: string;
    pipelineStatus: string;
  };
  project: {
    id: string;
    projectCode: string;
    projectName: string;
    status: string;
  };
  transitionedAt: string;
}

export default withAuth(withErrorHandler(async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  const userId = (req as AuthenticatedNextApiRequest).user.id;
  const userName = (req as AuthenticatedNextApiRequest).user.name || userId;
  const pipelineProjectId = req.query.id as string;

  if (!pipelineProjectId) {
    return apiResponse.badRequest(res, 'Pipeline project ID is required');
  }

  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  const input = req.body as TransitionInput;

  try {
    // 1. Get the pipeline project
    const pipelineProject = await sql`
      SELECT *
      FROM pipeline_projects
      WHERE id = ${pipelineProjectId}
      AND is_deleted = false
    `;

    if (pipelineProject.length === 0 || !pipelineProject[0]) {
      return apiResponse.notFound(res, 'Pipeline project', pipelineProjectId);
    }

    const pp = pipelineProject[0] as Record<string, unknown>;

    // 2. Check if already transitioned
    if (pp.planned_project_id) {
      return apiResponse.conflict(res, 'Pipeline project has already been transitioned to a planned project');
    }

    // 3. Check if in ready_to_plan status
    if (pp.pipeline_status !== 'ready_to_plan') {
      return apiResponse.badRequest(
        res,
        `Project must be in 'ready_to_plan' status to transition. Current status: ${pp.pipeline_status}`
      );
    }

    // 4. Generate project code if not exists
    let projectCode = pp.project_code;
    if (!projectCode) {
      const codeResult = await sql`
        SELECT 'PRJ-' || TO_CHAR(CURRENT_DATE, 'YYMM') || '-' || LPAD(
          (COALESCE(
            (SELECT MAX(CAST(SUBSTRING(project_code FROM 10) AS INTEGER))
             FROM projects
             WHERE project_code LIKE 'PRJ-' || TO_CHAR(CURRENT_DATE, 'YYMM') || '-%'),
            0
          ) + 1)::TEXT, 4, '0'
        ) as code
      `;
      projectCode = codeResult[0]?.code || `PRJ-${Date.now()}`;
    }

    // 5. Create project in projects table
    const newProject = await sql`
      INSERT INTO projects (
        project_code,
        project_name,
        description,
        project_type,
        status,
        priority,
        client_id,
        project_manager,
        location,
        latitude,
        longitude,
        budget,
        start_date,
        end_date,
        created_at,
        updated_at
      ) VALUES (
        ${projectCode},
        ${pp.project_name},
        ${pp.description || input.notes || null},
        ${pp.project_type || 'greenfield'},
        'planning',
        ${pp.priority || 'medium'},
        ${pp.client_id},
        ${input.projectManagerId || pp.project_manager_id || null},
        ${[pp.area, pp.municipality, pp.province].filter(Boolean).join(', ') || pp.address || null},
        ${(pp.coordinates as { lat?: number } | null)?.lat || null},
        ${(pp.coordinates as { lng?: number } | null)?.lng || null},
        ${input.budget || pp.estimated_value || null},
        ${input.startDate || pp.target_start_date || null},
        ${input.endDate || pp.target_completion_date || null},
        NOW(),
        NOW()
      )
      RETURNING *
    `;

    if (newProject.length === 0 || !newProject[0]) {
      return apiResponse.internalError(res, new Error('Failed to create project'));
    }

    const project = newProject[0] as Record<string, unknown>;

    // 6. Update pipeline project with link
    await sql`
      UPDATE pipeline_projects SET
        pipeline_status = 'planned',
        planned_project_id = ${project.id},
        transitioned_at = NOW(),
        transitioned_by = ${userName},
        updated_at = NOW(),
        updated_by = ${userName}
      WHERE id = ${pipelineProjectId}
    `;

    // 6b. Set bidirectional link on project
    await sql`
      UPDATE projects
      SET pipeline_project_id = ${pipelineProjectId}
      WHERE id = ${project.id}
    `;

    // 7. Seed project requirements
    await sql`SELECT seed_project_requirements(${project.id}::uuid)`;

    // 8. Copy wayleave approvals to project requirements if they have expiry dates
    await sql`
      UPDATE project_requirements pr
      SET
        is_completed = CASE
          WHEN ppa.status IN ('approved', 'conditionally_approved', 'renewed') THEN true
          ELSE false
        END,
        completed_at = CASE
          WHEN ppa.status IN ('approved', 'conditionally_approved', 'renewed') THEN ppa.approved_date
          ELSE NULL
        END,
        expiry_date = ppa.expiry_date,
        document_url = ppa.document_url
      FROM pipeline_project_approvals ppa
      JOIN pipeline_approval_types pat ON pat.id = ppa.approval_type_id
      WHERE pr.project_id = ${project.id}
      AND pr.requirement_type = 'wayleave'
      AND ppa.pipeline_project_id = ${pipelineProjectId}
      AND pat.category = 'wayleave'
    `;

    // 9. Log the transition
    log.info('Pipeline project transitioned to planned', {
      pipelineProjectId,
      projectId: project.id,
      projectCode,
      transitionedBy: userName,
    });

    const result: TransitionResult = {
      pipelineProject: {
        id: pipelineProjectId,
        projectName: pp.project_name as string,
        pipelineStatus: 'planned',
      },
      project: {
        id: project.id as string,
        projectCode: project.project_code as string,
        projectName: project.project_name as string,
        status: 'planning',
      },
      transitionedAt: new Date().toISOString(),
    };

    return apiResponse.success(res, result, 'Pipeline project transitioned to planned successfully');
  } catch (error) {
    log.error('Failed to transition pipeline project', { pipelineProjectId, error });
    return apiResponse.databaseError(res, error, 'Failed to transition pipeline project');
  }
}));
