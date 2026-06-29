import { query, queryOne } from '../utils/db';

export interface MaterializedProject {
  projectId: string;
  /** true when a new projects row was created, false when an existing one was reused */
  created: boolean;
}

interface PipelineRow {
  id: string;
  project_code: string | null;
  project_name: string;
  description: string | null;
  project_type: string | null;
  priority: string | null;
  client_id: string | null;
  project_manager_id: string | null;
  area: string | null;
  municipality: string | null;
  province: string | null;
  address: string | null;
  coordinates: { lat?: number; lng?: number } | null;
  estimated_value: number | null;
  target_start_date: string | null;
  target_completion_date: string | null;
  pipeline_status: string;
  planned_project_id: string | null;
}

/**
 * Resolve the real `projects` row for a pipeline project, creating and linking one
 * on demand (materialize-on-select for the Planning board). A planning_item must
 * reference projects(id) (NOT NULL FK), but most pipeline_projects have no project
 * row yet — this bridges that gap when a user creates a card for one.
 *
 * Hybrid behaviour:
 *  - Already linked (planned_project_id, or a project_pipeline_links row) → reuse it.
 *  - Not linked + pipeline_status = 'ready_to_plan' → full transition: create the
 *    project, link it, flip pipeline_status → 'planned', seed requirements, copy
 *    wayleave approvals (mirrors POST /api/pipeline/projects/[id]/transition, minus
 *    the auto Stage-0 card — the caller creates the user's own card).
 *  - Not linked + any other status → light materialize: create + link the project
 *    only, leaving the pipeline stage untouched so the pipeline dashboard stays accurate.
 */
export async function resolveOrCreateProjectForPipeline(
  pipelineProjectId: string,
  opts: { userId: string; userName: string },
): Promise<MaterializedProject> {
  const pp = await queryOne<PipelineRow>(
    `SELECT id, project_code, project_name, description, project_type, priority,
            client_id, project_manager_id, area, municipality, province, address,
            coordinates, estimated_value, target_start_date, target_completion_date,
            pipeline_status, planned_project_id
       FROM pipeline_projects
      WHERE id = $1 AND is_deleted = false`,
    [pipelineProjectId],
  );
  if (!pp) throw new Error(`Pipeline project ${pipelineProjectId} not found`);

  // 1. Already transitioned to a planned project
  if (pp.planned_project_id) return { projectId: pp.planned_project_id, created: false };

  // 2. Already linked via the junction table (prefer the primary link)
  const link = await queryOne<{ project_id: string }>(
    `SELECT project_id FROM project_pipeline_links
      WHERE pipeline_project_id = $1
      ORDER BY is_primary DESC, linked_at ASC
      LIMIT 1`,
    [pipelineProjectId],
  );
  if (link) return { projectId: link.project_id, created: false };

  // 3. Create a new project row (generate a code if the pipeline lacks one)
  let projectCode = pp.project_code;
  if (!projectCode) {
    const codeRow = await queryOne<{ code: string }>(
      `SELECT 'PRJ-' || TO_CHAR(CURRENT_DATE, 'YYMM') || '-' || LPAD(
         (COALESCE(
           (SELECT MAX(CAST(SUBSTRING(project_code FROM 10) AS INTEGER))
              FROM projects
             WHERE project_code LIKE 'PRJ-' || TO_CHAR(CURRENT_DATE, 'YYMM') || '-%'),
           0) + 1)::TEXT, 4, '0') AS code`,
    );
    projectCode = codeRow?.code ?? `PRJ-${pipelineProjectId.slice(0, 8)}`;
  }

  const location =
    [pp.area, pp.municipality, pp.province].filter(Boolean).join(', ') || pp.address || null;

  const newProject = await queryOne<{ id: string }>(
    `INSERT INTO projects (
       project_code, project_name, description, project_type, status, priority,
       client_id, project_manager, location, latitude, longitude, budget,
       start_date, end_date, pipeline_project_id, created_at, updated_at
     ) VALUES ($1,$2,$3,$4,'planning',$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW(),NOW())
     RETURNING id`,
    [
      projectCode,
      pp.project_name,
      pp.description,
      pp.project_type || 'greenfield',
      pp.priority || 'medium',
      pp.client_id,
      pp.project_manager_id,
      location,
      pp.coordinates?.lat ?? null,
      pp.coordinates?.lng ?? null,
      pp.estimated_value,
      pp.target_start_date,
      pp.target_completion_date,
      pipelineProjectId,
    ],
  );
  if (!newProject) throw new Error('Failed to create project for pipeline materialization');
  const projectId = newProject.id;

  // 4. Record the one-to-many link
  await query(
    `INSERT INTO project_pipeline_links (project_id, pipeline_project_id, is_primary, link_type, linked_by, linked_at)
     VALUES ($1, $2, true, 'planning', $3, NOW())
     ON CONFLICT (project_id, pipeline_project_id) DO NOTHING`,
    [projectId, pipelineProjectId, opts.userId],
  );

  // 5. Hybrid: only flip the pipeline stage + seed requirements when genuinely ready
  if (pp.pipeline_status === 'ready_to_plan') {
    await query(
      `UPDATE pipeline_projects
          SET pipeline_status = 'planned', planned_project_id = $2,
              transitioned_at = NOW(), transitioned_by = $3, updated_at = NOW(), updated_by = $3
        WHERE id = $1`,
      [pipelineProjectId, projectId, opts.userName],
    );
    await query(`SELECT seed_project_requirements($1::uuid)`, [projectId]);
    await query(
      `UPDATE project_requirements pr
          SET is_completed = CASE WHEN ppa.status IN ('approved','conditionally_approved','renewed') THEN true ELSE false END,
              completed_at = CASE WHEN ppa.status IN ('approved','conditionally_approved','renewed') THEN ppa.approved_date ELSE NULL END,
              expiry_date = ppa.expiry_date,
              document_url = ppa.document_url
         FROM pipeline_project_approvals ppa
         JOIN pipeline_approval_types pat ON pat.id = ppa.approval_type_id
        WHERE pr.project_id = $1
          AND pr.requirement_type = 'wayleave'
          AND ppa.pipeline_project_id = $2
          AND pat.category = 'wayleave'`,
      [projectId, pipelineProjectId],
    );
  }

  return { projectId, created: true };
}
