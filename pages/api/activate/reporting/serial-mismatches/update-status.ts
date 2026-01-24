/**
 * Serial Mismatch Status Update API
 *
 * POST: Update mismatch investigation status and resolution
 *
 * Body:
 * - id: offline_devices record ID
 * - status: MismatchStatus
 * - resolution?: MismatchResolution (required when status is 'resolved')
 * - notes?: Investigation notes
 *
 * Status: WORKING
 * NLNH Confidence: HIGH
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { Pool } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { withAuth, withRole } from '@/lib/auth';
import { log } from '@/lib/logger';
import type { MismatchStatus, MismatchResolution } from '@/modules/activate/types/reporting.types';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

interface UpdateStatusBody {
  id: string;
  status: MismatchStatus;
  resolution?: MismatchResolution;
  notes?: string;
}

const VALID_STATUSES: MismatchStatus[] = ['pending_investigation', 'ticket_created', 'resolved', 'false_positive'];
const VALID_RESOLUTIONS: MismatchResolution[] = ['ont_replaced', 'data_corrected', 'theft_confirmed', 'false_alarm', 'other'];

async function handler(
  req: NextApiRequest,
  res: NextApiResponse
) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  try {
    const { id, status, resolution, notes } = req.body as UpdateStatusBody;

    // Validate required fields
    if (!id) {
      return apiResponse.badRequest(res, 'id is required');
    }

    if (!status || !VALID_STATUSES.includes(status)) {
      return apiResponse.badRequest(res, `Invalid status. Must be: ${VALID_STATUSES.join(', ')}`);
    }

    // Resolution required when resolving
    if (status === 'resolved' && (!resolution || !VALID_RESOLUTIONS.includes(resolution))) {
      return apiResponse.badRequest(res, `Resolution is required when status is 'resolved'. Must be: ${VALID_RESOLUTIONS.join(', ')}`);
    }

    // Build update query
    const updateQuery = `
      UPDATE offline_devices
      SET
        mismatch_status = $1,
        mismatch_resolution = $2,
        mismatch_notes = COALESCE($3, mismatch_notes),
        mismatch_investigated_at = CASE
          WHEN mismatch_investigated_at IS NULL THEN NOW()
          ELSE mismatch_investigated_at
        END,
        mismatch_investigated_by = CASE
          WHEN mismatch_investigated_by IS NULL THEN 'qa_dashboard'
          ELSE mismatch_investigated_by
        END,
        mismatch_resolved_at = CASE
          WHEN $1 IN ('resolved', 'false_positive') THEN NOW()
          ELSE NULL
        END,
        mismatch_resolved_by = CASE
          WHEN $1 IN ('resolved', 'false_positive') THEN 'qa_dashboard'
          ELSE NULL
        END
      WHERE id = $4
        AND serial_mismatch = true
      RETURNING id, drop_number, mismatch_status, mismatch_resolution
    `;

    const result = await pool.query(updateQuery, [
      status,
      resolution ?? null,
      notes ?? null,
      id,
    ]);

    if (result.rows.length === 0) {
      return apiResponse.notFound(res, 'Serial mismatch record', id);
    }

    const updated = result.rows[0];
    if (!updated) {
      return apiResponse.notFound(res, 'Serial mismatch record', id);
    }

    log.info('SerialMismatchUpdate', `Updated mismatch status for ${updated.drop_number}`, {
      id,
      dropNumber: updated.drop_number,
      newStatus: status,
      resolution,
    });

    return apiResponse.success(res, {
      success: true,
      id,
      drop_number: String(updated.drop_number),
      status: String(updated.mismatch_status),
      resolution: updated.mismatch_resolution ? String(updated.mismatch_resolution) : null,
      message: `Mismatch status updated to ${status}`,
    });
  } catch (error) {
    log.error('SerialMismatchUpdate', 'Failed to update mismatch status', { error });
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(withRole('manager')(handler));
