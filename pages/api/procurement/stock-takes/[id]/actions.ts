/**
 * Stock Take Actions API
 * POST /api/procurement/stock-takes/[id]/actions - Perform state transitions
 * Actions: start, complete, approve, cancel
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

interface ActionRequest {
  action: 'start' | 'complete' | 'approve' | 'cancel';
  approval_notes?: string;
  approved_by_name?: string;
}

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  const { id } = req.query;

  if (!id || typeof id !== 'string') {
    return apiResponse.badRequest(res, 'Stock take ID is required');
  }

  try {
    const data: ActionRequest = req.body;

    if (!data.action) {
      return apiResponse.badRequest(res, 'Action is required');
    }

    // Get current stock take
    const stockTake = await sql`
      SELECT * FROM stock_takes WHERE id = ${id}
    `;

    if (stockTake.length === 0) {
      return apiResponse.notFound(res, 'Stock take', id);
    }

    const current = stockTake[0]!;

    switch (data.action) {
      case 'start':
        return handleStart(id, current as Record<string, unknown>, res);
      case 'complete':
        return handleComplete(id, current as Record<string, unknown>, res);
      case 'approve':
        return handleApprove(id, current as Record<string, unknown>, data, res);
      case 'cancel':
        return handleCancel(id, current as Record<string, unknown>, res);
      default:
        return apiResponse.badRequest(res, `Unknown action: ${data.action}`);
    }
  } catch (error) {
    log.error('Stock Take Actions API error', { error, module: 'procurement:stock-takes' });
    return apiResponse.internalError(res, error);
  }
}

async function handleStart(id: string, current: Record<string, unknown>, res: NextApiResponse) {
  if (current.status !== 'draft') {
    return apiResponse.badRequest(res, 'Can only start draft stock takes');
  }

  // Check if lines exist
  const lineCount = await sql`
    SELECT COUNT(*) as count FROM stock_take_lines WHERE stock_take_id = ${id}
  `;

  if (parseInt(lineCount[0]!.count as string) === 0) {
    return apiResponse.badRequest(res, 'Initialize items before starting stock take');
  }

  const result = await sql`
    UPDATE stock_takes
    SET
      status = 'in_progress',
      start_date = NOW(),
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `;

  return apiResponse.success(res, {
    ...result[0],
    message: 'Stock take started'
  });
}

async function handleComplete(id: string, current: Record<string, unknown>, res: NextApiResponse) {
  if (current.status !== 'in_progress') {
    return apiResponse.badRequest(res, 'Can only complete in-progress stock takes');
  }

  // Check all items are counted
  const uncounted = await sql`
    SELECT COUNT(*) as count FROM stock_take_lines
    WHERE stock_take_id = ${id} AND counted_quantity IS NULL
  `;

  if (parseInt(uncounted[0]!.count as string) > 0) {
    return apiResponse.badRequest(res, `${uncounted[0]!.count} items have not been counted yet`);
  }

  const result = await sql`
    UPDATE stock_takes
    SET
      status = 'pending_review',
      end_date = NOW(),
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `;

  return apiResponse.success(res, {
    ...result[0],
    message: 'Stock take completed and ready for review'
  });
}

async function handleApprove(
  id: string,
  current: Record<string, unknown>,
  data: ActionRequest,
  res: NextApiResponse
) {
  if (current.status !== 'pending_review') {
    return apiResponse.badRequest(res, 'Can only approve stock takes pending review');
  }

  const result = await sql`
    UPDATE stock_takes
    SET
      status = 'approved',
      approved_at = NOW(),
      approval_notes = ${data.approval_notes || null},
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `;

  // Mark all lines as verified
  await sql`
    UPDATE stock_take_lines
    SET status = 'verified', updated_at = NOW()
    WHERE stock_take_id = ${id} AND status != 'adjusted'
  `;

  return apiResponse.success(res, {
    ...result[0],
    message: 'Stock take approved'
  });
}

async function handleCancel(id: string, current: Record<string, unknown>, res: NextApiResponse) {
  if (current.status === 'approved') {
    return apiResponse.badRequest(res, 'Cannot cancel approved stock takes');
  }

  const result = await sql`
    UPDATE stock_takes
    SET
      status = 'cancelled',
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `;

  return apiResponse.success(res, {
    ...result[0],
    message: 'Stock take cancelled'
  });
}

export default withAuth(handler);
