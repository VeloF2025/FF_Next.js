/**
 * Inspect Return API
 * POST /api/procurement/field-stock/returns/[returnId]/inspect
 * Mark return as inspected and update line dispositions
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { createAuditLog } from '@/services/procurement/auditService';
import { isReturnInspector } from '@/modules/field-stock-pwa/lib/storesRoles';

const sql = neon(process.env.DATABASE_URL!);

// Valid CHECK constraint values
const VALID_CONDITIONS = ['new', 'good', 'fair', 'poor', 'damaged', 'non_functional'] as const;
const VALID_DISPOSITIONS = ['restock', 'repair', 'scrap', 'supplier_return'] as const;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { returnId } = req.query;

  if (typeof returnId !== 'string') {
    return apiResponse.validationError(res, { returnId: 'Return ID is required' });
  }

  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  try {
    // ── Role gate ──────────────────────────────────────────────────────────────
    const userId = (req as AuthenticatedNextApiRequest).user?.id;
    if (!userId) {
      return apiResponse.unauthorized(res, 'User session required');
    }

    const staffRows = await sql`
      SELECT s.id, s.role, s.first_name, s.last_name, u.role AS auth_role
      FROM staff s
      JOIN users u ON u.id = s.user_id
      WHERE u.id = ${userId}
      LIMIT 1
    `;
    const staffRow = staffRows[0];

    if (!staffRow) {
      return apiResponse.forbidden(res, 'No staff record linked to user');
    }

    const staffId = staffRow.id as string;
    const staffRole = staffRow.role as string;
    const authRole = staffRow.auth_role as string;
    const inspectedBy = `${staffRow.first_name ?? ''} ${staffRow.last_name ?? ''}`.trim();

    if (!isReturnInspector(staffRole as Parameters<typeof isReturnInspector>[0], authRole)) {
      return apiResponse.forbidden(res, 'Insufficient role to inspect a return');
    }

    const { inspectionNotes, lineDispositions } = req.body;

    // ── Validate lineDispositions values ───────────────────────────────────────
    if (lineDispositions && typeof lineDispositions === 'object') {
      for (const [lineId, disposition] of Object.entries(lineDispositions)) {
        if (!disposition || typeof disposition !== 'object') continue;
        const d = disposition as { condition?: string; disposition?: string; notes?: string };

        if (d.condition !== undefined && d.condition !== null) {
          if (!(VALID_CONDITIONS as ReadonlyArray<string>).includes(d.condition)) {
            log.warn('returns.inspect.invalid_disposition', {
              returnId,
              lineId,
              field: 'condition',
              value: d.condition,
            });
            return apiResponse.validationError(res, {
              [lineId]: `Invalid condition "${d.condition}" for line ${lineId}. Must be one of: ${VALID_CONDITIONS.join(', ')}`
            });
          }
        }

        if (d.disposition !== undefined && d.disposition !== null) {
          if (!(VALID_DISPOSITIONS as ReadonlyArray<string>).includes(d.disposition)) {
            log.warn('returns.inspect.invalid_disposition', {
              returnId,
              lineId,
              field: 'disposition',
              value: d.disposition,
            });
            return apiResponse.validationError(res, {
              [lineId]: `Invalid disposition "${d.disposition}" for line ${lineId}. Must be one of: ${VALID_DISPOSITIONS.join(', ')}`
            });
          }
        }
      }
    }

    // ── Check current status ───────────────────────────────────────────────────
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

    // ── Update return header ───────────────────────────────────────────────────
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

    // ── Update line dispositions and set status='inspected' ───────────────────
    const lineCount = lineDispositions ? Object.keys(lineDispositions).length : 0;
    if (lineDispositions && typeof lineDispositions === 'object') {
      for (const [lineId, disposition] of Object.entries(lineDispositions)) {
        if (disposition && typeof disposition === 'object') {
          const d = disposition as { condition?: string; disposition?: string; notes?: string };
          // IDOR guard: scope the UPDATE to lines that belong to THIS return.
          // Without this, an authenticated inspector could mutate stock_return_lines
          // from any other return by passing arbitrary lineIds in the body.
          await sql`
            UPDATE stock_return_lines
            SET
              condition = COALESCE(${d.condition || null}, condition),
              disposition = COALESCE(${d.disposition || null}, disposition),
              notes = COALESCE(${d.notes || null}, notes),
              status = 'inspected'
            WHERE id = ${lineId}
              AND return_id = ${returnId}
          `;
        }
      }
    }

    // ── Fetch updated return ───────────────────────────────────────────────────
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
              'status', rl.status,
              'notes', rl.notes
            )
          )
          FROM stock_return_lines rl
          WHERE rl.return_id = r.id
        ) as lines
      FROM stock_returns r
      WHERE r.id = ${returnId}
    `;

    log.info('returns.inspect', { returnId, staffId, lineCount });

    createAuditLog({
      entityType: 'stock_return',
      entityId: returnId,
      action: 'update',
      performedBy: staffId,
      newValues: { status: 'inspected', inspectedBy },
    });

    return apiResponse.success(res, result[0]);
  } catch (error: unknown) {
    log.error('Error inspecting return', { error, returnId }, 'field-stock');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
