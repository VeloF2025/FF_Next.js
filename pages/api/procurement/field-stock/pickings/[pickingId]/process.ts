/**
 * Process Picking API
 * POST /api/procurement/field-stock/pickings/[pickingId]/process
 *
 * Fix VF-20260331-048: stock availability validation + explicit transaction.
 * Sprint D: issue pickings post into holder custody via postIssueToHolderWith.
 * Sprint E Track 2.2: serial status writes route through promoteSerial so
 * mig 387 triggers can emit stock_serial_events with source_table='stock_pickings'.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { transaction } from '@/lib/db-pool';
import type { TxnClient } from '@/lib/db-pool';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth } from '@/lib/auth';
import { createAuditLog } from '@/services/procurement/auditService';
import { postIssueToHolderWith } from '@/modules/procurement/field-stock/services/custodyService';
import {
  getHolderById,
  getOrCreateStaffHolder,
  getOrCreateContractorHolder,
} from '@/modules/procurement/field-stock/services/stockHolderService';
import { promotePickingSerials } from '@/modules/procurement/field-stock/services/pickingSerialPromotion';
import { assertHolderNotBlocked, HolderBlockedError } from '@/modules/procurement/field-stock/services/holderBlockGuard';

interface PickingLine {
  id: string;
  stock_item_id: string;
  planned_quantity: number;
  serial_ids?: string[];
  lot_number?: string | null;
  unit_cost?: number | null;
}

interface StockQuantRow extends Record<string, unknown> {
  quantity: number;
}

interface Picking {
  id: string;
  picking_number: string;
  picking_type: string;
  source_location_id: string;
  destination_location_id: string;
  status: string;
  holder_id: string | null;
  technician_id: string | null;
  technician_name: string | null;
  contractor_id: string | null;
  contractor_name: string | null;
  signed_by: string | null;
  lines: PickingLine[];
}

/** Verify every picking line has sufficient stock at source (runs inside txn with FOR UPDATE). */
async function validateStockAvailability(
  txn: TxnClient,
  lines: PickingLine[],
  sourceLocationId: string,
): Promise<{ valid: true } | { valid: false; errors: Record<string, string> }> {
  const errors: Record<string, string> = {};
  for (const line of lines) {
    if (!line || !line.stock_item_id) continue;
    const quants = await txn.query<StockQuantRow>(
      `SELECT quantity FROM stock_quants WHERE stock_item_id = $1 AND location_id = $2 FOR UPDATE`,
      [line.stock_item_id, sourceLocationId],
    );
    if (quants.length === 0) {
      errors[line.stock_item_id] = `No stock record for item ${line.stock_item_id} at source ${sourceLocationId}`;
      continue;
    }
    const available = Number(quants[0]!.quantity);
    if (available < line.planned_quantity) {
      errors[line.stock_item_id] =
        `Insufficient stock for ${line.stock_item_id}: required ${line.planned_quantity}, available ${available}`;
    }
  }
  return Object.keys(errors).length > 0 ? { valid: false, errors } : { valid: true };
}

async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { pickingId } = req.query;
  if (typeof pickingId !== 'string') {
    return apiResponse.validationError(res, { pickingId: 'Picking ID is required' });
  }
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method || 'UNKNOWN', ['POST']);
  }

  let finalPicking: unknown;
  try {
    finalPicking = await transaction(async (txn) => {
      // Fetch picking + lines inside txn for consistent read
      const rows = await txn.query<Record<string, unknown>>(
        `SELECT p.id, p.picking_number, p.picking_type,
                p.source_location_id, p.destination_location_id,
                p.status, p.holder_id,
                p.technician_id, p.technician_name,
                p.contractor_id, p.contractor_name,
                p.signed_by,
                json_agg(json_build_object(
                  'id', pl.id, 'stock_item_id', pl.stock_item_id,
                  'planned_quantity', pl.planned_quantity, 'serial_ids', pl.serial_ids,
                  'lot_number', pl.lot_number, 'unit_cost', pl.unit_cost
                )) AS lines
         FROM stock_pickings p
         LEFT JOIN stock_picking_lines pl ON pl.picking_id = p.id
         WHERE p.id = $1 GROUP BY p.id`,
        [pickingId],
      );

      const picking = rows[0] as Picking | undefined;
      if (!picking) throw Object.assign(new Error('PICKING_NOT_FOUND'), { pickingId });
      if (picking.status !== 'confirmed') {
        throw Object.assign(new Error('PICKING_INVALID_STATUS'), { currentStatus: picking.status });
      }

      const { picking_type: pickingType, source_location_id: sourceLocationId,
              destination_location_id: destinationLocationId } = picking;
      const lines: PickingLine[] = (picking.lines ?? []).filter((l) => l && l.stock_item_id);

      // Availability check (FOR UPDATE inside txn)
      const avail = await validateStockAvailability(txn, lines, sourceLocationId);
      if (!avail.valid) {
        throw Object.assign(new Error('INSUFFICIENT_STOCK'), { stockErrors: avail.errors });
      }

      // Status guard: prevents double-processing
      await txn.query(
        `UPDATE stock_pickings SET status = 'processing', updated_at = NOW() WHERE id = $1`,
        [pickingId],
      );

      // Resolve recipient holder ONCE (issue pickings only)
      let toHolderId: string | null = null;
      if (pickingType === 'issue') {
        let holder;
        if (picking.holder_id) {
          holder = await getHolderById(picking.holder_id);
          if (!holder) throw new Error(`Issue picking holder_id ${picking.holder_id} not found in stock_holders`);
        } else if (picking.technician_id) {
          holder = await getOrCreateStaffHolder(picking.technician_id, picking.technician_name ?? 'technician');
        } else if (picking.contractor_id) {
          holder = await getOrCreateContractorHolder(picking.contractor_id, picking.contractor_name ?? 'contractor');
        } else {
          throw new Error(
            `Issue picking ${picking.picking_number} has no holder_id, technician_id, or contractor_id`,
          );
        }
        toHolderId = holder.id;
      }

      if (pickingType === 'issue' && toHolderId !== null) {
        // Sprint E Track 4.1 (SOP-4.4): refuse to issue to a blocked holder.
        // Runs first, inside the txn, before any custody/serial write — a block
        // throws, rolling back this txn's writes (the 'processing' status flag,
        // any serial promotion). Only a PRE-EXISTING holder can be blocked (the
        // block lives in stock_accountability), so the getOrCreate* resolution
        // above is a no-op on the throw path — nothing is left orphaned.
        await assertHolderNotBlocked(txn, toHolderId);

        // Issue path — custody service handles: debit stock_quants, credit stock_custody,
        // insert field_stock_movements 'issue' row. No manual duplication.
        await postIssueToHolderWith(txn, {
          lines: lines.map((l) => ({
            stockItemId: l.stock_item_id,
            quantity: Number(l.planned_quantity),
            lotNumber: l.lot_number ?? null,
            unitCost: l.unit_cost ?? null,
          })),
          sourceLocationId,
          toHolderId,
          reference: picking.picking_number,
          performedBy: picking.signed_by ?? undefined,
        });

        // Metadata first (current_location_id batched); then per-serial promoteSerial
        // routes status+holder through mig 387 triggers via the Track 2.2 helper.
        const allSerialIds = lines.flatMap((l) => l.serial_ids ?? []);
        if (allSerialIds.length > 0) {
          await txn.query(
            `UPDATE stock_serials SET current_location_id = NULL, updated_at = NOW()
             WHERE id = ANY($1::uuid[])`,
            [allSerialIds],
          );
          await promotePickingSerials(txn, allSerialIds, {
            toStatus:     'issued',
            toHolderId:   toHolderId,
            sourceId:     pickingId,
            actorStaffId: picking.signed_by ?? null,
            payload:      { picking_number: picking.picking_number },
          });
        }

        // Persist holder_id on picking if not already set
        await txn.query(
          `UPDATE stock_pickings SET holder_id = $1, updated_at = NOW() WHERE id = $2 AND holder_id IS NULL`,
          [toHolderId, pickingId],
        );

        // NOTE: the issue movement is already recorded in field_stock_movements
        // by postIssueToHolderWith() above. A previous "legacy" stock_movements
        // INSERT here referenced columns (picking_id, stock_item_id,
        // from_location_id, to_location_id, quantity, performed_at) that do NOT
        // exist on the stock_movements table — they belong to
        // field_stock_movements — so it threw `column "picking_id" of relation
        // "stock_movements" does not exist` on every issue, 500-ing the whole
        // process step. Removed (the field_stock_movements row is the audit record).
      } else {
        // Non-issue path (transfer, scrap, receipt, return) — original behavior
        for (const line of lines) {
          await txn.query(
            `UPDATE stock_quants SET quantity = quantity - $1,
             last_movement_date = NOW(), updated_at = NOW()
             WHERE stock_item_id = $2 AND location_id = $3`,
            [line.planned_quantity, line.stock_item_id, sourceLocationId],
          );
          await txn.query(
            `INSERT INTO stock_quants (stock_item_id, location_id, quantity, last_movement_date)
             VALUES ($1, $2, $3, NOW())
             ON CONFLICT (stock_item_id, location_id, lot_number)
             DO UPDATE SET quantity = stock_quants.quantity + $3,
               last_movement_date = NOW(), updated_at = NOW()`,
            [line.stock_item_id, destinationLocationId, line.planned_quantity],
          );
          if (Array.isArray(line.serial_ids) && line.serial_ids.length > 0) {
            // Metadata first; promoteSerial routes status through mig 387 triggers.
            // toStatus='in_stock' (Track 7 cutover vocabulary): a transfer leaves
            // the serials in stock at the destination, so for already-in-stock
            // units this is an in_stock→in_stock no-op that the validate/emit
            // triggers short-circuit. This commit deploys only after mig 387 +
            // the Track 5 backfill, when the widened CHECK accepts 'in_stock'.
            await txn.query(
              `UPDATE stock_serials SET current_location_id = $1, updated_at = NOW()
               WHERE id = ANY($2::uuid[])`,
              [destinationLocationId, line.serial_ids],
            );
            await promotePickingSerials(txn, line.serial_ids, {
              toStatus:     'in_stock',
              sourceId:     pickingId,
              actorStaffId: picking.signed_by ?? null,
              payload:      { picking_number: picking.picking_number, picking_type: pickingType },
            });
          }
          await txn.query(
            `INSERT INTO stock_movements (picking_id, stock_item_id, movement_type,
               from_location_id, to_location_id, quantity, performed_at)
             VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
            [pickingId, line.stock_item_id, pickingType, sourceLocationId, destinationLocationId, line.planned_quantity],
          );
        }
      }

      // Mark all lines done
      for (const line of lines) {
        await txn.query(
          `UPDATE stock_picking_lines SET status = 'done', actual_quantity = planned_quantity WHERE id = $1`,
          [line.id],
        );
      }

      // Finalise picking
      const updated = await txn.query<Record<string, unknown>>(
        `UPDATE stock_pickings SET status = 'done', effective_date = NOW(), updated_at = NOW()
         WHERE id = $1 RETURNING *`,
        [pickingId],
      );

      return { picking: updated[0], linesProcessed: lines.length };
    });
  } catch (error: unknown) {
    if (error instanceof HolderBlockedError) {
      log.warn('Issue picking blocked: recipient holder is blocked',
        { pickingId, holderId: error.holderId }, 'field-stock');
      return apiResponse.conflict(res, 'holder_blocked', {
        holderId: error.holderId,
        blockedReason: error.blockedReason,
      });
    }
    if (error instanceof Error) {
      if (error.message === 'PICKING_NOT_FOUND') return apiResponse.notFound(res, 'Picking', pickingId);
      if (error.message === 'PICKING_INVALID_STATUS') {
        const e = error as Error & { currentStatus?: string };
        return apiResponse.validationError(res, {
          status: `Cannot process picking with status "${e.currentStatus ?? 'unknown'}". Only confirmed pickings can be processed.`,
        });
      }
      if (error.message === 'INSUFFICIENT_STOCK') {
        const e = error as Error & { stockErrors?: Record<string, string> };
        log.warn('Stock transfer blocked: insufficient stock', { pickingId, errors: e.stockErrors }, 'field-stock');
        return apiResponse.validationError(res, e.stockErrors ?? {});
      }
    }
    log.error('Error processing picking', {
      error: error instanceof Error ? error.message : String(error),
      pickingId,
    }, 'field-stock');
    return apiResponse.internalError(res, error);
  }

  const { picking, linesProcessed } = finalPicking as { picking: unknown; linesProcessed: number };
  log.info('Picking processed successfully', { pickingId, linesProcessed }, 'field-stock');
  createAuditLog({
    entityType: 'picking',
    entityId: pickingId,
    action: 'update',
    performedBy: 'system',
    newValues: { status: 'done', linesProcessed },
  });
  return apiResponse.success(res, picking);
}

export default withAuth(handler);
