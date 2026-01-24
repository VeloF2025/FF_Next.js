/**
 * Cost Center Transactions API
 * GET /api/procurement/cost-centers/[id]/transactions - List transactions
 * POST /api/procurement/cost-centers/[id]/transactions - Create transaction
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import type { CreateTransactionRequest } from '@/types/procurement/costCenter.types';
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
    const {
      transaction_type,
      status,
      from_date,
      to_date,
      reference_type,
      page = '1',
      limit = '50',
    } = req.query;

    // Verify cost center exists
    const costCenter = await sql`
      SELECT id FROM cost_centers WHERE id = ${id}::UUID
    `;

    if (costCenter.length === 0) {
      return apiResponse.notFound(res, 'Cost center', id);
    }

    let query = `
      SELECT
        t.*,
        cc.code as cost_center_code,
        cc.name as cost_center_name,
        si.code as stock_item_code,
        si.name as stock_item_name
      FROM cost_center_transactions t
      LEFT JOIN cost_centers cc ON t.cost_center_id = cc.id
      LEFT JOIN stock_items si ON t.stock_item_id = si.id
      WHERE t.cost_center_id = $1::UUID
    `;
    const params: (string | number)[] = [id];
    let paramIndex = 2;

    if (transaction_type) {
      query += ` AND t.transaction_type = $${paramIndex}`;
      params.push(transaction_type as string);
      paramIndex++;
    }

    if (status) {
      query += ` AND t.status = $${paramIndex}`;
      params.push(status as string);
      paramIndex++;
    }

    if (from_date) {
      query += ` AND t.transaction_date >= $${paramIndex}::DATE`;
      params.push(from_date as string);
      paramIndex++;
    }

    if (to_date) {
      query += ` AND t.transaction_date <= $${paramIndex}::DATE`;
      params.push(to_date as string);
      paramIndex++;
    }

    if (reference_type) {
      query += ` AND t.reference_type = $${paramIndex}`;
      params.push(reference_type as string);
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

    query += ` ORDER BY t.transaction_date DESC, t.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limitNum);
    params.push(offset);

    const transactions = await sql.query(query, params);

    // Summary totals
    const summary = await sql`
      SELECT
        transaction_type,
        status,
        SUM(amount) as total_amount,
        COUNT(*) as count
      FROM cost_center_transactions
      WHERE cost_center_id = ${id}::UUID
      GROUP BY transaction_type, status
    `;

    return apiResponse.success(res, {
      transactions,
      summary,
      total,
      page: pageNum,
      limit: limitNum,
    });
  } catch (error) {
    log.error('Transactions GET error', { error, module: 'procurement:cost-centers' });
    return apiResponse.internalError(res, error);
  }
}

async function handlePost(id: string, req: NextApiRequest, res: NextApiResponse) {
  try {
    const data: CreateTransactionRequest = req.body;

    // Verify cost center exists and is not locked
    const costCenter = await sql`
      SELECT id, is_locked FROM cost_centers WHERE id = ${id}::UUID
    `;

    if (costCenter.length === 0) {
      return apiResponse.notFound(res, 'Cost center', id);
    }

    if (costCenter[0]!.is_locked) {
      return apiResponse.badRequest(res, 'Cost center is locked');
    }

    if (!data.transaction_type || !data.amount) {
      return apiResponse.badRequest(res, 'Transaction type and amount are required');
    }

    const result = await sql`
      INSERT INTO cost_center_transactions (
        cost_center_id,
        allocation_id,
        transaction_type,
        transaction_date,
        amount,
        currency,
        reference_type,
        reference_id,
        reference_number,
        description,
        stock_item_id,
        quantity,
        unit_cost,
        status,
        created_by
      ) VALUES (
        ${id}::UUID,
        ${data.allocation_id || null}::UUID,
        ${data.transaction_type},
        ${data.transaction_date || new Date().toISOString().split('T')[0]},
        ${data.amount},
        ${data.currency || 'ZAR'},
        ${data.reference_type || null},
        ${data.reference_id || null}::UUID,
        ${data.reference_number || null},
        ${data.description || null},
        ${data.stock_item_id || null}::UUID,
        ${data.quantity ?? null},
        ${data.unit_cost ?? null},
        'pending',
        ${data.created_by || null}
      )
      RETURNING *
    `;

    return apiResponse.created(res, result[0]);
  } catch (error) {
    log.error('Transactions POST error', { error, module: 'procurement:cost-centers' });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
