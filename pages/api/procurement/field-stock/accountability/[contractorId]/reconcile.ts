/**
 * Reconcile Contractor Stock API
 * POST /api/procurement/field-stock/accountability/[contractorId]/reconcile
 * Perform stock reconciliation for contractor (SOP Section 10)
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { contractorId } = req.query;

  if (typeof contractorId !== 'string') {
    return apiResponse.validationError(res, { contractorId: 'Contractor ID is required' });
  }

  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  try {
    const { reconciledBy, notes } = req.body;

    if (!reconciledBy) {
      return apiResponse.validationError(res, { reconciledBy: 'Reconciler name is required' });
    }

    // Check if record exists
    const existing = await sql`
      SELECT * FROM contractor_stock_accountability
      WHERE contractor_id = ${contractorId}
    `;

    const record = existing[0];
    if (!record) {
      return apiResponse.notFound(res, 'Contractor accountability', contractorId);
    }

    // Calculate totals from actual data
    // Total issued (from pickings where contractor received stock)
    const issuedResult = await sql`
      SELECT
        COUNT(DISTINCT pl.id) as count,
        COALESCE(SUM(pl.total_cost), 0) as value
      FROM stock_pickings p
      JOIN stock_picking_lines pl ON pl.picking_id = p.id
      WHERE p.picking_type = 'issue'
        AND p.status = 'done'
        AND p.contractor_id = ${contractorId}
    `;

    // Total consumed (from consumption records)
    const consumedResult = await sql`
      SELECT
        COUNT(*) as count,
        COALESCE(SUM(c.quantity * COALESCE(si.standard_cost, 0)), 0) as value
      FROM stock_consumptions c
      JOIN stock_items si ON si.id = c.stock_item_id
      WHERE c.consumed_by_id = ${contractorId}
        OR c.consumed_by_id IN (
          SELECT sl.assigned_to_id FROM stock_locations sl
          WHERE sl.location_type = 'technician'
        )
    `;

    // Total returned
    const returnedResult = await sql`
      SELECT
        COUNT(DISTINCT rl.id) as count,
        COALESCE(SUM(rl.quantity * COALESCE(si.standard_cost, 0)), 0) as value
      FROM stock_returns r
      JOIN stock_return_lines rl ON rl.return_id = r.id
      JOIN stock_items si ON si.id = rl.stock_item_id
      WHERE r.status IN ('accepted', 'restocked')
        AND r.returned_by_id = ${contractorId}
    `;

    const issuedCount = Number(issuedResult[0]?.count || 0);
    const issuedValue = Number(issuedResult[0]?.value || 0);
    const consumedCount = Number(consumedResult[0]?.count || 0);
    const consumedValue = Number(consumedResult[0]?.value || 0);
    const returnedCount = Number(returnedResult[0]?.count || 0);
    const returnedValue = Number(returnedResult[0]?.value || 0);

    // Calculate unaccounted
    const unaccountedCount = Math.max(0, issuedCount - consumedCount - returnedCount);
    const unaccountedValue = Math.max(0, issuedValue - consumedValue - returnedValue);

    // Update accountability record
    const result = await sql`
      UPDATE contractor_stock_accountability
      SET
        total_issued_count = ${issuedCount},
        total_issued_value = ${issuedValue},
        total_consumed_count = ${consumedCount},
        total_consumed_value = ${consumedValue},
        total_returned_count = ${returnedCount},
        total_returned_value = ${returnedValue},
        unaccounted_count = ${unaccountedCount},
        unaccounted_value = ${unaccountedValue},
        pending_recovery_amount = ${unaccountedValue},
        last_reconciliation_date = NOW(),
        last_reconciliation_by = ${reconciledBy},
        updated_at = NOW()
      WHERE contractor_id = ${contractorId}
      RETURNING *
    `;

    // Record history
    await sql`
      INSERT INTO stock_accountability_history (
        contractor_id,
        event_type,
        count_change,
        value_change,
        notes,
        performed_by,
        performed_at
      ) VALUES (
        ${contractorId},
        'reconciliation',
        ${unaccountedCount},
        ${unaccountedValue},
        ${notes || `Reconciliation completed. Unaccounted: ${unaccountedCount} items worth R${unaccountedValue.toFixed(2)}`},
        ${reconciledBy},
        NOW()
      )
    `;

    // Auto-block if unaccounted exceeds threshold (SOP 4.4)
    const updatedRecord = result[0];
    if (updatedRecord && unaccountedCount > 0 && !updatedRecord.is_blocked) {
      await sql`
        UPDATE contractor_stock_accountability
        SET
          is_blocked = true,
          blocked_reason = 'Auto-blocked: Unaccounted stock detected during reconciliation',
          blocked_at = NOW(),
          blocked_by = 'System'
        WHERE contractor_id = ${contractorId}
      `;

      await sql`
        INSERT INTO stock_accountability_history (
          contractor_id,
          event_type,
          count_change,
          value_change,
          notes,
          performed_by,
          performed_at
        ) VALUES (
          ${contractorId},
          'block',
          0,
          0,
          'Auto-blocked due to unaccounted stock',
          'System',
          NOW()
        )
      `;
    }

    log.info('Contractor stock reconciled', {
      contractorId,
      issuedCount,
      consumedCount,
      returnedCount,
      unaccountedCount,
      unaccountedValue
    }, 'field-stock');

    return apiResponse.success(res, {
      ...result[0],
      reconciliation: {
        issued: { count: issuedCount, value: issuedValue },
        consumed: { count: consumedCount, value: consumedValue },
        returned: { count: returnedCount, value: returnedValue },
        unaccounted: { count: unaccountedCount, value: unaccountedValue }
      }
    });
  } catch (error: unknown) {
    log.error('Error reconciling contractor', { error, contractorId }, 'field-stock');
    return apiResponse.internalError(res, error);
  }
}
