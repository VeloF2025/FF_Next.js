import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { query, queryOne, transaction } from '@/lib/db-pool';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { createAuditLog } from '@/services/procurement/auditService';
import { postGRNToGL } from '@/modules/accounting/services/glIntegrationHooks';
import { postGrnReceiptLines, type GrnLine } from '@/services/procurement/postGrnReceipt';

interface ConfirmRequest { grnId: string; notes?: string; }

export default withAuth(withErrorHandler(async (req: NextApiRequest, res: NextApiResponse) => {
  if (req.method !== 'POST') return apiResponse.methodNotAllowed(res, req.method!, ['POST']);

  const userId = (req as AuthenticatedNextApiRequest).user.id;
  const { grnId, notes } = req.body as ConfirmRequest;
  if (!grnId) return apiResponse.validationError(res, { grnId: 'GRN ID is required' });

  try {
    const grn = await queryOne<{
      id: string; grn_number: string; status: string; supplier_id: string;
      warehouse_id: string; purchase_order_id: string | null;
      supplier_name: string; warehouse_name: string;
    }>(
      `SELECT grn.id, grn.grn_number, grn.status, grn.supplier_id, grn.warehouse_id, grn.purchase_order_id,
              COALESCE(s.company_name, s.name) AS supplier_name, sl.name AS warehouse_name
         FROM goods_receipt_notes grn
         LEFT JOIN suppliers s ON grn.supplier_id = s.id
         LEFT JOIN stock_locations sl ON grn.warehouse_id = sl.id
        WHERE grn.id = $1`, [grnId]);

    if (!grn) return apiResponse.notFound(res, 'Goods Receipt Note', grnId);

    if (!['draft', 'receiving'].includes(grn.status)) {
      return apiResponse.badRequest(
        res,
        `Cannot confirm GRN in '${grn.status}' status. Only draft or receiving GRNs can be confirmed.`,
      );
    }
    if (!grn.warehouse_id) return apiResponse.badRequest(res, 'GRN has no destination warehouse');

    const grnItems = await query<{
      stock_item_id: string | null; quantity_received: number; quantity_rejected: number;
      lot_number: string | null; item_code: string | null; item_description: string | null;
      uom: string | null; unit_cost: number | null; serial_numbers: unknown; total_cost: number | null;
    }>(
      `SELECT stock_item_id, quantity_received, quantity_rejected, lot_number, item_code, item_description,
              uom, unit_cost, serial_numbers, total_cost
         FROM goods_receipt_items WHERE grn_id = $1`, [grnId]);

    if (grnItems.length === 0) return apiResponse.badRequest(res, 'GRN has no items to receive');

    const vendors = await queryOne<{ id: string }>(
      "SELECT id FROM stock_locations WHERE code = 'VENDORS' LIMIT 1",
    );
    // VENDORS is the virtual location representing external suppliers (migration 382)
    if (!vendors) return apiResponse.badRequest(res, 'VENDORS location missing — run migration 382');

    const lines: GrnLine[] = grnItems.map((i) => ({
      stockItemId: i.stock_item_id ?? '',
      quantityReceived: Number(i.quantity_received || 0),
      quantityRejected: Number(i.quantity_rejected || 0),
      lotNumber: i.lot_number,
    }));

    const { movementId, totalAccepted } = await transaction(async (txn) => {
      const mvRows = await txn.query<{ id: string }>(
        `INSERT INTO stock_movements (id, project_id, movement_type, reference_number, reference_type, reference_id,
            from_location, to_location, status, movement_date, confirmed_at, requested_by, processed_by, notes, source_type)
         VALUES (gen_random_uuid(), 'fibreflow', 'GRN', $1, 'goods_receipt_note', $2, $3, $4, 'completed', NOW(), NOW(), $5, $5, $6, 'fibreflow')
         RETURNING id`,
        [
          grn.grn_number, grnId,
          grn.supplier_name || 'Supplier', grn.warehouse_name || 'Warehouse',
          userId || 'system', notes || `GRN confirmed: ${grn.grn_number}`,
        ],
      );
      const mv = mvRows[0];
      if (!mv) throw new Error('stock_movements insert returned no row');

      // Document-detail line items (consumed by stock/index.ts, movementReversalService,
      // stockMovementSync) — preserved additively alongside the location-aware ledger postings.
      for (const it of grnItems) {
        const accepted = Number(it.quantity_received || 0) - Number(it.quantity_rejected || 0);
        if (accepted <= 0) continue;
        await txn.query(
          `INSERT INTO stock_movement_items (id, stock_movement_id, project_id, item_code, description,
             planned_quantity, actual_quantity, uom, unit_cost, total_cost, serial_numbers, lot_numbers, item_status)
           VALUES (gen_random_uuid(), $1, 'fibreflow', $2, $3, $4, $5, $6, $7, $8, $9, $10, 'received')`,
          [
            mv.id, it.item_code || '', it.item_description || '', Number(it.quantity_received || 0), accepted,
            it.uom || 'EA', it.unit_cost || 0, (Number(it.unit_cost || 0) * accepted), it.serial_numbers ?? null,
            it.lot_number ? JSON.stringify([it.lot_number]) : null,
          ],
        );
      }

      const totalAccepted = await postGrnReceiptLines(txn, {
        lines,
        destinationLocationId: grn.warehouse_id,
        vendorsLocationId: vendors.id,
      });

      await txn.query(
        `UPDATE goods_receipt_notes SET status = 'completed', total_quantity_received = $2,
            verified_by = $3, verified_at = NOW(), updated_at = NOW() WHERE id = $1`,
        [grnId, totalAccepted, userId || 'system'],
      );

      return { movementId: mv.id, totalAccepted };
    });

    // fire-and-forget: audit write must not block or fail the confirmed response (matches prior behavior)
    createAuditLog({
      entityType: 'goods_receipt', entityId: grnId, action: 'update', performedBy: userId,
      newValues: { status: 'completed', totalQuantityReceived: totalAccepted, movementId },
    });

    const grnTotalValue = grnItems.reduce((s, i) => s + Number(i.total_cost || 0), 0);
    if (grnTotalValue > 0) {
      const poProjectId = grn.purchase_order_id
        ? (await queryOne<{ project_id: string }>(
            'SELECT project_id FROM purchase_orders WHERE id = $1',
            [grn.purchase_order_id],
          ))?.project_id ?? null
        : null;
      await postGRNToGL(grnId, grnTotalValue, poProjectId, userId, grn.grn_number);
    }

    log.info('GRN confirmed successfully', {
      grnId, grnNumber: grn.grn_number, movementId, totalAccepted, module: 'procurement:grn-confirm',
    });

    return apiResponse.success(res, {
      message: 'GRN confirmed successfully',
      grn: { id: grn.id, grnNumber: grn.grn_number, status: 'completed' },
      movement: { id: movementId, referenceNumber: grn.grn_number, type: 'GRN' },
      summary: {
        itemsProcessed: lines.filter((l) => l.stockItemId && (l.quantityReceived - l.quantityRejected) > 0).length,
        totalQuantityReceived: totalAccepted,
      },
    });
  } catch (error) {
    log.error('Failed to confirm GRN', { grnId, error, module: 'procurement:grn-confirm' });
    return apiResponse.databaseError(res, error, 'Failed to confirm GRN');
  }
}));
