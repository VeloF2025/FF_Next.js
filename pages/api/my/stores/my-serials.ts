/**
 * GET /api/my/stores/my-serials — serials currently held by the calling staff member.
 *
 * PWA-session (withMySession) equivalent of GET /api/procurement/field-stock/my-serials.
 * Unlike the withAuth version — which resolves staff via `staff WHERE user_id = req.user.id`
 * and therefore returns [] for PIN-only field staff with no user_id link — this keys
 * directly on session.staffId, the canonical PWA identity. Used by the return wizard's
 * scan step.
 *
 * Held serials are derived via the picking chain (stock_pickings.technician_id), since
 * stock_serials has no direct holder column. DISTINCT ON picks the latest picking per
 * serial. Uses pg.Pool via @/lib/db-pool.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { sql } from '@/lib/db-pool';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withMySession } from '@/modules/attendance/portal/authMiddleware';
import { requireStoresActor } from '@/modules/field-stock-pwa/lib/storesActor';

export default withMySession(async (req: NextApiRequest, res: NextApiResponse, session) => {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  const actor = await requireStoresActor(res, session.staffId);
  if (!actor) return;

  try {
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
          AND sp.technician_id  = ${actor.staffId}
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

    log.info('my-stores.my-serials.list', { staffId: actor.staffId, count: rows.length });
    return apiResponse.success(
      res,
      rows.map((r) => ({
        serialId:           r.serial_id as string,
        serialNumber:       r.serial_number as string,
        stockItemId:        r.stock_item_id as string,
        stockItemName:      r.stock_item_name as string,
        sourceLocationId:   r.source_location_id as string,
        sourceLocationName: r.source_location_name as string,
      })),
    );
  } catch (error) {
    log.error('my-stores.my-serials.failed', { error, staffId: actor.staffId }, 'my/stores/my-serials');
    return apiResponse.internalError(res, error);
  }
});
