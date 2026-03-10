/**
 * Odoo Purchase Order Sync Service
 *
 * Syncs purchase orders and line items from Odoo to FibreFlow
 */

import { neon } from '@/lib/db-neon';
import { createLogger } from '@/lib/logger';
import {
  OdooClient,
  OdooPurchaseOrder,
  OdooPurchaseOrderLine,
} from '../odooClient';

const logger = createLogger({ module: 'odooPOSync' });

// ============================================================================
// Types
// ============================================================================

export interface POSyncResult {
  orders: { created: number; updated: number; skipped: number; errors: string[] };
  lineItems: { created: number; updated: number; errors: string[] };
  details: Array<{
    odooId: number;
    poNumber: string;
    action: 'created' | 'updated' | 'skipped' | 'error';
    message?: string;
  }>;
}

// ============================================================================
// Mapping Functions
// ============================================================================

// Map Odoo PO state to FF status
const STATE_MAP: Record<string, string> = {
  draft: 'draft',
  sent: 'pending_approval',
  to_approve: 'pending_approval',
  purchase: 'approved',
  done: 'received',
  cancel: 'cancelled',
};

function mapOdooPOToFF(
  po: OdooPurchaseOrder,
  supplierIdMap: Map<number, number>
) {
  const odooSupplierId = po.partner_id ? po.partner_id[0] : null;
  const ffSupplierId = odooSupplierId ? supplierIdMap.get(odooSupplierId) : null;

  const status = STATE_MAP[po.state] || 'draft';
  const orderDate = po.date_order ? po.date_order.split(' ')[0] : null; // date_order is datetime

  return {
    odoo_po_id: po.id,
    po_number: po.name,
    supplier_id: ffSupplierId,
    order_date: orderDate,
    status,
    subtotal: po.amount_untaxed || 0,
    tax_amount: po.amount_tax || 0,
    total_amount: po.amount_total || 0,
    currency: po.currency_id ? po.currency_id[1] : 'ZAR',
    supplier_reference: po.origin || null,
    approved_at: po.date_approve || null,
  };
}

function mapOdooPOLineToFF(
  line: OdooPurchaseOrderLine,
  poIdMap: Map<number, string>
) {
  const odooOrderId = line.order_id ? line.order_id[0] : null;
  const ffOrderId = odooOrderId ? poIdMap.get(odooOrderId) : null;

  const productName = line.product_id ? line.product_id[1] : line.name;

  return {
    odoo_line_id: line.id,
    purchase_order_id: ffOrderId,
    item_description: line.name || productName,
    quantity_ordered: line.product_qty || 0,
    quantity_received: line.qty_received || 0,
    quantity_invoiced: line.qty_invoiced || 0,
    uom: line.product_uom_id ? line.product_uom_id[1] : 'Units',
    unit_price: line.price_unit || 0,
    total_price: line.price_total || 0,
  };
}

// ============================================================================
// Sync Functions
// ============================================================================

/**
 * Sync purchase orders from Odoo to FibreFlow
 */
export async function syncPurchaseOrders(
  client: OdooClient,
  databaseUrl: string,
  options?: { dryRun?: boolean; includeLineItems?: boolean }
): Promise<POSyncResult> {
  const sql = neon(databaseUrl);
  const result: POSyncResult = {
    orders: { created: 0, updated: 0, skipped: 0, errors: [] },
    lineItems: { created: 0, updated: 0, errors: [] },
    details: [],
  };

  const includeLineItems = options?.includeLineItems ?? true;

  try {
    logger.info('Starting purchase order sync from Odoo');

    // ========================================================================
    // 1. BUILD SUPPLIER ID MAP
    // ========================================================================
    // Get suppliers with odoo_partner_id to map Odoo partner -> FF supplier
    const suppliers = await sql<{ id: number; odoo_partner_id: number }[]>`
      SELECT id, odoo_partner_id FROM suppliers WHERE odoo_partner_id IS NOT NULL
    `;
    const supplierIdMap = new Map(
      suppliers.map((s) => [s.odoo_partner_id, s.id])
    );
    logger.info(`Loaded ${supplierIdMap.size} supplier mappings`);

    // ========================================================================
    // 2. FETCH PURCHASE ORDERS FROM ODOO
    // ========================================================================
    const odooPOs = await client.getPurchaseOrders({ limit: 500 });
    logger.info(`Found ${odooPOs.length} purchase orders in Odoo`);

    // Get existing FF POs with Odoo IDs
    const existingPOs = await sql<{ id: string; odoo_po_id: number }[]>`
      SELECT id, odoo_po_id FROM purchase_orders WHERE odoo_po_id IS NOT NULL
    `;
    const existingByOdooId = new Map(
      existingPOs.map((po) => [po.odoo_po_id, po.id])
    );

    // Map Odoo PO ID -> FF PO ID for line items
    const poIdMap = new Map<number, string>();

    // ========================================================================
    // 3. SYNC PURCHASE ORDERS
    // ========================================================================
    for (const odooPO of odooPOs) {
      try {
        const ffData = mapOdooPOToFF(odooPO, supplierIdMap);
        const existingId = existingByOdooId.get(odooPO.id);

        // Skip if no supplier mapping found
        if (!ffData.supplier_id) {
          result.orders.skipped++;
          result.details.push({
            odooId: odooPO.id,
            poNumber: odooPO.name,
            action: 'skipped',
            message: 'No supplier mapping found',
          });
          continue;
        }

        if (options?.dryRun) {
          result.details.push({
            odooId: odooPO.id,
            poNumber: odooPO.name,
            action: existingId ? 'updated' : 'created',
            message: 'Dry run',
          });
          if (existingId) {
            result.orders.updated++;
            poIdMap.set(odooPO.id, existingId);
          } else {
            result.orders.created++;
          }
          continue;
        }

        if (existingId) {
          // Update existing PO
          await sql`
            UPDATE purchase_orders
            SET
              po_number = ${ffData.po_number},
              supplier_id = ${ffData.supplier_id},
              order_date = ${ffData.order_date},
              status = ${ffData.status},
              subtotal = ${ffData.subtotal},
              tax_amount = ${ffData.tax_amount},
              total_amount = ${ffData.total_amount},
              currency = ${ffData.currency},
              supplier_reference = ${ffData.supplier_reference},
              approved_at = ${ffData.approved_at},
              updated_at = CURRENT_TIMESTAMP
            WHERE id = ${existingId}
          `;
          result.orders.updated++;
          poIdMap.set(odooPO.id, existingId);
          result.details.push({
            odooId: odooPO.id,
            poNumber: odooPO.name,
            action: 'updated',
          });
        } else {
          // Create new PO
          const inserted = await sql<{ id: string }[]>`
            INSERT INTO purchase_orders (
              odoo_po_id, po_number, supplier_id, order_date, status,
              subtotal, tax_amount, total_amount, currency,
              supplier_reference, approved_at,
              created_by, created_at, updated_at
            ) VALUES (
              ${ffData.odoo_po_id}, ${ffData.po_number}, ${ffData.supplier_id},
              ${ffData.order_date}, ${ffData.status}, ${ffData.subtotal},
              ${ffData.tax_amount}, ${ffData.total_amount}, ${ffData.currency},
              ${ffData.supplier_reference}, ${ffData.approved_at},
              'odoo-sync', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            )
            RETURNING id
          `;
          result.orders.created++;
          poIdMap.set(odooPO.id, inserted[0].id);
          result.details.push({
            odooId: odooPO.id,
            poNumber: odooPO.name,
            action: 'created',
          });
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown error';
        result.orders.errors.push(`${odooPO.name}: ${message}`);
        result.details.push({
          odooId: odooPO.id,
          poNumber: odooPO.name,
          action: 'error',
          message,
        });
      }
    }

    // Refresh PO ID map for all existing POs
    const allPOs = await sql<{ id: string; odoo_po_id: number }[]>`
      SELECT id, odoo_po_id FROM purchase_orders WHERE odoo_po_id IS NOT NULL
    `;
    for (const po of allPOs) {
      poIdMap.set(po.odoo_po_id, po.id);
    }

    // ========================================================================
    // 4. SYNC LINE ITEMS (if enabled)
    // ========================================================================
    if (includeLineItems && !options?.dryRun) {
      logger.info('Starting PO line items sync from Odoo');

      // Collect all line item IDs from POs we have
      const allLineIds: number[] = [];
      for (const po of odooPOs) {
        if (poIdMap.has(po.id) && po.order_line && po.order_line.length > 0) {
          allLineIds.push(...po.order_line);
        }
      }

      if (allLineIds.length > 0) {
        // Fetch line items in batches of 100
        const batchSize = 100;
        const allLines: OdooPurchaseOrderLine[] = [];

        for (let i = 0; i < allLineIds.length; i += batchSize) {
          const batch = allLineIds.slice(i, i + batchSize);
          const lines = await client.getPurchaseOrderLines(batch);
          allLines.push(...lines);
        }

        logger.info(`Found ${allLines.length} PO line items in Odoo`);

        // Get existing line items
        const existingLines = await sql<{ id: string; odoo_line_id: number }[]>`
          SELECT id, odoo_line_id FROM purchase_order_items WHERE odoo_line_id IS NOT NULL
        `;
        const existingLinesByOdooId = new Map(
          existingLines.map((l) => [l.odoo_line_id, l.id])
        );

        for (const line of allLines) {
          try {
            const ffData = mapOdooPOLineToFF(line, poIdMap);

            if (!ffData.purchase_order_id) {
              // Skip lines for POs we don't have
              continue;
            }

            const existingLineId = existingLinesByOdooId.get(line.id);

            if (existingLineId) {
              // Update existing line
              await sql`
                UPDATE purchase_order_items
                SET
                  item_description = ${ffData.item_description},
                  quantity_ordered = ${ffData.quantity_ordered},
                  quantity_received = ${ffData.quantity_received},
                  quantity_invoiced = ${ffData.quantity_invoiced},
                  uom = ${ffData.uom},
                  unit_price = ${ffData.unit_price},
                  total_price = ${ffData.total_price}
                WHERE id = ${existingLineId}
              `;
              result.lineItems.updated++;
            } else {
              // Create new line
              await sql`
                INSERT INTO purchase_order_items (
                  purchase_order_id, odoo_line_id, item_description,
                  quantity_ordered, quantity_received, quantity_invoiced,
                  uom, unit_price, total_price, created_at
                ) VALUES (
                  ${ffData.purchase_order_id}::uuid, ${ffData.odoo_line_id},
                  ${ffData.item_description}, ${ffData.quantity_ordered},
                  ${ffData.quantity_received}, ${ffData.quantity_invoiced},
                  ${ffData.uom}, ${ffData.unit_price}, ${ffData.total_price},
                  CURRENT_TIMESTAMP
                )
              `;
              result.lineItems.created++;
            }
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            result.lineItems.errors.push(`Line ${line.id}: ${message}`);
          }
        }
      }
    }

    logger.info('PO sync completed', {
      orders: result.orders,
      lineItems: result.lineItems,
    });

    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    logger.error('PO sync failed', { error: message });
    result.orders.errors.push(`Sync failed: ${message}`);
    return result;
  }
}
