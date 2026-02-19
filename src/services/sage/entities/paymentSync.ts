/**
 * Payment Sync Service
 *
 * Pulls supplier payments from Sage and:
 * - Matches to invoices
 * - Creates budget_transaction records for payments
 * - Updates PO status when fully paid
 *
 * NOTE: Sage API returns PascalCase properties (ID, SupplierID, Total, etc.)
 */

import { NeonQueryFunction } from '@neondatabase/serverless';
import { createLogger } from '@/lib/logger';
import { SageClient, SageSupplierPayment } from '../sageClient';

const logger = createLogger('sage:payment-sync');

export interface PaymentSyncResult {
  success: boolean;
  totalProcessed: number;
  created: number;
  updated: number;
  matched: number;
  unmatched: number;
  failed: number;
  posFullyPaid: number;
  errors: Array<{ paymentId: string; error: string }>;
}

/**
 * Pull payments from Sage and process them
 */
export async function pullPaymentsFromSage(
  client: SageClient,
  sql: NeonQueryFunction<false, false>,
  options?: { sinceDate?: Date }
): Promise<PaymentSyncResult> {
  const result: PaymentSyncResult = {
    success: true,
    totalProcessed: 0,
    created: 0,
    updated: 0,
    matched: 0,
    unmatched: 0,
    failed: 0,
    posFullyPaid: 0,
    errors: [],
  };

  try {
    logger.info('Starting payment pull from Sage', options);

    // Fetch payments - use sinceDate if provided, else last 30 days
    let sageResponse;
    if (options?.sinceDate) {
      sageResponse = await client.getSupplierPaymentsSince(options.sinceDate);
    } else {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      sageResponse = await client.getSupplierPaymentsSince(thirtyDaysAgo);
    }

    const payments = sageResponse.Results || [];
    logger.info(`Fetched ${payments.length} payments from Sage`);

    for (const payment of payments) {
      result.totalProcessed++;

      try {
        // Check if payment already exists (PascalCase .ID)
        const existing = await sql`
          SELECT id FROM sage_supplier_payments
          WHERE sage_payment_id = ${payment.ID}
        `;

        if (existing.length > 0) {
          // Already processed
          result.updated++;
          continue;
        }

        // Create payment record
        const paymentRecord = await createPaymentRecord(sql, payment);

        // Try to match to invoice
        const matched = await matchPaymentToInvoice(sql, paymentRecord.id, payment);

        if (matched) {
          result.matched++;

          // Create budget transaction for the payment
          await createPaymentBudgetTransaction(sql, paymentRecord.id, payment, matched);

          // Check if PO is fully paid
          const fullyPaid = await checkAndUpdatePOStatus(sql, matched.poId);
          if (fullyPaid) {
            result.posFullyPaid++;
          }
        } else {
          result.unmatched++;
        }

        result.created++;
      } catch (error) {
        result.failed++;
        result.errors.push({
          paymentId: payment.ID,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        logger.error(`Failed to process payment ${payment.ID}`, { error });
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
        'payment_sync',
        'inbound',
        'supplier_payment',
        ${result.failed === 0 ? 'success' : 'partial'},
        ${result.totalProcessed},
        ${result.created + result.updated},
        ${result.failed},
        ${JSON.stringify({
          created: result.created,
          updated: result.updated,
          matched: result.matched,
          unmatched: result.unmatched,
          posFullyPaid: result.posFullyPaid,
          errors: result.errors,
        })}
      )
    `;

    logger.info('Payment sync completed', result);
  } catch (error) {
    result.success = false;
    logger.error('Payment sync failed', { error });

    await sql`
      INSERT INTO sage_sync_history (
        operation_type,
        direction,
        entity_type,
        status,
        error_message
      ) VALUES (
        'payment_sync',
        'inbound',
        'supplier_payment',
        'failed',
        ${error instanceof Error ? error.message : 'Unknown error'}
      )
    `;
  }

  return result;
}

/**
 * Create payment record in local database
 * Maps Sage PascalCase → DB snake_case
 */
async function createPaymentRecord(
  sql: NeonQueryFunction<false, false>,
  payment: SageSupplierPayment
): Promise<{ id: string }> {
  const result = await sql`
    INSERT INTO sage_supplier_payments (
      sage_payment_id,
      sage_supplier_id,
      payment_date,
      amount,
      currency,
      reference,
      payment_method,
      raw_data
    ) VALUES (
      ${payment.ID},
      ${payment.SupplierID},
      ${payment.Date},
      ${payment.Total ?? 0},
      ${'ZAR'},
      ${payment.Reference || null},
      ${payment.PaymentMethod != null ? String(payment.PaymentMethod) : null},
      ${JSON.stringify(payment)}
    )
    RETURNING id
  `;

  return { id: result[0].id as string };
}

/**
 * Match payment to invoice
 */
async function matchPaymentToInvoice(
  sql: NeonQueryFunction<false, false>,
  localPaymentId: string,
  payment: SageSupplierPayment
): Promise<{ invoiceId: string; poId: string; projectId: string } | null> {
  // Try to match by reference to invoice number
  const paymentRef = payment.Reference || '';
  if (paymentRef) {
    const invoiceMatch = await sql`
      SELECT
        ssi.id,
        ssi.ff_purchase_order_id,
        po.project_id
      FROM sage_supplier_invoices ssi
      LEFT JOIN purchase_orders po ON po.id = ssi.ff_purchase_order_id
      WHERE (ssi.invoice_number = ${paymentRef}
        OR ssi.sage_invoice_id = ${paymentRef})
        AND ssi.ff_purchase_order_id IS NOT NULL
    `;

    if (invoiceMatch.length > 0 && invoiceMatch[0].ff_purchase_order_id) {
      await linkPaymentToInvoice(sql, localPaymentId, invoiceMatch[0].id as string);
      return {
        invoiceId: invoiceMatch[0].id as string,
        poId: invoiceMatch[0].ff_purchase_order_id as string,
        projectId: invoiceMatch[0].project_id as string,
      };
    }
  }

  // Try to match by supplier + amount (approximate)
  const supplierMapping = await sql`
    SELECT ff_entity_id FROM sage_entity_mappings
    WHERE sage_entity_type = 'supplier'
      AND sage_entity_id = ${payment.SupplierID}
      AND sync_status = 'synced'
    LIMIT 1
  `;

  if (supplierMapping.length > 0) {
    const paymentAmount = payment.Total ?? 0;
    const amountMatch = await sql`
      SELECT
        ssi.id,
        ssi.ff_purchase_order_id,
        po.project_id
      FROM sage_supplier_invoices ssi
      LEFT JOIN purchase_orders po ON po.id = ssi.ff_purchase_order_id
      WHERE ssi.sage_supplier_id = ${payment.SupplierID}
        AND ABS(ssi.outstanding_amount - ${paymentAmount}) < 0.01
        AND ssi.status != 'paid'
        AND ssi.ff_purchase_order_id IS NOT NULL
      ORDER BY ssi.invoice_date DESC
      LIMIT 1
    `;

    if (amountMatch.length > 0) {
      await linkPaymentToInvoice(sql, localPaymentId, amountMatch[0].id as string);
      return {
        invoiceId: amountMatch[0].id as string,
        poId: amountMatch[0].ff_purchase_order_id as string,
        projectId: amountMatch[0].project_id as string,
      };
    }
  }

  return null;
}

/**
 * Link payment to invoice
 */
async function linkPaymentToInvoice(
  sql: NeonQueryFunction<false, false>,
  paymentId: string,
  invoiceId: string
): Promise<void> {
  await sql`
    UPDATE sage_supplier_payments
    SET
      sage_invoice_id = ${invoiceId},
      match_status = 'matched',
      updated_at = NOW()
    WHERE id = ${paymentId}
  `;

  // Update invoice outstanding amount
  const payment = await sql`
    SELECT amount FROM sage_supplier_payments WHERE id = ${paymentId}
  `;

  const paymentAmount = parseFloat(payment[0].amount as string);

  await sql`
    UPDATE sage_supplier_invoices
    SET
      outstanding_amount = GREATEST(0, outstanding_amount - ${paymentAmount}),
      status = CASE
        WHEN outstanding_amount - ${paymentAmount} <= 0 THEN 'paid'
        ELSE 'partial'
      END,
      updated_at = NOW()
    WHERE id = ${invoiceId}
  `;

  logger.info(`Linked payment ${paymentId} to invoice ${invoiceId}`);
}

/**
 * Create budget transaction for payment
 */
async function createPaymentBudgetTransaction(
  sql: NeonQueryFunction<false, false>,
  paymentId: string,
  payment: SageSupplierPayment,
  match: { invoiceId: string; poId: string; projectId: string }
): Promise<void> {
  // Get budget item from PO
  const poDetails = await sql`
    SELECT budget_item_id, budget_category
    FROM purchase_orders
    WHERE id = ${match.poId}
  `;

  const budgetItemId = poDetails[0]?.budget_item_id;
  const category = poDetails[0]?.budget_category || 'MATERIALS';
  const paymentAmount = payment.Total ?? 0;
  const paymentRef = payment.Reference || payment.DocumentNumber || payment.ID;

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
      sage_payment_id,
      transaction_date,
      status
    ) VALUES (
      ${match.projectId},
      ${budgetItemId},
      ${category},
      'payment',
      ${paymentAmount},
      ${`Sage Payment: ${paymentRef}`},
      'purchase_order',
      ${match.poId},
      ${paymentId},
      ${payment.Date},
      'completed'
    )
    ON CONFLICT (reference_type, reference_id, transaction_type, sage_payment_id)
    DO UPDATE SET
      amount = ${paymentAmount},
      updated_at = NOW()
  `;

  logger.info(`Created budget transaction for payment ${paymentRef}`);
}

/**
 * Check if PO is fully paid and update status
 */
async function checkAndUpdatePOStatus(
  sql: NeonQueryFunction<false, false>,
  poId: string
): Promise<boolean> {
  // Get PO total and sum of payments
  const po = await sql`
    SELECT total_amount FROM purchase_orders WHERE id = ${poId}
  `;

  const payments = await sql`
    SELECT COALESCE(SUM(bt.amount), 0) as total_paid
    FROM budget_transactions bt
    WHERE bt.reference_type = 'purchase_order'
      AND bt.reference_id = ${poId}
      AND bt.transaction_type = 'payment'
  `;

  const totalAmount = parseFloat(po[0]?.total_amount as string || '0');
  const totalPaid = parseFloat(payments[0]?.total_paid as string || '0');

  if (totalPaid >= totalAmount) {
    await sql`
      UPDATE purchase_orders
      SET
        status = 'completed',
        payment_status = 'paid',
        updated_at = NOW()
      WHERE id = ${poId}
    `;

    logger.info(`PO ${poId} marked as fully paid`);
    return true;
  }

  // Update partial payment status
  if (totalPaid > 0) {
    await sql`
      UPDATE purchase_orders
      SET
        payment_status = 'partial',
        updated_at = NOW()
      WHERE id = ${poId}
    `;
  }

  return false;
}

/**
 * Get payment summary for a PO
 */
export async function getPOPaymentSummary(
  sql: NeonQueryFunction<false, false>,
  poId: string
): Promise<{
  totalAmount: number;
  invoicedAmount: number;
  paidAmount: number;
  outstandingAmount: number;
  status: string;
}> {
  const po = await sql`
    SELECT total_amount, payment_status FROM purchase_orders WHERE id = ${poId}
  `;

  const invoices = await sql`
    SELECT COALESCE(SUM(total_amount), 0) as invoiced
    FROM sage_supplier_invoices
    WHERE ff_purchase_order_id = ${poId}
  `;

  const payments = await sql`
    SELECT COALESCE(SUM(amount), 0) as paid
    FROM budget_transactions
    WHERE reference_type = 'purchase_order'
      AND reference_id = ${poId}
      AND transaction_type = 'payment'
  `;

  const totalAmount = parseFloat(po[0]?.total_amount as string || '0');
  const invoicedAmount = parseFloat(invoices[0]?.invoiced as string || '0');
  const paidAmount = parseFloat(payments[0]?.paid as string || '0');

  return {
    totalAmount,
    invoicedAmount,
    paidAmount,
    outstandingAmount: totalAmount - paidAmount,
    status: (po[0]?.payment_status as string) || 'pending',
  };
}
