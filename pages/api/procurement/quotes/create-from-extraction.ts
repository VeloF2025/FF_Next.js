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
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';

const sql = neon(process.env.DATABASE_URL || '');

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }

  const { extractionId, supplierId } = req.body;

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

    const extraction = extractions[0];

    // Check if a quote already exists for this extraction
    const existingQuotes = await sql`
      SELECT id FROM quotes
      WHERE rfq_id = ${extraction.rfq_id}
        AND quote_number = ${extraction.extracted_quote_number}
    `;

    if (existingQuotes.length > 0) {
      return apiResponse.error(res, 'DUPLICATE_QUOTE', 'A quote with this number already exists for this RFQ');
    }

    // Determine supplier_id - use provided or try to match by name
    let finalSupplierId = supplierId;
    if (!finalSupplierId && extraction.extracted_supplier_name) {
      const matchedSuppliers = await sql`
        SELECT id FROM suppliers
        WHERE LOWER(company_name) LIKE LOWER(${'%' + extraction.extracted_supplier_name + '%'})
           OR LOWER(name) LIKE LOWER(${'%' + extraction.extracted_supplier_name + '%'})
        LIMIT 1
      `;
      if (matchedSuppliers.length > 0) {
        finalSupplierId = matchedSuppliers[0].id;
      }
    }

    // If still no supplier, create a placeholder or use a default
    if (!finalSupplierId) {
      // Create a new supplier from extracted data
      const newSupplier = await sql`
        INSERT INTO suppliers (name, company_name, email, phone, vat_number, status)
        VALUES (
          ${extraction.extracted_supplier_name || 'Unknown Supplier'},
          ${extraction.extracted_supplier_name || 'Unknown Supplier'},
          ${extraction.extracted_supplier_email || null},
          ${extraction.extracted_supplier_phone || null},
          ${extraction.extracted_supplier_vat || null},
          'active'
        )
        RETURNING id
      `;
      finalSupplierId = newSupplier[0].id;
      log.info('[CreateQuote] Created new supplier', { supplierId: finalSupplierId });
    }

    // Calculate valid_until (default 30 days if not extracted)
    const validUntil = extraction.extracted_valid_until
      ? new Date(extraction.extracted_valid_until)
      : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

    // Create the quote
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
        ${extraction.extracted_quote_number || 'SCAN-' + Date.now()},
        ${extraction.extracted_quote_number},
        'received',
        ${extraction.extracted_quote_date ? new Date(extraction.extracted_quote_date) : new Date()},
        ${validUntil},
        ${extraction.extracted_total || 0},
        ${extraction.extracted_subtotal || extraction.extracted_total || 0},
        ${extraction.extracted_vat_amount || 0},
        ${extraction.extracted_currency || 'ZAR'},
        ${extraction.extracted_payment_terms || null},
        ${extraction.extracted_delivery_terms || null},
        ${'Created from scanned document. Extraction ID: ' + extractionId}
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
      quoteId: newQuote[0].id,
      extractionId,
      rfqId: extraction.rfq_id,
    });

    return apiResponse.success(res, {
      quoteId: newQuote[0].id,
      quoteNumber: newQuote[0].quote_number,
      supplierId: finalSupplierId,
    });

  } catch (error) {
    log.error('[CreateQuote] Error', {
      error: error instanceof Error ? error.message : 'Unknown error',
      extractionId,
    });
    return apiResponse.error(res, 'CREATE_ERROR', 'Failed to create quote from extraction');
  }
}

export default withAuth(withErrorHandler(handler));
