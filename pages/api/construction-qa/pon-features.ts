/**
 * PON Features API
 *
 * GET /api/construction-qa/pon-features?projectId=UUID&zoneNo=1&ponNo=12
 *   Paginated feature list scoped to project + zone + PON.
 *   Optional: ?discipline=civil&status=pending
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, withPermission } from '@/lib/auth/middleware';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'unknown', ['GET']);
  }

  const projectId = req.query.projectId as string;
  const zoneNo = req.query.zoneNo as string;
  const ponNo = req.query.ponNo as string;

  if (!projectId || !zoneNo || !ponNo) {
    return apiResponse.badRequest(res, 'projectId, zoneNo, and ponNo are required');
  }

  const discipline = req.query.discipline as string || '';
  const status = req.query.status as string || '';
  const page = Math.max(1, parseInt(req.query.page as string || '1', 10));
  const pageSize = Math.min(200, Math.max(1, parseInt(req.query.pageSize as string || '50', 10)));
  const offset = (page - 1) * pageSize;

  try {
    // zone=-1 / pon=-1 is the sentinel for unassigned features (NULL zone/pon)
    const zoneInt = parseInt(zoneNo, 10);
    const ponInt = parseInt(ponNo, 10);
    const isUnassigned = zoneInt === -1;

    const conditions: string[] = ['r.project_id = $1::uuid'];
    const params: (string | number)[] = [projectId];
    let paramIdx = 2;

    if (isUnassigned) {
      conditions.push('r.zone_no IS NULL');
    } else {
      conditions.push(`r.zone_no = $${paramIdx}`);
      params.push(zoneInt);
      paramIdx++;
      conditions.push(`r.pon_no = $${paramIdx}`);
      params.push(ponInt);
      paramIdx++;
    }

    if (discipline) {
      conditions.push(`r.discipline = $${paramIdx}`);
      params.push(discipline);
      paramIdx++;
    }

    if (status) {
      conditions.push(`r.workflow_status = $${paramIdx}`);
      params.push(status);
      paramIdx++;
    }

    const dateFrom = req.query.dateFrom as string || '';
    const dateTo = req.query.dateTo as string || '';

    if (dateFrom) {
      conditions.push(`COALESCE(r.last_photo_at, r.created_at) >= $${paramIdx}::timestamptz`);
      params.push(dateFrom);
      paramIdx++;
    }

    if (dateTo) {
      conditions.push(`COALESCE(r.last_photo_at, r.created_at) < $${paramIdx}::timestamptz`);
      params.push(dateTo);
      paramIdx++;
    }

    const whereClause = conditions.join(' AND ');

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
        r.updated_at
      FROM construction_qa_reviews r
      WHERE ${whereClause}
      ORDER BY r.feature_id
      LIMIT $${paramIdx} OFFSET $${paramIdx + 1}
    `;

    const countQuery = `
      SELECT COUNT(*)::int AS total
      FROM construction_qa_reviews r
      WHERE ${whereClause}
    `;

    const [features, countResult] = await Promise.all([
      sql.query(featuresQuery, [...params, pageSize, offset]),
      sql.query(countQuery, params),
    ]);

    const total = Number(countResult[0]?.total || 0);

    return apiResponse.success(res, {
      features,
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    });
  } catch (error) {
    log.error('PON features API error', {
      module: 'construction-qa',
      error: (error as Error).message,
    });

    if ((error as Error).message?.includes('does not exist')) {
      return apiResponse.success(res, {
        features: [],
        pagination: { page: 1, pageSize: 50, total: 0, totalPages: 0 },
      });
    }

    return apiResponse.internalError(res, error);
  }
}

export default withAuth(withPermission('construction-qa.qa-centre')(handler));
