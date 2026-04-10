/**
 * PO Extraction Service
 *
 * Purpose: Extract Client PO information from PDF documents using VLM
 * - Fibertime PO format parsing
 * - PDF to image conversion
 * - VLM API integration
 * - VLM Learning System integration for continuous improvement
 *
 * Status: WORKING - Client PO PDF Import Feature
 *
 * NLNH Confidence: HIGH
 */

import { log } from '@/lib/logger';
import type { POExtractionResult } from '../types/po-extraction.types';
import {
  getVlmFewShotExamples,
  buildVlmFewShotPrompt,
  recordCorrectExtraction,
  recordVlmCorrection,
  hashPromptContent,
} from '@/services/vlmLearningService';
import type { RecordCorrectionInput } from '@/types/vlm-learning';

// ============================================================================
// CONFIGURATION
// ============================================================================

const VLM_API_BASE = process.env.VLM_API_URL || 'http://100.96.203.105:8100';
const VLM_API_ENDPOINT = `${VLM_API_BASE}/v1/chat/completions`;
const VLM_MODEL = process.env.VLM_EXTRACTION_MODEL || process.env.VLM_MODEL || 'QuantTrio/Qwen3-VL-30B-A3B-Instruct-AWQ';
const VLM_TIMEOUT_MS = 90000; // 90 seconds for complex documents
const VLM_TEMPERATURE = 0.1;

// ============================================================================
// VLM PROMPT - Optimized for Fibertime PO Format
// ============================================================================

const PO_EXTRACTION_PROMPT = `You are analyzing a Client Purchase Order (PO) document, specifically a Fibertime-style PO. Extract ALL visible information accurately.

CRITICAL RULES:
1. Extract EXACTLY what you see - do not calculate or infer values
2. For prices/amounts, use numeric values without currency symbols
3. If a field is not visible or unclear, use null
4. The "quantity" is typically the number of drops/units being ordered
5. Look for patterns like "PO-XXXX" for PO numbers

Return ONLY valid JSON (no markdown, no explanation):

{
  "poNumber": "PO number (format: PO-XXXX or similar)",
  "reference": "Reference/project code (e.g., MAM.POP2, LAW.NOK)",
  "poDate": "Date in YYYY-MM-DD format",
  "quantity": 27781,
  "unitPrice": 2700.00,
  "vatRate": 15,
  "subtotal": 75008700.00,
  "vatAmount": 11251305.00,
  "total": 86260005.00,
  "description": "Full description text from PO",
  "confidence": 0.95
}

IMPORTANT extraction guidelines:
- PO Number: Look for "Purchase Order", "PO No", "PO #", "Order Number"
- Reference: Look for "Reference", "Ref", "Project", "Site Code"
- Quantity: Look for "Qty", "Quantity", "Units", "Drops", "No. of drops"
- Unit Price: Look for "Unit Price", "Price per Unit", "Rate", "Price/Drop"
- VAT: Usually 15% in South Africa, look for "VAT", "Tax"
- Total: Look for "Total", "Grand Total", "Amount Due"
- Description: Main service/product description

If multiple pages, focus on the main order details page.`;

// ============================================================================
// MAIN EXTRACTION FUNCTION
// ============================================================================

/**
 * Extract PO information from a document image using VLM
 * Uses VLM Learning System for few-shot examples to improve accuracy
 */
export async function extractPOFromImage(
  imageBase64: string,
  documentName?: string
): Promise<POExtractionResult & { success: boolean; error?: string; processingTimeMs: number; promptHash?: string }> {
  const startTime = Date.now();

  try {
    log.info('[POExtraction] Starting PO extraction', { documentName });

    // Validate input
    if (!imageBase64 || imageBase64.length < 100) {
      return createErrorResult('Invalid or empty image data', startTime);
    }

    // Prepare image data URL
    const imageDataUrl = imageBase64.startsWith('data:')
      ? imageBase64
      : `data:image/jpeg;base64,${imageBase64}`;

    // Get few-shot examples from VLM Learning System
    const [headerExamples, quantityExamples, pricingExamples] = await Promise.all([
      getVlmFewShotExamples({ module: 'procurement', analysisType: 'po_header', maxExamples: 2 }),
      getVlmFewShotExamples({ module: 'procurement', analysisType: 'po_quantity', maxExamples: 2 }),
      getVlmFewShotExamples({ module: 'procurement', analysisType: 'po_pricing', maxExamples: 2 }),
    ]);

    // Build enhanced prompt with few-shot examples
    const fewShotSection = buildPOFewShotSection(headerExamples, quantityExamples, pricingExamples);
    const enhancedPrompt = fewShotSection
      ? `${PO_EXTRACTION_PROMPT}\n\n${fewShotSection}`
      : PO_EXTRACTION_PROMPT;

    const promptHash = hashPromptContent(enhancedPrompt);

    // Call VLM API with enhanced prompt
    const response = await callVlmApi(imageDataUrl, enhancedPrompt);

    if (!response) {
      return createErrorResult('VLM API returned no response', startTime);
    }

    // Parse VLM response
    const extraction = parseVlmResponse(response);

    const processingTimeMs = Date.now() - startTime;
    log.info('[POExtraction] Extraction complete', {
      documentName,
      processingTimeMs,
      success: true,
      poNumber: extraction.poNumber,
      quantity: extraction.quantity,
      total: extraction.total,
      confidence: extraction.confidence,
      fewShotExamples: headerExamples.length + quantityExamples.length + pricingExamples.length,
    });

    // Record successful extraction metrics (non-blocking)
    if (extraction.confidence >= 0.7) {
      recordCorrectExtraction('procurement', 'po_header', extraction.confidence).catch((e) => log.debug('Non-blocking operation failed', { error: e instanceof Error ? e.message : 'unknown' }, 'po-extraction'));
      if (extraction.quantity) {
        recordCorrectExtraction('procurement', 'po_quantity', extraction.confidence).catch((e) => log.debug('Non-blocking operation failed', { error: e instanceof Error ? e.message : 'unknown' }, 'po-extraction'));
      }
      if (extraction.total || extraction.unitPrice) {
        recordCorrectExtraction('procurement', 'po_pricing', extraction.confidence).catch((e) => log.debug('Non-blocking operation failed', { error: e instanceof Error ? e.message : 'unknown' }, 'po-extraction'));
      }
    }

    return {
      ...extraction,
      success: true,
      processingTimeMs,
      promptHash,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log.error('[POExtraction] Extraction failed', { error: errorMsg, documentName });
    return createErrorResult(errorMsg, startTime);
  }
}

/**
 * Build few-shot section for PO extraction prompt
 */
function buildPOFewShotSection(
  headerExamples: Array<{ incorrect: string | null; correct: string; context?: string }>,
  quantityExamples: Array<{ incorrect: string | null; correct: string; context?: string }>,
  pricingExamples: Array<{ incorrect: string | null; correct: string; context?: string }>
): string {
  const allExamples = [...headerExamples, ...quantityExamples, ...pricingExamples];
  if (allExamples.length === 0) return '';

  return buildVlmFewShotPrompt(allExamples as Parameters<typeof buildVlmFewShotPrompt>[0]);
}

/**
 * Extract PO from multiple page images (for multi-page PDFs)
 * Uses first page with valid PO data
 */
export async function extractPOFromMultipleImages(
  images: string[],
  documentName?: string
): Promise<POExtractionResult & { success: boolean; error?: string; processingTimeMs: number }> {
  const startTime = Date.now();

  if (images.length === 0) {
    return createErrorResult('No images provided', startTime);
  }

  // For single image, use standard extraction
  const firstImage = images[0];
  if (images.length === 1 && firstImage) {
    return extractPOFromImage(firstImage, documentName);
  }

  log.info('[POExtraction] Processing multi-page document', {
    pageCount: images.length,
    documentName,
  });

  // Try first 3 pages to find best PO data
  const pagesToTry = Math.min(images.length, 3);
  let bestResult: (POExtractionResult & { success: boolean; error?: string; processingTimeMs: number }) | null = null;
  let bestConfidence = 0;

  for (let i = 0; i < pagesToTry; i++) {
    const pageImage = images[i];
    if (!pageImage) continue;
    const result = await extractPOFromImage(pageImage, `${documentName || 'doc'}_page${i + 1}`);

    if (result.success && result.confidence > bestConfidence) {
      bestConfidence = result.confidence;
      bestResult = result;

      // If we have high confidence, stop searching
      if (bestConfidence >= 0.85) {
        break;
      }
    }
  }

  if (bestResult) {
    const processingTimeMs = Date.now() - startTime;
    return {
      ...bestResult,
      processingTimeMs,
    };
  }

  return createErrorResult('Failed to extract PO data from any page', startTime);
}

// ============================================================================
// VLM API CALL
// ============================================================================

async function callVlmApi(imageDataUrl: string, prompt?: string): Promise<string | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), VLM_TIMEOUT_MS);

  try {
    const payload = {
      model: VLM_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt || PO_EXTRACTION_PROMPT },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        },
      ],
      temperature: VLM_TEMPERATURE,
      max_tokens: 2000,
    };

    const response = await fetch(VLM_API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      log.error('[POExtraction] VLM API error', {
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
      log.error('[POExtraction] VLM API timeout (90s)');
    } else {
      log.error('[POExtraction] VLM API call failed', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
    }
    return null;
  }
}

// ============================================================================
// RESPONSE PARSING
// ============================================================================

function parseVlmResponse(responseText: string): POExtractionResult {
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
      log.warn('[POExtraction] No JSON found in response', {
        response: responseText.substring(0, 300),
      });
      return createEmptyResult('No JSON in VLM response');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      poNumber: normalizeString(parsed.poNumber),
      reference: normalizeString(parsed.reference),
      poDate: normalizeDate(parsed.poDate),
      quantity: normalizeNumber(parsed.quantity),
      unitPrice: normalizeNumber(parsed.unitPrice),
      vatRate: normalizeNumber(parsed.vatRate),
      subtotal: normalizeNumber(parsed.subtotal),
      vatAmount: normalizeNumber(parsed.vatAmount),
      total: normalizeNumber(parsed.total),
      description: normalizeString(parsed.description),
      confidence: normalizeConfidence(parsed.confidence),
    };
  } catch (error) {
    log.error('[POExtraction] Failed to parse VLM response', {
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

  try {
    // Handle common date formats
    // DD/MM/YYYY or DD-MM-YYYY
    const dmyMatch = str.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (dmyMatch && dmyMatch[1] && dmyMatch[2] && dmyMatch[3]) {
      return `${dmyMatch[3]}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}`;
    }

    // YYYY/MM/DD or YYYY-MM-DD
    const ymdMatch = str.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (ymdMatch && ymdMatch[1] && ymdMatch[2] && ymdMatch[3]) {
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

function normalizeConfidence(value: unknown): number {
  if (typeof value === 'number' && value >= 0 && value <= 1) {
    return value;
  }
  return 0.7; // Default confidence
}

function createEmptyResult(note: string): POExtractionResult {
  return {
    poNumber: null,
    reference: null,
    poDate: null,
    quantity: null,
    unitPrice: null,
    vatRate: null,
    subtotal: null,
    vatAmount: null,
    total: null,
    description: null,
    confidence: 0,
  };
}

function createErrorResult(
  error: string,
  startTime: number
): POExtractionResult & { success: boolean; error: string; processingTimeMs: number } {
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
export function calculateExtractionConfidence(extraction: POExtractionResult): number {
  let score = 0;
  let maxScore = 0;

  // PO number (critical)
  maxScore += 25;
  if (extraction.poNumber) score += 25;

  // Quantity (critical)
  maxScore += 25;
  if (extraction.quantity) score += 25;

  // Unit price
  maxScore += 20;
  if (extraction.unitPrice) score += 20;

  // Total
  maxScore += 15;
  if (extraction.total) score += 15;

  // Date
  maxScore += 10;
  if (extraction.poDate) score += 10;

  // Reference (nice to have)
  maxScore += 5;
  if (extraction.reference) score += 5;

  return Math.round((score / maxScore) * 100) / 100;
}

/**
 * Validate extraction has minimum required data
 */
export function isValidExtraction(extraction: POExtractionResult): boolean {
  // Must have at least PO number or reference
  const hasIdentifier = extraction.poNumber || extraction.reference;

  // Must have quantity (drops)
  const hasQuantity = extraction.quantity !== null && extraction.quantity > 0;

  return Boolean(hasIdentifier && hasQuantity);
}

// ============================================================================
// VLM LEARNING INTEGRATION - CORRECTION RECORDING
// ============================================================================

/**
 * Record a PO extraction correction for VLM learning
 * Call this when a user edits VLM-extracted values in the form
 */
export async function recordPOExtractionCorrection(
  fieldType: 'po_header' | 'po_quantity' | 'po_pricing',
  vlmExtractedValue: string | number | null,
  correctedValue: string | number,
  context?: {
    projectId?: string;
    documentName?: string;
    vlmConfidence?: number;
    promptHash?: string;
    correctedByName?: string;
    correctedById?: string;
  }
): Promise<void> {
  try {
    // Only record if values actually differ
    const vlmStr = vlmExtractedValue?.toString() || '';
    const correctedStr = correctedValue.toString();

    if (vlmStr === correctedStr) {
      return; // No correction needed
    }

    await recordVlmCorrection({
      module: 'procurement',
      analysisType: fieldType,
      vlmExtractedValue: vlmStr || null,
      correctedValue: correctedStr,
      vlmConfidence: context?.vlmConfidence,
      vlmPromptHash: context?.promptHash,
      vlmModel: VLM_MODEL,
      correctionReason: detectCorrectionReason(vlmStr, correctedStr, fieldType),
      context: {
        projectId: context?.projectId,
        documentName: context?.documentName,
      },
      correctedByName: context?.correctedByName,
      correctedById: context?.correctedById,
    });

    log.info('[POExtraction] Recorded correction', {
      fieldType,
      vlmValue: vlmStr,
      correctedValue: correctedStr,
    });
  } catch (error) {
    // Don't fail the main operation if correction recording fails
    log.error('[POExtraction] Failed to record correction', { error });
  }
}

/**
 * Detect the correction reason based on value comparison
 */
function detectCorrectionReason(
  vlmValue: string,
  correctedValue: string,
  fieldType: string
): RecordCorrectionInput['correctionReason'] {
  if (!vlmValue) return 'ocr_failure';

  // Check for digit confusion in numeric fields
  if (fieldType === 'po_quantity' || fieldType === 'po_pricing') {
    const vlmNum = vlmValue.replace(/[^0-9.]/g, '');
    const correctNum = correctedValue.replace(/[^0-9.]/g, '');

    if (vlmNum.length === correctNum.length && vlmNum !== correctNum) {
      return 'digit_confusion';
    }

    // Check for decimal issues
    if (vlmNum.includes('.') !== correctNum.includes('.')) {
      return 'format_error';
    }
  }

  // Check for partial extraction
  if (correctedValue.includes(vlmValue) || vlmValue.includes(correctedValue)) {
    return 'partial_extraction';
  }

  return 'other';
}

/**
 * Batch record corrections for all changed fields in a PO form
 * Call this when saving a PO that was pre-populated from VLM extraction
 */
export async function recordPOFormCorrections(
  vlmExtraction: POExtractionResult,
  formData: {
    poNumber?: string;
    reference?: string;
    poDate?: string;
    contractedDrops?: number;
    pricePerDrop?: number;
  },
  context?: {
    projectId?: string;
    documentName?: string;
    vlmConfidence?: number;
    promptHash?: string;
    correctedByName?: string;
    correctedById?: string;
  }
): Promise<void> {
  const corrections: Array<Promise<void>> = [];

  // Check PO header fields
  if (formData.poNumber && formData.poNumber !== vlmExtraction.poNumber) {
    corrections.push(
      recordPOExtractionCorrection('po_header', vlmExtraction.poNumber, formData.poNumber, context)
    );
  }
  if (formData.reference && formData.reference !== vlmExtraction.reference) {
    corrections.push(
      recordPOExtractionCorrection('po_header', vlmExtraction.reference, formData.reference, context)
    );
  }
  if (formData.poDate && formData.poDate !== vlmExtraction.poDate) {
    corrections.push(
      recordPOExtractionCorrection('po_header', vlmExtraction.poDate, formData.poDate, context)
    );
  }

  // Check quantity
  if (formData.contractedDrops && formData.contractedDrops !== vlmExtraction.quantity) {
    corrections.push(
      recordPOExtractionCorrection('po_quantity', vlmExtraction.quantity, formData.contractedDrops, context)
    );
  }

  // Check pricing
  if (formData.pricePerDrop && formData.pricePerDrop !== vlmExtraction.unitPrice) {
    corrections.push(
      recordPOExtractionCorrection('po_pricing', vlmExtraction.unitPrice, formData.pricePerDrop, context)
    );
  }

  // Execute all corrections in parallel
  await Promise.all(corrections);
}
