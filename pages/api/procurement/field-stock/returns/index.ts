/**
 * Stock Returns API
 * GET /api/procurement/field-stock/returns - List returns (role-scoped, see _list.ts)
 * POST /api/procurement/field-stock/returns - Create return
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { sql } from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { isReturnCreator } from '@/modules/field-stock-pwa/lib/storesRoles';
import { handleList } from './_list';

// Valid CHECK constraint values
const VALID_RETURN_REASONS = ['unused', 'job_cancelled', 'wrong_item', 'excess', 'faulty', 'customer_refused'] as const;
const VALID_CONDITIONS = ['new', 'good', 'fair', 'poor', 'damaged', 'non_functional'] as const;

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method === 'GET') {
    return handleList(req, res);
  } else if (req.method === 'POST') {
    return handleCreate(req, res);
  }
  return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['GET', 'POST']);
}

async function handleCreate(req: NextApiRequest, res: NextApiResponse) {
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
    const returnedByName = `${staffRow.first_name ?? ''} ${staffRow.last_name ?? ''}`.trim();

    if (!isReturnCreator(staffRole as Parameters<typeof isReturnCreator>[0], authRole)) {
      return apiResponse.forbidden(res, 'Insufficient role to create a return');
    }

    const {
      originalPickingId,
      returnToLocationId,
      lines,
      notes,
      idempotencyKey,
    } = req.body;

    // ── Idempotency check ──────────────────────────────────────────────────────
    if (idempotencyKey && typeof idempotencyKey === 'string' && idempotencyKey.trim() !== '') {
      const existing = await sql`
        SELECT id, return_number, status
        FROM stock_returns
        WHERE idempotency_key = ${idempotencyKey}
        LIMIT 1
      `;
      if (existing[0]) {
        log.warn('returns.create.idempotent_replay', { idempotencyKey, returnId: existing[0].id });
        return apiResponse.success(res, existing[0]);
      }
    }

    // ── Input validation ───────────────────────────────────────────────────────
    if (!returnToLocationId) {
      return apiResponse.validationError(res, { returnToLocationId: 'Return location is required' });
    }

    if (!lines || !Array.isArray(lines) || lines.length === 0) {
      return apiResponse.validationError(res, { lines: 'At least one return line is required' });
    }

    // Validate per-line fields against CHECK constraints
    for (const line of lines) {
      if (!line.stockItemId || typeof line.stockItemId !== 'string' || line.stockItemId.trim() === '') {
        return apiResponse.validationError(res, { stockItemId: 'stockItemId is required on each line' });
      }
      if (line.returnReason !== undefined && line.returnReason !== null) {
        if (!(VALID_RETURN_REASONS as ReadonlyArray<string>).includes(line.returnReason)) {
          return apiResponse.validationError(res, {
            returnReason: `Invalid returnReason "${line.returnReason}". Must be one of: ${VALID_RETURN_REASONS.join(', ')}`
          });
        }
      }
      if (line.condition !== undefined && line.condition !== null) {
        if (!(VALID_CONDITIONS as ReadonlyArray<string>).includes(line.condition)) {
          return apiResponse.validationError(res, {
            condition: `Invalid condition "${line.condition}". Must be one of: ${VALID_CONDITIONS.join(', ')}`
          });
        }
      }
    }

    // ── Generate return number via SQL function (race-safe) ────────────────────
    const numResult = await sql`SELECT generate_return_number() AS num`;
    const returnNumber = numResult[0]?.num as string;

    // ── Create return header ───────────────────────────────────────────────────
    const returnResult = await sql`
      INSERT INTO stock_returns (
        return_number,
        original_picking_id,
        returned_by_id,
        returned_by_name,
        return_to_location_id,
        status,
        notes,
        return_date,
        idempotency_key
      ) VALUES (
        ${returnNumber},
        ${originalPickingId || null},
        ${staffId},
        ${returnedByName || null},
        ${returnToLocationId},
        'pending',
        ${notes || null},
        NOW(),
        ${(idempotencyKey && typeof idempotencyKey === 'string' && idempotencyKey.trim() !== '') ? idempotencyKey : null}
      )
      RETURNING *
    `;

    const returnRecord = returnResult[0];
    if (!returnRecord) {
      return apiResponse.internalError(res, new Error('Failed to create return'));
    }

    const returnId = returnRecord.id as string;

    // ── Create return lines ────────────────────────────────────────────────────
    for (const line of lines) {
      await sql`
        INSERT INTO stock_return_lines (
          return_id,
          stock_item_id,
          serial_id,
          serial_number,
          quantity,
          condition,
          return_reason,
          notes
        ) VALUES (
          ${returnId},
          ${line.stockItemId},
          ${line.serialId || null},
          ${line.serialNumber || null},
          ${line.quantity || 1},
          ${line.condition || 'good'},
          ${line.returnReason || 'unused'},
          ${line.notes || null}
        )
      `;
    }

    // ── Fetch complete return with lines ───────────────────────────────────────
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
              'notes', rl.notes
            )
          )
          FROM stock_return_lines rl
          WHERE rl.return_id = r.id
        ) as lines
      FROM stock_returns r
      WHERE r.id = ${returnId}
    `;

    log.info('returns.create', { staffId, returnNumber, lineCount: lines.length, idempotencyKey: idempotencyKey ?? null });
    return apiResponse.created(res, result[0]);
  } catch (error: unknown) {
    log.error('Error creating return', { error }, 'field-stock');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
