/**
 * Block Contractor API
 * POST /api/procurement/field-stock/accountability/[contractorId]/block
 * Block contractor from receiving new stock (SOP 4.4)
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
    const { reason, blockedBy } = req.body;

    if (!reason) {
      return apiResponse.validationError(res, { reason: 'Block reason is required' });
    }

    if (!blockedBy) {
      return apiResponse.validationError(res, { blockedBy: 'Blocker name is required' });
    }

    // Check if record exists
    const existing = await sql`
      SELECT id, is_blocked FROM contractor_stock_accountability
      WHERE contractor_id = ${contractorId}
    `;

    const record = existing[0];
    if (!record) {
      return apiResponse.notFound(res, 'Contractor accountability', contractorId);
    }

    if (record.is_blocked) {
      return apiResponse.validationError(res, {
        contractorId: 'Contractor is already blocked'
      });
    }

    // Block the contractor
    const result = await sql`
      UPDATE contractor_stock_accountability
      SET
        is_blocked = true,
        blocked_reason = ${reason},
        blocked_at = NOW(),
        blocked_by = ${blockedBy},
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
        'block',
        0,
        0,
        ${reason},
        ${blockedBy},
        NOW()
      )
    `;

    log.info('Contractor blocked', { contractorId, reason, blockedBy }, 'field-stock');

    createAuditLog({
      entityType: 'contractor_accountability',
      entityId: contractorId,
      action: 'update',
      performedBy: 'system',
      performedByName: blockedBy,
      newValues: { isBlocked: true, reason },
    });

    return apiResponse.success(res, result[0]);
  } catch (error: unknown) {
    log.error('Error blocking contractor', { error, contractorId }, 'field-stock');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
