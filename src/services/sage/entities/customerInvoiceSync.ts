/**
 * Customer Invoice Sync Service
 *
 * Pulls customer invoices (Tax Invoices) from Sage
 * into sage_customer_invoices staging table.
 * Same pattern as invoiceSync.ts but for AR.
 */

import { NeonQueryFunction } from '@/lib/db-neon';
import { createLogger } from '@/lib/logger';
import { SageClient, SageCustomerInvoice } from '../sageClient';

const logger = createLogger('sage:customer-invoice-sync');

export interface CustomerInvoiceSyncResult {
  success: boolean;
  totalProcessed: number;
  created: number;
  updated: number;
  failed: number;
  errors: Array<{ invoiceId: string; error: string }>;
}

/**
 * Pull customer invoices from Sage and store in staging table
 */
export async function pullCustomerInvoicesFromSage(
  client: SageClient,
  sql: NeonQueryFunction<false, false>,
  options?: { sinceDate?: Date }
): Promise<CustomerInvoiceSyncResult> {
  const result: CustomerInvoiceSyncResult = {
    success: true,
    totalProcessed: 0,
    created: 0,
    updated: 0,
    failed: 0,
    errors: [],
  };

  try {
    logger.info('Starting customer invoice pull from Sage', options);

    let sageResponse;
    if (options?.sinceDate) {
      sageResponse = await client.getCustomerInvoicesSince(options.sinceDate);
    } else {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      sageResponse = await client.getCustomerInvoicesSince(thirtyDaysAgo);
    }

    const invoices = sageResponse.Results || [];
    logger.info(`Fetched ${invoices.length} customer invoices from Sage`);

    for (const invoice of invoices) {
      result.totalProcessed++;

      try {
        const existing = await sql`
          SELECT id, status FROM sage_customer_invoices
          WHERE sage_invoice_id = ${invoice.ID}
        `;

        if (existing.length > 0) {
          await updateExistingInvoice(sql, existing[0]!.id as string, invoice);
          result.updated++;
          continue;
        }

        await createInvoiceRecord(sql, invoice);
        await resolveClient(sql, invoice);
        result.created++;
      } catch (error) {
        result.failed++;
        result.errors.push({
          invoiceId: invoice.ID,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        logger.error(`Failed to process customer invoice ${invoice.ID}`, { error });
      }
    }

    await sql`
      INSERT INTO sage_sync_history (
        operation_type, direction, entity_type, status,
        records_processed, records_success, records_failed, details
      ) VALUES (
        'customer_invoice_sync', 'inbound', 'customer_invoice',
        ${result.failed === 0 ? 'success' : 'partial'},
        ${result.totalProcessed}, ${result.created + result.updated},
        ${result.failed},
        ${JSON.stringify({
          created: result.created,
          updated: result.updated,
          errors: result.errors,
        })}
      )
    `;

    logger.info('Customer invoice sync completed', result);
  } catch (error) {
    result.success = false;
    logger.error('Customer invoice sync failed', { error });

    await sql`
      INSERT INTO sage_sync_history (
        operation_type, direction, entity_type, status, error_message
      ) VALUES (
        'customer_invoice_sync', 'inbound', 'customer_invoice', 'failed',
        ${error instanceof Error ? error.message : 'Unknown error'}
      )
    `;
  }

  return result;
}

async function createInvoiceRecord(
  sql: NeonQueryFunction<false, false>,
  invoice: SageCustomerInvoice
): Promise<{ id: string }> {
  const totalAmount = invoice.Total ?? 0;
  const amountDue = invoice.AmountDue ?? totalAmount;

  const rows = await sql`
    INSERT INTO sage_customer_invoices (
      sage_invoice_id, sage_customer_id, invoice_number,
      invoice_date, due_date, reference,
      subtotal, tax_amount, total_amount, outstanding_amount,
      currency, status, raw_data
    ) VALUES (
      ${invoice.ID}, ${invoice.CustomerID},
      ${invoice.DocumentNumber || null},
      ${invoice.Date}, ${invoice.DueDate || null},
      ${invoice.Reference || null},
      ${invoice.Exclusive ?? 0}, ${invoice.Tax ?? 0},
      ${totalAmount}, ${amountDue},
      'ZAR', ${invoice.Paid ? 'paid' : 'pending'},
      ${JSON.stringify(invoice)}
    )
    RETURNING id
  `;

  return { id: rows[0]!.id as string };
}

async function updateExistingInvoice(
  sql: NeonQueryFunction<false, false>,
  localId: string,
  invoice: SageCustomerInvoice
): Promise<void> {
  await sql`
    UPDATE sage_customer_invoices
    SET outstanding_amount = ${invoice.AmountDue ?? invoice.Total ?? 0},
        total_amount = ${invoice.Total ?? 0},
        status = ${invoice.Paid ? 'paid' : 'pending'},
        raw_data = ${JSON.stringify(invoice)},
        updated_at = NOW()
    WHERE id = ${localId}
  `;
}

async function resolveClient(
  sql: NeonQueryFunction<false, false>,
  invoice: SageCustomerInvoice
): Promise<void> {
  const mapping = await sql`
    SELECT ff_entity_id FROM sage_entity_mappings
    WHERE sage_entity_type = 'customer'
      AND sage_entity_id = ${invoice.CustomerID}
      AND sync_status = 'synced' AND ff_entity_id IS NOT NULL
    LIMIT 1
  `;

  if (mapping.length > 0) {
    await sql`
      UPDATE sage_customer_invoices
      SET client_id = ${mapping[0]!.ff_entity_id}::UUID, updated_at = NOW()
      WHERE sage_invoice_id = ${invoice.ID}
    `;
  }
}
