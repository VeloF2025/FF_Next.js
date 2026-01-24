/**
 * Cancel Picking API
 * POST /api/procurement/field-stock/pickings/[pickingId]/cancel
 * Cancel a draft or confirmed picking
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { pickingId } = req.query;

  if (typeof pickingId !== 'string') {
    return apiResponse.validationError(res, { pickingId: 'Picking ID is required' });
  }

  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  try {
    // Check current status
    const existing = await sql`
      SELECT id, status FROM stock_pickings WHERE id = ${pickingId}
    `;

    const pickingRecord = existing[0];
    if (!pickingRecord) {
      return apiResponse.notFound(res, 'Picking', pickingId);
    }

    const allowedStatuses = ['draft', 'confirmed'];
    if (!allowedStatuses.includes(pickingRecord.status as string)) {
      return apiResponse.validationError(res, {
        status: `Cannot cancel picking with status "${pickingRecord.status}". Only draft or confirmed pickings can be cancelled.`
      });
    }

    // Update status to cancelled
    const result = await sql`
      UPDATE stock_pickings
      SET
        status = 'cancelled',
        updated_at = NOW()
      WHERE id = ${pickingId}
      RETURNING *
    `;

    // Also cancel all lines
    await sql`
      UPDATE stock_picking_lines
      SET status = 'cancelled'
      WHERE picking_id = ${pickingId}
    `;

    log.info('Picking cancelled', { pickingId }, 'field-stock');
    return apiResponse.success(res, result[0]);
  } catch (error: unknown) {
    log.error('Error cancelling picking', { error, pickingId }, 'field-stock');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
