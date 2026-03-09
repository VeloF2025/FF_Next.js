/**
 * Create Quote from Extraction API
 * POST /api/procurement/quotes/create-from-extraction
 *
 * Creates an actual quote record from a quote extraction
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import { withAuth } from '@/lib/auth';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse, ErrorCode } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL || '');

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }

  const { extractionId, supplierId, overrides } = req.body;

  if (!extractionId) {
    return apiResponse.validationError(res, { extractionId: 'Extraction ID is required' });
  }

  try {
    // Get the extraction
    const extractions = await sql`
      SELECT * FROM quote_extractions WHERE id = ${extractionId}
    `;

    if (extractions.length === 0) {
      return apiResponse.notFound(res, 'Quote extraction', extractionId);
    }

    const extraction = extractions[0]!;

    // Use overrides if provided, otherwise fall back to extraction values
    const supplierName = overrides?.supplierName || extraction.extracted_supplier_name;
    const quoteNumber = overrides?.quoteNumber || extraction.extracted_quote_number;
    const quoteDate = overrides?.quoteDate || extraction.extracted_quote_date;
    const validUntilStr = overrides?.validUntil || extraction.extracted_valid_until;
    const total = overrides?.total ?? extraction.extracted_total ?? 0;
    const subtotal = overrides?.subtotal ?? extraction.extracted_subtotal ?? total;
    const vatAmount = overrides?.vatAmount ?? extraction.extracted_vat_amount ?? 0;
    const currency = overrides?.currency || extraction.extracted_currency || 'ZAR';
    const paymentTerms = overrides?.paymentTerms || extraction.extracted_payment_terms;
    const deliveryTerms = overrides?.deliveryTerms || extraction.extracted_delivery_terms;

    // Check if a quote already exists for this extraction (use actual quote number)
    if (quoteNumber) {
      const existingQuotes = await sql`
        SELECT id FROM quotes
        WHERE rfq_id = ${extraction.rfq_id}
          AND quote_number = ${quoteNumber}
      `;

      if (existingQuotes.length > 0) {
        return apiResponse.error(res, ErrorCode.CONFLICT, 'A quote with this number already exists for this RFQ');
      }
    }

    // Determine supplier_id - use provided or try to match by name
    let finalSupplierId = supplierId;
    if (!finalSupplierId && supplierName) {
      const matchedSuppliers = await sql`
        SELECT id FROM suppliers
        WHERE LOWER(company_name) LIKE LOWER(${'%' + supplierName + '%'})
           OR LOWER(name) LIKE LOWER(${'%' + supplierName + '%'})
        LIMIT 1
      `;
      if (matchedSuppliers.length > 0) {
        finalSupplierId = matchedSuppliers[0]!.id;
      }
    }

    // If still no supplier, create a new one from the data
    if (!finalSupplierId) {
      const supplierCode = 'SUP-SCAN-' + Date.now();
      const createdBy = ((req as any).user?.id as string | undefined) || 'system';

      const newSupplier = await sql`
        INSERT INTO suppliers (code, name, company_name, email, phone, vat_number, status, created_by)
        VALUES (
          ${supplierCode},
          ${supplierName || 'Unknown Supplier'},
          ${supplierName || 'Unknown Supplier'},
          ${extraction.extracted_supplier_email || null},
          ${extraction.extracted_supplier_phone || null},
          ${extraction.extracted_supplier_vat || null},
          'active',
          ${createdBy}
        )
        RETURNING id
      `;
      finalSupplierId = newSupplier[0]!.id;
      log.info('[CreateQuote] Created new supplier', { supplierId: finalSupplierId, code: supplierCode, name: supplierName });
    }

    // Calculate valid_until (default 30 days if not provided)
    const validUntil = validUntilStr
      ? new Date(validUntilStr)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // Create the quote using user-reviewed values
    const finalQuoteNumber = quoteNumber || 'SCAN-' + Date.now();
    const newQuote = await sql`
      INSERT INTO quotes (
        rfq_id,
        supplier_id,
        project_id,
        quote_number,
        quote_reference,
        status,
        submission_date,
        valid_until,
        total_value,
        subtotal,
        tax_amount,
        currency,
        payment_terms,
        delivery_terms,
        notes
      ) VALUES (
        ${extraction.rfq_id},
        ${finalSupplierId},
        ${extraction.project_id},
        ${finalQuoteNumber},
        ${quoteNumber || null},
        'received',
        ${quoteDate ? new Date(quoteDate) : new Date()},
        ${validUntil},
        ${total},
        ${subtotal},
        ${vatAmount},
        ${currency},
        ${paymentTerms || null},
        ${deliveryTerms || null},
        ${'Created from scanned document (reviewed). Extraction ID: ' + extractionId}
      )
      RETURNING id, quote_number
    `;

    // Update extraction status
    await sql`
      UPDATE quote_extractions
      SET status = 'applied', updated_at = NOW()
      WHERE id = ${extractionId}
    `;

    log.info('[CreateQuote] Quote created from extraction', {
      quoteId: newQuote[0]!.id,
      extractionId,
      rfqId: extraction.rfq_id,
    });

    return apiResponse.success(res, {
      quoteId: newQuote[0]!.id,
      quoteNumber: newQuote[0]!.quote_number,
      supplierId: finalSupplierId,
    });

  } catch (error) {
    log.error('[CreateQuote] Error', {
      error: error instanceof Error ? error.message : 'Unknown error',
      extractionId,
    });
    return apiResponse.internalError(res, error, 'Failed to create quote from extraction');
  }
}

export default withAuth(withErrorHandler(handler));
