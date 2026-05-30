/**
 * Accept Return API
 * POST /api/procurement/field-stock/returns/[returnId]/accept
 * Accept inspected return and restock items
 *
 * Sprint D: returnable disposition now calls postReturnFromHolderWith which
 * debits stock_custody for the identified holder and credits stock_quants at
 * the return-to location in a single atomic movement.  All dispositions clear
 * stock_serials.holder_id so no stale holder reference survives acceptance.
 *
 * Null-holder fallback: when neither returned_by_id nor contractor_id resolves
 * a holder the old manual quant credit is used instead, so returns without an
 * identified holder continue to work correctly.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { queryOne, transaction } from '@/lib/db-pool';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { createAuditLog } from '@/services/procurement/auditService';
import { isReturnInspector } from '@/modules/field-stock-pwa/lib/storesRoles';
import {
  postReturnFromHolderWith,
  type CustodyLine,
} from '@/modules/procurement/field-stock/services/custodyService';
import {
  getOrCreateStaffHolder,
  getOrCreateContractorHolder,
} from '@/modules/procurement/field-stock/services/stockHolderService';
import {
  promoteSerial,
  LifecycleViolationError,
  HolderMismatchError,
} from '@/modules/procurement/field-stock/services/serialLifecycle';

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

    const staffRow = await queryOne<{ id: string; role: string; auth_role: string }>(
      `SELECT s.id, s.role, u.role AS auth_role
       FROM staff s
       JOIN users u ON u.id = s.user_id
       WHERE u.id = $1
       LIMIT 1`,
      [userId]
    );

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
    const returnRecord = await queryOne(
      `SELECT
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
       WHERE r.id = $1
       GROUP BY r.id`,
      [returnId]
    );
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

    // ── Resolve returning holder ONCE (before entering the transaction) ────────
    // getOrCreateStaff/ContractorHolder use the pool directly — safe outside txn.
    let fromHolderId: string | null = null;

    if (returnRecord.returned_by_id) {
      const holder = await getOrCreateStaffHolder(
        returnRecord.returned_by_id as string,
        (returnRecord.returned_by_name as string | null) ?? 'staff',
      );
      fromHolderId = holder.id;
    } else if (returnRecord.contractor_id) {
      const holder = await getOrCreateContractorHolder(
        returnRecord.contractor_id as string,
        (returnRecord.contractor_name as string | null) ?? 'contractor',
      );
      fromHolderId = holder.id;
    } else {
      log.warn('returns.accept.no_holder_resolved', { returnId }, 'field-stock');
    }

    // ── Atomic transaction: all line mutations + status update ─────────────────
    let linesProcessed = 0;

    await transaction(async (txn) => {
      for (const line of lines) {
        if (!line || !line.stock_item_id) continue;

        const disposition = line.disposition || 'restock';

        if (disposition === 'supplier_return') {
          log.error('returns.accept.supplier_return_not_supported', { returnId, lineId: line.id }, 'field-stock');
          throw new Error('supplier_return is not yet supported. Re-inspect with restock/repair/scrap.');
        }

        if (disposition === 'restock') {
          if (fromHolderId) {
            // Custody-aware path: debit holder custody + credit warehouse quant +
            // insert field_stock_movements 'return' row — all via postReturnFromHolderWith.
            const custodyLine: CustodyLine = {
              stockItemId: line.stock_item_id,
              quantity: Number(line.quantity ?? 1),
              lotNumber: null,
              unitCost: null,
            };
            await postReturnFromHolderWith(txn, {
              lines: [custodyLine],
              fromHolderId,
              toLocationId: returnToLocationId,
              reference: returnRecord.return_number as string | undefined,
              performedBy: (returnRecord.inspected_by as string | null) ?? undefined,
            });
          } else {
            // Null-holder fallback: no custody debit, credit warehouse quant directly.
            // The stock_quants unique index is on
            //   (stock_item_id, location_id, COALESCE(lot_number, ''))
            await txn.query(
              `INSERT INTO stock_quants (stock_item_id, location_id, quantity, last_movement_date)
               VALUES ($1, $2, $3, NOW())
               ON CONFLICT (stock_item_id, location_id, (COALESCE(lot_number, ''::varchar)))
               DO UPDATE SET
                 quantity = stock_quants.quantity + $3,
                 last_movement_date = NOW(),
                 updated_at = NOW()`,
              [line.stock_item_id, returnToLocationId, line.quantity]
            );
          }

          // Return to warehouse stock. Status + holder route through promoteSerial
          // (returned→in_stock, 'restocked' event, holder cleared); the location
          // is non-status metadata so it stays a plain UPDATE.
          if (line.serial_id) {
            await promoteSerial(txn.client, {
              serialId:     line.serial_id,
              toStatus:     'in_stock',
              toHolderId:   null,
              sourceTable:  'stock_returns',
              sourceId:     returnId,
              actorStaffId: staffId,
              payload: {
                disposition,
                line_id: line.id,
                return_number: returnRecord.return_number,
              },
            });
            await txn.query(
              `UPDATE stock_serials SET current_location_id = $1, updated_at = NOW() WHERE id = $2`,
              [returnToLocationId, line.serial_id]
            );
          }
        } else if (disposition === 'scrap') {
          // TODO(sprintD-fast-follow): custody debit for scrap dispositions pending business rule
          // Routes through promoteSerial so mig 387 AFTER trigger emits stock_serial_events
          // post-cutover. Pre-cutover: same UPDATE behaviour, no triggers fire.
          // Both paths clear holder_id (NULL) — warehouse-resident via stock_quants.
          // At acceptance the serial is already 'returned' (set at creation via
          // promoteSerial), so this is the matrixed returned→scrapped transition.
          if (line.serial_id) {
            await promoteSerial(txn.client, {
              serialId:    line.serial_id,
              toStatus:    'scrapped',
              toHolderId:  null,
              sourceTable: 'stock_returns',
              sourceId:    returnId,
              actorStaffId: staffId,
              payload: {
                disposition,
                line_id: line.id,
                return_number: returnRecord.return_number,
              },
            });
          }
        } else if (disposition === 'repair') {
          // TODO(sprintD-fast-follow): custody debit for faulty/repair dispositions pending business rule
          // Routes through promoteSerial so mig 387 AFTER trigger emits stock_serial_events
          // post-cutover. Pre-cutover: same UPDATE behaviour, no triggers fire.
          // Both paths clear holder_id (NULL) — warehouse-resident via stock_quants.
          // At acceptance the serial is already 'returned', so this is the matrixed
          // returned→faulty transition (disposition=repair, inspected faulty).
          if (line.serial_id) {
            await promoteSerial(txn.client, {
              serialId:    line.serial_id,
              toStatus:    'faulty',
              toHolderId:  null,
              sourceTable: 'stock_returns',
              sourceId:    returnId,
              actorStaffId: staffId,
              payload: {
                disposition,
                line_id: line.id,
                return_number: returnRecord.return_number,
              },
            });
          }
        }

        // Mark line as processed
        await txn.query(
          `UPDATE stock_return_lines SET status = 'processed' WHERE id = $1`,
          [line.id]
        );

        linesProcessed++;
      }

      // Update return status to restocked
      await txn.query(
        `UPDATE stock_returns SET status = 'restocked', updated_at = NOW() WHERE id = $1`,
        [returnId]
      );
    });

    // ── Fetch final state ──────────────────────────────────────────────────────
    const result = await queryOne(
      `SELECT * FROM stock_returns WHERE id = $1`,
      [returnId]
    );

    log.info('returns.accept', { returnId, staffId, linesProcessed });

    createAuditLog({
      entityType: 'stock_return',
      entityId: returnId,
      action: 'update',
      performedBy: staffId,
      newValues: { status: 'restocked', linesProcessed },
    });

    return apiResponse.success(res, result);
  } catch (error: unknown) {
    if (error instanceof LifecycleViolationError || error instanceof HolderMismatchError) {
      log.warn('returns.accept.lifecycle_rejected', { error: error.message, returnId }, 'field-stock');
      return apiResponse.validationError(res, { serial: error.message });
    }
    const msg = error instanceof Error ? error.message : String(error);
    if (msg.includes('supplier_return is not yet supported')) {
      return apiResponse.validationError(res, { disposition: msg });
    }
    log.error('Error accepting return', { error, returnId }, 'field-stock');
    return apiResponse.internalError(res, error);
  }
}

export default withAuth(handler);
