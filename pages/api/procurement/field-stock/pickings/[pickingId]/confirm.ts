/**
 * Confirm Picking API
 * POST /api/procurement/field-stock/pickings/[pickingId]/confirm
 * Transition picking from draft to confirmed status
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL!);

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
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

    if (pickingRecord.status !== 'draft') {
      return apiResponse.validationError(res, {
        status: `Cannot confirm picking with status "${pickingRecord.status}". Only draft pickings can be confirmed.`
      });
    }

    // Update status to confirmed
    const result = await sql`
      UPDATE stock_pickings
      SET
        status = 'confirmed',
        updated_at = NOW()
      WHERE id = ${pickingId}
      RETURNING *
    `;

    log.info('Picking confirmed', { pickingId }, 'field-stock');
    return apiResponse.success(res, result[0]);
  } catch (error: unknown) {
    log.error('Error confirming picking', { error, pickingId }, 'field-stock');
    return apiResponse.internalError(res, error);
  }
}
