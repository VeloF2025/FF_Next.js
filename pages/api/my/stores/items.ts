/**
 * GET /api/my/stores/items — stock items for the /my stores PWA.
 *
 * PWA-session (withMySession) equivalent of GET /api/procurement/field-stock/items.
 * Returns ALL tracking types when no trackingType filter is given (the PWA issue flow
 * lists serial + lot + quantity items). When trackingType is omitted, serial items sort
 * first. Client is `fetchIssuableStockItems` in
 * `src/modules/field-stock-pwa/api/items.ts`. Uses pg.Pool via @/lib/db-pool (not the
 * Neon shim); explicit query branches because of the tagged-template style.
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
    const trackingType = req.query.trackingType as string | undefined;
    const rawSearch = req.query.search as string | undefined;
    const search = rawSearch ? `%${rawSearch}%` : undefined;

    let rows: Record<string, unknown>[];
    if (trackingType && search) {
      rows = await sql`
        SELECT id, item_code, name, description, category, tracking_type,
          uom, standard_cost, currency, is_returnable, is_active, qty_available
        FROM stock_items
        WHERE is_active = true AND tracking_type = ${trackingType}
          AND (name ILIKE ${search} OR item_code ILIKE ${search})
        ORDER BY category, name LIMIT 100
      `;
    } else if (trackingType) {
      rows = await sql`
        SELECT id, item_code, name, description, category, tracking_type,
          uom, standard_cost, currency, is_returnable, is_active, qty_available
        FROM stock_items
        WHERE is_active = true AND tracking_type = ${trackingType}
        ORDER BY category, name LIMIT 100
      `;
    } else if (search) {
      rows = await sql`
        SELECT id, item_code, name, description, category, tracking_type,
          uom, standard_cost, currency, is_returnable, is_active, qty_available
        FROM stock_items
        WHERE is_active = true
          AND (name ILIKE ${search} OR item_code ILIKE ${search})
        ORDER BY tracking_type = 'serial' DESC, category, name LIMIT 100
      `;
    } else {
      rows = await sql`
        SELECT id, item_code, name, description, category, tracking_type,
          uom, standard_cost, currency, is_returnable, is_active, qty_available
        FROM stock_items
        WHERE is_active = true
        ORDER BY tracking_type = 'serial' DESC, category, name LIMIT 100
      `;
    }

    return apiResponse.success(res, rows);
  } catch (error) {
    log.error('my-stores items API error', { error }, 'my/stores/items');
    return apiResponse.internalError(res, error);
  }
});
