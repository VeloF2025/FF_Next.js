/**
 * GET /api/my/stores/items — stock items for the /my stores PWA.
 *
 * PWA-session (withMySession) equivalent of GET /api/procurement/field-stock/items.
 * The PWA only ever requests serial-tracked items (trackingType=serial) with an
 * optional search term (see fetchSerialStockItems), so only those two branches are
 * implemented here. Uses pg.Pool via @/lib/db-pool (not the Neon shim); explicit
 * query branches mirror the source-of-truth route.
 *
 * Gated to stores roles via requireStoresActor. Read-only.
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
    const trackingType = (req.query.trackingType as string | undefined) ?? 'serial';
    const rawSearch = req.query.search as string | undefined;
    const search = rawSearch ? `%${rawSearch}%` : undefined;

    let rows: Record<string, unknown>[];
    if (search) {
      rows = await sql`
        SELECT
          id, item_code, name, description, category, tracking_type,
          uom, standard_cost, currency, min_stock_level, max_stock_level,
          reorder_quantity, is_returnable, is_active, qty_available,
          created_at, updated_at
        FROM stock_items
        WHERE is_active = true
          AND tracking_type = ${trackingType}
          AND (name ILIKE ${search} OR item_code ILIKE ${search})
        ORDER BY category, name
        LIMIT 100
      `;
    } else {
      rows = await sql`
        SELECT
          id, item_code, name, description, category, tracking_type,
          uom, standard_cost, currency, min_stock_level, max_stock_level,
          reorder_quantity, is_returnable, is_active, qty_available,
          created_at, updated_at
        FROM stock_items
        WHERE is_active = true
          AND tracking_type = ${trackingType}
        ORDER BY category, name
        LIMIT 100
      `;
    }

    return apiResponse.success(res, rows);
  } catch (error) {
    log.error('my-stores items API error', { error }, 'my/stores/items');
    return apiResponse.internalError(res, error);
  }
});
