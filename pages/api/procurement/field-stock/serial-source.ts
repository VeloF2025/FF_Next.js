/**
 * GET /api/procurement/field-stock/serial-source?serialNumber=XYZ
 *
 * Returns the source warehouse of the most recent issue picking that touched
 * the given serial — used by the Phase 3 return wizard's mixed-source guard.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET']);
  }

  const serialNumber =
    typeof req.query.serialNumber === 'string'
      ? req.query.serialNumber.trim()
      : '';
  if (!serialNumber) {
    return apiResponse.validationError(res, { serialNumber: 'Required' });
  }

  try {
    const rows = await sql`
      WITH target AS (
        SELECT id FROM stock_serials
        WHERE serial_number = ${serialNumber}
        LIMIT 1
      )
      SELECT
        sp.source_location_id AS source_location_id,
        sl.name               AS source_location_name,
        sp.id                 AS picking_id
      FROM target
      JOIN stock_picking_lines spl ON target.id = ANY(spl.serial_ids)
      JOIN stock_pickings sp ON sp.id = spl.picking_id
      JOIN stock_locations sl ON sl.id = sp.source_location_id
      WHERE sp.picking_type = 'issue' AND sp.status = 'done'
      ORDER BY sp.created_at DESC
      LIMIT 1
    `;
    const row = rows[0];
    if (!row) {
      return apiResponse.notFound(res, 'Serial issue history', serialNumber);
    }
    return apiResponse.success(res, {
      sourceLocationId: row.source_location_id as string,
      sourceLocationName: row.source_location_name as string,
      originalPickingId: row.picking_id as string,
    });
  } catch (error: unknown) {
    log.error('serial-source.failed', { error, serialNumber }, 'field-stock');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
