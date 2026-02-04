/**
 * Quote Extraction Service
 *
 * Purpose: Extract quote information from supplier documents using VLM
 * - Supplier details
 * - Quote metadata (number, date, terms)
 * - Line items with prices
 * - Totals and VAT
 *
 * Status: WORKING - OCR Quote Scanner Feature
 *
 * NLNH Confidence: HIGH
 */

import { log } from '@/lib/logger';
import type {
  QuoteExtractionResult,
  ExtractedSupplier,
  ExtractedQuoteInfo,
  ExtractedLineItem,
  ExtractedTotals,
} from '../types/extraction.types';
import {
  getVlmFewShotExamples,
  buildVlmFewShotPrompt,
  recordCorrectExtraction,
} from '@/services/vlmLearningService';

// ============================================================================
// CONFIGURATION
// ============================================================================

const VLM_API_BASE = process.env.VLM_API_URL || 'http://100.96.203.105:8100';
const VLM_API_ENDPOINT = `${VLM_API_BASE}/v1/chat/completions`;
const VLM_MODEL = process.env.VLM_EXTRACTION_MODEL || 'Qwen/Qwen3-VL-8B-Instruct';
const VLM_TIMEOUT_MS = 90000; // 90 seconds for complex documents
const VLM_TEMPERATURE = 0.1;
const MAX_IMAGE_DIMENSION = 1280;
const JPEG_QUALITY = 0.85;

// ============================================================================
// VLM PROMPTS
// ============================================================================

const QUOTE_EXTRACTION_PROMPT = `You are analyzing a supplier quote document. Extract ALL visible information accurately.

CRITICAL RULES:
1. Extract EXACTLY what you see - do not calculate or infer
2. For prices, use numeric values without currency symbols
3. If a field is not visible, use null
4. Line item totals should match quantity × unit price if visible

Return ONLY valid JSON (no markdown, no explanation):

{
  "supplier": {
    "name": "Company name from letterhead or header",
    "address": "Full address if visible (can be null)",
    "phone": "Phone number if visible (can be null)",
    "email": "Email if visible (can be null)",
    "vatNumber": "VAT/Tax number if visible (can be null)",
    "contactPerson": "Contact person name if visible (can be null)"
  },
  "quoteInfo": {
    "quoteNumber": "Quote/reference number",
    "quoteDate": "Date in YYYY-MM-DD format (or original format if unclear)",
    "validUntil": "Validity/expiry date in YYYY-MM-DD format (can be null)",
    "paymentTerms": "Payment terms text (e.g., 'Net 30 days', '50% deposit')",
    "deliveryTerms": "Delivery terms text (e.g., 'Ex Works', 'Delivered site')",
    "deliveryDays": "Number of days for delivery if specified (integer or null)",
    "reference": "Any reference number or PO reference (can be null)"
  },
  "lineItems": [
    {
      "lineNumber": 1,
      "itemCode": "Product code/SKU if visible (can be null)",
      "description": "Full item description",
      "quantity": 100,
      "unit": "m" | "each" | "kg" | "set" | "lot" | etc.,
      "unitPrice": 125.50,
      "totalPrice": 12550.00,
      "notes": "Any additional notes for this item (can be null)",
      "confidence": 0.95
    }
  ],
  "totals": {
    "subtotal": 12550.00,
    "vatRate": 15,
    "vatAmount": 1882.50,
    "total": 14432.50,
    "currency": "ZAR"
  },
  "extractionNotes": "Any issues, uncertainties, or observations about the extraction"
}

IMPORTANT for line items:
- Include ALL line items visible in the document
- Keep original descriptions, don't abbreviate
- If quantity or unit is not clear, use best guess with lower confidence
- Use standard units: m, km, each, kg, set, lot, pack, box, roll, meter`;

// ============================================================================
// MAIN EXTRACTION FUNCTION
// ============================================================================

/**
 * Extract quote information from a document image using VLM
 * Enhanced with few-shot learning from past corrections
 */
export async function extractQuoteFromImage(
  imageBase64: string,
  documentName?: string
): Promise<QuoteExtractionResult & { success: boolean; error?: string; processingTimeMs: number }> {
  const startTime = Date.now();

  try {
    log.info('[QuoteExtraction] Starting quote extraction', { documentName });

    // Validate input
    if (!imageBase64 || imageBase64.length < 100) {
      return createErrorResult('Invalid or empty image data', startTime);
    }

    // Prepare image data URL
    const imageDataUrl = imageBase64.startsWith('data:')
      ? imageBase64
      : `data:image/jpeg;base64,${imageBase64}`;

    // Get few-shot examples from past corrections (non-blocking)
    let enhancedPrompt = QUOTE_EXTRACTION_PROMPT;
    try {
      const examples = await getVlmFewShotExamples({
        module: 'procurement',
        analysisType: 'quote_line_item',
        maxExamples: 2,
        prioritizeCanonical: true,
      });
      if (examples.length > 0) {
        const fewShotSection = buildVlmFewShotPrompt(examples);
        enhancedPrompt = `${QUOTE_EXTRACTION_PROMPT}\n\n${fewShotSection}`;
        log.debug('[QuoteExtraction] Injected few-shot examples');
      }
    } catch (fewShotError) {
      log.warn('[QuoteExtraction] Few-shot retrieval failed', { error: fewShotError });
    }

    // Call VLM API with enhanced prompt
    const response = await callVlmApi(imageDataUrl, enhancedPrompt);

    if (!response) {
      return createErrorResult('VLM API returned no response', startTime);
    }

    // Parse VLM response
    const extraction = parseVlmResponse(response);

    const processingTimeMs = Date.now() - startTime;
    log.info('[QuoteExtraction] Extraction complete', {
      documentName,
      processingTimeMs,
      success: true,
      supplierName: extraction.supplier?.name,
      lineItemCount: extraction.lineItems?.length || 0,
      total: extraction.totals?.total,
    });

    // Record successful extraction metric (non-blocking)
    if (extraction.lineItems && extraction.lineItems.length > 0) {
      recordCorrectExtraction('procurement', 'quote_line_item', 0.8).catch(() => {
        // Silently ignore metric recording failures
      });
    }

    return {
      ...extraction,
      success: true,
      processingTimeMs,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log.error('[QuoteExtraction] Extraction failed', { error: errorMsg, documentName });
    return createErrorResult(errorMsg, startTime);
  }
}

/**
 * Extract quote from an image URL (fetches and converts to base64)
 */
export async function extractQuoteFromImageUrl(
  imageUrl: string,
  documentName?: string
): Promise<QuoteExtractionResult & { success: boolean; error?: string; processingTimeMs: number }> {
  const startTime = Date.now();

  try {
    log.info('[QuoteExtraction] Fetching image from URL', {
      url: imageUrl.substring(0, 100),
      documentName,
    });

    const response = await fetch(imageUrl);
    if (!response.ok) {
      return createErrorResult(`Failed to fetch image: ${response.status}`, startTime);
    }

    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');

    // Determine content type
    const contentType = response.headers.get('content-type') || 'image/jpeg';
    const imageDataUrl = `data:${contentType};base64,${base64}`;

    return extractQuoteFromImage(imageDataUrl, documentName);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    return createErrorResult(`Failed to fetch image: ${errorMsg}`, startTime);
  }
}

/**
 * Extract quote from multiple pages (for multi-page PDFs)
 * Combines results from all pages
 */
export async function extractQuoteFromMultipleImages(
  images: string[],
  documentName?: string
): Promise<QuoteExtractionResult & { success: boolean; error?: string; processingTimeMs: number }> {
  const startTime = Date.now();

  if (images.length === 0) {
    return createErrorResult('No images provided', startTime);
  }

  // For single image, use standard extraction
  if (images.length === 1) {
    return extractQuoteFromImage(images[0], documentName);
  }

  log.info('[QuoteExtraction] Processing multi-page document', {
    pageCount: images.length,
    documentName,
  });

  // Extract from all pages
  const extractions = await Promise.all(
    images.slice(0, 5).map((img, idx) => // Limit to first 5 pages
      extractQuoteFromImage(img, `${documentName || 'doc'}_page${idx + 1}`)
    )
  );

  // Combine results - use first page for supplier/quote info, merge line items
  const validExtractions = extractions.filter(e => e.success);

  if (validExtractions.length === 0) {
    return createErrorResult('Failed to extract from any page', startTime);
  }

  const combined = validExtractions[0];

  // Merge line items from subsequent pages
  for (let i = 1; i < validExtractions.length; i++) {
    const pageItems = validExtractions[i].lineItems || [];
    const lastLineNumber = combined.lineItems?.length || 0;

    // Renumber and add items
    pageItems.forEach((item, idx) => {
      combined.lineItems?.push({
        ...item,
        lineNumber: lastLineNumber + idx + 1,
      });
    });
  }

  // Recalculate totals if we have more items
  if (combined.lineItems && combined.lineItems.length > 0) {
    const subtotal = combined.lineItems.reduce(
      (sum, item) => sum + (item.totalPrice || 0),
      0
    );
    if (combined.totals) {
      combined.totals.subtotal = subtotal;
      if (combined.totals.vatRate) {
        combined.totals.vatAmount = subtotal * (combined.totals.vatRate / 100);
        combined.totals.total = subtotal + combined.totals.vatAmount;
      }
    }
  }

  const processingTimeMs = Date.now() - startTime;
  log.info('[QuoteExtraction] Multi-page extraction complete', {
    documentName,
    pageCount: images.length,
    pagesProcessed: validExtractions.length,
    totalLineItems: combined.lineItems?.length || 0,
    processingTimeMs,
  });

  return {
    ...combined,
    processingTimeMs,
    extractionNotes: `Processed ${validExtractions.length} of ${images.length} pages. ${combined.extractionNotes || ''}`,
  };
}

// ============================================================================
// VLM API CALL
// ============================================================================

async function callVlmApi(imageDataUrl: string, customPrompt?: string): Promise<string | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), VLM_TIMEOUT_MS);

  try {
    const payload = {
      model: VLM_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: customPrompt || QUOTE_EXTRACTION_PROMPT },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        },
      ],
      temperature: VLM_TEMPERATURE,
      max_tokens: 4000, // Higher for complex quotes with many items
    };

    const response = await fetch(VLM_API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      log.error('[QuoteExtraction] VLM API error', {
        status: response.status,
        statusText: response.statusText,
      });
      return null;
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content || null;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      log.error('[QuoteExtraction] VLM API timeout (90s)');
    } else {
      log.error('[QuoteExtraction] VLM API call failed', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
    }
    return null;
  }
}

// ============================================================================
// RESPONSE PARSING
// ============================================================================

function parseVlmResponse(responseText: string): QuoteExtractionResult {
  try {
    // Clean up response - remove markdown code blocks if present
    let cleanJson = responseText.trim();

    // Remove ```json ... ``` wrapper
    if (cleanJson.startsWith('```')) {
      cleanJson = cleanJson.replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
    }

    // Try to extract JSON from response
    const jsonMatch = cleanJson.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      log.warn('[QuoteExtraction] No JSON found in response', {
        response: responseText.substring(0, 300),
      });
      return createEmptyResult('No JSON in VLM response');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Parse and validate supplier
    const supplier: ExtractedSupplier = {
      name: normalizeString(parsed.supplier?.name),
      address: normalizeString(parsed.supplier?.address),
      phone: normalizeString(parsed.supplier?.phone),
      email: normalizeString(parsed.supplier?.email),
      vatNumber: normalizeString(parsed.supplier?.vatNumber),
      contactPerson: normalizeString(parsed.supplier?.contactPerson),
    };

    // Parse and validate quote info
    const quoteInfo: ExtractedQuoteInfo = {
      quoteNumber: normalizeString(parsed.quoteInfo?.quoteNumber),
      quoteDate: normalizeDate(parsed.quoteInfo?.quoteDate),
      validUntil: normalizeDate(parsed.quoteInfo?.validUntil),
      paymentTerms: normalizeString(parsed.quoteInfo?.paymentTerms),
      deliveryTerms: normalizeString(parsed.quoteInfo?.deliveryTerms),
      deliveryDays: normalizeNumber(parsed.quoteInfo?.deliveryDays),
      reference: normalizeString(parsed.quoteInfo?.reference),
    };

    // Parse line items
    const rawItems = Array.isArray(parsed.lineItems) ? parsed.lineItems : [];
    const lineItems: ExtractedLineItem[] = rawItems.map((item: Record<string, unknown>, idx: number) => ({
      lineNumber: normalizeNumber(item.lineNumber) || idx + 1,
      itemCode: normalizeString(item.itemCode),
      description: normalizeString(item.description) || `Item ${idx + 1}`,
      quantity: normalizeNumber(item.quantity),
      unit: normalizeUnit(item.unit),
      unitPrice: normalizeNumber(item.unitPrice),
      totalPrice: normalizeNumber(item.totalPrice),
      notes: normalizeString(item.notes),
      confidence: normalizeConfidence(item.confidence),
    }));

    // Parse totals
    const totals: ExtractedTotals = {
      subtotal: normalizeNumber(parsed.totals?.subtotal),
      vatRate: normalizeNumber(parsed.totals?.vatRate),
      vatAmount: normalizeNumber(parsed.totals?.vatAmount),
      total: normalizeNumber(parsed.totals?.total),
      currency: normalizeString(parsed.totals?.currency) || 'ZAR',
    };

    return {
      supplier,
      quoteInfo,
      lineItems,
      totals,
      extractionNotes: normalizeString(parsed.extractionNotes),
      rawResponse: responseText,
    };
  } catch (error) {
    log.error('[QuoteExtraction] Failed to parse VLM response', {
      error: error instanceof Error ? error.message : 'Unknown',
      response: responseText.substring(0, 300),
    });
    return createEmptyResult('Failed to parse VLM response');
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function normalizeString(value: unknown): string | null {
  if (value === null || value === undefined || value === 'null' || value === 'undefined') {
    return null;
  }
  const str = String(value).trim();
  return str.length > 0 ? str : null;
}

function normalizeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === 'null') {
    return null;
  }

  // Handle string numbers with currency symbols
  if (typeof value === 'string') {
    // Remove currency symbols, spaces, and thousand separators
    const cleaned = value.replace(/[R$€£¥,\s]/g, '').trim();
    const num = parseFloat(cleaned);
    return isNaN(num) ? null : num;
  }

  if (typeof value === 'number') {
    return isNaN(value) ? null : value;
  }

  return null;
}

function normalizeDate(value: unknown): string | null {
  if (!value || value === 'null') return null;

  const str = String(value).trim();
  if (!str) return null;

  // Try to parse and format as YYYY-MM-DD
  try {
    // Handle common date formats
    // DD/MM/YYYY or DD-MM-YYYY
    const dmyMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (dmyMatch) {
      return `${dmyMatch[3]}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}`;
    }

    // YYYY/MM/DD or YYYY-MM-DD
    const ymdMatch = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (ymdMatch) {
      return `${ymdMatch[1]}-${ymdMatch[2].padStart(2, '0')}-${ymdMatch[3].padStart(2, '0')}`;
    }

    // If it's already in ISO format, return as is
    if (/^\d{4}-\d{2}-\d{2}/.test(str)) {
      return str.substring(0, 10);
    }

    // Return original if can't parse
    return str;
  } catch {
    return str;
  }
}

function normalizeUnit(value: unknown): string | null {
  if (!value || value === 'null') return null;

  const str = String(value).toLowerCase().trim();

  // Standardize common units
  const unitMap: Record<string, string> = {
    ea: 'each',
    pcs: 'each',
    pc: 'each',
    piece: 'each',
    pieces: 'each',
    unit: 'each',
    units: 'each',
    metre: 'm',
    meter: 'm',
    meters: 'm',
    metres: 'm',
    kilometer: 'km',
    kilometre: 'km',
    kilogram: 'kg',
    kilograms: 'kg',
    kgs: 'kg',
    roll: 'roll',
    rolls: 'roll',
    box: 'box',
    boxes: 'box',
    pack: 'pack',
    packs: 'pack',
    set: 'set',
    sets: 'set',
    lot: 'lot',
    lots: 'lot',
  };

  return unitMap[str] || str;
}

function normalizeConfidence(value: unknown): number {
  if (typeof value === 'number' && value >= 0 && value <= 1) {
    return value;
  }
  return 0.7; // Default confidence
}

function createEmptyResult(note: string): QuoteExtractionResult {
  return {
    supplier: {
      name: null,
      address: null,
      phone: null,
      email: null,
      vatNumber: null,
    },
    quoteInfo: {
      quoteNumber: null,
      quoteDate: null,
      validUntil: null,
      paymentTerms: null,
      deliveryTerms: null,
      deliveryDays: null,
    },
    lineItems: [],
    totals: {
      subtotal: null,
      vatRate: null,
      vatAmount: null,
      total: null,
      currency: 'ZAR',
    },
    extractionNotes: note,
  };
}

function createErrorResult(
  error: string,
  startTime: number
): QuoteExtractionResult & { success: boolean; error: string; processingTimeMs: number } {
  return {
    ...createEmptyResult(error),
    success: false,
    error,
    processingTimeMs: Date.now() - startTime,
  };
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/**
 * Calculate overall extraction confidence based on completeness
 */
export function calculateExtractionConfidence(extraction: QuoteExtractionResult): number {
  let score = 0;
  let maxScore = 0;

  // Supplier name (important)
  maxScore += 20;
  if (extraction.supplier?.name) score += 20;

  // Quote number
  maxScore += 15;
  if (extraction.quoteInfo?.quoteNumber) score += 15;

  // Quote date
  maxScore += 10;
  if (extraction.quoteInfo?.quoteDate) score += 10;

  // At least one line item
  maxScore += 25;
  if (extraction.lineItems && extraction.lineItems.length > 0) {
    score += 25;

    // Line items with prices
    const itemsWithPrices = extraction.lineItems.filter(i => i.unitPrice !== null);
    const priceRatio = itemsWithPrices.length / extraction.lineItems.length;
    maxScore += 15;
    score += Math.round(priceRatio * 15);
  }

  // Total amount
  maxScore += 15;
  if (extraction.totals?.total) score += 15;

  return Math.round((score / maxScore) * 100) / 100;
}

/**
 * Validate extraction has minimum required data
 */
export function isValidExtraction(extraction: QuoteExtractionResult): boolean {
  // Must have at least supplier name OR quote number
  const hasIdentifier = extraction.supplier?.name || extraction.quoteInfo?.quoteNumber;

  // Must have at least one line item
  const hasLineItems = extraction.lineItems && extraction.lineItems.length > 0;

  return Boolean(hasIdentifier && hasLineItems);
}
