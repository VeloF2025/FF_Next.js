/**
 * Contractor Accountability Detail API
 * GET /api/procurement/field-stock/accountability/[contractorId] - Get contractor summary
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

  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  try {
    // Get accountability record
    const accountabilityResult = await sql`
      SELECT * FROM contractor_stock_accountability
      WHERE contractor_id = ${contractorId}
    `;

    const accountability = accountabilityResult[0];
    if (!accountability) {
      return apiResponse.notFound(res, 'Contractor accountability', contractorId);
    }

    // Get current stock held by contractor's technicians
    const stockHeldResult = await sql`
      SELECT
        sq.stock_item_id,
        si.name as item_name,
        si.item_code,
        si.category,
        SUM(sq.quantity) as quantity,
        sl.id as location_id,
        sl.name as location_name,
        sl.assigned_to_name as technician_name
      FROM stock_quants sq
      JOIN stock_locations sl ON sl.id = sq.location_id
      JOIN stock_items si ON si.id = sq.stock_item_id
      WHERE sl.location_type = 'technician'
        AND sq.quantity > 0
      GROUP BY sq.stock_item_id, si.name, si.item_code, si.category,
               sl.id, sl.name, sl.assigned_to_name
      ORDER BY sl.name, si.name
    `;

    // Get unaccounted serials (issued but not consumed/returned)
    const unaccountedSerialsResult = await sql`
      SELECT
        ss.*,
        si.name as item_name,
        si.item_code,
        sl.name as location_name,
        sl.assigned_to_name as technician_name
      FROM stock_serials ss
      JOIN stock_items si ON si.id = ss.stock_item_id
      LEFT JOIN stock_locations sl ON sl.id = ss.current_location_id
      WHERE ss.status = 'issued'
      ORDER BY ss.updated_at DESC
      LIMIT 50
    `;

    // Get recent activity history
    const historyResult = await sql`
      SELECT * FROM stock_accountability_history
      WHERE contractor_id = ${contractorId}
      ORDER BY performed_at DESC
      LIMIT 20
    `;

    // Get pending returns
    const pendingReturnsResult = await sql`
      SELECT
        r.*,
        (
          SELECT COUNT(*) FROM stock_return_lines rl WHERE rl.return_id = r.id
        ) as line_count
      FROM stock_returns r
      WHERE r.status IN ('pending', 'inspected')
      ORDER BY r.return_date DESC
      LIMIT 10
    `;

    return apiResponse.success(res, {
      accountability,
      stockHeld: stockHeldResult,
      unaccountedSerials: unaccountedSerialsResult,
      recentHistory: historyResult,
      pendingReturns: pendingReturnsResult
    });
  } catch (error: unknown) {
    log.error('Error fetching accountability', { error, contractorId }, 'field-stock');
    return apiResponse.internalError(res, error);
  }
}
