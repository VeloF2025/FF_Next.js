/**
 * Invoice Sync Service
 *
 * Pulls supplier invoices from Sage and:
 * - Matches to POs in FibreFlow
 * - Creates budget_transaction records for invoice amounts
 * - Tracks invoice status and payment progress
 */

import { NeonQueryFunction } from '@neondatabase/serverless';
import { createLogger } from '@/lib/logger';
import { SageClient, SageSupplierInvoice } from '../sageClient';

const logger = createLogger({ module: 'sage:invoice-sync' });

export interface InvoiceSyncResult {
  success: boolean;
  totalProcessed: number;
  created: number;
  updated: number;
  matched: number;
  unmatched: number;
  failed: number;
  errors: Array<{ invoiceId: string; error: string }>;
}

/**
 * Pull invoices from Sage and process them
 */
export async function pullInvoicesFromSage(
  client: SageClient,
  sql: NeonQueryFunction<false, false>,
  options?: { sinceDate?: Date; supplierId?: string }
): Promise<InvoiceSyncResult> {
  const result: InvoiceSyncResult = {
    success: true,
    totalProcessed: 0,
    created: 0,
    updated: 0,
    matched: 0,
    unmatched: 0,
    failed: 0,
    errors: [],
  };

  try {
    logger.info('Starting invoice pull from Sage', options);

    // Build filter options
    const filterDate = options?.sinceDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000); // Last 30 days default

    // Fetch invoices from Sage
    const sageResponse = await client.getSupplierInvoices({
      pageSize: 200,
      fromDate: filterDate.toISOString().split('T')[0],
    });

    const invoices = sageResponse.results || [];
    logger.info(`Fetched ${invoices.length} invoices from Sage`);

    for (const invoice of invoices) {
      result.totalProcessed++;

      try {
        // Check if invoice already exists
        const existing = await sql`
          SELECT id, status FROM sage_supplier_invoices
          WHERE sage_invoice_id = ${invoice.id}
        `;

        if (existing.length > 0) {
          // Update existing invoice
          await updateExistingInvoice(sql, existing[0].id, invoice);
          result.updated++;
          continue;
        }

        // Create new invoice record
        const invoiceRecord = await createInvoiceRecord(sql, invoice);

        // Try to match to PO
        const matched = await matchInvoiceToPO(sql, invoiceRecord.id, invoice);

        if (matched) {
          result.matched++;
          // Create budget transaction for the invoice
          await createBudgetTransaction(sql, invoiceRecord.id, invoice, matched.poId, matched.projectId);
        } else {
          result.unmatched++;
        }

        result.created++;
      } catch (error) {
        result.failed++;
        result.errors.push({
          invoiceId: invoice.id,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        logger.error(`Failed to process invoice ${invoice.id}`, { error });
      }
    }

    // Log sync history
    await sql`
      INSERT INTO sage_sync_history (
        operation_type,
        direction,
        entity_type,
        status,
        records_processed,
        records_success,
        records_failed,
        details
      ) VALUES (
        'invoice_sync',
        'inbound',
        'supplier_invoice',
        ${result.failed === 0 ? 'success' : 'partial'},
        ${result.totalProcessed},
        ${result.created + result.updated},
        ${result.failed},
        ${JSON.stringify({
          created: result.created,
          updated: result.updated,
          matched: result.matched,
          unmatched: result.unmatched,
          errors: result.errors,
        })}
      )
    `;

    logger.info('Invoice sync completed', result);
  } catch (error) {
    result.success = false;
    logger.error('Invoice sync failed', { error });

    await sql`
      INSERT INTO sage_sync_history (
        operation_type,
        direction,
        entity_type,
        status,
        error_message
      ) VALUES (
        'invoice_sync',
        'inbound',
        'supplier_invoice',
        'failed',
        ${error instanceof Error ? error.message : 'Unknown error'}
      )
    `;
  }

  return result;
}

/**
 * Create invoice record in local database
 */
async function createInvoiceRecord(
  sql: NeonQueryFunction<false, false>,
  invoice: SageSupplierInvoice
): Promise<{ id: string }> {
  const result = await sql`
    INSERT INTO sage_supplier_invoices (
      sage_invoice_id,
      sage_supplier_id,
      invoice_number,
      invoice_date,
      due_date,
      total_amount,
      outstanding_amount,
      currency,
      status,
      raw_data
    ) VALUES (
      ${invoice.id},
      ${invoice.supplierId},
      ${invoice.invoiceNumber},
      ${invoice.invoiceDate},
      ${invoice.dueDate || null},
      ${invoice.totalAmount},
      ${invoice.outstandingAmount || invoice.totalAmount},
      ${invoice.currency || 'ZAR'},
      ${invoice.status || 'pending'},
      ${JSON.stringify(invoice)}
    )
    RETURNING id
  `;

  return { id: result[0].id };
}

/**
 * Update existing invoice
 */
async function updateExistingInvoice(
  sql: NeonQueryFunction<false, false>,
  localId: string,
  invoice: SageSupplierInvoice
): Promise<void> {
  await sql`
    UPDATE sage_supplier_invoices
    SET
      outstanding_amount = ${invoice.outstandingAmount || invoice.totalAmount},
      status = ${invoice.status || 'pending'},
      raw_data = ${JSON.stringify(invoice)},
      updated_at = NOW()
    WHERE id = ${localId}
  `;
}

/**
 * Try to match invoice to a PO
 */
async function matchInvoiceToPO(
  sql: NeonQueryFunction<false, false>,
  localInvoiceId: string,
  invoice: SageSupplierInvoice
): Promise<{ poId: string; projectId: string } | null> {
  // First, get FF supplier ID from Sage supplier mapping
  const supplierMapping = await sql`
    SELECT ff_entity_id
    FROM sage_entity_mappings
    WHERE sage_entity_type = 'supplier'
      AND sage_entity_id = ${invoice.supplierId}
      AND sync_status = 'synced'
    LIMIT 1
  `;

  if (supplierMapping.length === 0) {
    logger.info(`No FF supplier mapping for Sage supplier ${invoice.supplierId}`);
    return null;
  }

  const ffSupplierId = supplierMapping[0].ff_entity_id;

  // Try to match by PO number in invoice reference
  if (invoice.reference) {
    const poMatch = await sql`
      SELECT id, project_id
      FROM purchase_orders
      WHERE supplier_id = ${ffSupplierId}
        AND (
          po_number = ${invoice.reference}
          OR po_number ILIKE ${`%${invoice.reference}%`}
        )
        AND status IN ('approved', 'sent', 'acknowledged')
      LIMIT 1
    `;

    if (poMatch.length > 0) {
      await linkInvoiceToPO(sql, localInvoiceId, poMatch[0].id);
      return { poId: poMatch[0].id, projectId: poMatch[0].project_id };
    }
  }

  // Try to match by amount and supplier (approximate match)
  const amountMatch = await sql`
    SELECT id, project_id
    FROM purchase_orders
    WHERE supplier_id = ${ffSupplierId}
      AND ABS(total_amount - ${invoice.totalAmount}) < 0.01
      AND status IN ('approved', 'sent', 'acknowledged')
      AND sage_invoice_linked = false
    ORDER BY created_at DESC
    LIMIT 1
  `;

  if (amountMatch.length > 0) {
    await linkInvoiceToPO(sql, localInvoiceId, amountMatch[0].id);
    return { poId: amountMatch[0].id, projectId: amountMatch[0].project_id };
  }

  return null;
}

/**
 * Link invoice to PO
 */
async function linkInvoiceToPO(
  sql: NeonQueryFunction<false, false>,
  invoiceId: string,
  poId: string
): Promise<void> {
  await sql`
    UPDATE sage_supplier_invoices
    SET
      ff_purchase_order_id = ${poId},
      match_status = 'matched',
      updated_at = NOW()
    WHERE id = ${invoiceId}
  `;

  await sql`
    UPDATE purchase_orders
    SET
      sage_invoice_linked = true,
      updated_at = NOW()
    WHERE id = ${poId}
  `;

  logger.info(`Linked invoice ${invoiceId} to PO ${poId}`);
}

/**
 * Create budget transaction for invoice
 */
async function createBudgetTransaction(
  sql: NeonQueryFunction<false, false>,
  invoiceId: string,
  invoice: SageSupplierInvoice,
  poId: string,
  projectId: string
): Promise<void> {
  // Get budget item from PO
  const poDetails = await sql`
    SELECT budget_item_id, budget_category
    FROM purchase_orders
    WHERE id = ${poId}
  `;

  const budgetItemId = poDetails[0]?.budget_item_id;
  const category = poDetails[0]?.budget_category || 'MATERIALS';

  // Create budget transaction
  await sql`
    INSERT INTO budget_transactions (
      project_id,
      budget_item_id,
      category,
      transaction_type,
      amount,
      description,
      reference_type,
      reference_id,
      sage_invoice_id,
      transaction_date,
      status
    ) VALUES (
      ${projectId},
      ${budgetItemId},
      ${category},
      'invoice',
      ${invoice.totalAmount},
      ${`Sage Invoice: ${invoice.invoiceNumber}`},
      'purchase_order',
      ${poId},
      ${invoiceId},
      ${invoice.invoiceDate},
      'pending'
    )
    ON CONFLICT (reference_type, reference_id, transaction_type, sage_invoice_id)
    DO UPDATE SET
      amount = ${invoice.totalAmount},
      updated_at = NOW()
  `;

  logger.info(`Created budget transaction for invoice ${invoice.invoiceNumber}`);
}

/**
 * Get unmatched invoices for manual review
 */
export async function getUnmatchedInvoices(
  sql: NeonQueryFunction<false, false>
): Promise<Array<{
  id: string;
  invoiceNumber: string;
  supplierName: string;
  amount: number;
  date: string;
}>> {
  const unmatched = await sql`
    SELECT
      ssi.id,
      ssi.invoice_number,
      ssi.total_amount,
      ssi.invoice_date,
      s.name as supplier_name
    FROM sage_supplier_invoices ssi
    LEFT JOIN sage_entity_mappings sem
      ON sem.sage_entity_type = 'supplier'
      AND sem.sage_entity_id = ssi.sage_supplier_id
    LEFT JOIN suppliers s
      ON s.id = sem.ff_entity_id
    WHERE ssi.ff_purchase_order_id IS NULL
      AND ssi.match_status != 'ignored'
    ORDER BY ssi.invoice_date DESC
    LIMIT 100
  `;

  return unmatched.map((inv) => ({
    id: inv.id,
    invoiceNumber: inv.invoice_number,
    supplierName: inv.supplier_name || 'Unknown',
    amount: parseFloat(inv.total_amount),
    date: inv.invoice_date,
  }));
}

/**
 * Manually match an invoice to a PO
 */
export async function manuallyMatchInvoice(
  sql: NeonQueryFunction<false, false>,
  invoiceId: string,
  poId: string
): Promise<boolean> {
  try {
    // Get invoice and PO details
    const invoice = await sql`
      SELECT * FROM sage_supplier_invoices WHERE id = ${invoiceId}
    `;

    const po = await sql`
      SELECT project_id FROM purchase_orders WHERE id = ${poId}
    `;

    if (invoice.length === 0 || po.length === 0) {
      return false;
    }

    await linkInvoiceToPO(sql, invoiceId, poId);

    // Create budget transaction
    await createBudgetTransaction(
      sql,
      invoiceId,
      {
        id: invoice[0].sage_invoice_id,
        supplierId: invoice[0].sage_supplier_id,
        invoiceNumber: invoice[0].invoice_number,
        invoiceDate: invoice[0].invoice_date,
        totalAmount: parseFloat(invoice[0].total_amount),
        outstandingAmount: parseFloat(invoice[0].outstanding_amount),
      } as SageSupplierInvoice,
      poId,
      po[0].project_id
    );

    return true;
  } catch (error) {
    logger.error('Failed to manually match invoice', { invoiceId, poId, error });
    return false;
  }
}
