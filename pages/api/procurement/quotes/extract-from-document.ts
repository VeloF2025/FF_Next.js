/**
 * Quote Document Extraction API
 * POST /api/procurement/quotes/extract-from-document
 *
 * Extracts quote data from uploaded PDF/image documents using VLM
 * Optionally matches extracted items to RFQ items
 *
 * Status: WORKING - OCR Quote Scanner Feature
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { neon } from '@neondatabase/serverless';
import formidable from 'formidable';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { withAuth } from '@/lib/auth';
import { withErrorHandler } from '@/lib/api-error-handler';
import { apiResponse } from '@/lib/apiResponse';
import { log } from '@/lib/logger';
import { vfStorage, isVFStorageAvailable } from '@/services/vfStorageAdapter';
import {
  extractQuoteFromImage,
  extractQuoteFromMultipleImages,
  calculateExtractionConfidence,
  isValidExtraction,
} from '@/modules/procurement/quote-scanner/services/quoteExtractionService';
import {
  matchExtractedToRfq,
  type RfqItem,
} from '@/modules/procurement/quote-scanner/services/quoteMatchingService';
import type {
  ExtractQuoteResponse,
  ExtractionStatus,
} from '@/modules/procurement/quote-scanner/types/extraction.types';

const sql = neon(process.env.DATABASE_URL || '');

// Config for file upload
export const config = {
  api: {
    bodyParser: false,
    responseLimit: '25mb',
  },
  maxDuration: 120, // 2 minute timeout for VLM processing
};

// Valid file types
const VALID_MIME_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/jpg',
  'image/png',
];

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB

// ============================================================================
// HANDLER
// ============================================================================

async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return apiResponse.methodNotAllowed(res, req.method!, ['POST']);
  }

  let tempFilePath: string | null = null;
  let uploadedDocumentUrl: string | null = null;

  try {
    // Parse multipart form data
    const { fields, files } = await parseForm(req);

    // Extract fields
    const projectId = getFieldValue(fields.projectId);
    const rfqId = getFieldValue(fields.rfqId);
    const supplierId = getFieldValue(fields.supplierId);

    // Validate required fields
    if (!projectId) {
      return apiResponse.validationError(res, { projectId: 'Project ID is required' });
    }

    // Get uploaded file
    const file = Array.isArray(files.document) ? files.document[0] : files.document;
    if (!file) {
      return apiResponse.validationError(res, { document: 'Document file is required' });
    }

    tempFilePath = file.filepath;

    // Validate file type
    const mimeType = file.mimetype || '';
    if (!VALID_MIME_TYPES.includes(mimeType)) {
      return apiResponse.validationError(res, {
        document: `Invalid file type. Allowed: PDF, JPEG, PNG`,
      });
    }

    // Validate file size
    if (file.size > MAX_FILE_SIZE) {
      return apiResponse.validationError(res, {
        document: `File too large. Maximum size: ${MAX_FILE_SIZE / 1024 / 1024}MB`,
      });
    }

    log.info('[QuoteExtract] Processing document', {
      projectId,
      rfqId,
      fileName: file.originalFilename,
      mimeType,
      size: file.size,
    });

    // Convert file to base64 images
    const images = await convertToImages(tempFilePath, mimeType);

    if (images.length === 0) {
      return apiResponse.error(res, 'PROCESSING_ERROR', 'Failed to process document');
    }

    // Upload document to VF Storage
    if (await isVFStorageAvailable()) {
      const fileBuffer = fs.readFileSync(tempFilePath);
      const sanitizedName = sanitizeFileName(file.originalFilename || 'quote_document');
      const fileName = `${projectId}_${Date.now()}_${sanitizedName}`;

      const uploadResult = await vfStorage.uploadFile(fileBuffer, 'procurement', 'quotes', fileName);
      if (uploadResult.success) {
        uploadedDocumentUrl = uploadResult.url;
      }
    }

    // Extract quote data from images
    const startTime = Date.now();
    const extraction = images.length === 1
      ? await extractQuoteFromImage(images[0], file.originalFilename || undefined)
      : await extractQuoteFromMultipleImages(images, file.originalFilename || undefined);

    if (!extraction.success) {
      // Save failed extraction record
      await saveExtractionRecord({
        projectId,
        rfqId,
        supplierId: supplierId ? parseInt(supplierId) : null,
        documentUrl: uploadedDocumentUrl || '',
        documentType: mimeType.includes('pdf') ? 'pdf' : 'image',
        documentName: file.originalFilename || null,
        documentSize: file.size,
        status: 'failed',
        errorMessage: extraction.error || 'Extraction failed',
        processingTimeMs: extraction.processingTimeMs,
      });

      return apiResponse.error(res, 'EXTRACTION_FAILED', extraction.error || 'Failed to extract quote data');
    }

    // Validate extraction has minimum data
    if (!isValidExtraction(extraction)) {
      return apiResponse.error(
        res,
        'INVALID_EXTRACTION',
        'Could not extract sufficient data from document. Please check the image quality.'
      );
    }

    // Calculate confidence
    const confidenceScore = calculateExtractionConfidence(extraction);

    // Match to RFQ items if rfqId provided
    let matchingResult = null;
    if (rfqId) {
      const rfqData = await getRfqWithItems(rfqId);
      if (rfqData) {
        matchingResult = matchExtractedToRfq(
          extraction,
          rfqData.items,
          rfqId,
          rfqData.rfqNumber
        );
      }
    }

    // Save extraction record
    const extractionId = await saveExtractionRecord({
      projectId,
      rfqId,
      supplierId: supplierId ? parseInt(supplierId) : null,
      documentUrl: uploadedDocumentUrl || '',
      documentType: mimeType.includes('pdf') ? 'pdf' : 'image',
      documentName: file.originalFilename || null,
      documentSize: file.size,
      extractionData: extraction,
      matchingData: matchingResult,
      confidenceScore,
      processingTimeMs: extraction.processingTimeMs,
      status: matchingResult ? 'matched' : 'extracted',
    });

    // Save individual line items
    if (extraction.lineItems && extraction.lineItems.length > 0) {
      await saveExtractionItems(extractionId, extraction.lineItems, matchingResult);
    }

    const response: ExtractQuoteResponse = {
      success: true,
      extractionId,
      extraction,
      matching: matchingResult || undefined,
      documentUrl: uploadedDocumentUrl || '',
      processingTimeMs: Date.now() - startTime,
      warnings: matchingResult?.warnings,
    };

    log.info('[QuoteExtract] Extraction complete', {
      extractionId,
      lineItems: extraction.lineItems?.length || 0,
      matched: matchingResult?.totalMatched || 0,
      confidence: confidenceScore,
      processingTimeMs: response.processingTimeMs,
    });

    return apiResponse.success(res, response);

  } catch (error) {
    log.error('[QuoteExtract] Error', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    return apiResponse.error(res, 'PROCESSING_ERROR', 'Failed to process document');
  } finally {
    // Cleanup temp file
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Parse multipart form data
 */
function parseForm(req: NextApiRequest): Promise<{
  fields: formidable.Fields;
  files: formidable.Files;
}> {
  return new Promise((resolve, reject) => {
    const form = formidable({
      maxFileSize: MAX_FILE_SIZE,
      keepExtensions: true,
    });

    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      else resolve({ fields, files });
    });
  });
}

/**
 * Get single field value from formidable fields
 */
function getFieldValue(field: string | string[] | undefined): string | undefined {
  if (!field) return undefined;
  return Array.isArray(field) ? field[0] : field;
}

/**
 * Sanitize filename for storage
 */
function sanitizeFileName(name: string): string {
  return name
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .substring(0, 100);
}

/**
 * Convert PDF to PNG images using pdftoppm (from poppler-utils)
 * Same approach as staff documents OCR
 */
async function convertPdfToImages(pdfPath: string, maxPages: number = 5): Promise<string[]> {
  const tempDir = os.tmpdir();
  const outputBase = path.join(tempDir, `quote-pdf-${Date.now()}`);
  const dpi = 150;
  const images: string[] = [];

  try {
    // Get total page count first
    const pageCountOutput = execSync(`pdfinfo "${pdfPath}" | grep Pages`, {
      timeout: 10000,
      encoding: 'utf-8',
    });
    const totalPages = parseInt(pageCountOutput.match(/\d+/)?.[0] || '1', 10);
    const pagesToConvert = Math.min(totalPages, maxPages);

    log.info('[QuoteExtract] Converting PDF pages', { totalPages, pagesToConvert, dpi });

    // Convert each page
    for (let page = 1; page <= pagesToConvert; page++) {
      const pageOutput = `${outputBase}-page${page}`;

      execSync(`pdftoppm -png -f ${page} -l ${page} -r ${dpi} "${pdfPath}" "${pageOutput}"`, {
        timeout: 30000,
        stdio: 'pipe',
      });

      // pdftoppm outputs file as outputBase-1.png for single page
      const outputPath = `${pageOutput}-${page}.png`;
      const altPath = `${pageOutput}-01.png`;

      const imagePath = fs.existsSync(outputPath) ? outputPath :
                        fs.existsSync(altPath) ? altPath : null;

      if (imagePath) {
        const imageBuffer = fs.readFileSync(imagePath);
        const base64 = imageBuffer.toString('base64');
        images.push(`data:image/png;base64,${base64}`);

        // Clean up converted image
        fs.unlinkSync(imagePath);
      }
    }

    log.info('[QuoteExtract] PDF conversion complete', { pagesConverted: images.length });
    return images;

  } catch (error) {
    log.error('[QuoteExtract] PDF conversion error', {
      error: error instanceof Error ? error.message : 'Unknown',
    });
    return [];
  }
}

/**
 * Convert document to base64 images for VLM processing
 */
async function convertToImages(filePath: string, mimeType: string): Promise<string[]> {
  if (mimeType === 'application/pdf') {
    return convertPdfToImages(filePath);
  }

  // For images, just return as base64
  const fileBuffer = fs.readFileSync(filePath);
  const base64 = fileBuffer.toString('base64');
  return [`data:${mimeType};base64,${base64}`];
}

/**
 * Get RFQ with items for matching
 */
async function getRfqWithItems(rfqId: string): Promise<{ rfqNumber: string; items: RfqItem[] } | null> {
  try {
    const rfqResult = await sql`
      SELECT rfq_number FROM rfqs WHERE id = ${rfqId}
    `;

    if (rfqResult.length === 0) return null;

    const itemsResult = await sql`
      SELECT
        id,
        description,
        item_code,
        quantity,
        uom as unit,
        budget_price
      FROM rfq_items
      WHERE rfq_id = ${rfqId}
      ORDER BY line_number
    `;

    return {
      rfqNumber: rfqResult[0].rfq_number,
      items: itemsResult.map((row: any) => ({
        id: row.id,
        description: row.description || '',
        itemCode: row.item_code,
        quantity: parseFloat(row.quantity) || 0,
        unit: row.unit || 'each',
        budgetPrice: row.budget_price ? parseFloat(row.budget_price) : null,
      })),
    };
  } catch (error) {
    log.error('[QuoteExtract] Failed to get RFQ', {
      rfqId,
      error: error instanceof Error ? error.message : 'Unknown',
    });
    return null;
  }
}

/**
 * Save extraction record to database
 */
async function saveExtractionRecord(data: {
  projectId: string;
  rfqId?: string | null;
  supplierId?: number | null;
  documentUrl: string;
  documentType: 'pdf' | 'image';
  documentName?: string | null;
  documentSize?: number | null;
  extractionData?: any;
  matchingData?: any;
  confidenceScore?: number;
  processingTimeMs?: number;
  status: ExtractionStatus;
  errorMessage?: string;
}): Promise<string> {
  const extraction = data.extractionData || {};

  const result = await sql`
    INSERT INTO quote_extractions (
      project_id,
      rfq_id,
      supplier_id,
      document_url,
      document_type,
      document_name,
      document_size,
      extracted_supplier_name,
      extracted_supplier_email,
      extracted_supplier_phone,
      extracted_supplier_vat,
      extracted_quote_number,
      extracted_quote_date,
      extracted_valid_until,
      extracted_payment_terms,
      extracted_delivery_terms,
      extracted_delivery_days,
      extracted_subtotal,
      extracted_vat_rate,
      extracted_vat_amount,
      extracted_total,
      extracted_currency,
      extraction_data,
      matching_data,
      confidence_score,
      processing_time_ms,
      matched_items_count,
      unmatched_items_count,
      status,
      error_message
    ) VALUES (
      ${data.projectId},
      ${data.rfqId || null},
      ${data.supplierId || null},
      ${data.documentUrl},
      ${data.documentType},
      ${data.documentName || null},
      ${data.documentSize || null},
      ${extraction.supplier?.name || null},
      ${extraction.supplier?.email || null},
      ${extraction.supplier?.phone || null},
      ${extraction.supplier?.vatNumber || null},
      ${extraction.quoteInfo?.quoteNumber || null},
      ${extraction.quoteInfo?.quoteDate || null},
      ${extraction.quoteInfo?.validUntil || null},
      ${extraction.quoteInfo?.paymentTerms || null},
      ${extraction.quoteInfo?.deliveryTerms || null},
      ${extraction.quoteInfo?.deliveryDays || null},
      ${extraction.totals?.subtotal || null},
      ${extraction.totals?.vatRate || null},
      ${extraction.totals?.vatAmount || null},
      ${extraction.totals?.total || null},
      ${extraction.totals?.currency || 'ZAR'},
      ${JSON.stringify(extraction)},
      ${data.matchingData ? JSON.stringify(data.matchingData) : null},
      ${data.confidenceScore || null},
      ${data.processingTimeMs || null},
      ${data.matchingData?.totalMatched || 0},
      ${data.matchingData?.totalUnmatched || 0},
      ${data.status},
      ${data.errorMessage || null}
    )
    RETURNING id
  `;

  return result[0].id;
}

/**
 * Save extraction line items
 */
async function saveExtractionItems(
  extractionId: string,
  items: any[],
  matchingResult: any | null
): Promise<void> {
  for (const item of items) {
    // Find matching result for this item
    const matchResult = matchingResult?.matchedItems?.find(
      (m: any) => m.extractedIndex === item.lineNumber
    );

    await sql`
      INSERT INTO quote_extraction_items (
        extraction_id,
        line_number,
        item_code,
        description,
        quantity,
        unit,
        unit_price,
        total_price,
        notes,
        confidence_score,
        matched_rfq_item_id,
        match_confidence,
        match_reason,
        is_matched
      ) VALUES (
        ${extractionId},
        ${item.lineNumber},
        ${item.itemCode || null},
        ${item.description},
        ${item.quantity || null},
        ${item.unit || null},
        ${item.unitPrice || null},
        ${item.totalPrice || null},
        ${item.notes || null},
        ${item.confidence || null},
        ${matchResult?.rfqItemId || null},
        ${matchResult?.matchConfidence || null},
        ${matchResult?.matchReason || null},
        ${matchResult?.rfqItemId ? true : false}
      )
    `;
  }
}

export default withAuth(withErrorHandler(handler));
