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

  // Get ADJUST virtual location
  const adjustLoc = await sql`SELECT id FROM stock_locations WHERE code = 'ADJUST'`;
  const adjustLocationId = adjustLoc.length > 0 ? (adjustLoc[0]!.id as string) : null;

  // Fetch lines with non-zero variance
  const varianceLines = await sql`
    SELECT stl.*, si.standard_cost
    FROM stock_take_lines stl
    JOIN stock_items si ON si.id = stl.stock_item_id
    WHERE stl.stock_take_id = ${id} AND stl.variance_quantity != 0
  `;

  const takeRef = (current.reference_number as string) || id;
  const takeLocationId = current.location_id as string;

  // Apply variance adjustments to stock_quants
  for (const line of varianceLines) {
    const finalCount = (line.recount_quantity ?? line.counted_quantity) as number;
    const expected = line.expected_quantity as number;
    const variance = finalCount - expected;
    const itemId = line.stock_item_id as string;
    const lineLocationId = (line.location_id as string) || takeLocationId;
    const unitCost = (line.standard_cost as number) || 0;

    if (variance > 0) {
      // Found more stock - increase at location
      await sql`
        INSERT INTO stock_quants (stock_item_id, location_id, quantity, last_movement_date)
        VALUES (${itemId}, ${lineLocationId}, ${variance}, NOW())
        ON CONFLICT (stock_item_id, location_id, lot_number)
        DO UPDATE SET
          quantity = stock_quants.quantity + ${variance},
          last_movement_date = NOW(),
          updated_at = NOW()
      `;
    } else {
      // Found less stock - decrease at location
      await sql`
        UPDATE stock_quants
        SET
          quantity = quantity + ${variance},
          last_movement_date = NOW(),
          updated_at = NOW()
        WHERE stock_item_id = ${itemId}
          AND location_id = ${lineLocationId}
      `;
    }

    // Record stock movement
    const fromLoc = variance > 0 ? adjustLocationId : lineLocationId;
    const toLoc = variance > 0 ? lineLocationId : adjustLocationId;
    await sql`
      INSERT INTO stock_movements (
        stock_item_id, movement_type, from_location_id, to_location_id,
        quantity, reference, notes, performed_by, performed_at
      ) VALUES (
        ${itemId}, 'adjustment', ${fromLoc}, ${toLoc},
        ${Math.abs(variance)}, ${'ST-' + takeRef},
        ${'Stock take variance adjustment'},
        ${data.approved_by_name || 'system'}, NOW()
      )
    `;

    // Record stock_take_adjustments
    const adjType = variance > 0 ? 'increase' : 'decrease';
    await sql`
      INSERT INTO stock_take_adjustments (
        stock_take_id, stock_take_line_id, stock_item_id,
        adjustment_type, quantity_before, quantity_after, adjustment_quantity,
        unit_cost, adjustment_value, reason_code, reason_description,
        approved_by, approved_at, created_by_name
      ) VALUES (
        ${id}, ${line.id}, ${itemId},
        ${adjType}, ${expected}, ${finalCount}, ${Math.abs(variance)},
        ${unitCost}, ${Math.abs(variance) * unitCost}, 'COUNT_ERROR',
        ${'Variance from stock take ' + takeRef},
        ${data.approved_by_name || null}, NOW(), ${data.approved_by_name || 'system'}
      )
    `;

    // Mark this line as adjusted
    await sql`
      UPDATE stock_take_lines
      SET status = 'adjusted', updated_at = NOW()
      WHERE id = ${line.id}
    `;
  }

  // Mark remaining (zero-variance) lines as verified
  await sql`
    UPDATE stock_take_lines
    SET status = 'verified', updated_at = NOW()
    WHERE stock_take_id = ${id} AND status NOT IN ('adjusted', 'verified')
  `;

  log.info('Stock take approved with adjustments', {
    stockTakeId: id,
    varianceLinesCount: varianceLines.length,
  }, 'procurement:stock-takes');

  return apiResponse.success(res, {
    ...result[0],
    adjustments_applied: varianceLines.length,
    message: `Stock take approved. ${varianceLines.length} variance adjustment(s) applied.`
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
