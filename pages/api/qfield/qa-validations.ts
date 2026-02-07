/**
 * GET/POST /api/qfield/qa-validations
 * List and manage photo validations for QField QA
 *
 * GET: Fetch validations with filtering and pagination
 * POST: Create a new validation record (internal use)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth } from '@/lib/auth';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

interface ValidationFilters {
  projectId?: string;
  workType?: string;
  workflowStatus?: string;
  assignedTo?: string;
  priority?: string;
  needsRetake?: boolean;
  search?: string;
  page?: number;
  pageSize?: number;
}

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
    const {
      projectId,
      workType,
      workflowStatus,
      assignedTo,
      priority,
      needsRetake,
      search,
      page = '1',
      pageSize = '50',
    } = req.query;

    const pageNum = parseInt(page as string, 10) || 1;
    const limit = Math.min(parseInt(pageSize as string, 10) || 50, 200);
    const offset = (pageNum - 1) * limit;

    // Build query conditions
    const conditions: string[] = [];
    const params: (string | boolean | number)[] = [];
    let paramIndex = 1;

    if (projectId) {
      conditions.push(`v.project_id = $${paramIndex}::uuid`);
      params.push(projectId as string);
      paramIndex++;
    }

    if (workType) {
      conditions.push(`v.work_type = $${paramIndex}`);
      params.push(workType as string);
      paramIndex++;
    }

    if (workflowStatus) {
      conditions.push(`v.workflow_status = $${paramIndex}`);
      params.push(workflowStatus as string);
      paramIndex++;
    }

    if (assignedTo) {
      conditions.push(`v.assigned_to = $${paramIndex}`);
      params.push(assignedTo as string);
      paramIndex++;
    }

    if (priority) {
      conditions.push(`v.priority = $${paramIndex}`);
      params.push(priority as string);
      paramIndex++;
    }

    if (needsRetake === 'true') {
      conditions.push('v.needs_retake = TRUE');
    } else if (needsRetake === 'false') {
      conditions.push('v.needs_retake = FALSE');
    }

    if (search) {
      conditions.push(`(v.photo_key ILIKE $${paramIndex} OR v.feature_id ILIKE $${paramIndex})`);
      params.push(`%${search}%`);
      paramIndex++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    // Get total count
    const countQuery = `
      SELECT COUNT(*) as total
      FROM qfield_photo_validations v
      ${whereClause}
    `;
    const countResult = await sql.query(countQuery, params);
    const total = parseInt(countResult[0]?.total || '0', 10);

    // Get validations with feature context
    const dataQuery = `
      SELECT
        v.id,
        v.photo_key,
        v.feature_id,
        v.feature_type,
        v.work_type,
        v.project_id,
        v.vlm_confidence,
        v.vlm_feedback,
        v.vlm_raw_response,
        v.needs_retake,
        v.retake_notified_at,
        v.retake_completed_at,
        v.validated_at,
        v.created_at,
        v.manual_status,
        v.manual_reviewed_by,
        v.manual_reviewed_at,
        v.manual_notes,
        v.assigned_to,
        v.assigned_at,
        v.due_date,
        v.priority,
        v.escalation_level,
        v.escalated_at,
        v.escalation_reason,
        v.workflow_status,
        v.file_size_bytes,
        v.file_modified_at,
        -- Pole context
        p.type AS pole_type,
        p.height AS pole_height,
        p.material AS pole_material,
        p.status AS pole_status,
        p.latitude AS pole_latitude,
        p.longitude AS pole_longitude,
        p.address AS pole_address,
        -- Drop context
        d.drop_number,
        d.pole_number AS drop_pole_number,
        d.address AS drop_address,
        d.customer_name AS drop_customer_name,
        d.status AS drop_status,
        d.qc_status AS drop_qc_status,
        -- Project name
        qp.name AS qfield_project_name
      FROM qfield_photo_validations v
      LEFT JOIN poles p ON v.feature_type = 'pole' AND v.feature_id = p.pole_number
      LEFT JOIN drops d ON v.feature_type = 'drop' AND v.feature_id = d.drop_number
      LEFT JOIN qfield_projects qp ON v.project_id = qp.id
      ${whereClause}
      ORDER BY
        CASE v.priority
          WHEN 'urgent' THEN 1
          WHEN 'high' THEN 2
          WHEN 'normal' THEN 3
          WHEN 'low' THEN 4
        END,
        v.due_date ASC NULLS LAST,
        v.validated_at DESC
      LIMIT ${limit} OFFSET ${offset}
    `;

    const validations = await sql.query(dataQuery, params);

    return apiResponse.paginated(res, validations, {
      page: pageNum,
      pageSize: limit,
      total,
    });
  } catch (error) {
    log.error('qfield-qa-validations', error instanceof Error ? { message: error.message } : { error }, 'Fetch failed');
    return apiResponse.databaseError(res, error);
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    const {
      photo_key,
      feature_id,
      feature_type,
      work_type,
      project_id,
      vlm_confidence,
      vlm_feedback,
      vlm_raw_response,
    } = req.body;

    if (!photo_key) {
      return apiResponse.badRequest(res, 'photo_key is required');
    }

    const result = await sql`
      INSERT INTO qfield_photo_validations (
        photo_key,
        feature_id,
        feature_type,
        work_type,
        project_id,
        vlm_confidence,
        vlm_feedback,
        vlm_raw_response,
        needs_retake,
        workflow_status
      ) VALUES (
        ${photo_key},
        ${feature_id || null},
        ${feature_type || null},
        ${work_type || null},
        ${project_id ? project_id : null}::uuid,
        ${vlm_confidence || null},
        ${vlm_feedback || null},
        ${vlm_raw_response ? JSON.stringify(vlm_raw_response) : null}::jsonb,
        ${(vlm_confidence || 1) < 0.6},
        'pending'
      )
      RETURNING *
    `;

    return apiResponse.created(res, result[0]);
  } catch (error) {
    log.error('qfield-qa-validations', error instanceof Error ? { message: error.message } : { error }, 'Create failed');
    return apiResponse.databaseError(res, error);
  }
}

export default withAuth(handler);
