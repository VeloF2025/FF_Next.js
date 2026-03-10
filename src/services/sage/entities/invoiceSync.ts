/**
 * Invoice Sync Service
 *
 * Pulls supplier invoices from Sage and:
 * - Matches to POs in FibreFlow
 * - Creates budget_transaction records for invoice amounts
 * - Tracks invoice status and payment progress
 *
 * NOTE: Sage API returns PascalCase properties (ID, SupplierID, Total, etc.)
 */

import { NeonQueryFunction } from '@/lib/db-neon';
import { createLogger } from '@/lib/logger';
import { SageClient, SageSupplierInvoice } from '../sageClient';

const logger = createLogger('sage:invoice-sync');

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

    // Fetch invoices - use sinceDate if provided, else last 30 days
    let sageResponse;
    if (options?.sinceDate) {
      sageResponse = await client.getSupplierInvoicesSince(options.sinceDate);
    } else {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      sageResponse = await client.getSupplierInvoicesSince(thirtyDaysAgo);
    }

    const invoices = sageResponse.Results || [];
    logger.info(`Fetched ${invoices.length} invoices from Sage`);

    for (const invoice of invoices) {
      result.totalProcessed++;

      try {
        // Check if invoice already exists (use PascalCase .ID from Sage)
        const existing = await sql`
          SELECT id, status FROM sage_supplier_invoices
          WHERE sage_invoice_id = ${invoice.ID}
        `;

        if (existing.length > 0) {
          // Update existing invoice
          await updateExistingInvoice(sql, existing[0].id as string, invoice);
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
          invoiceId: invoice.ID,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        logger.error(`Failed to process invoice ${invoice.ID}`, { error });
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
 * Maps Sage PascalCase → DB snake_case
 */
async function createInvoiceRecord(
  sql: NeonQueryFunction<false, false>,
  invoice: SageSupplierInvoice
): Promise<{ id: string }> {
  const totalAmount = invoice.Total ?? 0;
  const amountDue = invoice.AmountDue ?? totalAmount;

  const result = await sql`
    INSERT INTO sage_supplier_invoices (
      sage_invoice_id,
      sage_supplier_id,
      invoice_number,
      invoice_date,
      due_date,
      reference,
      subtotal,
      tax_amount,
      total_amount,
      outstanding_amount,
      currency,
      status,
      raw_data
    ) VALUES (
      ${invoice.ID},
      ${invoice.SupplierID},
      ${invoice.DocumentNumber || null},
      ${invoice.Date},
      ${invoice.DueDate || null},
      ${invoice.Reference || null},
      ${invoice.Exclusive ?? 0},
      ${invoice.Tax ?? 0},
      ${totalAmount},
      ${amountDue},
      ${'ZAR'},
      ${invoice.Paid ? 'paid' : 'pending'},
      ${JSON.stringify(invoice)}
    )
    RETURNING id
  `;

  return { id: result[0].id as string };
}

/**
 * Update existing invoice
 */
async function updateExistingInvoice(
  sql: NeonQueryFunction<false, false>,
  localId: string,
  invoice: SageSupplierInvoice
): Promise<void> {
  const totalAmount = invoice.Total ?? 0;
  const amountDue = invoice.AmountDue ?? totalAmount;

  await sql`
    UPDATE sage_supplier_invoices
    SET
      outstanding_amount = ${amountDue},
      total_amount = ${totalAmount},
      status = ${invoice.Paid ? 'paid' : 'pending'},
      raw_data = ${JSON.stringify(invoice)},
      last_synced_at = NOW(),
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
      AND sage_entity_id = ${invoice.SupplierID}
      AND sync_status = 'synced'
    LIMIT 1
  `;

  if (supplierMapping.length === 0) {
    logger.info(`No FF supplier mapping for Sage supplier ${invoice.SupplierID}`);
    return null;
  }

  const ffSupplierId = supplierMapping[0].ff_entity_id;
  const invoiceRef = invoice.Reference || '';

  // Try to match by PO number in invoice reference
  if (invoiceRef) {
    const poMatch = await sql`
      SELECT id, project_id
      FROM purchase_orders
      WHERE supplier_id = ${ffSupplierId}
        AND (
          po_number = ${invoiceRef}
          OR po_number ILIKE ${`%${invoiceRef}%`}
        )
        AND status IN ('approved', 'sent', 'acknowledged')
      LIMIT 1
    `;

    if (poMatch.length > 0) {
      await linkInvoiceToPO(sql, localInvoiceId, poMatch[0].id as string);
      return { poId: poMatch[0].id as string, projectId: poMatch[0].project_id as string };
    }
  }

  // Try to match by amount and supplier (approximate match)
  const totalAmount = invoice.Total ?? 0;
  const amountMatch = await sql`
    SELECT id, project_id
    FROM purchase_orders
    WHERE supplier_id = ${ffSupplierId}
      AND ABS(total_amount - ${totalAmount}) < 0.01
      AND status IN ('approved', 'sent', 'acknowledged')
      AND sage_invoice_linked = false
    ORDER BY created_at DESC
    LIMIT 1
  `;

  if (amountMatch.length > 0) {
    await linkInvoiceToPO(sql, localInvoiceId, amountMatch[0].id as string);
    return { poId: amountMatch[0].id as string, projectId: amountMatch[0].project_id as string };
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
  const totalAmount = invoice.Total ?? 0;
  const docNumber = invoice.DocumentNumber || invoice.Reference || invoice.ID;

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
      ${totalAmount},
      ${`Sage Invoice: ${docNumber}`},
      'purchase_order',
      ${poId},
      ${invoiceId},
      ${invoice.Date},
      'pending'
    )
    ON CONFLICT (reference_type, reference_id, transaction_type, sage_invoice_id)
    DO UPDATE SET
      amount = ${totalAmount},
      updated_at = NOW()
  `;

  logger.info(`Created budget transaction for invoice ${docNumber}`);
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
    id: inv.id as string,
    invoiceNumber: inv.invoice_number as string,
    supplierName: (inv.supplier_name as string) || 'Unknown',
    amount: parseFloat(inv.total_amount as string),
    date: inv.invoice_date as string,
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

    // Create budget transaction using DB values (already snake_case)
    const inv = invoice[0];
    const sageInvoice: SageSupplierInvoice = {
      ID: inv.sage_invoice_id as string,
      SupplierID: inv.sage_supplier_id as string,
      Date: inv.invoice_date as string,
      DueDate: inv.due_date as string,
      DocumentNumber: inv.invoice_number as string,
      Total: parseFloat(inv.total_amount as string),
      AmountDue: parseFloat(inv.outstanding_amount as string),
      Paid: inv.status === 'paid',
      Status: inv.status as string,
      Locked: false,
      HasAdditionalCost: false,
      SupplierName: '',
      Inclusive: false,
    };

    await createBudgetTransaction(
      sql,
      invoiceId,
      sageInvoice,
      poId,
      po[0].project_id as string
    );

    return true;
  } catch (error) {
    logger.error('Failed to manually match invoice', { invoiceId, poId, error });
    return false;
  }
}
