/**
 * Inspect Return API
 * POST /api/procurement/field-stock/returns/[returnId]/inspect
 * Mark return as inspected and update line dispositions
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { returnId } = req.query;

  if (typeof returnId !== 'string') {
    return apiResponse.validationError(res, { returnId: 'Return ID is required' });
  }

  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  try {
    const { inspectedBy, inspectionNotes, lineDispositions } = req.body;

    if (!inspectedBy) {
      return apiResponse.validationError(res, { inspectedBy: 'Inspector name is required' });
    }

    // Check current status
    const existing = await sql`
      SELECT id, status FROM stock_returns WHERE id = ${returnId}
    `;

    const returnRecord = existing[0];
    if (!returnRecord) {
      return apiResponse.notFound(res, 'Return', returnId);
    }

    if (returnRecord.status !== 'pending') {
      return apiResponse.validationError(res, {
        status: `Cannot inspect return with status "${returnRecord.status}". Only pending returns can be inspected.`
      });
    }

    // Update return header
    await sql`
      UPDATE stock_returns
      SET
        status = 'inspected',
        inspected_by = ${inspectedBy},
        inspected_at = NOW(),
        inspection_notes = ${inspectionNotes || null},
        updated_at = NOW()
      WHERE id = ${returnId}
    `;

    // Update line dispositions if provided
    if (lineDispositions && typeof lineDispositions === 'object') {
      for (const [lineId, disposition] of Object.entries(lineDispositions)) {
        if (disposition && typeof disposition === 'object') {
          const d = disposition as { condition?: string; disposition?: string; notes?: string };
          await sql`
            UPDATE stock_return_lines
            SET
              condition = COALESCE(${d.condition || null}, condition),
              disposition = COALESCE(${d.disposition || null}, disposition),
              notes = COALESCE(${d.notes || null}, notes)
            WHERE id = ${lineId}
          `;
        }
      }
    }

    // Fetch updated return
    const result = await sql`
      SELECT
        r.*,
        (
          SELECT json_agg(
            json_build_object(
              'id', rl.id,
              'stock_item_id', rl.stock_item_id,
              'serial_id', rl.serial_id,
              'serial_number', rl.serial_number,
              'quantity', rl.quantity,
              'condition', rl.condition,
              'return_reason', rl.return_reason,
              'disposition', rl.disposition,
              'notes', rl.notes
            )
          )
          FROM stock_return_lines rl
          WHERE rl.return_id = r.id
        ) as lines
      FROM stock_returns r
      WHERE r.id = ${returnId}
    `;

    log.info('Return inspected', { returnId, inspectedBy }, 'field-stock');
    return apiResponse.success(res, result[0]);
  } catch (error: unknown) {
    log.error('Error inspecting return', { error, returnId }, 'field-stock');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
