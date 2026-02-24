/**
 * Asset VLM Extraction Service
 *
 * Purpose: Extract asset information from equipment labels using VLM
 * - Manufacturer/Brand
 * - Model number
 * - Serial number
 * - Manufacture date
 *
 * Status: WORKING - Phase 1 Asset Procurement Integration
 *
 * NLNH Confidence: HIGH
 */

import { log } from '@/lib/logger';
import { recordCorrectExtraction } from '@/services/vlmLearningService';

// ============================================================================
// CONFIGURATION
// ============================================================================

const VLM_API_BASE = process.env.VLM_API_URL || 'http://100.96.203.105:8100';
const VLM_API_ENDPOINT = `${VLM_API_BASE}/v1/chat/completions`;
const VLM_MODEL = process.env.VLM_EXTRACTION_MODEL || 'Qwen/Qwen3-VL-8B-Instruct';
const VLM_TIMEOUT_MS = 60000;
const VLM_TEMPERATURE = 0.1;

// ============================================================================
// TYPES
// ============================================================================

/**
 * Extracted asset label information
 */
export interface AssetLabelExtraction {
  /** Whether extraction was successful */
  success: boolean;
  /** Manufacturer or brand name */
  manufacturer: string | null;
  /** Product model number/name */
  model: string | null;
  /** Serial number */
  serialNumber: string | null;
  /** Manufacture date in YYYY-MM or YYYY format */
  manufactureDate: string | null;
  /** Barcode value if visible */
  barcode: string | null;
  /** VLM confidence score 0-1 */
  confidence: number;
  /** Raw text visible on label */
  rawText: string;
  /** Error message if extraction failed */
  error?: string;
}

/**
 * VLM API response structure
 */
interface VlmResponse {
  choices: Array<{
    message: {
      content: string;
    };
  }>;
}

// ============================================================================
// PROMPTS
// ============================================================================

const ASSET_LABEL_EXTRACTION_PROMPT = `You are analyzing an equipment/asset label photo. Extract the following information:

1. MANUFACTURER - The company/brand name (e.g., Brady, Sumitomo, Fluke, EXFO)
2. MODEL - The product model number or name (e.g., M210, TYPE-71C+, DTX-1800)
3. SERIAL NUMBER - Look for S/N, Serial, SN: followed by alphanumeric code
4. MFG DATE - Manufacture date (look for MFG, Date, or year patterns like 2024-01)
5. BARCODE - Any visible barcode numbers

IMPORTANT:
- Extract EXACTLY what you see, don't guess
- Serial numbers are usually alphanumeric (letters + numbers)
- Model numbers often have dashes or numbers
- If a field is not visible, return null

Return ONLY a JSON object (no markdown, no explanation):
{
  "manufacturer": "string or null",
  "model": "string or null",
  "serialNumber": "string or null",
  "manufactureDate": "string or null",
  "barcode": "string or null",
  "confidence": 0.0-1.0,
  "rawText": "all visible text on label"
}`;

// ============================================================================
// MAIN EXTRACTION FUNCTION
// ============================================================================

/**
 * Extract asset information from a label image using VLM
 */
export async function extractAssetFromLabel(
  imageBase64: string
): Promise<AssetLabelExtraction> {
  const startTime = Date.now();

  try {
    log.info('[AssetVLM] Starting label extraction');

    // Validate input
    if (!imageBase64 || imageBase64.length < 100) {
      return createErrorResult('Invalid or empty image data');
    }

    // Prepare image data URL
    const imageDataUrl = imageBase64.startsWith('data:')
      ? imageBase64
      : `data:image/jpeg;base64,${imageBase64}`;

    // Call VLM API
    const response = await callVlmApi(imageDataUrl);

    if (!response) {
      return createErrorResult('VLM API returned no response');
    }

    // Parse VLM response
    const extraction = parseVlmResponse(response);

    const duration = Date.now() - startTime;
    log.info('[AssetVLM] Extraction complete', {
      duration,
      success: extraction.success,
      hasManufacturer: !!extraction.manufacturer,
      hasModel: !!extraction.model,
      hasSerial: !!extraction.serialNumber,
      confidence: extraction.confidence,
    });

    // Record VLM learning metric (fire-and-forget)
    if (extraction.success && extraction.confidence >= 0.7) {
      recordCorrectExtraction('assets', 'equipment_label', extraction.confidence)
        .catch(() => {});
    }

    return extraction;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    log.error('[AssetVLM] Extraction failed', { error: errorMsg });
    return createErrorResult(errorMsg);
  }
}

/**
 * Extract asset info from an image URL (fetches and converts to base64)
 */
export async function extractAssetFromImageUrl(
  imageUrl: string
): Promise<AssetLabelExtraction> {
  try {
    log.info('[AssetVLM] Fetching image from URL', { url: imageUrl.substring(0, 100) });

    const response = await fetch(imageUrl);
    if (!response.ok) {
      return createErrorResult(`Failed to fetch image: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    const base64 = Buffer.from(arrayBuffer).toString('base64');

    return extractAssetFromLabel(base64);
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : 'Unknown error';
    return createErrorResult(`Failed to fetch image: ${errorMsg}`);
  }
}

// ============================================================================
// VLM API CALL
// ============================================================================

async function callVlmApi(imageDataUrl: string): Promise<string | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), VLM_TIMEOUT_MS);

  try {
    const payload = {
      model: VLM_MODEL,
      messages: [
        {
          role: 'user',
          content: [
            { type: 'text', text: ASSET_LABEL_EXTRACTION_PROMPT },
            { type: 'image_url', image_url: { url: imageDataUrl } },
          ],
        },
      ],
      temperature: VLM_TEMPERATURE,
      max_tokens: 1000,
    };

    const response = await fetch(VLM_API_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      log.error('[AssetVLM] VLM API error', {
        status: response.status,
        statusText: response.statusText,
      });
      return null;
    }

    const data = (await response.json()) as VlmResponse;
    return data.choices?.[0]?.message?.content || null;
  } catch (error) {
    clearTimeout(timeoutId);
    if (error instanceof Error && error.name === 'AbortError') {
      log.error('[AssetVLM] VLM API timeout');
    } else {
      log.error('[AssetVLM] VLM API call failed', {
        error: error instanceof Error ? error.message : 'Unknown',
      });
    }
    return null;
  }
}

// ============================================================================
// RESPONSE PARSING
// ============================================================================

function parseVlmResponse(responseText: string): AssetLabelExtraction {
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
      log.warn('[AssetVLM] No JSON found in response', {
        response: responseText.substring(0, 200),
      });
      return createErrorResult('No JSON in VLM response');
    }

    const parsed = JSON.parse(jsonMatch[0]);

    // Validate and normalize
    return {
      success: true,
      manufacturer: normalizeString(parsed.manufacturer),
      model: normalizeString(parsed.model),
      serialNumber: normalizeString(parsed.serialNumber),
      manufactureDate: normalizeString(parsed.manufactureDate),
      barcode: normalizeString(parsed.barcode),
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.5,
      rawText: parsed.rawText || '',
    };
  } catch (error) {
    log.error('[AssetVLM] Failed to parse VLM response', {
      error: error instanceof Error ? error.message : 'Unknown',
      response: responseText.substring(0, 200),
    });
    return createErrorResult('Failed to parse VLM response');
  }
}

// ============================================================================
// HELPERS
// ============================================================================

function normalizeString(value: unknown): string | null {
  if (value === null || value === undefined || value === 'null') {
    return null;
  }
  const str = String(value).trim();
  return str.length > 0 ? str : null;
}

function createErrorResult(error: string): AssetLabelExtraction {
  return {
    success: false,
    manufacturer: null,
    model: null,
    serialNumber: null,
    manufactureDate: null,
    barcode: null,
    confidence: 0,
    rawText: '',
    error,
  };
}
