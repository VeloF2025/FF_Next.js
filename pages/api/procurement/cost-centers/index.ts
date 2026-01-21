/**
 * Cost Centers API
 * GET /api/procurement/cost-centers - List cost centers
 * POST /api/procurement/cost-centers - Create cost center
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import type { CreateCostCenterRequest } from '@/types/procurement/costCenter.types';

const sql = neon(process.env.DATABASE_URL!);

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  switch (req.method) {
    case 'GET':
      return handleGet(req, res);
    case 'POST':
      return handlePost(req, res);
    default:
      return apiResponse.methodNotAllowed(res);
  }
}

async function handleGet(req: NextApiRequest, res: NextApiResponse) {
  try {
    const {
      project_id,
      type_code,
      parent_id,
      is_active = 'true',
      search,
      include_tree = 'false',
      page = '1',
      limit = '50',
    } = req.query;

    // If tree view requested, return hierarchical data
    if (include_tree === 'true') {
      const tree = await sql`
        SELECT * FROM v_cost_center_tree
        WHERE (${project_id}::UUID IS NULL OR project_id = ${project_id as string}::UUID)
        ORDER BY sort_path
      `;
      return apiResponse.success(res, { tree, total: tree.length });
    }

    // Build query for list view
    let query = `
      SELECT * FROM v_cost_centers_summary
      WHERE 1=1
    `;
    const params: (string | boolean)[] = [];
    let paramIndex = 1;

    if (project_id) {
      query += ` AND project_id = $${paramIndex}::UUID`;
      params.push(project_id as string);
      paramIndex++;
    }

    if (type_code) {
      query += ` AND type_code = $${paramIndex}`;
      params.push(type_code as string);
      paramIndex++;
    }

    if (parent_id === 'null') {
      query += ` AND parent_id IS NULL`;
    } else if (parent_id) {
      query += ` AND parent_id = $${paramIndex}::UUID`;
      params.push(parent_id as string);
      paramIndex++;
    }

    if (is_active !== undefined) {
      query += ` AND is_active = $${paramIndex}`;
      params.push(is_active === 'true');
      paramIndex++;
    }

    if (search) {
      query += ` AND (code ILIKE $${paramIndex} OR name ILIKE $${paramIndex})`;
      params.push(`%${search}%`);
      paramIndex++;
    }

    // Count total
    const countQuery = query.replace('SELECT *', 'SELECT COUNT(*)');
    const countResult = await sql(countQuery, params);
    const total = parseInt(countResult[0].count as string) || 0;

    // Add pagination and ordering
    const pageNum = parseInt(page as string) || 1;
    const limitNum = Math.min(parseInt(limit as string) || 50, 100);
    const offset = (pageNum - 1) * limitNum;

    query += ` ORDER BY hierarchy_path, sort_order LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limitNum.toString());
    params.push(offset.toString());

    const costCenters = await sql(query, params);

    return apiResponse.success(res, {
      cost_centers: costCenters,
      total,
      page: pageNum,
      limit: limitNum,
    });
  } catch (error) {
    console.error('Cost Centers GET error:', error);
    return apiResponse.internalError(res, error);
  }
}

async function handlePost(req: NextApiRequest, res: NextApiResponse) {
  try {
    const data: CreateCostCenterRequest = req.body;

    if (!data.code || !data.name) {
      return apiResponse.badRequest(res, 'Code and name are required');
    }

    // Check for duplicate code within project
    const existing = await sql`
      SELECT id FROM cost_centers
      WHERE code = ${data.code}
      AND (${data.project_id || null}::UUID IS NULL OR project_id = ${data.project_id || null}::UUID)
    `;

    if (existing.length > 0) {
      return apiResponse.badRequest(res, `Cost center with code "${data.code}" already exists`);
    }

    // Get type ID if type_code provided
    let typeId = data.cost_center_type_id;
    if (!typeId && data.reference_type) {
      const typeMapping: Record<string, string> = {
        project: 'project',
        phase: 'phase',
        zone: 'zone',
        pon: 'pon',
        pole: 'pole',
        drop: 'drop',
      };
      const typeCode = typeMapping[data.reference_type];
      if (typeCode) {
        const type = await sql`
          SELECT id FROM cost_center_types WHERE code = ${typeCode}
        `;
        if (type.length > 0) {
          typeId = type[0].id as string;
        }
      }
    }

    const result = await sql`
      INSERT INTO cost_centers (
        code,
        name,
        description,
        parent_id,
        cost_center_type_id,
        project_id,
        allocated_budget,
        reference_type,
        reference_id,
        sort_order,
        metadata,
        created_by
      ) VALUES (
        ${data.code},
        ${data.name},
        ${data.description || null},
        ${data.parent_id || null}::UUID,
        ${typeId || null}::UUID,
        ${data.project_id || null}::UUID,
        ${data.allocated_budget || 0},
        ${data.reference_type || null},
        ${data.reference_id || null}::UUID,
        ${data.sort_order || 0},
        ${JSON.stringify(data.metadata || {})}::JSONB,
        ${data.created_by || null}
      )
      RETURNING *
    `;

    return apiResponse.created(res, result[0]);
  } catch (error) {
    console.error('Cost Centers POST error:', error);
    return apiResponse.internalError(res, error);
  }
}
