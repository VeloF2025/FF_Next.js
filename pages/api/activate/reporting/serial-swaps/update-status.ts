/**
 * Serial Swap Status Update API
 *
 * POST: Update swap correction status
 *
 * Body:
 * - dropNumber: DR number
 * - status: 'corrected_in_1map' | 'false_positive'
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neonConfig, Pool } from '@neondatabase/serverless';
import ws from 'ws';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import type { SwapStatus } from '@/modules/activate/types/reporting.types';

// Configure Neon WebSocket
neonConfig.webSocketConstructor = ws;
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

interface UpdateStatusBody {
  dropNumber: string;
  status: SwapStatus;
}

export default async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, ['POST']);
  }

  try {
    const { dropNumber, status } = req.body as UpdateStatusBody;

    // Validate inputs
    if (!dropNumber) {
      return apiResponse.badRequest(res, 'dropNumber is required');
    }

    if (!status || !['corrected_in_1map', 'false_positive', 'pending_correction'].includes(status)) {
      return apiResponse.badRequest(res, 'Invalid status. Must be: corrected_in_1map, false_positive, or pending_correction');
    }

    // Update the status
    const updateQuery = `
      UPDATE dr_photo_unified_reviews
      SET
        serial_swap_status = $1,
        serial_swap_corrected_at = CASE
          WHEN $1 IN ('corrected_in_1map', 'false_positive') THEN NOW()
          ELSE NULL
        END,
        serial_swap_corrected_by = CASE
          WHEN $1 IN ('corrected_in_1map', 'false_positive') THEN 'qa_dashboard'
          ELSE NULL
        END,
        updated_at = NOW()
      WHERE drop_number = $2
        AND serial_swap_detected = true
      RETURNING drop_number, serial_swap_status
    `;

    const result = await pool.query(updateQuery, [status, dropNumber]);

    if (result.rows.length === 0) {
      return apiResponse.notFound(res, 'Serial swap record', dropNumber);
    }

    log.info('SerialSwapUpdate', `Updated swap status for ${dropNumber}`, {
      dropNumber,
      newStatus: status,
    });

    // Also update foto_ai_reviews if it exists
    await pool.query(`
      UPDATE foto_ai_reviews
      SET
        serial_swap_status = $1,
        serial_swap_corrected_at = CASE
          WHEN $1 IN ('corrected_in_1map', 'false_positive') THEN NOW()
          ELSE NULL
        END,
        serial_swap_corrected_by = CASE
          WHEN $1 IN ('corrected_in_1map', 'false_positive') THEN 'qa_dashboard'
          ELSE NULL
        END
      WHERE drop_number = $2
        AND serial_swap_detected = true
    `, [status, dropNumber]);

    return apiResponse.success(res, {
      success: true,
      dropNumber,
      status,
      message: `Swap status updated to ${status}`,
    });
  } catch (error) {
    log.error('SerialSwapUpdate', 'Failed to update swap status', { error });
    return apiResponse.internalError(res, error);
  }
}
