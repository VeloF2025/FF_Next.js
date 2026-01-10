/**
 * Sign Picking API
 * POST /api/procurement/field-stock/pickings/[pickingId]/sign
 * Add digital signature to a picking (SOP 4.1 requirement)
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
    const { signatureData, signedBy } = req.body;

    if (!signatureData) {
      return apiResponse.validationError(res, { signatureData: 'Signature data is required' });
    }

    if (!signedBy) {
      return apiResponse.validationError(res, { signedBy: 'Signer name is required' });
    }

    // Check if picking exists
    const existing = await sql`
      SELECT id, status FROM stock_pickings WHERE id = ${pickingId}
    `;

    if (existing.length === 0) {
      return apiResponse.notFound(res, 'Picking', pickingId);
    }

    // Update picking with signature
    const result = await sql`
      UPDATE stock_pickings
      SET
        signature_data = ${signatureData},
        signed_at = NOW(),
        signed_by = ${signedBy},
        updated_at = NOW()
      WHERE id = ${pickingId}
      RETURNING *
    `;

    log.info('Picking signed', { pickingId, signedBy }, 'field-stock');
    return apiResponse.success(res, result[0]);
  } catch (error: unknown) {
    log.error('Error signing picking', { error, pickingId }, 'field-stock');
    return apiResponse.internalError(res, error);
  }
}
