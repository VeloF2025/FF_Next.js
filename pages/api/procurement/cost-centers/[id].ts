/**
 * Single Cost Center API
 * GET /api/procurement/cost-centers/[id] - Get cost center details
 * PUT /api/procurement/cost-centers/[id] - Update cost center
 * DELETE /api/procurement/cost-centers/[id] - Delete cost center
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import type { UpdateCostCenterRequest } from '@/types/procurement/costCenter.types';

const sql = neon(process.env.DATABASE_URL!);

export default async function handler(
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
    case 'PUT':
      return handlePut(id, req, res);
    case 'DELETE':
      return handleDelete(id, res);
    default:
      return apiResponse.methodNotAllowed(res);
  }
}

async function handleGet(id: string, req: NextApiRequest, res: NextApiResponse) {
  try {
    const { include_children = 'false', include_rollup = 'false' } = req.query;

    // Get cost center summary
    const costCenter = await sql`
      SELECT * FROM v_cost_centers_summary WHERE id = ${id}::UUID
    `;

    if (costCenter.length === 0) {
      return apiResponse.notFound(res, 'Cost center', id);
    }

    const result: Record<string, unknown> = { ...costCenter[0] };

    // Include children if requested
    if (include_children === 'true') {
      const children = await sql`
        SELECT * FROM v_cost_centers_summary
        WHERE parent_id = ${id}::UUID
        ORDER BY sort_order, code
      `;
      result.children = children;
    }

    // Include rollup totals if requested
    if (include_rollup === 'true') {
      const rollup = await sql`
        SELECT * FROM rollup_cost_center_totals(${id}::UUID)
      `;
      if (rollup.length > 0) {
        result.rollup_totals = rollup[0];
      }
    }

    return apiResponse.success(res, result);
  } catch (error) {
    console.error('Cost Center GET error:', error);
    return apiResponse.internalError(res, error);
  }
}

async function handlePut(id: string, req: NextApiRequest, res: NextApiResponse) {
  try {
    const data: UpdateCostCenterRequest = req.body;

    // Check if cost center exists
    const existing = await sql`
      SELECT id, is_locked FROM cost_centers WHERE id = ${id}::UUID
    `;

    if (existing.length === 0) {
      return apiResponse.notFound(res, 'Cost center', id);
    }

    // Check if locked
    if (existing[0].is_locked && !data.is_locked) {
      return apiResponse.badRequest(res, 'Cost center is locked and cannot be modified');
    }

    // Check for duplicate code if changing
    if (data.code) {
      const duplicate = await sql`
        SELECT id FROM cost_centers
        WHERE code = ${data.code} AND id != ${id}::UUID
        AND project_id = (SELECT project_id FROM cost_centers WHERE id = ${id}::UUID)
      `;
      if (duplicate.length > 0) {
        return apiResponse.badRequest(res, `Cost center with code "${data.code}" already exists`);
      }
    }

    // Prevent circular parent reference
    if (data.parent_id) {
      // Check that new parent isn't a descendant
      const descendants = await sql`
        SELECT id FROM get_cost_center_descendants(${id}::UUID)
        WHERE id = ${data.parent_id}::UUID
      `;
      if (descendants.length > 0) {
        return apiResponse.badRequest(res, 'Cannot set parent to a descendant cost center');
      }
    }

    const result = await sql`
      UPDATE cost_centers SET
        code = COALESCE(${data.code || null}, code),
        name = COALESCE(${data.name || null}, name),
        description = COALESCE(${data.description || null}, description),
        parent_id = CASE
          WHEN ${data.parent_id !== undefined} THEN ${data.parent_id || null}::UUID
          ELSE parent_id
        END,
        cost_center_type_id = COALESCE(${data.cost_center_type_id || null}::UUID, cost_center_type_id),
        allocated_budget = COALESCE(${data.allocated_budget ?? null}::DECIMAL, allocated_budget),
        is_active = COALESCE(${data.is_active ?? null}::BOOLEAN, is_active),
        is_locked = COALESCE(${data.is_locked ?? null}::BOOLEAN, is_locked),
        sort_order = COALESCE(${data.sort_order ?? null}::INTEGER, sort_order),
        metadata = CASE
          WHEN ${data.metadata !== undefined} THEN ${JSON.stringify(data.metadata || {})}::JSONB
          ELSE metadata
        END,
        updated_at = NOW()
      WHERE id = ${id}::UUID
      RETURNING *
    `;

    return apiResponse.success(res, result[0]);
  } catch (error) {
    console.error('Cost Center PUT error:', error);
    return apiResponse.internalError(res, error);
  }
}

async function handleDelete(id: string, res: NextApiResponse) {
  try {
    // Check if cost center exists
    const existing = await sql`
      SELECT id, is_locked FROM cost_centers WHERE id = ${id}::UUID
    `;

    if (existing.length === 0) {
      return apiResponse.notFound(res, 'Cost center', id);
    }

    if (existing[0].is_locked) {
      return apiResponse.badRequest(res, 'Cannot delete a locked cost center');
    }

    // Check for children
    const children = await sql`
      SELECT COUNT(*) as count FROM cost_centers WHERE parent_id = ${id}::UUID
    `;

    if (parseInt(children[0].count as string) > 0) {
      return apiResponse.badRequest(res, 'Cannot delete cost center with children. Delete children first.');
    }

    // Check for transactions
    const transactions = await sql`
      SELECT COUNT(*) as count FROM cost_center_transactions WHERE cost_center_id = ${id}::UUID
    `;

    if (parseInt(transactions[0].count as string) > 0) {
      return apiResponse.badRequest(res, 'Cannot delete cost center with transactions. Deactivate instead.');
    }

    await sql`DELETE FROM cost_centers WHERE id = ${id}::UUID`;

    return apiResponse.success(res, { message: 'Cost center deleted' });
  } catch (error) {
    console.error('Cost Center DELETE error:', error);
    return apiResponse.internalError(res, error);
  }
}
