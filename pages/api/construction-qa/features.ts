/**
 * Construction QA Features API
 *
 * GET /api/construction-qa/features
 *   - List features with filters, pagination, and stats
 *   - ?action=projects returns project list only
 *
 * Follows apiResponse pattern from @/lib/apiResponse
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth/middleware';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['GET']);
  }

  try {
    const { action } = req.query;

    // Return project list
    if (action === 'projects') {
      const projects = await sql`
        SELECT DISTINCT p.id, p.project_name AS name
        FROM projects p
        INNER JOIN construction_qa_reviews r ON r.project_id = p.id
        ORDER BY p.project_name
      `;
      return apiResponse.success(res, { projects });
    }

    // Parse filters
    const projectId = req.query.projectId as string || '';
    const discipline = req.query.discipline as string || 'civil';
    const zoneNo = req.query.zoneNo as string || '';
    const ponNo = req.query.ponNo as string || '';
    const workflowStatus = req.query.workflowStatus as string || '';
    const priority = req.query.priority as string || '';
    const search = req.query.search as string || '';
    const page = Math.max(1, parseInt(req.query.page as string || '1', 10));
    const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize as string || '50', 10)));
    const offset = (page - 1) * pageSize;

    // Build WHERE conditions
    const conditions: string[] = ['r.discipline = $1'];
    const params: (string | number)[] = [discipline];
    let paramIdx = 2;

    if (projectId) {
      conditions.push(`r.project_id = $${paramIdx}::uuid`);
      params.push(projectId);
      paramIdx++;
    }

    if (zoneNo) {
      if (zoneNo === '-1') {
        conditions.push('r.zone_no IS NULL');
      } else {
        conditions.push(`r.zone_no = $${paramIdx}`);
        params.push(parseInt(zoneNo, 10));
        paramIdx++;
      }
    }

    if (ponNo) {
      if (ponNo === '-1') {
        conditions.push('r.pon_no IS NULL');
      } else {
        conditions.push(`r.pon_no = $${paramIdx}`);
        params.push(parseInt(ponNo, 10));
        paramIdx++;
      }
    }

    if (workflowStatus) {
      conditions.push(`r.workflow_status = $${paramIdx}`);
      params.push(workflowStatus);
      paramIdx++;
    }

    if (priority) {
      conditions.push(`r.priority = $${paramIdx}`);
      params.push(priority);
      paramIdx++;
    }

    if (search) {
      conditions.push(`(r.feature_id ILIKE $${paramIdx} OR r.extracted_pole_number ILIKE $${paramIdx})`);
      params.push(`%${search}%`);
      paramIdx++;
    }

    const whereClause = conditions.join(' AND ');

    // Fetch features with project name
    const featuresQuery = `
      SELECT
        r.id,
        r.feature_id,
        r.feature_type,
        r.discipline,
        r.zone_no,
        r.pon_no,
        r.photo_count,
        r.vlm_confidence,
        r.vlm_status,
        r.workflow_status,
        r.qa_decision,
        r.priority,
        r.assigned_to,
        r.created_at,
        r.updated_at,
        p.project_name
      FROM construction_qa_reviews r
      JOIN projects p ON p.id = r.project_id
      WHERE ${whereClause}
      ORDER BY
        CASE r.priority
          WHEN 'urgent' THEN 0
          WHEN 'high' THEN 1
          WHEN 'normal' THEN 2
          WHEN 'low' THEN 3
        END,
        r.updated_at DESC
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
    `;

    const countQuery = `
      SELECT COUNT(*) AS total
      FROM construction_qa_reviews r
      WHERE ${whereClause}
    `;

    // Stats query (always filtered by discipline, optionally by project)
    const statsConditions: string[] = ['discipline = $1'];
    const statsParams: (string | number)[] = [discipline];
    let statsParamIdx = 2;

    if (projectId) {
      statsConditions.push(`project_id = $${statsParamIdx}::uuid`);
      statsParams.push(projectId);
      statsParamIdx++;
    }

    const statsWhere = statsConditions.join(' AND ');
    const statsQuery = `
      SELECT
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE workflow_status = 'pending') AS pending,
        COUNT(*) FILTER (WHERE workflow_status = 'approved') AS approved,
        COUNT(*) FILTER (WHERE workflow_status = 'rejected') AS rejected,
        COUNT(*) FILTER (WHERE workflow_status = 'rework_needed') AS rework_needed,
        COUNT(*) FILTER (WHERE workflow_status = 'escalated') AS escalated,
        COUNT(*) FILTER (WHERE workflow_status = 'unidentified') AS unidentified
      FROM construction_qa_reviews
      WHERE ${statsWhere}
    `;

    // Execute all queries in parallel
    const [features, countResult, statsResult] = await Promise.all([
      sql.query(featuresQuery, [...params, pageSize, offset]),
      sql.query(countQuery, params),
      sql.query(statsQuery, statsParams),
    ]);

    const total = Number(countResult[0]?.total || 0);
    const statsRow = statsResult[0] || {};

    return apiResponse.success(res, {
      features,
      stats: {
        total: Number(statsRow.total || 0),
        pending: Number(statsRow.pending || 0),
        approved: Number(statsRow.approved || 0),
        rejected: Number(statsRow.rejected || 0),
        rework_needed: Number(statsRow.rework_needed || 0),
        escalated: Number(statsRow.escalated || 0),
        unidentified: Number(statsRow.unidentified || 0),
      },
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    log.error('Features API error', { module: 'construction-qa', error: (error as Error).message });

    // If table doesn't exist yet (pre-migration), return empty data
    if ((error as Error).message?.includes('does not exist')) {
      return apiResponse.success(res, {
        features: [],
        stats: { total: 0, pending: 0, approved: 0, rejected: 0, rework_needed: 0, escalated: 0, unidentified: 0 },
        pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 },
      });
    }

    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
