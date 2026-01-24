/**
 * Cost Center Allocations API
 * GET /api/procurement/cost-centers/[id]/allocations - List allocations
 * POST /api/procurement/cost-centers/[id]/allocations - Create allocation
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import type { CreateAllocationRequest } from '@/types/procurement/costCenter.types';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return apiResponse.badRequest(res, 'Cost center ID is required');
  }

  switch (req.method) {
    case 'GET':
      return handleGet(id, req, res);
    case 'POST':
      return handlePost(id, req, res);
    default:
      return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
  }
}

async function handleGet(id: string, req: NextApiRequest, res: NextApiResponse) {
  try {
    const { allocation_type, fiscal_year, page = '1', limit = '50' } = req.query;

    // Verify cost center exists
    const costCenter = await sql`
      SELECT id, is_locked FROM cost_centers WHERE id = ${id}::UUID
    `;

    if (costCenter.length === 0) {
      return apiResponse.notFound(res, 'Cost center', id);
    }

    let query = `
      SELECT
        a.*,
        bc.category_code,
        bc.category_name,
        bi.item_code,
        bi.description as item_description
      FROM cost_center_allocations a
      LEFT JOIN budget_categories bc ON a.budget_category_id = bc.id
      LEFT JOIN budget_items bi ON a.budget_item_id = bi.id
      WHERE a.cost_center_id = $1::UUID
    `;
    const params: (string | number)[] = [id];
    let paramIndex = 2;

    if (allocation_type) {
      query += ` AND a.allocation_type = $${paramIndex}`;
      params.push(allocation_type as string);
      paramIndex++;
    }

    if (fiscal_year) {
      query += ` AND a.fiscal_year = $${paramIndex}`;
      params.push(parseInt(fiscal_year as string));
      paramIndex++;
    }

    // Count
    const countQuery = query.replace(/SELECT[\s\S]*?FROM/, 'SELECT COUNT(*) FROM');
    const countResult = await sql.query(countQuery, params);
    const total = parseInt(countResult[0]!.count as string) || 0;

    // Pagination
    const pageNum = parseInt(page as string) || 1;
    const limitNum = Math.min(parseInt(limit as string) || 50, 100);
    const offset = (pageNum - 1) * limitNum;

    query += ` ORDER BY a.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limitNum);
    params.push(offset);

    const allocations = await sql.query(query, params);

    // Calculate totals by type
    const totals = await sql`
      SELECT
        allocation_type,
        SUM(amount) as total_amount,
        COUNT(*) as count
      FROM cost_center_allocations
      WHERE cost_center_id = ${id}::UUID
      GROUP BY allocation_type
    `;

    return apiResponse.success(res, {
      allocations,
      totals,
      total,
      page: pageNum,
      limit: limitNum,
    });
  } catch (error) {
    log.error('Allocations GET error', { error, module: 'procurement:cost-centers' });
    return apiResponse.internalError(res, error);
  }
}

async function handlePost(id: string, req: NextApiRequest, res: NextApiResponse) {
  try {
    const data: CreateAllocationRequest = req.body;

    // Verify cost center exists and is not locked
    const costCenter = await sql`
      SELECT id, is_locked, allocated_budget FROM cost_centers WHERE id = ${id}::UUID
    `;

    if (costCenter.length === 0) {
      return apiResponse.notFound(res, 'Cost center', id);
    }

    if (costCenter[0]!.is_locked) {
      return apiResponse.badRequest(res, 'Cost center is locked');
    }

    if (!data.allocation_type || !data.amount) {
      return apiResponse.badRequest(res, 'Allocation type and amount are required');
    }

    // Validate allocation won't exceed budget for commitments
    if (data.allocation_type === 'commitment') {
      const currentCommitted = await sql`
        SELECT COALESCE(SUM(amount), 0) as total
        FROM cost_center_allocations
        WHERE cost_center_id = ${id}::UUID
        AND allocation_type = 'commitment'
      `;

      const budget = parseFloat(costCenter[0]!.allocated_budget as string) || 0;
      const committed = parseFloat(currentCommitted[0]!.total as string) || 0;
      const available = budget - committed;

      if (data.amount > available) {
        return apiResponse.badRequest(
          res,
          `Allocation amount (${data.amount}) exceeds available budget (${available})`
        );
      }
    }

    const result = await sql`
      INSERT INTO cost_center_allocations (
        cost_center_id,
        budget_category_id,
        budget_item_id,
        allocation_type,
        amount,
        currency,
        reference_type,
        reference_id,
        reference_number,
        description,
        fiscal_year,
        fiscal_period,
        created_by
      ) VALUES (
        ${id}::UUID,
        ${data.budget_category_id || null}::UUID,
        ${data.budget_item_id || null}::UUID,
        ${data.allocation_type},
        ${data.amount},
        ${data.currency || 'ZAR'},
        ${data.reference_type || null},
        ${data.reference_id || null}::UUID,
        ${data.reference_number || null},
        ${data.description || null},
        ${data.fiscal_year || new Date().getFullYear()},
        ${data.fiscal_period || null},
        ${data.created_by || null}
      )
      RETURNING *
    `;

    return apiResponse.created(res, result[0]);
  } catch (error) {
    log.error('Allocations POST error', { error, module: 'procurement:cost-centers' });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
