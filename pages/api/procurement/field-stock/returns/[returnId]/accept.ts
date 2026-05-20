/**
 * Accept Return API
 * POST /api/procurement/field-stock/returns/[returnId]/accept
 * Accept inspected return and restock items
 *
 * Note on transactions: the @neondatabase/serverless shim routes each sql``
 * call through a pg.Pool — each call gets its own connection. True transactional
 * isolation requires a dedicated client. We use pg.Client via the shim's
 * re-exported Client to wrap the accept body in an explicit transaction.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon, Client } from '@neondatabase/serverless';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { createAuditLog } from '@/services/procurement/auditService';
import { isReturnInspector } from '@/modules/field-stock-pwa/lib/storesRoles';

const sql = neon(process.env.DATABASE_URL!);

interface ReturnLine {
  id: string;
  stock_item_id: string;
  serial_id?: string;
  quantity: number;
  disposition?: string;
}

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
      SELECT s.id, s.role, u.role AS auth_role
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

    if (!isReturnInspector(staffRole as Parameters<typeof isReturnInspector>[0], authRole)) {
      return apiResponse.forbidden(res, 'Insufficient role to accept a return');
    }

    // ── Get return with lines ──────────────────────────────────────────────────
    const existing = await sql`
      SELECT
        r.*,
        json_agg(
          json_build_object(
            'id', rl.id,
            'stock_item_id', rl.stock_item_id,
            'serial_id', rl.serial_id,
            'quantity', rl.quantity,
            'disposition', rl.disposition
          )
        ) as lines
      FROM stock_returns r
      LEFT JOIN stock_return_lines rl ON rl.return_id = r.id
      WHERE r.id = ${returnId}
      GROUP BY r.id
    `;

    const returnRecord = existing[0];
    if (!returnRecord) {
      return apiResponse.notFound(res, 'Return', returnId);
    }

    if (returnRecord.status !== 'inspected') {
      return apiResponse.validationError(res, {
        status: `Cannot accept return with status "${returnRecord.status}". Only inspected returns can be accepted.`
      });
    }

    const returnToLocationId = returnRecord.return_to_location_id as string;
    const lines: ReturnLine[] = (returnRecord.lines as ReturnLine[]) || [];

    // ── Atomic transaction: BEGIN/COMMIT/ROLLBACK ──────────────────────────────
    // The neon shim re-exports pg.Client; use a dedicated connection for the
    // transaction so BEGIN and COMMIT are on the same connection.
    const connectionString = process.env.DATABASE_URL!;
    const client = new Client({ connectionString });
    await client.connect();

    let linesProcessed = 0;

    try {
      await client.query('BEGIN');

      for (const line of lines) {
        if (!line || !line.stock_item_id) continue;

        const disposition = line.disposition || 'restock';

        if (disposition === 'supplier_return') {
          await client.query('ROLLBACK');
          log.error('returns.accept.supplier_return_not_supported', { returnId, lineId: line.id }, 'field-stock');
          return apiResponse.validationError(res, {
            disposition: 'supplier_return is not yet supported. Re-inspect with restock/repair/scrap.',
          });
        }

        if (disposition === 'restock') {
          // Add back to destination quant
          // The stock_quants unique index is on
          //   (stock_item_id, location_id, COALESCE(lot_number, ''))
          // so the ON CONFLICT target MUST match that expression — using the
          // bare 3-column form throws "no unique or exclusion constraint matching".
          await client.query(
            `INSERT INTO stock_quants (stock_item_id, location_id, quantity, last_movement_date)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (stock_item_id, location_id, (COALESCE(lot_number, ''::varchar)))
             DO UPDATE SET
               quantity = stock_quants.quantity + $3,
               last_movement_date = NOW(),
               updated_at = NOW()`,
            [line.stock_item_id, returnToLocationId, line.quantity]
          );

          // Update serial if applicable
          if (line.serial_id) {
            await client.query(
              `UPDATE stock_serials
               SET current_location_id = $1, status = 'available', updated_at = NOW()
               WHERE id = $2`,
              [returnToLocationId, line.serial_id]
            );
          }
        } else if (disposition === 'scrap') {
          // Mark serial as scrapped
          if (line.serial_id) {
            await client.query(
              `UPDATE stock_serials SET status = 'scrapped', updated_at = NOW() WHERE id = $1`,
              [line.serial_id]
            );
          }
        } else if (disposition === 'repair') {
          // Mark serial as faulty (awaiting repair)
          if (line.serial_id) {
            await client.query(
              `UPDATE stock_serials SET status = 'faulty', updated_at = NOW() WHERE id = $1`,
              [line.serial_id]
            );
          }
        }

        // Audit trail: stock_movements integration deferred to Phase 4.
        // The actual stock_movements schema is project-based with required
        // project_id / movement_type / reference_number / movement_date columns
        // and string from_location/to_location — different from what this
        // handler was originally written against. The INSERT here always
        // failed silently in earlier code paths. Restock-line accountability
        // is captured by stock_serials.status, stock_quants.quantity, and
        // stock_return_lines.status/disposition (all updated atomically above),
        // so removing the broken insert lets the load-bearing transaction
        // complete. Proper audit integration tracked for Phase 4.

        // Mark line as processed
        await client.query(
          `UPDATE stock_return_lines SET status = 'processed' WHERE id = $1`,
          [line.id]
        );

        linesProcessed++;
      }

      // Update return status to restocked
      await client.query(
        `UPDATE stock_returns SET status = 'restocked', updated_at = NOW() WHERE id = $1`,
        [returnId]
      );

      await client.query('COMMIT');
    } catch (txError: unknown) {
      await client.query('ROLLBACK');
      log.error('returns.accept.partial_failure', { error: txError, returnId }, 'field-stock');
      return apiResponse.internalError(res, txError);
    } finally {
      await client.end();
    }

    // ── Fetch final state ──────────────────────────────────────────────────────
    const result = await sql`
      SELECT * FROM stock_returns WHERE id = ${returnId}
    `;

    log.info('returns.accept', { returnId, staffId, linesProcessed });

    createAuditLog({
      entityType: 'stock_return',
      entityId: returnId,
      action: 'update',
      performedBy: staffId,
      newValues: { status: 'restocked', linesProcessed },
    });

    return apiResponse.success(res, result[0]);
  } catch (error: unknown) {
    log.error('Error accepting return', { error, returnId }, 'field-stock');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
