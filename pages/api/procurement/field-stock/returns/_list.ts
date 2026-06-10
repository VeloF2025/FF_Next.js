/**
 * handleList / listReturns — GET /api/procurement/field-stock/returns
 *
 * listReturns(req, res, ctx) — shared core: inspectors see all returns;
 * creator-only callers (technician) see only their own submissions.
 * handleList(req, res) — withAuth entry: resolves actor from req.user.id.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { sql } from '@/lib/db';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { isReturnInspector } from '@/modules/field-stock-pwa/lib/storesRoles';

export interface ListReturnsCtx {
  callerStaffId: string;
  callerIsInspector: boolean;
}

export async function listReturns(
  req: NextApiRequest,
  res: NextApiResponse,
  ctx: ListReturnsCtx,
): Promise<void> {
  const { callerStaffId, callerIsInspector } = ctx;

  try {
    // For non-inspectors, ignore any client-supplied returnedBy and always
    // scope to the caller's own staff id.
    const { status } = req.query;
    const returnedByParam =
      callerIsInspector && req.query.returnedBy && typeof req.query.returnedBy === 'string'
        ? req.query.returnedBy
        : null;

    // ── Queries (4 branches to keep tagged-template literals clean) ──────────
    let result;

    if (callerIsInspector) {
      // Inspector path: honour both optional filter params.
      if (status && typeof status === 'string' && returnedByParam) {
        result = await sql`
          SELECT
            r.*,
            sl.name as return_location_name,
            sl.code as return_location_code,
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
                  'notes', rl.notes,
                  'item_name', si.name,
                  'item_code', si.item_code
                )
              )
              FROM stock_return_lines rl
              LEFT JOIN stock_items si ON si.id = rl.stock_item_id
              WHERE rl.return_id = r.id
            ) as lines
          FROM stock_returns r
          LEFT JOIN stock_locations sl ON sl.id = r.return_to_location_id
          WHERE r.status = ${status} AND r.returned_by_id = ${returnedByParam}
          ORDER BY r.created_at DESC
          LIMIT 50
        `;
      } else if (status && typeof status === 'string') {
        result = await sql`
          SELECT
            r.*,
            sl.name as return_location_name,
            sl.code as return_location_code,
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
                  'notes', rl.notes,
                  'item_name', si.name,
                  'item_code', si.item_code
                )
              )
              FROM stock_return_lines rl
              LEFT JOIN stock_items si ON si.id = rl.stock_item_id
              WHERE rl.return_id = r.id
            ) as lines
          FROM stock_returns r
          LEFT JOIN stock_locations sl ON sl.id = r.return_to_location_id
          WHERE r.status = ${status}
          ORDER BY r.created_at DESC
          LIMIT 50
        `;
      } else if (returnedByParam) {
        result = await sql`
          SELECT
            r.*,
            sl.name as return_location_name,
            sl.code as return_location_code,
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
                  'notes', rl.notes,
                  'item_name', si.name,
                  'item_code', si.item_code
                )
              )
              FROM stock_return_lines rl
              LEFT JOIN stock_items si ON si.id = rl.stock_item_id
              WHERE rl.return_id = r.id
            ) as lines
          FROM stock_returns r
          LEFT JOIN stock_locations sl ON sl.id = r.return_to_location_id
          WHERE r.returned_by_id = ${returnedByParam}
          ORDER BY r.created_at DESC
          LIMIT 50
        `;
      } else {
        result = await sql`
          SELECT
            r.*,
            sl.name as return_location_name,
            sl.code as return_location_code,
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
                  'notes', rl.notes,
                  'item_name', si.name,
                  'item_code', si.item_code
                )
              )
              FROM stock_return_lines rl
              LEFT JOIN stock_items si ON si.id = rl.stock_item_id
              WHERE rl.return_id = r.id
            ) as lines
          FROM stock_returns r
          LEFT JOIN stock_locations sl ON sl.id = r.return_to_location_id
          ORDER BY r.created_at DESC
          LIMIT 50
        `;
      }
    } else {
      // Creator-only path: always scope to caller's own staff id.
      if (status && typeof status === 'string') {
        result = await sql`
          SELECT
            r.*,
            sl.name as return_location_name,
            sl.code as return_location_code,
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
                  'notes', rl.notes,
                  'item_name', si.name,
                  'item_code', si.item_code
                )
              )
              FROM stock_return_lines rl
              LEFT JOIN stock_items si ON si.id = rl.stock_item_id
              WHERE rl.return_id = r.id
            ) as lines
          FROM stock_returns r
          LEFT JOIN stock_locations sl ON sl.id = r.return_to_location_id
          WHERE r.status = ${status} AND r.returned_by_id = ${callerStaffId}
          ORDER BY r.created_at DESC
          LIMIT 50
        `;
      } else {
        result = await sql`
          SELECT
            r.*,
            sl.name as return_location_name,
            sl.code as return_location_code,
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
                  'notes', rl.notes,
                  'item_name', si.name,
                  'item_code', si.item_code
                )
              )
              FROM stock_return_lines rl
              LEFT JOIN stock_items si ON si.id = rl.stock_item_id
              WHERE rl.return_id = r.id
            ) as lines
          FROM stock_returns r
          LEFT JOIN stock_locations sl ON sl.id = r.return_to_location_id
          WHERE r.returned_by_id = ${callerStaffId}
          ORDER BY r.created_at DESC
          LIMIT 50
        `;
      }
    }

    log.info('returns.list', {
      callerStaffId,
      callerIsInspector,
      status: (req.query.status as string) ?? null,
      returnedBy: returnedByParam ?? callerStaffId,
    }, 'field-stock');

    return void apiResponse.success(res, result);
  } catch (error: unknown) {
    log.error('Error listing returns', { error }, 'field-stock');
    return void apiResponse.internalError(res, error);
  }
}

export async function handleList(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  const userId = (req as AuthenticatedNextApiRequest).user?.id;
  if (!userId) return void apiResponse.unauthorized(res, 'User session required');
  let staffRows;
  try {
    staffRows = await sql`
      SELECT s.id, s.role, u.role AS auth_role FROM staff s
      JOIN users u ON u.id = s.user_id WHERE u.id = ${userId} LIMIT 1
    `;
  } catch (error: unknown) {
    log.error('Error resolving caller staff for returns list', { error }, 'field-stock');
    return void apiResponse.internalError(res, error);
  }
  const staffRow = staffRows[0];
  if (!staffRow) return void apiResponse.forbidden(res, 'No staff record linked to user');
  return listReturns(req, res, {
    callerStaffId: staffRow.id as string,
    callerIsInspector: isReturnInspector(
      staffRow.role as Parameters<typeof isReturnInspector>[0],
      staffRow.auth_role as string,
    ),
  });
}

// Re-export withAuth for convenience (used by the index route only — this file
// is _not_ a Next.js route itself so no default export is needed).
export { withAuth };
