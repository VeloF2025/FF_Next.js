/**
 * Unblock Contractor API
 * POST /api/procurement/field-stock/accountability/[contractorId]/unblock
 * Unblock contractor to allow receiving stock again
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { createAuditLog } from '@/services/procurement/auditService';

const sql = neon(process.env.DATABASE_URL!);

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { contractorId } = req.query;

  if (typeof contractorId !== 'string') {
    return apiResponse.validationError(res, { contractorId: 'Contractor ID is required' });
  }

  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  try {
    const { reason, unblockedBy } = req.body;

    if (!unblockedBy) {
      return apiResponse.validationError(res, { unblockedBy: 'Unblocker name is required' });
    }

    // Check if record exists and is blocked
    const existing = await sql`
      SELECT id, is_blocked FROM contractor_stock_accountability
      WHERE contractor_id = ${contractorId}
    `;

    const record = existing[0];
    if (!record) {
      return apiResponse.notFound(res, 'Contractor accountability', contractorId);
    }

    if (!record.is_blocked) {
      return apiResponse.validationError(res, {
        contractorId: 'Contractor is not blocked'
      });
    }

    // Unblock the contractor
    const result = await sql`
      UPDATE contractor_stock_accountability
      SET
        is_blocked = false,
        blocked_reason = NULL,
        blocked_at = NULL,
        blocked_by = NULL,
        updated_at = NOW()
      WHERE contractor_id = ${contractorId}
      RETURNING *
    `;

    // Record history
    await sql`
      INSERT INTO stock_accountability_history (
        contractor_id,
        event_type,
        count_change,
        value_change,
        notes,
        performed_by,
        performed_at
      ) VALUES (
        ${contractorId},
        'unblock',
        0,
        0,
        ${reason || 'Contractor unblocked'},
        ${unblockedBy},
        NOW()
      )
    `;

    log.info('Contractor unblocked', { contractorId, unblockedBy }, 'field-stock');

    createAuditLog({
      entityType: 'contractor_accountability',
      entityId: contractorId,
      action: 'update',
      performedBy: 'system',
      performedByName: unblockedBy,
      newValues: { isBlocked: false, reason: reason || 'Contractor unblocked' },
    });

    return apiResponse.success(res, result[0]);
  } catch (error: unknown) {
    log.error('Error unblocking contractor', { error, contractorId }, 'field-stock');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
