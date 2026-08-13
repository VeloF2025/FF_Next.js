/**
 * Stock Take Actions API
 * POST /api/procurement/stock-takes/[id]/actions - Perform state transitions
 * Actions: start, complete, approve, cancel
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, AuthenticatedRequest } from '@/lib/auth';
import { transaction } from '@/lib/db-pool';

const sql = neon(process.env.DATABASE_URL!);

interface ActionRequest {
  action: 'start' | 'complete' | 'approve' | 'cancel';
  approval_notes?: string;
}

/** Raised when a concurrent request already moved the take out of pending_review. */
class StockTakeConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StockTakeConflictError';
  }
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

  const userId = (req as unknown as AuthenticatedRequest).user?.id || null;

  try {
    const data: ActionRequest = req.body;

    if (!data.action) {
      return apiResponse.badRequest(res, 'Action is required');
    }

    // Get current stock take
    const stockTake = await sql`
      SELECT id, status, reference_number, location_id FROM stock_takes WHERE id = ${id}
    `;

    if (stockTake.length === 0) {
      return apiResponse.notFound(res, 'Stock take', id);
    }

    const current = stockTake[0]!;

    switch (data.action) {
      case 'start':
        return await handleStart(id, current as Record<string, unknown>, res);
      case 'complete':
        return await handleComplete(id, current as Record<string, unknown>, res);
      case 'approve':
        // Must be awaited so the catch below can map a StockTakeConflictError
        // thrown inside the transaction to a 409 instead of an unhandled reject.
        return await handleApprove(id, current as Record<string, unknown>, data, userId, res);
      case 'cancel':
        return await handleCancel(id, current as Record<string, unknown>, res);
      default:
        return apiResponse.badRequest(res, `Unknown action: ${data.action}`);
    }
  } catch (error) {
    if (error instanceof StockTakeConflictError) {
      return apiResponse.conflict(res, error.message);
    }
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
    RETURNING
      id, reference_number, name, description, status,
      location_id, warehouse_id, category_id, project_id,
      stock_take_type, count_method, scheduled_date,
      start_date, end_date, approved_at, approval_notes,
      notes, tags, created_at, updated_at
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
    RETURNING
      id, reference_number, name, description, status,
      location_id, warehouse_id, category_id, project_id,
      stock_take_type, count_method, scheduled_date,
      start_date, end_date, approved_at, approval_notes,
      notes, tags, created_at, updated_at
  `;

  return apiResponse.success(res, {
    ...result[0],
    message: 'Stock take completed and ready for review'
  });
}

/**
 * Approve a stock take and apply its counted quantities to stock.
 *
 * The whole apply is one ACID transaction (pg.Pool, not the neon HTTP tag) so a
 * failure part-way rolls back cleanly instead of leaving a half-adjusted take
 * stuck in 'approved'. Key properties:
 *  - Idempotent: the take row is locked FOR UPDATE and re-checked as
 *    pending_review inside the txn, so a double-submit / concurrent approve is
 *    rejected (409) rather than applying the adjustments twice.
 *  - Absolute, not delta: each counted line SETs stock_quants.quantity to the
 *    counted value at the take's location. The old code added a variance
 *    (finalCount - expected, a stale snapshot) onto the live quantity and, for a
 *    NULL take location, either crashed (INSERT into NOT NULL location_id) or
 *    silently matched zero rows (`WHERE location_id = NULL`).
 *  - Location-correct: writes go to the take/line location (guaranteed non-NULL).
 *  - Attributed to the authenticated user, not a client-supplied name.
 */
async function handleApprove(
  id: string,
  current: Record<string, unknown>,
  data: ActionRequest,
  userId: string | null,
  res: NextApiResponse
) {
  if (current.status !== 'pending_review') {
    return apiResponse.badRequest(res, 'Can only approve stock takes pending review');
  }

  if (!current.location_id) {
    return apiResponse.badRequest(
      res,
      'Stock take has no location; it cannot be approved. Recreate it with a location.'
    );
  }

  const summary = await transaction(async (txn) => {
    // Lock the take and re-check status inside the transaction so two concurrent
    // approvals can't both pass the pending_review check and double-apply.
    const locked = await txn.queryOne<{
      status: string;
      reference_number: string | null;
      location_id: string | null;
    }>(
      `SELECT status, reference_number, location_id FROM stock_takes WHERE id = $1 FOR UPDATE`,
      [id]
    );

    if (!locked) {
      throw new StockTakeConflictError('Stock take no longer exists');
    }
    if (locked.status !== 'pending_review') {
      throw new StockTakeConflictError('Stock take is no longer pending review');
    }

    const takeRef = locked.reference_number || id;
    const takeLocationId = locked.location_id as string;

    const adjustLoc = await txn.queryOne<{ id: string }>(
      `SELECT id FROM stock_locations WHERE code = 'ADJUST'`
    );
    const adjustLocationId = adjustLoc?.id ?? null;

    const varianceLines = await txn.query<Record<string, unknown>>(
      `SELECT stl.*, si.standard_cost
       FROM stock_take_lines stl
       JOIN stock_items si ON si.id = stl.stock_item_id
       WHERE stl.stock_take_id = $1 AND stl.variance_quantity != 0`,
      [id]
    );

    for (const line of varianceLines) {
      const rawCount = line.recount_quantity ?? line.counted_quantity;
      if (rawCount === null || rawCount === undefined) {
        // Never actually counted — must not silently write 0. Unreachable in the
        // normal flow (handleComplete blocks pending_review with uncounted lines)
        // but the guard should mean what it says.
        throw new Error(`Stock take line ${String(line.id)} was never counted`);
      }
      const finalCount = Number(rawCount);
      const expected = Number(line.expected_quantity);
      if (!Number.isFinite(finalCount) || finalCount < 0) {
        throw new Error(`Invalid counted quantity for stock take line ${String(line.id)}`);
      }
      const variance = finalCount - expected;
      const itemId = line.stock_item_id as string;
      const lineLocationId = (line.location_id as string) || takeLocationId;
      const unitCost = Number(line.standard_cost) || 0;

      // Absolute write: the counted quantity IS the new on-hand at this location
      // (bulk / null-lot quant). No stale-delta arithmetic against live stock.
      await txn.query(
        `INSERT INTO stock_quants (stock_item_id, location_id, quantity, last_movement_date)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (stock_item_id, location_id, COALESCE(lot_number, ''))
         DO UPDATE SET quantity = $3, last_movement_date = NOW(), updated_at = NOW()`,
        [itemId, lineLocationId, finalCount]
      );

      // Movement ledger: direction reflects the sign of the variance.
      const fromLoc = variance > 0 ? adjustLocationId : lineLocationId;
      const toLoc = variance > 0 ? lineLocationId : adjustLocationId;
      await txn.query(
        `INSERT INTO field_stock_movements (
           stock_item_id, movement_type, from_location_id, to_location_id,
           quantity, reference, notes, performed_by, performed_at
         ) VALUES ($1, 'adjustment', $2, $3, $4, $5, $6, $7, NOW())`,
        [itemId, fromLoc, toLoc, Math.abs(variance), 'ST-' + takeRef, 'Stock take variance adjustment', userId]
      );

      const adjType = variance > 0 ? 'increase' : 'decrease';
      await txn.query(
        `INSERT INTO stock_take_adjustments (
           stock_take_id, stock_take_line_id, stock_item_id,
           adjustment_type, quantity_before, quantity_after, adjustment_quantity,
           unit_cost, adjustment_value, reason_code, reason_description,
           approved_by, approved_at, created_by
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'COUNT_ERROR', $10, $11, NOW(), $11)`,
        [
          id, line.id, itemId,
          adjType, expected, finalCount, Math.abs(variance),
          unitCost, Math.abs(variance) * unitCost,
          'Variance from stock take ' + takeRef,
          userId,
        ]
      );

      await txn.query(
        `UPDATE stock_take_lines
         SET status = 'adjusted', adjusted_at = NOW(), adjusted_by = $2, updated_at = NOW()
         WHERE id = $1`,
        [line.id, userId]
      );
    }

    // Zero-variance lines are verified as counted.
    await txn.query(
      `UPDATE stock_take_lines
       SET status = 'verified', updated_at = NOW()
       WHERE stock_take_id = $1 AND status NOT IN ('adjusted', 'verified')`,
      [id]
    );

    // Flip the take to approved LAST — only reached if every adjustment committed.
    const updated = await txn.query<Record<string, unknown>>(
      `UPDATE stock_takes
       SET status = 'approved', approved_by = $2, approved_at = NOW(),
           approval_notes = $3, updated_at = NOW()
       WHERE id = $1
       RETURNING
         id, reference_number, name, description, status,
         location_id, warehouse_id, category_id, project_id,
         stock_take_type, count_method, scheduled_date,
         start_date, end_date, approved_at, approval_notes,
         notes, tags, created_at, updated_at`,
      [id, userId, data.approval_notes ?? null]
    );

    return { take: updated[0], adjustmentsApplied: varianceLines.length };
  });

  log.info('Stock take approved with adjustments', {
    stockTakeId: id,
    varianceLinesCount: summary.adjustmentsApplied,
  }, 'procurement:stock-takes');

  return apiResponse.success(res, {
    ...summary.take,
    adjustments_applied: summary.adjustmentsApplied,
    message: `Stock take approved. ${summary.adjustmentsApplied} variance adjustment(s) applied.`
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
    RETURNING
      id, reference_number, name, description, status,
      location_id, warehouse_id, category_id, project_id,
      stock_take_type, count_method, scheduled_date,
      start_date, end_date, approved_at, approval_notes,
      notes, tags, created_at, updated_at
  `;

  return apiResponse.success(res, {
    ...result[0],
    message: 'Stock take cancelled'
  });
}

export default withAuth(handler);
