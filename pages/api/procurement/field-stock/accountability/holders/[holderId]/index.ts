/**
 * Holder Accountability Detail API
 * GET /api/procurement/field-stock/accountability/holders/[holderId]
 *
 * Returns the holder's accountability summary from v_holder_accountability
 * plus the items they currently hold (stock_custody) and their serials.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { query, queryOne } from '@/lib/db-pool';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { holderId } = req.query;

  if (typeof holderId !== 'string') {
    return apiResponse.validationError(res, { holderId: 'Holder ID is required' });
  }

  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }

  try {
    // Get the holder's accountability row from the live view, plus aging buckets
    // from the v_holder_held_aging companion view (migration 409).
    const holderRow = await queryOne(
      `SELECT
        va.holder_id, va.holder_type, va.staff_id, va.contractor_id, va.name, va.is_active,
        va.issued_count, va.issued_value,
        va.consumed_count, va.consumed_value,
        va.returned_count, va.returned_value,
        va.held_count, va.held_value,
        va.unaccounted_count,
        va.is_blocked, va.blocked_reason, va.blocked_at, va.blocked_by,
        va.pending_recovery_amount, va.recovered_amount,
        va.last_reconciliation_date, va.last_reconciliation_by,
        COALESCE(ag.held_age_0_7, 0)     AS held_age_0_7,
        COALESCE(ag.held_age_8_30, 0)    AS held_age_8_30,
        COALESCE(ag.held_age_31_plus, 0) AS held_age_31_plus,
        ag.oldest_held_at,
        COALESCE(ag.oldest_held_days, 0) AS oldest_held_days
       FROM v_holder_accountability va
       LEFT JOIN v_holder_held_aging ag ON ag.holder_id = va.holder_id
       WHERE va.holder_id = $1`,
      [holderId]
    );

    if (!holderRow) {
      return apiResponse.notFound(res, 'Holder accountability', holderId);
    }

    // Items currently held by this holder (non-zero quantity)
    const custody = await query(
      `SELECT
        sc.stock_item_id,
        si.item_code,
        si.name AS item_name,
        sc.lot_number,
        sc.quantity,
        sc.total_value
       FROM stock_custody sc
       JOIN stock_items si ON si.id = sc.stock_item_id
       WHERE sc.holder_id = $1
         AND sc.quantity <> 0`,
      [holderId]
    );

    // Serials currently attributed to this holder
    const serials = await query(
      `SELECT id, serial_number, stock_item_id, status
       FROM stock_serials
       WHERE holder_id = $1`,
      [holderId]
    );

    // Per-project breakdown of held serial stock (migration 409). project_id is
    // NULL for legacy issues that pre-date the PWA project picker → surfaced as
    // "Unassigned" by the UI.
    const projectBreakdown = await query(
      `SELECT project_id, project_name, held_count, held_value
       FROM v_holder_project_breakdown
       WHERE holder_id = $1
       ORDER BY held_count DESC, project_name NULLS LAST`,
      [holderId]
    );

    return apiResponse.success(res, {
      ...holderRow,
      custody,
      serials,
      projectBreakdown,
    });
  } catch (error: unknown) {
    log.error('Error fetching holder accountability', { error, holderId }, 'field-stock');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
