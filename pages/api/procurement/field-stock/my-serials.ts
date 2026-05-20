/**
 * GET /api/procurement/field-stock/my-serials
 *
 * Returns the calling tech's currently-held serials (status='issued', NOT
 * 'assigned' — 'assigned' is not in the stock_serials.status CHECK; 'issued'
 * is the correct value). Holding relationship derived via picking chain
 * (stock_pickings.technician_id), since stock_serials has no direct
 * assigned_to_staff_id column.
 *
 * Used by the Phase 3 return wizard to populate the scan step.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  const userId = (req as AuthenticatedNextApiRequest).user?.id;
  if (!userId) {
    return apiResponse.unauthorized(res, 'User session required');
  }

  try {
    // Phase 2 helper pattern: users.id → staff.id
    const staffRows = await sql`
      SELECT id FROM staff WHERE user_id = ${userId} LIMIT 1
    `;
    const staffRow = staffRows[0];
    if (!staffRow) {
      log.warn('my-serials: no staff row for user', { userId });
      return apiResponse.success(res, []);
    }
    const staffId = staffRow.id as string;

    // Derive the tech's currently held serials via the picking chain.
    // DISTINCT ON picks the latest picking per serial so re-issued serials
    // correctly reflect the most recent warehouse source.
    const rows = await sql`
      WITH tech_serials AS (
        SELECT DISTINCT
          ss.id,
          ss.serial_number,
          ss.stock_item_id,
          sp.source_location_id,
          sp.id          AS picking_id,
          sp.created_at  AS picking_at
        FROM stock_serials ss
        JOIN stock_picking_lines spl ON ss.id = ANY(spl.serial_ids)
        JOIN stock_pickings sp       ON sp.id = spl.picking_id
        WHERE sp.picking_type   = 'issue'
          AND sp.status         = 'done'
          AND sp.technician_id  = ${staffId}
          AND ss.status         = 'issued'
      ),
      latest_per_serial AS (
        SELECT DISTINCT ON (id)
          id,
          serial_number,
          stock_item_id,
          source_location_id,
          picking_id
        FROM tech_serials
        ORDER BY id, picking_at DESC
      )
      SELECT
        lps.id                  AS serial_id,
        lps.serial_number,
        lps.stock_item_id,
        si.name                 AS stock_item_name,
        lps.source_location_id,
        sl.name                 AS source_location_name
      FROM latest_per_serial lps
      JOIN stock_items     si ON si.id = lps.stock_item_id
      JOIN stock_locations sl ON sl.id = lps.source_location_id
      ORDER BY lps.serial_number
    `;

    log.info('my-serials.list', { staffId, count: rows.length });
    return apiResponse.success(
      res,
      rows.map((r) => ({
        serialId:           r.serial_id as string,
        serialNumber:       r.serial_number as string,
        stockItemId:        r.stock_item_id as string,
        stockItemName:      r.stock_item_name as string,
        sourceLocationId:   r.source_location_id as string,
        sourceLocationName: r.source_location_name as string,
      }))
    );
  } catch (error: unknown) {
    log.error('my-serials.list.failed', { error, userId }, 'field-stock');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
