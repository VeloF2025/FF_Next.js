/**
 * GRN Confirm API - Confirms a GRN and updates stock
 *
 * POST /api/procurement/grn-confirm
 *
 * This endpoint:
 * 1. Validates the GRN is in draft/receiving status
 * 2. Creates a stock_movement record (source_type='fibreflow')
 * 3. Creates stock_movement_items for each GRN item
 * 4. Updates stock_items.qty_available for each accepted item
 * 5. Updates the GRN status to 'received'
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { withErrorHandler } from '@/lib/api-error-handler';
import { createLoggedSql, logUpdate } from '@/lib/db-logger';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { withAuth, type AuthenticatedNextApiRequest } from '@/lib/auth';
import { createAuditLog } from '@/services/procurement/auditService';
import { postGRNToGL } from '@/modules/accounting/services/glIntegrationHooks';

const sql = createLoggedSql(process.env.DATABASE_URL!);

interface ConfirmRequest {
  grnId: string;
  notes?: string;
}

export default withAuth(withErrorHandler(async (
  req: NextApiRequest,
  res: NextApiResponse
) => {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }

  const userId = (req as AuthenticatedNextApiRequest).user.id;
  const { grnId, notes } = req.body as ConfirmRequest;

  if (!grnId) {
    return apiResponse.validationError(res, { grnId: 'GRN ID is required' });
  }

  try {
    // 1. Get the GRN with its items
    const [grn] = await sql`
      SELECT
        grn.id, grn.grn_number, grn.status, grn.supplier_id, grn.warehouse_id,
        grn.purchase_order_id,
        COALESCE(s.company_name, s.name) as supplier_name,
        sl.name as warehouse_name
      FROM goods_receipt_notes grn
      LEFT JOIN suppliers s ON grn.supplier_id = s.id
      LEFT JOIN stock_locations sl ON grn.warehouse_id = sl.id
      WHERE grn.id = ${grnId}
    `;

    if (!grn) {
      return apiResponse.notFound(res, 'Goods Receipt Note', grnId);
    }

    // 2. Check status - only draft or receiving can be confirmed
    if (!['draft', 'receiving'].includes(grn.status)) {
      return apiResponse.badRequest(
        res,
        `Cannot confirm GRN in '${grn.status}' status. Only draft or receiving GRNs can be confirmed.`
      );
    }

    // 3. Get GRN items
    const grnItems = await sql`
      SELECT
        id, grn_id, po_item_id, stock_item_id, item_code, item_description,
        quantity_received, quantity_rejected, uom, unit_cost, total_cost,
        serial_numbers, lot_number, inspection_status
      FROM goods_receipt_items
      WHERE grn_id = ${grnId}
    `;

    if (grnItems.length === 0) {
      return apiResponse.badRequest(res, 'GRN has no items to receive');
    }

    // 4. Create stock_movement record
    const movementRows = await sql`
      INSERT INTO stock_movements (
        id,
        project_id,
        movement_type,
        reference_number,
        reference_type,
        reference_id,
        from_location,
        to_location,
        status,
        movement_date,
        confirmed_at,
        requested_by,
        processed_by,
        notes,
        source_type
      ) VALUES (
        gen_random_uuid(),
        'fibreflow',
        'GRN',
        ${grn.grn_number},
        'goods_receipt_note',
        ${grnId},
        ${grn.supplier_name || 'Supplier'},
        ${grn.warehouse_name || 'Warehouse'},
        'completed',
        NOW(),
        NOW(),
        ${userId || 'system'},
        ${userId || 'system'},
        ${notes || `GRN confirmed: ${grn.grn_number}`},
        'fibreflow'
      )
      RETURNING id, reference_number, movement_type
    `;
    const movement = movementRows[0]!;

    log.info('Created stock movement for GRN', {
      movementId: movement.id,
      grnNumber: grn.grn_number,
      module: 'procurement:grn-confirm',
    });

    // 5. Create stock_movement_items and update stock quantities
    let totalQuantityReceived = 0;
    let itemsProcessed = 0;

    for (const item of grnItems) {
      const quantityReceived = Number(item.quantity_received || 0);
      const quantityRejected = Number(item.quantity_rejected || 0);
      const quantityAccepted = quantityReceived - quantityRejected;

      if (quantityAccepted <= 0) {
        continue; // Skip items with no accepted quantity
      }

      // Insert movement item
      await sql`
        INSERT INTO stock_movement_items (
          id,
          stock_movement_id,
          project_id,
          item_code,
          description,
          planned_quantity,
          actual_quantity,
          uom,
          unit_cost,
          total_cost,
          serial_numbers,
          lot_numbers,
          item_status
        ) VALUES (
          gen_random_uuid(),
          ${movement.id},
          'fibreflow',
          ${item.item_code || ''},
          ${item.item_description || ''},
          ${quantityReceived},
          ${quantityAccepted},
          ${item.uom || 'EA'},
          ${item.unit_cost || 0},
          ${(item.unit_cost || 0) * quantityAccepted},
          ${item.serial_numbers || null},
          ${item.lot_number ? JSON.stringify([item.lot_number]) : null},
          'received'
        )
      `;

      // Update stock_items quantity if stock_item_id is provided
      if (item.stock_item_id) {
        await sql`
          UPDATE stock_items
          SET
            qty_available = COALESCE(qty_available, 0) + ${quantityAccepted},
            updated_at = NOW()
          WHERE id = ${item.stock_item_id}
        `;

        log.debug('Updated stock item quantity', {
          stockItemId: item.stock_item_id,
          quantityAdded: quantityAccepted,
          module: 'procurement:grn-confirm',
        });
      } else if (item.item_code) {
        // Try to find and update by item_code
        await sql`
          UPDATE stock_items
          SET
            qty_available = COALESCE(qty_available, 0) + ${quantityAccepted},
            updated_at = NOW()
          WHERE item_code = ${item.item_code}
        `;
      }

      totalQuantityReceived += quantityAccepted;
      itemsProcessed++;
    }

    // 6. Update GRN status to 'completed'
    const updatedGrnRows = await sql`
      UPDATE goods_receipt_notes
      SET
        status = 'completed',
        total_quantity_received = ${totalQuantityReceived},
        verified_by = ${userId || 'system'},
        verified_at = NOW(),
        updated_at = NOW()
      WHERE id = ${grnId}
      RETURNING id, grn_number, status
    `;
    const updatedGrn = updatedGrnRows[0]!;

    logUpdate('goods_receipt_note', grnId, {
      status: 'completed',
      total_quantity_received: totalQuantityReceived,
      movement_id: movement.id,
    });

    createAuditLog({
      entityType: 'goods_receipt',
      entityId: grnId,
      action: 'update',
      performedBy: userId,
      newValues: { status: 'completed', totalQuantityReceived, movementId: movement.id },
    });

    // 7. GL integration: DR Materials, CR AP
    const grnTotalValue = grnItems.reduce((sum: number, item: Record<string, unknown>) =>
      sum + Number(item.total_cost || 0), 0);
    if (grnTotalValue > 0) {
      const poProjectId = grn.purchase_order_id
        ? (await sql`SELECT project_id FROM purchase_orders WHERE id = ${grn.purchase_order_id}`)?.[0]?.project_id
        : null;
      await postGRNToGL(grnId, grnTotalValue, poProjectId || null, userId, grn.grn_number);
    }

    log.info('GRN confirmed successfully', {
      grnId,
      grnNumber: grn.grn_number,
      movementId: movement.id,
      itemsProcessed,
      totalQuantityReceived,
      module: 'procurement:grn-confirm',
    });

    return apiResponse.success(res, {
      message: 'GRN confirmed successfully',
      grn: {
        id: updatedGrn.id,
        grnNumber: updatedGrn.grn_number,
        status: updatedGrn.status,
      },
      movement: {
        id: movement.id,
        referenceNumber: movement.reference_number,
        type: movement.movement_type,
      },
      summary: {
        itemsProcessed,
        totalQuantityReceived,
      },
    });
  } catch (error) {
    log.error('Failed to confirm GRN', {
      grnId,
      error,
      module: 'procurement:grn-confirm',
    });
    return apiResponse.databaseError(res, error, 'Failed to confirm GRN');
  }
}));
