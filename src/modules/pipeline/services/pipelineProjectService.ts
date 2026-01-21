/**
 * Pipeline Project Service
 * Database operations for pipeline projects
 */

import { sql } from '@/lib/neon';
import type {
  PipelineProject,
  PipelineProjectWithRelations,
  PipelineProjectSummary,
  CreatePipelineProjectInput,
  UpdatePipelineProjectInput,
  PipelineProjectFilters,
  PipelineProjectSort,
  PipelineProjectListResponse,
  PipelineDashboardStats,
  ReceivePOInput,
  PipelineStatus,
} from '../types';

// ============================================================================
// Query Helpers
// ============================================================================

function buildWhereClause(
  filters: PipelineProjectFilters,
  startParamIndex: number = 1
): { clause: string; params: unknown[]; nextIndex: number } {
  const conditions: string[] = ['p.is_deleted = false'];
  const params: unknown[] = [];
  let paramIndex = startParamIndex;

  if (filters.search) {
    conditions.push(
      `(LOWER(p.project_name) LIKE LOWER($${paramIndex}) OR LOWER(p.project_code) LIKE LOWER($${paramIndex}) OR LOWER(p.description) LIKE LOWER($${paramIndex}))`
    );
    params.push(`%${filters.search}%`);
    paramIndex++;
  }

  if (filters.pipeline_status) {
    const statuses = Array.isArray(filters.pipeline_status)
      ? filters.pipeline_status
      : [filters.pipeline_status];
    const placeholders = statuses.map((_, i) => `$${paramIndex + i}`).join(', ');
    conditions.push(`p.pipeline_status IN (${placeholders})`);
    params.push(...statuses);
    paramIndex += statuses.length;
  }

  if (filters.priority) {
    const priorities = Array.isArray(filters.priority)
      ? filters.priority
      : [filters.priority];
    const placeholders = priorities.map((_, i) => `$${paramIndex + i}`).join(', ');
    conditions.push(`p.priority IN (${placeholders})`);
    params.push(...priorities);
    paramIndex += priorities.length;
  }

  if (filters.client_id) {
    conditions.push(`p.client_id = $${paramIndex}`);
    params.push(filters.client_id);
    paramIndex++;
  }

  if (filters.project_manager_id) {
    conditions.push(`p.project_manager_id = $${paramIndex}`);
    params.push(filters.project_manager_id);
    paramIndex++;
  }

  if (filters.wayleaves_officer_id) {
    conditions.push(`p.wayleaves_officer_id = $${paramIndex}`);
    params.push(filters.wayleaves_officer_id);
    paramIndex++;
  }

  if (filters.province) {
    conditions.push(`p.province = $${paramIndex}`);
    params.push(filters.province);
    paramIndex++;
  }

  if (filters.municipality) {
    conditions.push(`p.municipality = $${paramIndex}`);
    params.push(filters.municipality);
    paramIndex++;
  }

  if (filters.project_type) {
    conditions.push(`p.project_type = $${paramIndex}`);
    params.push(filters.project_type);
    paramIndex++;
  }

  if (filters.has_po === true) {
    conditions.push(`p.po_number IS NOT NULL`);
  } else if (filters.has_po === false) {
    conditions.push(`p.po_number IS NULL`);
  }

  if (filters.created_after) {
    conditions.push(`p.created_at >= $${paramIndex}`);
    params.push(filters.created_after);
    paramIndex++;
  }

  if (filters.created_before) {
    conditions.push(`p.created_at <= $${paramIndex}`);
    params.push(filters.created_before);
    paramIndex++;
  }

  return {
    clause: conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '',
    params,
    nextIndex: paramIndex,
  };
}

function buildOrderByClause(sort?: PipelineProjectSort): string {
  if (!sort) {
    return 'ORDER BY p.created_at DESC';
  }

  const fieldMap: Record<string, string> = {
    project_name: 'p.project_name',
    project_code: 'p.project_code',
    pipeline_status: 'p.pipeline_status',
    priority: 'p.priority',
    estimated_value: 'p.estimated_value',
    created_at: 'p.created_at',
    updated_at: 'p.updated_at',
  };

  const field = fieldMap[sort.field] || 'p.created_at';
  const direction = sort.direction === 'asc' ? 'ASC' : 'DESC';

  return `ORDER BY ${field} ${direction}`;
}

// ============================================================================
// CRUD Operations
// ============================================================================

export async function createProject(
  input: CreatePipelineProjectInput
): Promise<PipelineProject> {
  const result = (await sql`
    INSERT INTO pipeline_projects (
      project_name, description, province, municipality, area, address,
      coordinates, project_type, priority, client_id,
      client_contact_name, client_contact_email, client_contact_phone,
      project_manager_id, wayleaves_officer_id, operations_manager_id,
      estimated_value, estimated_homes_passed, estimated_km,
      target_start_date, target_completion_date,
      notes, tags, custom_fields, created_by
    ) VALUES (
      ${input.project_name},
      ${input.description || null},
      ${input.province || null},
      ${input.municipality || null},
      ${input.area || null},
      ${input.address || null},
      ${input.coordinates ? JSON.stringify(input.coordinates) : null},
      ${input.project_type || 'greenfield'},
      ${input.priority || 'medium'},
      ${input.client_id || null},
      ${input.client_contact_name || null},
      ${input.client_contact_email || null},
      ${input.client_contact_phone || null},
      ${input.project_manager_id || null},
      ${input.wayleaves_officer_id || null},
      ${input.operations_manager_id || null},
      ${input.estimated_value || null},
      ${input.estimated_homes_passed || null},
      ${input.estimated_km || null},
      ${input.target_start_date || null},
      ${input.target_completion_date || null},
      ${input.notes || null},
      ${JSON.stringify(input.tags || [])},
      ${JSON.stringify(input.custom_fields || {})},
      ${input.created_by || null}
    )
    RETURNING *
  `) as Record<string, unknown>[];

  return result[0] as unknown as PipelineProject;
}

export async function getProjectById(
  id: string
): Promise<PipelineProjectWithRelations | null> {
  const result = (await sql`
    SELECT
      p.*,
      c.company_name AS client_name,
      CONCAT(pm.first_name, ' ', pm.last_name) AS project_manager_name,
      CONCAT(wo.first_name, ' ', wo.last_name) AS wayleaves_officer_name,
      CONCAT(om.first_name, ' ', om.last_name) AS operations_manager_name,
      (
        SELECT COUNT(*)
        FROM pipeline_project_approvals a
        WHERE a.pipeline_project_id = p.id AND a.is_required = true
      ) AS total_required_approvals,
      (
        SELECT COUNT(*)
        FROM pipeline_project_approvals a
        WHERE a.pipeline_project_id = p.id
          AND a.is_required = true
          AND a.status IN ('approved', 'conditionally_approved')
      ) AS completed_approvals,
      (
        SELECT COUNT(*)
        FROM pipeline_project_approvals a
        WHERE a.pipeline_project_id = p.id
          AND a.is_required = true
          AND a.expiry_date IS NOT NULL
          AND a.expiry_date < CURRENT_DATE
      ) AS expired_approvals,
      (
        SELECT MIN(a.expiry_date)
        FROM pipeline_project_approvals a
        WHERE a.pipeline_project_id = p.id
          AND a.status IN ('approved', 'conditionally_approved')
          AND a.expiry_date IS NOT NULL
      ) AS earliest_expiry_date
    FROM pipeline_projects p
    LEFT JOIN clients c ON p.client_id = c.id
    LEFT JOIN staff pm ON p.project_manager_id = pm.id
    LEFT JOIN staff wo ON p.wayleaves_officer_id = wo.id
    LEFT JOIN staff om ON p.operations_manager_id = om.id
    WHERE p.id = ${id} AND p.is_deleted = false
  `) as Record<string, unknown>[];

  if (result.length === 0) {
    return null;
  }

  const project = result[0] as unknown as PipelineProjectWithRelations;

  // Calculate approval progress
  if (project.total_required_approvals && project.total_required_approvals > 0) {
    project.approval_progress_percent = Math.round(
      ((project.completed_approvals || 0) / project.total_required_approvals) * 100
    );
  } else {
    project.approval_progress_percent = 0;
  }

  return project;
}

export async function updateProject(
  id: string,
  input: UpdatePipelineProjectInput
): Promise<PipelineProject | null> {
  // Build dynamic update
  const updates: string[] = [];
  const values: unknown[] = [];
  let paramIndex = 1;

  const addUpdate = (field: string, value: unknown) => {
    if (value !== undefined) {
      updates.push(`${field} = $${paramIndex}`);
      values.push(value);
      paramIndex++;
    }
  };

  addUpdate('project_name', input.project_name);
  addUpdate('description', input.description);
  addUpdate('province', input.province);
  addUpdate('municipality', input.municipality);
  addUpdate('area', input.area);
  addUpdate('address', input.address);
  if (input.coordinates !== undefined) {
    addUpdate('coordinates', input.coordinates ? JSON.stringify(input.coordinates) : null);
  }
  addUpdate('project_type', input.project_type);
  addUpdate('priority', input.priority);
  addUpdate('client_id', input.client_id);
  addUpdate('client_contact_name', input.client_contact_name);
  addUpdate('client_contact_email', input.client_contact_email);
  addUpdate('client_contact_phone', input.client_contact_phone);
  addUpdate('project_manager_id', input.project_manager_id);
  addUpdate('wayleaves_officer_id', input.wayleaves_officer_id);
  addUpdate('operations_manager_id', input.operations_manager_id);
  addUpdate('pipeline_status', input.pipeline_status);
  addUpdate('estimated_value', input.estimated_value);
  addUpdate('estimated_homes_passed', input.estimated_homes_passed);
  addUpdate('estimated_km', input.estimated_km);
  addUpdate('target_start_date', input.target_start_date);
  addUpdate('target_completion_date', input.target_completion_date);
  addUpdate('notes', input.notes);
  if (input.tags !== undefined) {
    addUpdate('tags', JSON.stringify(input.tags));
  }
  if (input.custom_fields !== undefined) {
    addUpdate('custom_fields', JSON.stringify(input.custom_fields));
  }
  addUpdate('updated_by', input.updated_by);

  if (updates.length === 0) {
    return getProjectById(id) as Promise<PipelineProject | null>;
  }

  updates.push('updated_at = NOW()');
  values.push(id);

  const query = `
    UPDATE pipeline_projects
    SET ${updates.join(', ')}
    WHERE id = $${paramIndex} AND is_deleted = false
    RETURNING *
  `;

  const result = (await sql.query(query, values)) as Record<string, unknown>[];
  return result.length > 0 ? (result[0] as unknown as PipelineProject) : null;
}

export async function deleteProject(
  id: string,
  deletedBy?: string
): Promise<boolean> {
  const result = (await sql`
    UPDATE pipeline_projects
    SET
      is_deleted = true,
      deleted_at = NOW(),
      deleted_by = ${deletedBy || null},
      updated_at = NOW()
    WHERE id = ${id} AND is_deleted = false
    RETURNING id
  `) as Record<string, unknown>[];

  return result.length > 0;
}

// ============================================================================
// List & Search
// ============================================================================

export async function listProjects(
  filters: PipelineProjectFilters = {},
  sort?: PipelineProjectSort,
  page: number = 1,
  limit: number = 20
): Promise<PipelineProjectListResponse> {
  const offset = (page - 1) * limit;
  const { clause: whereClause, params, nextIndex } = buildWhereClause(filters);
  const orderBy = buildOrderByClause(sort);

  // Get total count
  const countQuery = `
    SELECT COUNT(*) as total
    FROM pipeline_projects p
    ${whereClause}
  `;
  const countResult = (await sql.query(countQuery, params)) as Record<string, unknown>[];
  const total = parseInt(String(countResult[0]?.total || '0'), 10);

  // Get paginated results
  const dataQuery = `
    SELECT
      p.id,
      p.project_code,
      p.project_name,
      p.province,
      p.municipality,
      p.pipeline_status,
      p.priority,
      p.estimated_value,
      p.created_at,
      c.company_name AS client_name,
      CONCAT(pm.first_name, ' ', pm.last_name) AS project_manager_name,
      (
        SELECT COUNT(*)
        FROM pipeline_project_approvals a
        WHERE a.pipeline_project_id = p.id AND a.is_required = true
      ) AS total_required_approvals,
      (
        SELECT COUNT(*)
        FROM pipeline_project_approvals a
        WHERE a.pipeline_project_id = p.id
          AND a.is_required = true
          AND a.status IN ('approved', 'conditionally_approved')
      ) AS completed_approvals,
      (
        SELECT COUNT(*)
        FROM pipeline_project_approvals a
        WHERE a.pipeline_project_id = p.id
          AND a.is_required = true
          AND a.expiry_date IS NOT NULL
          AND a.expiry_date < CURRENT_DATE
      ) AS expired_approvals,
      (
        SELECT MIN(a.expiry_date)
        FROM pipeline_project_approvals a
        WHERE a.pipeline_project_id = p.id
          AND a.status IN ('approved', 'conditionally_approved')
          AND a.expiry_date IS NOT NULL
      ) AS earliest_expiry_date
    FROM pipeline_projects p
    LEFT JOIN clients c ON p.client_id = c.id
    LEFT JOIN staff pm ON p.project_manager_id = pm.id
    ${whereClause}
    ${orderBy}
    LIMIT $${nextIndex} OFFSET $${nextIndex + 1}
  `;

  const dataResult = (await sql.query(dataQuery, [...params, limit, offset])) as Record<string, unknown>[];

  return {
    projects: dataResult as unknown as PipelineProjectSummary[],
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

// ============================================================================
// Dashboard Stats
// ============================================================================

export async function getDashboardStats(): Promise<PipelineDashboardStats> {
  const result = (await sql`
    SELECT
      COUNT(*) AS total_projects,
      COUNT(*) FILTER (WHERE pipeline_status = 'new') AS status_new,
      COUNT(*) FILTER (WHERE pipeline_status = 'qualification') AS status_qualification,
      COUNT(*) FILTER (WHERE pipeline_status = 'approvals_in_progress') AS status_approvals_in_progress,
      COUNT(*) FILTER (WHERE pipeline_status = 'approvals_complete') AS status_approvals_complete,
      COUNT(*) FILTER (WHERE pipeline_status = 'po_pending') AS status_po_pending,
      COUNT(*) FILTER (WHERE pipeline_status = 'ready_to_plan') AS status_ready_to_plan,
      COUNT(*) FILTER (WHERE pipeline_status = 'planned') AS status_planned,
      COUNT(*) FILTER (WHERE pipeline_status = 'on_hold') AS status_on_hold,
      COUNT(*) FILTER (WHERE pipeline_status = 'cancelled') AS status_cancelled,
      COUNT(*) FILTER (WHERE pipeline_status = 'lost') AS status_lost,
      COUNT(*) FILTER (WHERE priority = 'low') AS priority_low,
      COUNT(*) FILTER (WHERE priority = 'medium') AS priority_medium,
      COUNT(*) FILTER (WHERE priority = 'high') AS priority_high,
      COUNT(*) FILTER (WHERE priority = 'critical') AS priority_critical,
      COALESCE(SUM(estimated_value), 0) AS total_estimated_value
    FROM pipeline_projects
    WHERE is_deleted = false
  `) as Record<string, unknown>[];

  const stats = result[0] || {};

  // Get projects with expired approvals
  const expiredResult = (await sql`
    SELECT COUNT(DISTINCT p.id) AS count
    FROM pipeline_projects p
    JOIN pipeline_project_approvals a ON a.pipeline_project_id = p.id
    WHERE p.is_deleted = false
      AND a.is_required = true
      AND a.expiry_date IS NOT NULL
      AND a.expiry_date < CURRENT_DATE
      AND p.pipeline_status NOT IN ('planned', 'cancelled', 'lost')
  `) as Record<string, unknown>[];

  // Get approvals expiring in next 30 days
  const expiringResult = (await sql`
    SELECT COUNT(*) AS count
    FROM pipeline_project_approvals a
    JOIN pipeline_projects p ON a.pipeline_project_id = p.id
    WHERE p.is_deleted = false
      AND a.status IN ('approved', 'conditionally_approved')
      AND a.expiry_date IS NOT NULL
      AND a.expiry_date <= CURRENT_DATE + INTERVAL '30 days'
      AND a.expiry_date > CURRENT_DATE
      AND p.pipeline_status NOT IN ('planned', 'cancelled', 'lost')
  `) as Record<string, unknown>[];

  return {
    total_projects: parseInt(String(stats.total_projects || '0'), 10),
    by_status: {
      new: parseInt(String(stats.status_new || '0'), 10),
      qualification: parseInt(String(stats.status_qualification || '0'), 10),
      approvals_in_progress: parseInt(String(stats.status_approvals_in_progress || '0'), 10),
      approvals_complete: parseInt(String(stats.status_approvals_complete || '0'), 10),
      po_pending: parseInt(String(stats.status_po_pending || '0'), 10),
      ready_to_plan: parseInt(String(stats.status_ready_to_plan || '0'), 10),
      planned: parseInt(String(stats.status_planned || '0'), 10),
      on_hold: parseInt(String(stats.status_on_hold || '0'), 10),
      cancelled: parseInt(String(stats.status_cancelled || '0'), 10),
      lost: parseInt(String(stats.status_lost || '0'), 10),
    },
    by_priority: {
      low: parseInt(String(stats.priority_low || '0'), 10),
      medium: parseInt(String(stats.priority_medium || '0'), 10),
      high: parseInt(String(stats.priority_high || '0'), 10),
      critical: parseInt(String(stats.priority_critical || '0'), 10),
    },
    total_estimated_value: parseFloat(String(stats.total_estimated_value || '0')),
    projects_with_expired_approvals: parseInt(String(expiredResult[0]?.count || '0'), 10),
    projects_ready_to_plan: parseInt(String(stats.status_ready_to_plan || '0'), 10),
    projects_awaiting_po: parseInt(String(stats.status_po_pending || '0'), 10),
    approvals_expiring_soon: parseInt(String(expiringResult[0]?.count || '0'), 10),
  };
}

// ============================================================================
// PO Operations
// ============================================================================

export async function receivePO(
  id: string,
  input: ReceivePOInput
): Promise<PipelineProject | null> {
  const result = (await sql`
    UPDATE pipeline_projects
    SET
      po_number = ${input.po_number},
      po_date = ${input.po_date},
      po_value = ${input.po_value},
      po_document_url = ${input.po_document_url || null},
      po_received_at = NOW(),
      po_received_by = ${input.po_received_by},
      pipeline_status = 'ready_to_plan',
      updated_at = NOW(),
      updated_by = ${input.po_received_by}
    WHERE id = ${id} AND is_deleted = false
    RETURNING *
  `) as Record<string, unknown>[];

  return result.length > 0 ? (result[0] as unknown as PipelineProject) : null;
}

// ============================================================================
// Status Operations
// ============================================================================

export async function updateStatus(
  id: string,
  status: PipelineStatus,
  updatedBy?: string
): Promise<PipelineProject | null> {
  const result = (await sql`
    UPDATE pipeline_projects
    SET
      pipeline_status = ${status},
      updated_at = NOW(),
      updated_by = ${updatedBy || null}
    WHERE id = ${id} AND is_deleted = false
    RETURNING *
  `) as Record<string, unknown>[];

  return result.length > 0 ? (result[0] as unknown as PipelineProject) : null;
}

// ============================================================================
// Approval Type Operations
// ============================================================================

export async function getApprovalTypes() {
  const result = (await sql`
    SELECT * FROM pipeline_approval_types
    WHERE is_active = true
    ORDER BY display_order, name
  `) as Record<string, unknown>[];
  return result;
}

export async function addDefaultApprovals(projectId: string, createdBy?: string) {
  // Get default required approval types
  const types = (await sql`
    SELECT id FROM pipeline_approval_types
    WHERE default_required = true AND is_active = true
  `) as Record<string, unknown>[];

  // Add each as a project approval
  for (const type of types) {
    await sql`
      INSERT INTO pipeline_project_approvals (
        pipeline_project_id, approval_type_id, is_required, created_by
      ) VALUES (
        ${projectId}, ${type.id}, true, ${createdBy || null}
      )
      ON CONFLICT (pipeline_project_id, approval_type_id) DO NOTHING
    `;
  }
}

// ============================================================================
// Export Service
// ============================================================================

export const pipelineProjectService = {
  createProject,
  getProjectById,
  updateProject,
  deleteProject,
  listProjects,
  getDashboardStats,
  receivePO,
  updateStatus,
  getApprovalTypes,
  addDefaultApprovals,
};
