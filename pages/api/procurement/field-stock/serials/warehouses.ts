/**
 * GET /api/procurement/field-stock/serials/warehouses
 *
 * FLAT route. Returns the list of warehouses (stock_locations) that currently
 * hold at least one serial, each with its serial count. Feeds the
 * /procurement/field-stock/warehouses landing page (Wave 2 PR-12).
 *
 * Auth: withAuth + withPermission('procurement.field-stock','view') — same
 * gate as the serial search API (technician/viewer have explicit deny rows).
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { withAuth, withPermission } from '@/lib/auth';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { listWarehousesWithSerials } from '@/modules/procurement/field-stock/services/serialHoldingsService';

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method ?? 'UNKNOWN', ['GET']);
  }
  try {
    const rows = await listWarehousesWithSerials();
    return apiResponse.success(res, { rows });
  } catch (err) {
    log.error(
      'list warehouse holdings failed',
      { err: err instanceof Error ? err.message : String(err) },
      'SerialHoldingsAPI'
    );
    return apiResponse.internalError(res, err);
  }
}

export default withAuth(withPermission('procurement.field-stock', 'view')(handler));
